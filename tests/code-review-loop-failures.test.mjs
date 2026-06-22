import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  runRequirementAudit,
  runReviewPasses,
} from "../skills/code-review-loop/scripts/ai-review.mjs";
import {
  buildHistoryEntry,
  renderHistoryMarkdownEntry,
} from "../skills/code-review-loop/scripts/review-display.mjs";
import {
  buildRequirementAuditCacheKey,
  loadRequirementAuditorPrompt,
  readCachedRequirementAudit,
  writeCachedRequirementAudit,
} from "../skills/code-review-loop/scripts/requirement-audit.mjs";
import { renderMarkdownReport } from "../skills/code-review-loop/scripts/review-report.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function failResult(overrides = {}) {
  return {
    verdict: "fail",
    summary: "requirements mismatch",
    blocking_findings: [
      {
        severity: "P1",
        title: "Mismatch",
        file: ".ai-review/review-context/current-request.md",
        line: 1,
        evidence: "bad understanding",
        impact: "wrong review",
        suggested_fix: "fix context",
      },
    ],
    warnings: [],
    verification_notes: [],
    confidence: 0.9,
    ...overrides,
  };
}

function secondReviewerOptions(extraArgs = []) {
  return {
    secondProvider: "second",
    secondModel: "second-model",
    secondBaseUrl: "https://second.example/v1",
    secondApiKey: "second-key",
    secondReviewMode: "always",
    ...Object.fromEntries(extraArgs),
  };
}

const providersConfig = {
  defaultProvider: "primary",
  providers: {
    primary: {
      model: "primary-model",
      baseUrl: "https://primary.example/v1",
      apiStyle: "chat",
      transport: "openai-compatible",
    },
    second: {
      model: "second-model",
      baseUrl: "https://second.example/v1",
      apiStyle: "chat",
      transport: "openai-compatible",
    },
  },
};

test("runReviewPasses records structured failure when second reviewer times out", async () => {
  const timeoutError = new Error("The operation was aborted.");
  timeoutError.name = "AbortError";
  timeoutError.timeoutMs = 60000;
  timeoutError.attempts = 1;

  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: secondReviewerOptions(),
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: { provider: "second", model: "second-model" },
    callReviewModelFn: async ({ options }) => {
      if (options.usePrimaryEnv === false) throw timeoutError;
      return passResult({ summary: "primary ok" });
    },
  });

  assert.equal(reviewRun.result.verdict, "pass");
  assert.equal(reviewRun.result.summary, "primary ok");
  assert.deepEqual(reviewRun.result.reviewer_failures, [
    {
      phase: "code_review",
      reviewer: "second",
      provider: "second",
      model: "second-model",
      category: "timeout",
      retryable: true,
      message: "The operation was aborted.",
      status: null,
      attempts: 1,
    },
  ]);
  assert.match(reviewRun.result.verification_notes.join("\n"), /二审模型失败/);
});

test("runReviewPasses returns needs_human with both structured failures when both reviewers fail", async () => {
  const primaryError = new TypeError("fetch failed");
  primaryError.code = "ECONNRESET";
  primaryError.attempts = 2;
  const secondError = new Error("Model request failed (401): unauthorized");
  secondError.status = 401;
  secondError.attempts = 1;

  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: secondReviewerOptions(),
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: { provider: "second", model: "second-model" },
    callReviewModelFn: async ({ options }) => {
      if (options.usePrimaryEnv === false) throw secondError;
      throw primaryError;
    },
  });

  assert.equal(reviewRun.result.verdict, "needs_human");
  assert.deepEqual(reviewRun.result.reviewer_failures.map((failure) => failure.category), [
    "network",
    "auth",
  ]);
  assert.deepEqual(reviewRun.result.reviewer_failures.map((failure) => failure.reviewer), [
    "primary",
    "second",
  ]);
});

test("runReviewPasses returns needs_human with a structured failure when only primary reviewer fails", async () => {
  const timeoutError = new Error("primary timed out");
  timeoutError.name = "AbortError";
  timeoutError.timeoutMs = 120000;
  timeoutError.attempts = 2;

  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: {},
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: null,
    callReviewModelFn: async () => {
      throw timeoutError;
    },
  });

  assert.equal(reviewRun.result.verdict, "needs_human");
  assert.deepEqual(reviewRun.result.reviewer_failures, [
    {
      phase: "code_review",
      reviewer: "primary",
      provider: "primary",
      model: "primary-model",
      category: "timeout",
      retryable: true,
      message: "primary timed out",
      status: null,
      attempts: 2,
    },
  ]);
});

