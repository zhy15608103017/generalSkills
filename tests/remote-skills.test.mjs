import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_REF,
  DEFAULT_SOURCE,
  addRemoteSkills,
  listRemoteSkills,
  parseGitHubSource,
  removeInstalledSkills
} from "../scripts/lib/remote-skills.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gskills-remote-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createMockFetch() {
  const tree = {
    tree: [
      { path: "skills/alpha-skill/SKILL.md", type: "blob" },
      { path: "skills/alpha-skill/assets/AGENTS.md", type: "blob" },
      { path: "skills/alpha-skill/references/guide.md", type: "blob" },
      { path: "skills/beta-skill/SKILL.md", type: "blob" },
      { path: "README.md", type: "blob" }
    ]
  };
  const files = new Map([
    [
      "skills/alpha-skill/SKILL.md",
      "---\nname: alpha-skill\ndescription: Use when installing alpha.\n---\n\n# Alpha\n"
    ],
    ["skills/alpha-skill/assets/AGENTS.md", "## Alpha Instructions\n\n- Use alpha style.\n"],
    ["skills/alpha-skill/references/guide.md", "# Alpha Guide\n"],
    [
      "skills/beta-skill/SKILL.md",
      "---\nname: beta-skill\ndescription: Use when installing beta.\n---\n\n# Beta\n"
    ]
  ]);

  return async function mockFetch(url) {
    const href = String(url);
    if (href.includes("/git/trees/")) {
      return jsonResponse(tree);
    }
    const marker = "/main/";
    const index = href.indexOf(marker);
    if (index !== -1) {
      const remotePath = decodeURIComponent(href.slice(index + marker.length));
      if (files.has(remotePath)) {
        return textResponse(files.get(remotePath));
      }
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "not found"
    };
  };
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data
  };
}

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    text: async () => text
  };
}

test("parses GitHub source formats", () => {
  assert.equal(DEFAULT_SOURCE, "zhy15608103017/generalSkills");
  assert.equal(DEFAULT_REF, "main");
  assert.deepEqual(parseGitHubSource("owner/repo"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGitHubSource("https://github.com/owner/repo.git"), {
    owner: "owner",
    repo: "repo"
  });
  assert.deepEqual(parseGitHubSource("git@github.com:owner/repo.git"), {
    owner: "owner",
    repo: "repo"
  });
});

test("lists remote skills with descriptions", async () => {
  const skills = await listRemoteSkills({
    source: "owner/repo",
    ref: "main",
    fetchImpl: createMockFetch()
  });

  assert.deepEqual(skills, [
    {
      name: "alpha-skill",
      description: "Use when installing alpha."
    },
    {
      name: "beta-skill",
      description: "Use when installing beta."
    }
  ]);
});

test("adds multiple remote skills into all tool directories", async () => {
  await withTempDir(async (destDir) => {
    const result = await addRemoteSkills({
      source: "owner/repo",
      ref: "main",
      destDir,
      tool: "all",
      skills: ["alpha-skill", "beta-skill"],
      fetchImpl: createMockFetch()
    });

    assert.equal(result.installed.length, 14);
    for (const toolDir of [
      ".agents/skills",
      ".claude/skills",
      ".cursor/skills",
      ".gemini/skills",
      ".opencode/skills",
      ".trae/skills",
      ".windsurf/skills"
    ]) {
      const alpha = await readFile(path.join(destDir, toolDir, "alpha-skill", "SKILL.md"), "utf8");
      const guide = await readFile(
        path.join(destDir, toolDir, "alpha-skill", "references", "guide.md"),
        "utf8"
      );
      const beta = await readFile(path.join(destDir, toolDir, "beta-skill", "SKILL.md"), "utf8");
      assert.match(alpha, /name: alpha-skill/);
      assert.match(guide, /Alpha Guide/);
      assert.match(beta, /name: beta-skill/);
    }

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.match(agentsText, /<!-- gskills:start alpha-skill -->/);
    assert.match(agentsText, /## Alpha Instructions/);
    assert.match(agentsText, /- Use alpha style\./);
  });
});

test("removes selected installed skills for selected tool", async () => {
  await withTempDir(async (destDir) => {
    await addRemoteSkills({
      source: "owner/repo",
      ref: "main",
      destDir,
      tool: "all",
      skills: ["alpha-skill"],
      fetchImpl: createMockFetch()
    });

    const result = await removeInstalledSkills({
      destDir,
      tool: "codex",
      skills: ["alpha-skill"]
    });

    assert.deepEqual(result.removed.map((entry) => entry.tool), ["codex"]);
    await assert.rejects(
      () => stat(path.join(destDir, ".agents/skills/alpha-skill")),
      /ENOENT/
    );
    await stat(path.join(destDir, ".claude/skills/alpha-skill"));
    await stat(path.join(destDir, ".opencode/skills/alpha-skill"));
  });
});

test("adds remote skills to the default target only", async () => {
  await withTempDir(async (destDir) => {
    const result = await addRemoteSkills({
      source: "owner/repo",
      ref: "main",
      destDir,
      tool: "default",
      skills: ["alpha-skill"],
      fetchImpl: createMockFetch()
    });

    assert.deepEqual(result.installed.map((entry) => entry.tool), ["default"]);
    await stat(path.join(destDir, ".agents/skills/alpha-skill/SKILL.md"));
    await assert.rejects(
      () => stat(path.join(destDir, ".claude/skills/alpha-skill")),
      /ENOENT/
    );
  });
});
