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

async function writeRepoFile(repoDir, relativePath, content) {
  const absolutePath = path.join(repoDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function initGitRepo(repoDir, options = {}) {
  const {
    files = {
      "index.js": "export const value = 1;\n",
    },
    committedIgnore = "",
    dirtyIndex = true,
  } = options;
  await git(repoDir, ["init"]);
  await git(repoDir, ["config", "user.email", "test@example.com"]);
  await git(repoDir, ["config", "user.name", "Test User"]);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeRepoFile(repoDir, relativePath, content);
  }
  if (committedIgnore) {
    await writeRepoFile(repoDir, ".ai-reviewignore", committedIgnore);
  }
  await git(repoDir, ["add", "."]);
  await git(repoDir, ["commit", "-m", "initial"]);
  if (dirtyIndex && files["index.js"]) {
    await writeRepoFile(repoDir, "index.js", "export const value = 2;\n");
  }
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

test("collectReviewContext excludes files matched by .ai-reviewignore from review scope", async () => {
  await withTempDir(async (tempDir) => {
    const repoDir = path.join(tempDir, "repo");
    await mkdir(repoDir, { recursive: true });
    await initGitRepo(repoDir, {
      files: {
        "index.js": "export const value = 1;\n",
        "ignored.js": "export const ignored = 1;\n",
        "generated/skip.js": "export const skip = 1;\n",
        "generated/keep.js": "export const keep = 1;\n",
      },
      committedIgnore: [
        "ignored.js",
        "generated",
        "!generated/keep.js",
        "",
      ].join("\n"),
      dirtyIndex: false,
    });
    const commandPath = await createFakeCodeGraph(path.join(tempDir, "fake bin"));
    const previousCwd = process.cwd();

    try {
      await writeRepoFile(repoDir, "index.js", "export const value = 2;\n");
      await writeRepoFile(repoDir, "ignored.js", "export const ignored = 2;\n");
      await writeRepoFile(repoDir, "generated/skip.js", "export const skip = 2;\n");
      await writeRepoFile(repoDir, "generated/keep.js", "export const keep = 2;\n");

      process.chdir(repoDir);
      const context = await collectReviewContext({
        ...parseArgs(["--codegraph"]),
        allowEmpty: true,
        codegraphCommand: commandPath,
        maxFiles: 10,
      });

      assert.deepEqual(
        [...context.changedFiles].sort(),
        ["generated/keep.js", "index.js"],
      );
      assert.match(context.diff, /index\.js/);
      assert.match(context.diff, /generated\/keep\.js/);
      assert.doesNotMatch(context.diff, /ignored\.js/);
      assert.doesNotMatch(context.diff, /generated\/skip\.js/);
      assert.deepEqual(
        context.fileContexts.map((item) => item.path).sort(),
        ["generated/keep.js", "index.js"],
      );
      assert.deepEqual(
        [...(context.codegraphContext?.files || [])].sort(),
        ["generated/keep.js", "index.js"],
      );
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test("collectReviewContext keeps anchored .ai-reviewignore rules scoped to the repo root", async () => {
  await withTempDir(async (tempDir) => {
    const repoDir = path.join(tempDir, "repo");
    await mkdir(repoDir, { recursive: true });
    await initGitRepo(repoDir, {
      files: {
        "index.js": "export const value = 1;\n",
        "dist/root.js": "export const rootDist = 1;\n",
        "nested/dist/kept.js": "export const nestedDist = 1;\n",
        "root.snap": "snap root\n",
        "nested/kept.snap": "snap nested\n",
      },
      committedIgnore: [
        "/dist/",
        "/*.snap",
        "",
      ].join("\n"),
      dirtyIndex: false,
    });
    const previousCwd = process.cwd();

    try {
      await writeRepoFile(repoDir, "dist/root.js", "export const rootDist = 2;\n");
      await writeRepoFile(repoDir, "nested/dist/kept.js", "export const nestedDist = 2;\n");
      await writeRepoFile(repoDir, "root.snap", "snap root changed\n");
      await writeRepoFile(repoDir, "nested/kept.snap", "snap nested changed\n");

      process.chdir(repoDir);
      const context = await collectReviewContext({
        ...parseArgs([]),
        allowEmpty: true,
        maxFiles: 10,
      });

      assert.deepEqual(
        [...context.changedFiles].sort(),
        ["nested/dist/kept.js", "nested/kept.snap"],
      );
      assert.doesNotMatch(context.diff, /dist\/root\.js/);
      assert.doesNotMatch(context.diff, /root\.snap/);
      assert.match(context.diff, /nested\/dist\/kept\.js/);
      assert.match(context.diff, /nested\/kept\.snap/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test("collectReviewContext excludes slash-pattern directories and ignored untracked files", async () => {
  await withTempDir(async (tempDir) => {
    const repoDir = path.join(tempDir, "repo");
    await mkdir(repoDir, { recursive: true });
    await initGitRepo(repoDir, {
      files: {
        "index.js": "export const value = 1;\n",
        "src/generated/committed.js": "export const committed = 1;\n",
        "src/kept.js": "export const kept = 1;\n",
      },
      committedIgnore: [
        "src/generated",
        "!src/generated/keep.js",
        "",
      ].join("\n"),
      dirtyIndex: false,
    });
    const previousCwd = process.cwd();

    try {
      await writeRepoFile(repoDir, "src/generated/committed.js", "export const committed = 2;\n");
      await writeRepoFile(repoDir, "src/generated/keep.js", "export const keep = 1;\n");
      await writeRepoFile(repoDir, "src/generated/ignored-untracked.js", "export const ignored = 1;\n");
      await writeRepoFile(repoDir, "src/kept.js", "export const kept = 2;\n");

      process.chdir(repoDir);
      const context = await collectReviewContext({
        ...parseArgs([]),
        allowEmpty: true,
        maxFiles: 10,
      });

      assert.deepEqual(
        [...context.changedFiles].sort(),
        ["src/generated/keep.js", "src/kept.js"],
      );
      assert.match(context.diff, /src\/generated\/keep\.js/);
      assert.match(context.diff, /src\/kept\.js/);
      assert.doesNotMatch(context.diff, /src\/generated\/committed\.js/);
      assert.doesNotMatch(context.diff, /src\/generated\/ignored-untracked\.js/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