for (const scenario of [
  {
    name: "missing API key",
    options: {
      secondProvider: "second",
      secondModel: "second-model",
      secondBaseUrl: "https://second.example/v1",
      secondReviewMode: "always",
    },
    expectedProvider: "second",
    expectedModel: "second-model",
    expectedMessage: /Missing API key/,
  },
  {
    name: "unknown provider",
    options: {
      secondProvider: "missing-provider",
      secondModel: "second-model",
      secondReviewMode: "always",
    },
    expectedProvider: "missing-provider",
    expectedModel: "second-model",
    expectedMessage: /Unknown provider/,
  },
  {
    name: "missing base URL",
    options: {
      secondProvider: "missing-base-url",
      secondModel: "missing-base-url-model",
      secondApiKey: "second-key",
      secondReviewMode: "always",
    },
    providersConfig: {
      ...providersConfig,
      providers: {
        ...providersConfig.providers,
        "missing-base-url": {
          model: "missing-base-url-model",
          apiStyle: "chat",
          transport: "openai-compatible",
        },
      },
    },
    expectedProvider: "missing-base-url",
    expectedModel: "missing-base-url-model",
    expectedMessage: /Missing base URL/,
  },
]) {
  test(`runReviewPasses records structured config failure when second reviewer has ${scenario.name}`, async () => {
    const reviewers = [];
    const reviewRun = await runReviewPasses({
      brief: "brief",
      assets: {
        systemPrompt: "prompt",
        schema: {},
        providersConfig: scenario.providersConfig || providersConfig,
      },
      options: scenario.options,
      primaryResolved: { provider: "primary", model: "primary-model" },
      secondResolved: null,
      callReviewModelFn: async ({ options }) => {
        reviewers.push(options.usePrimaryEnv === false ? "second" : "primary");
        return passResult({ summary: "primary ok" });
      },
    });

    assert.deepEqual(reviewers, ["primary"]);
    assert.equal(reviewRun.result.verdict, "pass");
    assert.equal(reviewRun.result.reviewer_failures?.length, 1);
    const [failure] = reviewRun.result.reviewer_failures;
    assert.deepEqual(
      {
        ...failure,
        message: "<checked separately>",
      },
      {
        phase: "code_review",
        reviewer: "second",
        provider: scenario.expectedProvider,
        model: scenario.expectedModel,
        category: "config",
        retryable: false,
        message: "<checked separately>",
        status: null,
        attempts: null,
      },
    );
    assert.match(failure.message, scenario.expectedMessage);
  });
}

test("runReviewPasses does not record second config failure in auto mode when second review is not triggered", async () => {
  const reviewers = [];
  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: {
      secondProvider: "second",
      secondModel: "second-model",
      secondBaseUrl: "https://second.example/v1",
      secondReviewMode: "auto",
      secondConfidenceThreshold: 0.8,
    },
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: null,
    callReviewModelFn: async ({ options }) => {
      reviewers.push(options.usePrimaryEnv === false ? "second" : "primary");
      return passResult({ summary: "primary ok", confidence: 0.95 });
    },
  });

  assert.deepEqual(reviewers, ["primary"]);
  assert.equal(reviewRun.result.verdict, "pass");
  assert.equal(reviewRun.result.reviewer_failures, undefined);
  assert.deepEqual(reviewRun.resolved, {
    primary: { provider: "primary", model: "primary-model" },
    second: null,
  });
});

test("runReviewPasses records second config failure in auto mode when second review would be triggered", async () => {
  const reviewers = [];
  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options: {
      secondProvider: "second",
      secondModel: "second-model",
      secondBaseUrl: "https://second.example/v1",
      secondReviewMode: "auto",
      secondConfidenceThreshold: 0.8,
    },
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: null,
    callReviewModelFn: async ({ options }) => {
      reviewers.push(options.usePrimaryEnv === false ? "second" : "primary");
      return passResult({ summary: "primary low confidence", confidence: 0.5 });
    },
  });

  assert.deepEqual(reviewers, ["primary"]);
  assert.equal(reviewRun.result.verdict, "pass");
  assert.equal(reviewRun.result.reviewer_failures?.length, 1);
  assert.equal(reviewRun.result.reviewer_failures[0].reviewer, "second");
  assert.equal(reviewRun.result.reviewer_failures[0].category, "config");
});

