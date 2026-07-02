import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewShards,
  mergeReviewResults,
  resolveAutoReviewStrategy,
  runAutoReviewPasses,
} from "../skills/code-review-loop/scripts/ai-review.mjs";
import { parseArgs } from "../skills/code-review-loop/scripts/collect-context.mjs";

const providersConfig = {
  defaultProvider: "primary",
  providers: {
    primary: {
      model: "primary-model",
      baseUrl: "https://primary.example/v1",
      apiStyle: "chat",
      transport: "openai-compatible",
    },
  },
};

function passResult(overrides = {}) {
  return {
    verdict: "pass",
    summary: "ok",
    blocking_findings: [],
    warnings: [],
    verification_notes: [],
    confidence: 0.95,
    ...overrides,
  };
}

function reviewContext(files) {
  return {
    root: "/repo",
    generatedAt: "2026-07-01 00:00:00",
    scope: { base: "HEAD", staged: false, paths: [] },
    profile: { requested: "auto", selected: "high-accuracy", reasons: [], appliedOptions: {} },
    reviewLimits: { maxReviewRounds: 3 },
    maxBriefBytes: 600000,
    status: " M src/a.js",
    diffStat: "src/a.js | 1 +",
    diff: files.map((file) => `diff --git a/${file} b/${file}\n+change in ${file}\n`).join("\n"),
    changedFiles: files,
    projectRules: "rules",
    docs: [{ label: "用户需求", path: ".ai-review/review-context/current-request.md", content: "do the work" }],
    fileContexts: files.map((file) => ({ path: file, content: `content for ${file}` })),
    codegraphContext: null,
    verification: [],
  };
}

function weightedDiff(entries) {
  return Object.entries(entries)
    .map(([file, content]) => `diff --git a/${file} b/${file}\n+++ b/${file}\n${content}\n`)
    .join("\n");
}

test("parseArgs accepts automatic review shard limit option", () => {
  const args = parseArgs(["--max-shards", "3"]);

  assert.equal(args.maxShards, 3);
});

test("resolveAutoReviewStrategy chooses sharded mode for large auto reviews", () => {
  const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`);
  const strategy = resolveAutoReviewStrategy({
    context: reviewContext(files),
    brief: "brief",
    options: parseArgs(["--profile", "auto"]),
  });

  assert.equal(strategy.mode, "sharded");
  assert.ok(strategy.reasons.some((reason) => reason.includes("变更文件数量")));
});

test("resolveAutoReviewStrategy keeps non-auto profiles on single review", () => {
  const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`);
  const strategy = resolveAutoReviewStrategy({
    context: reviewContext(files),
    brief: "brief",
    options: parseArgs(["--profile", "high-accuracy"]),
  });

  assert.equal(strategy.mode, "single");
  assert.ok(strategy.reasons.some((reason) => reason.includes("仅 --profile auto")));
});

test("resolveAutoReviewStrategy keeps max-shards one on single review", () => {
  const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`);
  const strategy = resolveAutoReviewStrategy({
    context: reviewContext(files),
    brief: "brief",
    options: parseArgs(["--profile", "auto", "--max-shards", "1"]),
  });

  assert.equal(strategy.mode, "single");
  assert.ok(strategy.reasons.some((reason) => reason.includes("小于 2")));
});

test("resolveAutoReviewStrategy lets environment configure shard limit when CLI is silent", () => {
  const previous = process.env.AI_REVIEW_MAX_SHARDS;
  process.env.AI_REVIEW_MAX_SHARDS = "6";
  try {
    const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`);
    const strategy = resolveAutoReviewStrategy({
      context: reviewContext(files),
      brief: "brief",
      options: parseArgs(["--profile", "auto"]),
    });

    assert.equal(strategy.maxShards, 6);
  } finally {
    if (previous === undefined) {
      delete process.env.AI_REVIEW_MAX_SHARDS;
    } else {
      process.env.AI_REVIEW_MAX_SHARDS = previous;
    }
  }
});

