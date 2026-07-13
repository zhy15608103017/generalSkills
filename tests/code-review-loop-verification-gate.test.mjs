import assert from "node:assert/strict";
import test from "node:test";

import {
  applyVerificationGate,
  failedVerifications,
} from "../skills/code-review-loop/scripts/verification-gate.mjs";

function passResult() {
  return {
    verdict: "pass",
    summary: "模型审核通过。",
    blocking_findings: [],
    warnings: [],
    verification_notes: [],
    confidence: 0.9,
  };
}

test("failedVerifications returns only non-zero verification results", () => {
  assert.deepEqual(
    failedVerifications([
      { command: "npm test", exitCode: 1 },
      { command: "git diff --check", exitCode: 0 },
    ]),
    [{ command: "npm test", exitCode: 1 }],
  );
});

test("applyVerificationGate deterministically blocks a model pass", () => {
  const result = applyVerificationGate(passResult(), [
    { command: "npm test", exitCode: 1, stderr: "one test failed" },
  ]);

  assert.equal(result.verdict, "fail");
  assert.equal(result.blocking_findings.length, 1);
  assert.equal(result.blocking_findings[0].severity, "P1");
  assert.match(result.blocking_findings[0].evidence, /npm test -> exit 1/);
  assert.match(result.verification_notes[0], /npm test/);
});

test("applyVerificationGate leaves successful verification results unchanged", () => {
  const original = passResult();
  assert.equal(
    applyVerificationGate(original, [{ command: "npm test", exitCode: 0 }]),
    original,
  );
});