test("classifyReviewError categorizes common model invocation failures", async () => {
  const { classifyReviewError } = await import("../skills/code-review-loop/scripts/call-model.mjs");

  const timeout = new Error("aborted");
  timeout.name = "AbortError";
  assert.equal(classifyReviewError(timeout).category, "timeout");

  const network = new TypeError("fetch failed");
  assert.equal(classifyReviewError(network).category, "network");

  const auth = new Error("unauthorized");
  auth.status = 401;
  assert.equal(classifyReviewError(auth).category, "auth");

  const httpAuthWithConfigText = new Error("Missing API key");
  httpAuthWithConfigText.status = 401;
  assert.equal(classifyReviewError(httpAuthWithConfigText).category, "auth");

  const rateLimit = new Error("too many requests");
  rateLimit.status = 429;
  assert.equal(classifyReviewError(rateLimit).category, "rate_limit");

  const server = new Error("bad gateway");
  server.status = 502;
  assert.equal(classifyReviewError(server).category, "server");

  const config = new Error("Missing API key for provider");
  assert.equal(classifyReviewError(config).category, "config");

  const badResponse = new Error("Reviewer response did not contain valid JSON.");
  assert.equal(classifyReviewError(badResponse).category, "bad_response");

  const cli = new Error("CLI reviewer failed (2): nope");
  assert.equal(classifyReviewError(cli).category, "cli");
});

test("renderMarkdownReport displays structured reviewer failures", () => {
  const report = renderMarkdownReport({
    verdict: "needs_human",
    summary: "model failed",
    blocking_findings: [],
    warnings: [],
    verification_notes: [],
    reviewer_failures: [
      {
        phase: "code_review",
        reviewer: "primary",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        category: "timeout",
        retryable: true,
        message: "aborted",
        status: null,
        attempts: 2,
      },
    ],
    confidence: 0,
  });

  assert.match(report, /审核运行失败原因/);
  assert.match(report, /primary/);
  assert.match(report, /timeout/);
  assert.match(report, /aborted/);
});

test("history markdown displays structured reviewer failures", () => {
  const entry = buildHistoryEntry({
    result: {
      verdict: "needs_human",
      summary: "model failed",
      blocking_findings: [],
      warnings: [],
      verification_notes: [],
      reviewer_failures: [
        {
          phase: "requirement_audit",
          reviewer: "requirement-auditor",
          provider: "openai",
          model: "gpt-5.5",
          category: "network",
          retryable: true,
          message: "fetch failed",
          status: null,
          attempts: 1,
        },
      ],
      confidence: 0,
    },
  });
  const markdown = renderHistoryMarkdownEntry(entry);

  assert.match(markdown, /审核运行失败原因/);
  assert.match(markdown, /requirement-auditor/);
  assert.match(markdown, /network/);
  assert.match(markdown, /fetch failed/);
});

test("requirement audit cache key ignores generated time but tracks requirement inputs", () => {
  const baseContext = {
    root: "/repo",
    generatedAt: "2026-06-22 10:00:00",
    projectRules: "rules",
    docs: [
      { label: "request", path: ".ai-review/review-context/current-request.md", content: "do x" },
    ],
  };
  const reviewer = { provider: "primary", model: "primary-model" };

  const first = buildRequirementAuditCacheKey({
    context: baseContext,
    auditPrompt: "audit prompt",
    primaryResolved: reviewer,
  });
  const sameInputsDifferentTime = buildRequirementAuditCacheKey({
    context: { ...baseContext, generatedAt: "2026-06-22 10:01:00" },
    auditPrompt: "audit prompt",
    primaryResolved: reviewer,
  });
  const changedRequest = buildRequirementAuditCacheKey({
    context: {
      ...baseContext,
      docs: [{ ...baseContext.docs[0], content: "do y" }],
    },
    auditPrompt: "audit prompt",
    primaryResolved: reviewer,
  });

  assert.equal(first, sameInputsDifferentTime);
  assert.notEqual(first, changedRequest);
});

test("requirement audit cache key tracks full document hashes beyond snippets", () => {
  const baseDoc = {
    label: "request",
    path: ".ai-review/review-context/current-request.md",
    content: "same visible snippet",
    contentHash: "full-hash-a",
    contentBytes: 50000,
  };
  const baseContext = {
    root: "/repo",
    projectRules: "rules",
    docs: [baseDoc],
  };
  const reviewer = { provider: "primary", model: "primary-model" };

  const first = buildRequirementAuditCacheKey({
    context: baseContext,
    auditPrompt: "audit prompt",
    primaryResolved: reviewer,
  });
  const changedTail = buildRequirementAuditCacheKey({
    context: {
      ...baseContext,
      docs: [{ ...baseDoc, contentHash: "full-hash-b" }],
    },
    auditPrompt: "audit prompt",
    primaryResolved: reviewer,
  });

  assert.notEqual(first, changedTail);
});

