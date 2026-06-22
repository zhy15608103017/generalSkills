import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSecondReviewOptions,
  runReviewPasses,
  shouldRunSecondReview,
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
    "--second-confidence-threshold",
    "0.7",
  ]);

  assert.equal(args.secondTimeoutMs, 45000);
  assert.equal(args.secondRetries, 2);
  assert.equal(args.secondConfidenceThreshold, 0.7);
});

test("parseArgs accepts disabling the requirement audit cache", () => {
  const args = parseArgs(["--no-requirement-audit-cache"]);

  assert.equal(args.noRequirementAuditCache, true);
});

test("buildSecondReviewOptions applies second-review timeout and retry defaults", () => {
  const secondOptions = buildSecondReviewOptions(secondReviewerOptions(), providersConfig);

  assert.equal(secondOptions.timeoutMs, 60000);
  assert.equal(secondOptions.retries, 0);
});

test("buildSecondReviewOptions lets explicit second-review budget override defaults", () => {
  const secondOptions = buildSecondReviewOptions(
    secondReviewerOptions([
      "--second-timeout-ms",
      "30000",
      "--second-retries",
      "1",
    ]),
    providersConfig,
  );

  assert.equal(secondOptions.timeoutMs, 30000);
  assert.equal(secondOptions.retries, 1);
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
