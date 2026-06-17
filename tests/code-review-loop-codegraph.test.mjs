import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  collectReviewContext,
  parseArgs,
  renderReviewBrief
} from "../skills/code-review-loop/scripts/collect-context.mjs";

const execFileAsync = promisify(execFile);

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "code-review-loop-codegraph-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepo(repoDir) {
  await git(repoDir, ["init"]);
  await git(repoDir, ["config", "user.email", "test@example.com"]);
  await git(repoDir, ["config", "user.name", "Test User"]);
  await writeFile(path.join(repoDir, "index.js"), "export const value = 1;\n", "utf8");
  await git(repoDir, ["add", "index.js"]);
  await git(repoDir, ["commit", "-m", "initial"]);
  await writeFile(path.join(repoDir, "index.js"), "export const value = 2;\n", "utf8");
}

async function createFakeCodeGraph(binDir, options = {}) {
  await mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "fake-codegraph.mjs");
  const statusLines = options.statusOutput === "not-json"
    ? ["  console.log('not json');"]
    : ["  console.log(JSON.stringify({ initialized: true, nodes: 42, edges: 7 }));"];
  await writeFile(
    scriptPath,
    [
      "const args = process.argv.slice(2);",
      "if (args[0] === 'status') {",
      ...statusLines,
      "  process.exit(0);",
      "}",
      "if (args[0] === 'affected') {",
      "  console.log(JSON.stringify({ tests: ['index.test.js'], files: args.slice(args.indexOf('--') + 1) }));",
      "  process.exit(0);",
      "}",
      "console.error(`unexpected args: ${args.join(' ')}`);",
      "process.exit(2);"
    ].join("\n"),
    "utf8"
  );

  if (process.platform === "win32") {
    const commandPath = path.join(binDir, "fake-codegraph.cmd");
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    return commandPath;
  }

  const commandPath = path.join(binDir, "fake-codegraph");
  await writeFile(commandPath, `#!/usr/bin/env sh\n"${process.execPath}" "${scriptPath}" "$@"\n`, {
    encoding: "utf8",
    mode: 0o755
  });
  return commandPath;
}

test("parseArgs enables optional codegraph context", () => {
  const args = parseArgs([
    "--codegraph",
    "--codegraph-depth",
    "3",
    "--codegraph-command",
    "custom-codegraph"
  ]);

  assert.equal(args.codegraph, true);
  assert.equal(args.codegraphDepth, 3);
  assert.equal(args.codegraphCommand, "custom-codegraph");
});

test("collectReviewContext includes optional CodeGraph affected-test context", async () => {
  await withTempDir(async (tempDir) => {
    const repoDir = path.join(tempDir, "repo");
    await mkdir(repoDir, { recursive: true });
    await initGitRepo(repoDir);
    const commandPath = await createFakeCodeGraph(path.join(tempDir, "fake bin"));
    const previousCwd = process.cwd();

    try {
      process.chdir(repoDir);
      const context = await collectReviewContext({
        ...parseArgs(["--codegraph"]),
        allowEmpty: true,
        codegraphCommand: commandPath,
        codegraphDepth: 4,
        maxFiles: 1
      });
      const brief = renderReviewBrief(context);

      assert.match(brief, /CodeGraph/);
      assert.match(brief, /initialized/);
      assert.match(brief, /index\.test\.js/);
      assert.match(brief, /index\.js/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test("collectReviewContext skips CodeGraph affected when status JSON is invalid", async () => {
  await withTempDir(async (tempDir) => {
    const repoDir = path.join(tempDir, "repo");
    await mkdir(repoDir, { recursive: true });
    await initGitRepo(repoDir);
    const commandPath = await createFakeCodeGraph(
      path.join(tempDir, "fake bin"),
      { statusOutput: "not-json" }
    );
    const previousCwd = process.cwd();

    try {
      process.chdir(repoDir);
      const context = await collectReviewContext({
        ...parseArgs(["--codegraph"]),
        allowEmpty: true,
        codegraphCommand: commandPath,
        maxFiles: 1
      });
      const brief = renderReviewBrief(context);

      assert.match(brief, /not json/);
      assert.match(brief, /未运行 affected/);
      assert.doesNotMatch(brief, /index\.test\.js/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
