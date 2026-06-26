import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecondReviewOptions,
  resolveMaxReviewRounds,
  runReviewPasses,
  shouldRunSecondReview,
} from "../skills/code-review-loop/scripts/ai-review.mjs";
import { resolveProviderOptions } from "../skills/code-review-loop/scripts/call-model.mjs";
import { parseArgs, renderReviewBrief } from "../skills/code-review-loop/scripts/collect-context.mjs";

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

const providerBudgetConfig = {
  defaultProvider: "cli",
  providers: {
    cli: {
      model: "cli-reviewer",
      transport: "cli",
      timeoutMs: 180000,
      retries: 0,
    },
    second: {
      model: "second-model",
      baseUrl: "https://second.example/v1",
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

function secondReviewerOptions(extraArgs = []) {
  return parseArgs([
    "--second-provider",
    "second",
    "--second-model",
    "second-model",
    "--second-base-url",
    "https://second.example/v1",
    "--second-api-key",
    "second-key",
    ...extraArgs,
  ]);
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("condition was not reached");
}

test("parseArgs accepts second-review timeout, retry, and confidence threshold options", () => {
  const args = parseArgs([
    "--second-timeout-ms",
    "45000",
    "--second-retries",
    "2",
    "--second-retry-fast-failure-ms",
    "8000",
    "--second-retry-delay-ms",
    "1000",
    "--second-confidence-threshold",
    "0.7",
  ]);

  assert.equal(args.secondTimeoutMs, 45000);
  assert.equal(args.secondRetries, 2);
  assert.equal(args.secondRetryFastFailureMs, 8000);
  assert.equal(args.secondRetryDelayMs, 1000);
  assert.equal(args.secondConfidenceThreshold, 0.7);
});

test("parseArgs accepts configurable review rounds and retry timing options", () => {
  const args = parseArgs([
    "--max-review-rounds",
    "5",
    "--retry-fast-failure-ms",
    "9000",
    "--retry-delay-ms",
    "250",
  ]);
  const infiniteArgs = parseArgs(["--max-review-rounds", "infinity"]);

  assert.equal(args.maxReviewRounds, 5);
  assert.equal(args.retryFastFailureMs, 9000);
  assert.equal(args.retryDelayMs, 250);
  assert.equal(infiniteArgs.maxReviewRounds, Infinity);
});

test("parseArgs accepts disabling the requirement audit cache", () => {
  const args = parseArgs(["--no-requirement-audit-cache"]);

  assert.equal(args.noRequirementAuditCache, true);
});

test("resolveMaxReviewRounds defaults to three and accepts infinity", () => {
  assert.equal(resolveMaxReviewRounds({}), 3);
  assert.equal(resolveMaxReviewRounds({ maxReviewRounds: 7 }), 7);
  assert.equal(resolveMaxReviewRounds({ maxReviewRounds: Infinity }), Infinity);
});

test("renderReviewBrief includes the resolved review round limit", () => {
  const brief = renderReviewBrief({
    root: "/repo",
    generatedAt: "2026-06-25 10:00:00",
    scope: {},
    profile: {},
    reviewLimits: { maxReviewRounds: "infinity" },
    status: "",
    projectRules: "",
    docs: [],
    diffStat: "",
    changedFiles: [],
    fileContexts: [],
    diff: "",
    verification: null,
    maxBriefBytes: 600000,
  });

  assert.match(brief, /审核闭环限制/);
  assert.match(brief, /infinity/);
});

test("resolveProviderOptions applies configurable fast-failure retry defaults", () => {
  const resolved = resolveProviderOptions({ provider: "primary" }, providersConfig);

  assert.equal(resolved.retries, 3);
  assert.equal(resolved.retryFastFailureMs, 10000);
  assert.equal(resolved.retryDelayMs, 5000);
});

test("buildSecondReviewOptions inherits the effective primary review budget by default", () => {
  const secondOptions = buildSecondReviewOptions(secondReviewerOptions(), providersConfig);

  assert.equal(secondOptions.timeoutMs, 120000);
  assert.equal(secondOptions.retries, 3);
  assert.equal(secondOptions.retryFastFailureMs, 10000);
  assert.equal(secondOptions.retryDelayMs, 5000);
});

test("buildSecondReviewOptions inherits explicit primary review budget when provided", () => {
  const secondOptions = buildSecondReviewOptions(
    secondReviewerOptions([
      "--timeout-ms",
      "180000",
      "--retries",
      "2",
      "--retry-fast-failure-ms",
      "7000",
      "--retry-delay-ms",
      "25",
    ]),
    providersConfig,
  );

  assert.equal(secondOptions.timeoutMs, 180000);
  assert.equal(secondOptions.retries, 2);
  assert.equal(secondOptions.retryFastFailureMs, 7000);
  assert.equal(secondOptions.retryDelayMs, 25);
});

test("buildSecondReviewOptions inherits resolved primary provider budget defaults", () => {
  const secondOptions = buildSecondReviewOptions(
    secondReviewerOptions([
      "--provider",
      "cli",
    ]),
    providerBudgetConfig,
  );

  assert.equal(secondOptions.timeoutMs, 180000);
  assert.equal(secondOptions.retries, 0);
  assert.equal(secondOptions.retryFastFailureMs, 10000);
  assert.equal(secondOptions.retryDelayMs, 5000);
});

test("buildSecondReviewOptions lets explicit second-review budget override defaults", () => {
  const secondOptions = buildSecondReviewOptions(
    secondReviewerOptions([
      "--second-timeout-ms",
      "30000",
      "--second-retries",
      "1",
      "--second-retry-fast-failure-ms",
      "3000",
      "--second-retry-delay-ms",
      "10",
    ]),
    providersConfig,
  );

  assert.equal(secondOptions.timeoutMs, 30000);
  assert.equal(secondOptions.retries, 1);
  assert.equal(secondOptions.retryFastFailureMs, 3000);
  assert.equal(secondOptions.retryDelayMs, 10);
});

test("shouldRunSecondReview triggers auto mode when primary confidence is below threshold", () => {
  const options = parseArgs([
    "--second-review-mode",
    "auto",
    "--second-confidence-threshold",
    "0.8",
  ]);

  assert.equal(shouldRunSecondReview(passResult({ confidence: 0.79 }), options), true);
  assert.equal(shouldRunSecondReview(passResult({ confidence: 0.8 }), options), false);
});

test("runReviewPasses runs always-mode reviewers concurrently and keeps primary result when second fails", async () => {
  const started = [];
  let releasePrimary;
  const primaryCanFinish = new Promise((resolve) => {
    releasePrimary = resolve;
  });
  const options = secondReviewerOptions(["--second-review-mode", "always"]);

  const run = runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options,
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: { provider: "second", model: "second-model" },
    callReviewModelFn: async ({ options: callOptions }) => {
      const reviewer = callOptions.usePrimaryEnv === false ? "second" : "primary";
      started.push(reviewer);
      if (reviewer === "primary") {
        await primaryCanFinish;
        return passResult({ summary: "primary ok" });
      }
      throw new Error("second timed out");
    },
  });

  await waitFor(() => started.includes("primary") && started.includes("second"));
  releasePrimary();
  const reviewRun = await run;

  assert.equal(reviewRun.result.summary, "primary ok");
  assert.equal(reviewRun.result.verdict, "pass");
  assert.match(reviewRun.result.verification_notes.join("\n"), /二审模型失败，已降级使用主审模型结果/);
  assert.match(reviewRun.result.verification_notes.join("\n"), /second timed out/);
  assert.deepEqual(started, ["primary", "second"]);
});

test("runReviewPasses starts auto-mode second review after low-confidence primary result", async () => {
  const started = [];
  const options = secondReviewerOptions([
    "--second-review-mode",
    "auto",
    "--second-confidence-threshold",
    "0.8",
  ]);

  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options,
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: { provider: "second", model: "second-model" },
    callReviewModelFn: async ({ options: callOptions }) => {
      const reviewer = callOptions.usePrimaryEnv === false ? "second" : "primary";
      started.push(reviewer);
      return passResult({
        summary: `${reviewer} ok`,
        confidence: reviewer === "primary" ? 0.5 : 0.9,
      });
    },
  });

  assert.deepEqual(started, ["primary", "second"]);
  assert.match(reviewRun.result.summary, /主审/);
  assert.match(reviewRun.result.summary, /二审/);
});