test("requirement audit cache only reuses pass results for the matching key", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "requirement-audit-cache-"));
  try {
    const result = passResult({
      summary: "requirements ok",
      verification_notes: ["fresh audit"],
    });

    await writeCachedRequirementAudit(tempDir, "cache-key", result);
    const cached = await readCachedRequirementAudit(tempDir, "cache-key");
    assert.equal(cached.verdict, "pass");
    assert.match(cached.verification_notes[0], /缓存/);
    assert.equal(cached.verification_notes[1], "fresh audit");

    const miss = await readCachedRequirementAudit(tempDir, "other-key");
    assert.equal(miss, null);

    await writeCachedRequirementAudit(tempDir, "fail-key", {
      ...result,
      verdict: "fail",
    });
    assert.equal(await readCachedRequirementAudit(tempDir, "fail-key"), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("requirement audit cache write failures are non-fatal", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "requirement-audit-cache-failure-"));
  try {
    const fileAsOutDir = path.join(tempDir, "not-a-directory");
    await writeFile(fileAsOutDir, "file", "utf8");

    await assert.doesNotReject(() => writeCachedRequirementAudit(
      fileAsOutDir,
      "cache-key",
      passResult(),
    ));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("cached requirement audit pass can feed the code review flow", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "requirement-audit-flow-"));
  try {
    const context = {
      root: tempDir,
      generatedAt: "2026-06-22 10:00:00",
      projectRules: "rules",
      docs: [
        {
          label: "request",
          path: ".ai-review/review-context/current-request.md",
          content: "do x",
          contentHash: "hash-x",
          contentBytes: 4,
        },
      ],
    };
    const primaryResolved = { provider: "primary", model: "primary-model" };
    const auditPrompt = await loadRequirementAuditorPrompt();
    const cacheKey = buildRequirementAuditCacheKey({ context, auditPrompt, primaryResolved });
    await writeCachedRequirementAudit(tempDir, cacheKey, passResult({ summary: "cached audit" }));

    const audit = await runRequirementAudit({
      context,
      outDir: tempDir,
      assets: { schema: {}, providersConfig },
      options: {},
      primaryResolved,
      callReviewModelFn: async () => {
        throw new Error("requirement model should not run on cache hit");
      },
    });
    assert.equal(audit.result.summary, "cached audit");

    const reviewers = [];
    const reviewRun = await runReviewPasses({
      brief: "brief",
      assets: { systemPrompt: "prompt", schema: {}, providersConfig },
      options: {},
      primaryResolved,
      secondResolved: null,
      callReviewModelFn: async () => {
        reviewers.push("code-review");
        return passResult({ summary: "code review ran" });
      },
    });

    assert.deepEqual(reviewers, ["code-review"]);
    assert.equal(reviewRun.result.summary, "code review ran");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("fresh non-pass requirement audit clears a matching old pass cache", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "requirement-audit-clear-"));
  try {
    const context = {
      root: tempDir,
      generatedAt: "2026-06-22 10:00:00",
      projectRules: "rules",
      docs: [
        {
          label: "request",
          path: ".ai-review/review-context/current-request.md",
          content: "do x",
          contentHash: "hash-x",
          contentBytes: 4,
        },
      ],
    };
    const primaryResolved = { provider: "primary", model: "primary-model" };
    const auditPrompt = await loadRequirementAuditorPrompt();
    const cacheKey = buildRequirementAuditCacheKey({ context, auditPrompt, primaryResolved });
    await writeCachedRequirementAudit(tempDir, cacheKey, passResult({ summary: "old pass" }));

    const audit = await runRequirementAudit({
      context,
      outDir: tempDir,
      assets: { schema: {}, providersConfig },
      options: { noRequirementAuditCache: true },
      primaryResolved,
      callReviewModelFn: async () => failResult(),
    });

    assert.equal(audit.result.verdict, "fail");
    assert.equal(await readCachedRequirementAudit(tempDir, cacheKey), null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ai-review writes structured failure output when primary provider config is invalid", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "code-review-loop-config-failure-"));
  try {
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await mkdir(path.join(tempDir, ".ai-review", "review-context"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".ai-review", "review-context", "current-request.md"),
      [
        "# 当前审核需求上下文",
        "## 用户原始请求（原文）",
        "test",
        "## 用户后续纠正/澄清（原文）",
        "无。",
        "## 当前模型理解（待审核，不得当作事实）",
        "test",
        "## 明确反例/非期望行为",
        "无。",
        "## 验收标准",
        "test",
        "",
      ].join("\n"),
      "utf8",
    );

    const scriptPath = path.join(repoRoot, "skills", "code-review-loop", "scripts", "ai-review.mjs");
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--allow-empty", "--provider", "missing-provider"],
      { cwd: tempDir, windowsHide: true },
    ).catch((error) => {
      assert.equal(error.code, 3);
      return error;
    });
    assert.match(stdout, /AI 审核结论/);

    const result = JSON.parse(await readFile(path.join(tempDir, ".ai-review", "latest-result.json"), "utf8"));
    assert.equal(result.verdict, "needs_human");
    assert.deepEqual(result.reviewer_failures.map((failure) => failure.category), ["config"]);
    assert.deepEqual(result.reviewer_failures.map((failure) => failure.reviewer), ["primary"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