test("buildReviewShards keeps every changed file in a bounded shard set", () => {
  const files = [
    "src/a.js",
    "src/b.js",
    "tests/a.test.js",
    "docs/guide.md",
    "scripts/run.mjs",
  ];
  const shards = buildReviewShards(files, 3);
  const flattened = shards.flatMap((shard) => shard.files).sort();

  assert.equal(shards.length, 3);
  assert.deepEqual(flattened, [...files].sort());
});

test("buildReviewShards balances shards by diff size", () => {
  const files = [
    "src/large.js",
    "src/small-a.js",
    "src/small-b.js",
    "docs/tiny.md",
  ];
  const shards = buildReviewShards(files, 2, weightedDiff({
    "src/large.js": "+".repeat(4000),
    "src/small-a.js": "+".repeat(100),
    "src/small-b.js": "+".repeat(100),
    "docs/tiny.md": "+".repeat(100),
  }));

  assert.deepEqual(shards.find((shard) => shard.files.includes("src/large.js")).files, ["src/large.js"]);
});

test("buildReviewShards keeps small modules together before splitting oversized ones", () => {
  const files = [
    "src/feature/a.js",
    "src/feature/b.js",
    "tests/large.test.js",
    "docs/tiny.md",
  ];
  const shards = buildReviewShards(files, 2, weightedDiff({
    "src/feature/a.js": "+".repeat(100),
    "src/feature/b.js": "+".repeat(100),
    "tests/large.test.js": "+".repeat(4000),
    "docs/tiny.md": "+".repeat(100),
  }));
  const srcShard = shards.find((shard) => shard.files.includes("src/feature/a.js"));

  assert.ok(srcShard.files.includes("src/feature/b.js"));
});

test("mergeReviewResults keeps matching findings from different files distinct", () => {
  const finding = {
    severity: "P1",
    title: "Same bug",
    evidence: "same evidence",
    impact: "same impact",
    suggested_fix: "same fix",
  };
  const merged = mergeReviewResults(
    passResult({ verdict: "fail", blocking_findings: [{ ...finding, file: "src/a.js", line: 1 }] }),
    passResult({ verdict: "fail", blocking_findings: [{ ...finding, file: "src/b.js", line: 1 }] }),
  );

  assert.equal(merged.blocking_findings.length, 2);
});

test("runAutoReviewPasses runs sharded reviews and then an aggregate review", async () => {
  const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`);
  const context = reviewContext(files);
  const seenBriefs = [];

  const run = await runAutoReviewPasses({
    context,
    brief: "large brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: parseArgs(["--profile", "auto", "--max-shards", "3"]),
    primaryResolved: { provider: "primary", model: "primary-model" },
    callReviewModelFn: async ({ brief }) => {
      seenBriefs.push(brief);
      return passResult({
        summary: brief.includes("自动分片审核汇总上下文") ? "aggregate ok" : "shard ok",
      });
    },
  });

  assert.equal(seenBriefs.length, 4);
  assert.equal(seenBriefs.filter((brief) => brief.includes("自动分片审核汇总上下文")).length, 1);
  assert.equal(run.result.verdict, "pass");
  assert.ok(run.result.verification_notes.some((note) => note.includes("自动分片审核")));
});

test("runAutoReviewPasses does not aggregate to pass when a shard fails", async () => {
  const files = Array.from({ length: 12 }, (_, index) => `src/file-${index}.js`);
  const context = reviewContext(files);
  let callCount = 0;

  const run = await runAutoReviewPasses({
    context,
    brief: "large brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: parseArgs(["--profile", "auto", "--max-shards", "3"]),
    primaryResolved: { provider: "primary", model: "primary-model" },
    callReviewModelFn: async () => {
      callCount += 1;
      if (callCount === 2) {
        throw new Error("shard failed");
      }
      return passResult({ summary: "shard ok" });
    },
  });

  assert.equal(callCount, 3);
  assert.equal(run.result.verdict, "needs_human");
  assert.equal(run.result.reviewer_failures.length, 1);
  assert.ok(run.result.verification_notes.some((note) => note.includes("未完整完成")));
});