test("runReviewPasses keeps auto mode on primary only when low confidence has no usable second config", async () => {
  const started = [];
  const options = parseArgs([
    "--second-review-mode",
    "auto",
    "--second-confidence-threshold",
    "0.8",
  ]);

  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options,
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: null,
    callReviewModelFn: async ({ options: callOptions }) => {
      const reviewer = callOptions.usePrimaryEnv === false ? "second" : "primary";
      started.push(reviewer);
      return passResult({ summary: "primary low confidence", confidence: 0.5 });
    },
  });

  assert.deepEqual(started, ["primary"]);
  assert.equal(reviewRun.result.summary, "primary low confidence");
  assert.equal(reviewRun.resolved.second, null);
});

test("runReviewPasses keeps second result when primary fails in always mode", async () => {
  const options = secondReviewerOptions(["--second-review-mode", "always"]);

  const reviewRun = await runReviewPasses({
    brief: "brief",
    assets: { systemPrompt: "prompt", schema: {}, providersConfig },
    options,
    primaryResolved: { provider: "primary", model: "primary-model" },
    secondResolved: { provider: "second", model: "second-model" },
    callReviewModelFn: async ({ options: callOptions }) => {
      if (callOptions.usePrimaryEnv === false) {
        return passResult({ summary: "second ok" });
      }
      throw new Error("primary timed out");
    },
  });

  assert.equal(reviewRun.result.summary, "second ok");
  assert.equal(reviewRun.result.verdict, "pass");
  assert.match(reviewRun.result.verification_notes.join("\n"), /主审模型失败，已降级使用二审模型结果/);
  assert.match(reviewRun.result.verification_notes.join("\n"), /primary timed out/);
});
