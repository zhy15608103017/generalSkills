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
      { path: "skills/alpha-skill/.gskills/install.mjs", type: "blob" },
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
    [
      "skills/alpha-skill/.gskills/install.mjs",
      [
        "import path from \"node:path\";",
        "import { mkdir, readFile, writeFile } from \"node:fs/promises\";",
        "",
        "export async function install(context) {",
        "  const sourcePath = path.join(context.skillDir, \"assets\", \"AGENTS.md\");",
        "  const instructions = (await readFile(sourcePath, \"utf8\")).trim();",
        "  const agentsPath = path.join(context.destDir, \"AGENTS.md\");",
        "  await mkdir(path.dirname(agentsPath), { recursive: true });",
        "  await writeFile(agentsPath, `<!-- gskills:start ${context.skillName} -->\\n${instructions}\\n<!-- gskills:end ${context.skillName} -->\\n`, \"utf8\");",
        "}"
      ].join("\n")
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
    assert.deepEqual(result.installScripts.map((entry) => entry.skillName), ["alpha-skill"]);
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
      await assert.rejects(
        () => stat(path.join(destDir, toolDir, "alpha-skill", ".gskills")),
        /ENOENT/
      );
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

test("falls back to GitHub blob API when raw downloads are rate limited", async () => {
  await withTempDir(async (destDir) => {
    const blobUrls = {
      skill: "https://api.github.com/repos/owner/repo/git/blobs/skill-md",
      install: "https://api.github.com/repos/owner/repo/git/blobs/install-mjs"
    };
    const tree = {
      tree: [
        { path: "skills/alpha-skill/SKILL.md", type: "blob", url: blobUrls.skill },
        { path: "skills/alpha-skill/.gskills/install.mjs", type: "blob", url: blobUrls.install }
      ]
    };
    const blobs = new Map([
      [
        blobUrls.skill,
        "---\nname: alpha-skill\ndescription: Use when installing alpha.\n---\n\n# Alpha\n"
      ],
      [blobUrls.install, "export async function install() {}\n"]
    ]);
    const rawRequests = [];
    const blobRequests = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return jsonResponse(tree);
      }
      if (href.startsWith("https://raw.githubusercontent.com/")) {
        rawRequests.push(href);
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          text: async () => "too many requests"
        };
      }
      if (blobs.has(href)) {
        blobRequests.push(href);
        return jsonResponse({
          encoding: "base64",
          content: Buffer.from(blobs.get(href), "utf8").toString("base64")
        });
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found"
      };
    };

    const result = await addRemoteSkills({
      source: "owner/repo",
      ref: "main",
      destDir,
      tool: "default",
      skills: ["alpha-skill"],
      fetchImpl
    });

    assert.deepEqual(result.installed.map((entry) => entry.tool), ["default"]);
    assert.deepEqual(result.installScripts.map((entry) => entry.skillName), ["alpha-skill"]);
    const skill = await readFile(path.join(destDir, ".agents/skills/alpha-skill/SKILL.md"), "utf8");
    assert.match(skill, /name: alpha-skill/);
    assert.equal(rawRequests.length, 2);
    assert.deepEqual(blobRequests.sort(), Object.values(blobUrls).sort());
  });
});

test("rejects malformed GitHub blob content during raw fallback", async () => {
  await withTempDir(async (destDir) => {
    const tree = {
      tree: [
        {
          path: "skills/alpha-skill/SKILL.md",
          type: "blob",
          url: "https://api.github.com/repos/owner/repo/git/blobs/skill-md"
        }
      ]
    };
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return jsonResponse(tree);
      }
      if (href.startsWith("https://raw.githubusercontent.com/")) {
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          text: async () => "too many requests"
        };
      }
      if (href.includes("/git/blobs/")) {
        return jsonResponse({
          encoding: "base64",
          content: "not base64??"
        });
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found"
      };
    };

    await assert.rejects(
      () =>
        addRemoteSkills({
          source: "owner/repo",
          ref: "main",
          destDir,
          tool: "default",
          skills: ["alpha-skill"],
          fetchImpl
        }),
      /did not include valid base64 content/
    );
  });
});

test("falls back to GitHub blob API when raw request fails before a response", async () => {
  await withTempDir(async (destDir) => {
    const blobUrl = "https://api.github.com/repos/owner/repo/git/blobs/skill-md";
    const tree = {
      tree: [{ path: "skills/alpha-skill/SKILL.md", type: "blob", url: blobUrl }]
    };
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return jsonResponse(tree);
      }
      if (href.startsWith("https://raw.githubusercontent.com/")) {
        throw new TypeError("fetch failed");
      }
      if (href === blobUrl) {
        return jsonResponse({
          encoding: "base64",
          content: Buffer.from(
            "---\nname: alpha-skill\ndescription: Use when installing alpha.\n---\n\n# Alpha\n",
            "utf8"
          ).toString("base64")
        });
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found"
      };
    };

    const result = await addRemoteSkills({
      source: "owner/repo",
      ref: "main",
      destDir,
      tool: "default",
      skills: ["alpha-skill"],
      fetchImpl
    });

    assert.deepEqual(result.installed.map((entry) => entry.tool), ["default"]);
    const skill = await readFile(path.join(destDir, ".agents/skills/alpha-skill/SKILL.md"), "utf8");
    assert.match(skill, /name: alpha-skill/);
  });
});
