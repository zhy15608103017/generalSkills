import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(
  repoRoot,
  "skills",
  "code-review-loop",
  "scripts",
  "write-review-context.mjs",
);

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "write-review-context-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("write-review-context rejects oversized structured fields and removes stale output", async () => {
  await withTempDir(async (tempDir) => {
    const outPath = path.join(tempDir, "current-request.md");
    await writeFile(outPath, "stale review context", "utf8");

    const error = await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--request",
        "x".repeat(4001),
        "--acceptance",
        "y".repeat(4002),
        "--out",
        outPath,
      ],
      { cwd: tempDir, windowsHide: true },
    ).then(
      () => assert.fail("expected oversized structured fields to fail"),
      (caught) => caught,
    );

    assert.equal(error.code, 1);
    assert.match(error.stderr, /FIELD_TOO_LONG/);
    assert.match(error.stderr, /--request=4001/);
    assert.match(error.stderr, /--acceptance=4002/);
    assert.match(error.stderr, /--from-file <path>/);
    await assert.rejects(() => stat(outPath), /ENOENT/);
  });
});

test("write-review-context preserves oversized full Markdown from file", async () => {
  await withTempDir(async (tempDir) => {
    const draftPath = path.join(tempDir, "draft-request.md");
    const outPath = path.join(tempDir, "current-request.md");
    const draft = [
      "# Current Review Context",
      "",
      "## Original Request",
      "",
      "x".repeat(5000),
    ].join("\n");

    await writeFile(draftPath, draft, "utf8");

    await execFileAsync(
      process.execPath,
      [scriptPath, "--from-file", draftPath, "--out", outPath],
      { cwd: tempDir, windowsHide: true },
    );

    assert.equal(await readFile(outPath, "utf8"), `${draft}\n`);
  });
});

test("write-review-context only truncates oversized fields when explicitly allowed", async () => {
  await withTempDir(async (tempDir) => {
    const outPath = path.join(tempDir, "current-request.md");

    await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--request",
        "x".repeat(4001),
        "--allow-truncate",
        "--out",
        outPath,
      ],
      { cwd: tempDir, windowsHide: true },
    );

    const output = await readFile(outPath, "utf8");
    assert.match(output, /CONTEXT_INCOMPLETE/);
    assert.match(output, /--allow-truncate/);
    assert.match(output, /--from-file/);
  });
});
