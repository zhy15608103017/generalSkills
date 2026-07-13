import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  beginReviewRound,
  completeReviewRound,
  reviewRoundLimitResult,
} from "../skills/code-review-loop/scripts/review-round-state.mjs";

function context(contentHash = "request-a") {
  return {
    docs: [{ label: "用户需求", contentHash, content: contentHash }],
  };
}

test("review rounds count consecutive non-pass results for the same request", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "code-review-rounds-"));
  try {
    const first = await beginReviewRound({ outDir, context: context(), maxReviewRounds: 2 });
    assert.equal(first.allowed, true);
    assert.equal(first.round, 1);
    await completeReviewRound({ roundState: first, verdict: "fail" });

    const second = await beginReviewRound({ outDir, context: context(), maxReviewRounds: 2 });
    assert.equal(second.allowed, true);
    assert.equal(second.round, 2);
    await completeReviewRound({ roundState: second, verdict: "fail" });

    const exhausted = await beginReviewRound({ outDir, context: context(), maxReviewRounds: 2 });
    assert.equal(exhausted.allowed, false);
    assert.equal(exhausted.round, 3);
    assert.equal(reviewRoundLimitResult(exhausted).verdict, "needs_human");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a pass or a new request resets the review round loop", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "code-review-round-reset-"));
  try {
    const first = await beginReviewRound({ outDir, context: context(), maxReviewRounds: 3 });
    await completeReviewRound({ roundState: first, verdict: "fail" });

    const newRequest = await beginReviewRound({ outDir, context: context("request-b"), maxReviewRounds: 3 });
    assert.equal(newRequest.round, 1);
    await completeReviewRound({ roundState: newRequest, verdict: "pass" });

    const restarted = await beginReviewRound({ outDir, context: context("request-b"), maxReviewRounds: 3 });
    assert.equal(restarted.round, 1);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
