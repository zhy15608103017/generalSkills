import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const logEntryScript = path.resolve("skills/self-improving-agent/scripts/log-entry.mjs");

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "self-improving-agent-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runLogEntry(args, options = {}) {
  return execFileAsync(process.execPath, [logEntryScript, ...args], {
    cwd: options.cwd || process.cwd()
  });
}

test("logs a learning entry and initializes .learnings files", async () => {
  await withTempDir(async (projectDir) => {
    const result = await runLogEntry([
      "learning",
      "--root",
      projectDir,
      "--now",
      "2026-06-17T08:30:00Z",
      "--id-suffix",
      "001",
      "--category",
      "best_practice",
      "--area",
      "tooling",
      "--priority",
      "high",
      "--summary",
      "Use pnpm for workspace installs",
      "--details",
      "The repository has pnpm-lock.yaml and npm install creates the wrong lockfile.",
      "--action",
      "Check for pnpm-lock.yaml before installing dependencies.",
      "--source",
      "investigation",
      "--related-files",
      "pnpm-lock.yaml",
      "--tags",
      "pnpm,dependencies",
      "--pattern-key",
      "tooling.package-manager"
    ]);

    assert.match(result.stdout, /Logged LRN-20260617-001/);

    const learningText = await readFile(
      path.join(projectDir, ".learnings", "LEARNINGS.md"),
      "utf8"
    );
    assert.match(learningText, /## \[LRN-20260617-001\] best_practice/);
    assert.match(learningText, /\*\*Logged\*\*: 2026-06-17T08:30:00Z/);
    assert.match(learningText, /Use pnpm for workspace installs/);
    assert.match(learningText, /Pattern-Key: tooling\.package-manager/);
    assert.match(learningText, /Recurrence-Count: 1/);

    const errorText = await readFile(path.join(projectDir, ".learnings", "ERRORS.md"), "utf8");
    assert.match(errorText, /^# Errors/m);
  });
});

test("updates recurrence instead of duplicating a learning with the same pattern key", async () => {
  await withTempDir(async (projectDir) => {
    const baseArgs = [
      "learning",
      "--root",
      projectDir,
      "--category",
      "knowledge_gap",
      "--area",
      "config",
      "--priority",
      "medium",
      "--summary",
      "Project uses a non-default config file",
      "--details",
      "The tool reads config from project.config.json.",
      "--action",
      "Check project.config.json before assuming defaults.",
      "--source",
      "error",
      "--pattern-key",
      "config.non-default-file"
    ];

    await runLogEntry([...baseArgs, "--now", "2026-06-17T08:30:00Z", "--id-suffix", "001"]);
    const result = await runLogEntry([
      ...baseArgs,
      "--now",
      "2026-06-18T09:45:00Z",
      "--id-suffix",
      "002"
    ]);

    assert.match(result.stdout, /Updated LRN-20260617-001/);

    const learningText = await readFile(
      path.join(projectDir, ".learnings", "LEARNINGS.md"),
      "utf8"
    );
    assert.equal((learningText.match(/## \[LRN-/g) || []).length, 1);
    assert.match(learningText, /Recurrence-Count: 2/);
    assert.match(learningText, /First-Seen: 2026-06-17/);
    assert.match(learningText, /Last-Seen: 2026-06-18/);
  });
});

test("updates recurrence metadata outside fenced examples", async () => {
  await withTempDir(async (projectDir) => {
    const baseArgs = [
      "learning",
      "--root",
      projectDir,
      "--category",
      "best_practice",
      "--area",
      "docs",
      "--priority",
      "medium",
      "--summary",
      "Entry contains sample recurrence metadata",
      "--details",
      "Example metadata:\n```markdown\n- Recurrence-Count: 1\n- First-Seen: 2026-06-01\n- Last-Seen: 2026-06-01\n```\nOnly real metadata should change.",
      "--action",
      "Update recurrence only in the Metadata section.",
      "--source",
      "investigation",
      "--pattern-key",
      "docs.recurrence-example"
    ];

    await runLogEntry([...baseArgs, "--now", "2026-06-17T08:30:00Z", "--id-suffix", "001"]);
    const learningPath = path.join(projectDir, ".learnings", "LEARNINGS.md");
    const seededLearningText = await readFile(learningPath, "utf8");
    await writeFile(learningPath, seededLearningText.replace("\n- First-Seen: 2026-06-17", ""));

    await runLogEntry([...baseArgs, "--now", "2026-06-18T08:30:00Z", "--id-suffix", "002"]);

    const learningText = await readFile(learningPath, "utf8");
    assert.match(
      learningText,
      /```markdown\n- Recurrence-Count: 1\n- First-Seen: 2026-06-01\n- Last-Seen: 2026-06-01\n```/
    );
    assert.match(learningText, /- Recurrence-Count: 2/);
    assert.match(learningText, /- First-Seen: 2026-06-18/);
    assert.match(learningText, /- Last-Seen: 2026-06-18/);
  });
});

test("logs sanitized command errors", async () => {
  await withTempDir(async (projectDir) => {
    const passwordLabel = "pass" + "word";
    const passwordValue = "pw-secret-123";
    const terminalNoise = "\u001b]0;terminal-title\u0007progress\bX\rrewritten\u0001";

    await runLogEntry([
      "error",
      "--root",
      projectDir,
      "--now",
      "2026-06-17T08:30:00Z",
      "--id-suffix",
      "A7B",
      "--tool",
      "npm_test_sk-tool-secret",
      "--area",
      "tests",
      "--priority",
      "high",
      "--summary",
      "Test command failed with a private API token in output",
      "--error",
      `Authorization: Bearer sk-test-secret\napi_key=abcdef123456\n${passwordLabel}: ${passwordValue}\n{"token":"ghp_testsecret1234567890"}\n${terminalNoise}\nexit code 1`,
      "--command",
      "npm test --token github_pat_testsecret1234567890",
      "--reproducible",
      "yes",
      "--related-files",
      "package.json api_key=file-secret secret: file-secret-2"
    ]);

    const errorText = await readFile(path.join(projectDir, ".learnings", "ERRORS.md"), "utf8");
    assert.match(errorText, /## \[ERR-20260617-A7B\] npm_test_\[REDACTED\]/);
    assert.ok(errorText.includes("Authorization: Bearer [REDACTED]"));
    assert.ok(errorText.includes("api_key=[REDACTED]"));
    assert.ok(errorText.includes(`${passwordLabel}: [REDACTED]`));
    assert.ok(errorText.includes('"token":"[REDACTED]"'));
    assert.ok(errorText.includes("Command/operation attempted: npm test --token [REDACTED]"));
    assert.ok(
      errorText.includes("Related Files: package.json api_key=[REDACTED] secret: [REDACTED]")
    );
    assert.doesNotMatch(errorText, /sk-test-secret/);
    assert.doesNotMatch(errorText, /sk-tool-secret/);
    assert.doesNotMatch(errorText, new RegExp(passwordValue));
    assert.doesNotMatch(errorText, /github_pat_testsecret/);
    assert.doesNotMatch(errorText, /ghp_testsecret/);
    assert.doesNotMatch(errorText, /abcdef123456/);
    assert.doesNotMatch(errorText, /file-secret/);
    assert.doesNotMatch(errorText, /terminal-title/);
    assert.doesNotMatch(errorText, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  });
});

test("rejects non-UTF-8 target learning files before writing", async () => {
  await withTempDir(async (projectDir) => {
    await mkdir(path.join(projectDir, ".learnings"), { recursive: true });
    await writeFile(path.join(projectDir, ".learnings", "LEARNINGS.md"), Buffer.from([0xff]));

    await assert.rejects(
      () =>
        runLogEntry([
          "learning",
          "--root",
          projectDir,
          "--category",
          "insight",
          "--summary",
          "Should not write",
          "--details",
          "The target file is not valid UTF-8.",
          "--action",
          "Stop before writing."
        ]),
      /not valid UTF-8/
    );
  });
});

test("ignores fenced Pattern-Key examples when matching real metadata", async () => {
  await withTempDir(async (projectDir) => {
    await runLogEntry([
      "learning",
      "--root",
      projectDir,
      "--now",
      "2026-06-17T08:30:00Z",
      "--id-suffix",
      "001",
      "--category",
      "insight",
      "--area",
      "docs",
      "--priority",
      "medium",
      "--summary",
      "Entry contains a sample Pattern-Key",
      "--details",
      "Example metadata:\n```markdown\n- Pattern-Key: docs.fake-example\n```\nThe real key is different.",
      "--action",
      "Ignore fenced metadata examples when deduplicating.",
      "--source",
      "investigation",
      "--pattern-key",
      "docs.real-key"
    ]);

    const result = await runLogEntry([
      "learning",
      "--root",
      projectDir,
      "--now",
      "2026-06-18T08:30:00Z",
      "--id-suffix",
      "002",
      "--category",
      "insight",
      "--area",
      "docs",
      "--priority",
      "medium",
      "--summary",
      "Fake example key is a real new entry",
      "--details",
      "This should append instead of updating the first entry.",
      "--action",
      "Treat only metadata outside code fences as the entry key.",
      "--source",
      "investigation",
      "--pattern-key",
      "docs.fake-example"
    ]);

    assert.match(result.stdout, /Logged LRN-20260618-002/);

    const learningText = await readFile(
      path.join(projectDir, ".learnings", "LEARNINGS.md"),
      "utf8"
    );
    assert.equal((learningText.match(/## \[LRN-/g) || []).length, 2);
    assert.match(learningText, /## \[LRN-20260617-001\] insight/);
    assert.match(learningText, /## \[LRN-20260618-002\] insight/);
  });
});

test("accepts option values that start with dashes", async () => {
  await withTempDir(async (projectDir) => {
    await runLogEntry([
      "error",
      "--root",
      projectDir,
      "--now",
      "2026-06-17T08:30:00Z",
      "--id-suffix",
      "B2C",
      "--tool=cli",
      "--area",
      "tooling",
      "--summary",
      "--help exits with an error in this tool",
      "--error",
      "--unknown-option failed",
      "--command",
      "--help"
    ]);

    const errorText = await readFile(path.join(projectDir, ".learnings", "ERRORS.md"), "utf8");
    assert.match(errorText, /### Summary\n--help exits with an error in this tool/);
    assert.match(errorText, /Command\/operation attempted: --help/);
    assert.match(errorText, /--unknown-option failed/);
  });
});

test("reviews pending high-priority and pattern-key entries", async () => {
  await withTempDir(async (projectDir) => {
    await runLogEntry([
      "learning",
      "--root",
      projectDir,
      "--now",
      "2026-06-17T08:30:00Z",
      "--id-suffix",
      "001",
      "--category",
      "best_practice",
      "--area",
      "tooling",
      "--priority",
      "high",
      "--summary",
      "Use project-specific install command",
      "--details",
      "The repository install command is custom.",
      "--action",
      "Check AGENTS.md before installing.",
      "--source",
      "user_feedback",
      "--pattern-key",
      "tooling.install-command"
    ]);
    await runLogEntry([
      "learning",
      "--root",
      projectDir,
      "--now",
      "2026-06-17T08:31:00Z",
      "--id-suffix",
      "002",
      "--category",
      "insight",
      "--area",
      "docs",
      "--priority",
      "low",
      "--summary",
      "Minor docs note",
      "--details",
      "A low priority note exists.",
      "--action",
      "Review later.",
      "--source",
      "investigation",
      "--pattern-key",
      "docs.minor-note"
    ]);

    const highPriority = await runLogEntry([
      "review",
      "--root",
      projectDir,
      "--status",
      "pending",
      "--priority",
      "high"
    ]);
    assert.match(highPriority.stdout, /LRN-20260617-001/);
    assert.match(highPriority.stdout, /Use project-specific install command/);
    assert.doesNotMatch(highPriority.stdout, /LRN-20260617-002/);

    const patternKey = await runLogEntry([
      "review",
      "--root",
      projectDir,
      "--pattern-key",
      "docs.minor-note"
    ]);
    assert.match(patternKey.stdout, /LRN-20260617-002/);
    assert.match(patternKey.stdout, /Pattern-Key=docs\.minor-note/);
    assert.doesNotMatch(patternKey.stdout, /LRN-20260617-001/);
  });
});
