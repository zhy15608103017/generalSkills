import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createSkill } from "../scripts/new-skill.mjs";
import { installSkills } from "../scripts/install-skills.mjs";
import { validateRepository } from "../scripts/validate-skills.mjs";

const execFileAsync = promisify(execFile);

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "general-skills-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("creates and validates a new skill", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "Example Skill",
      description: "Use when testing skill creation.",
      resources: ["references", "scripts"]
    });

    const skillPath = path.join(repoDir, "skills", "example-skill", "SKILL.md");
    const skillText = await readFile(skillPath, "utf8");
    assert.match(skillText, /name: example-skill/);
    assert.match(skillText, /description: Use when testing skill creation\./);
    await stat(path.join(repoDir, "skills", "example-skill", "references"));
    await stat(path.join(repoDir, "skills", "example-skill", "scripts"));

    const result = await validateRepository({ repoDir });
    assert.deepEqual(result.errors, []);
    assert.equal(result.skills.length, 1);
  });
});

test("installs canonical skills into every supported tool directory", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "portable-skill",
      description: "Use when testing multi-tool installation.",
      resources: []
    });

    const destDir = path.join(repoDir, "consumer-project");
    const result = await installSkills({
      repoDir,
      destDir,
      tool: "all"
    });

    assert.deepEqual(
      result.installed.map((entry) => `${entry.tool}:${entry.skillName}`).sort(),
      [
        "claude:portable-skill",
        "codex:portable-skill",
        "cursor:portable-skill",
        "gemini:portable-skill",
        "opencode:portable-skill",
        "trae:portable-skill",
        "windsurf:portable-skill"
      ]
    );

    for (const relativePath of [
      ".agents/skills",
      ".claude/skills",
      ".cursor/skills",
      ".gemini/skills",
      ".opencode/skills",
      ".trae/skills",
      ".windsurf/skills"
    ]) {
      const installedText = await readFile(
        path.join(destDir, relativePath, "portable-skill", "SKILL.md"),
        "utf8"
      );
      assert.match(installedText, /name: portable-skill/);
    }

    const geminiManifest = await readFile(
      path.join(destDir, ".gemini", "extensions", "gskills", "gemini-extension.json"),
      "utf8"
    );
    assert.match(geminiManifest, /"name": "gskills"/);
  });
});

test("install-skills CLI prefers --aicoding over legacy --tool", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "cli-skill",
      description: "Use when testing install CLI target parsing.",
      resources: []
    });

    const destDir = path.join(repoDir, "consumer-project");
    await execFileAsync(process.execPath, [
      path.resolve("scripts/install-skills.mjs"),
      "--repo",
      repoDir,
      "--dest",
      destDir,
      "--skills",
      "cli-skill",
      "--aicoding",
      "gemini",
      "--tool",
      "claude"
    ]);

    await stat(path.join(destDir, ".gemini/skills/cli-skill/SKILL.md"));
    await stat(path.join(destDir, ".gemini/extensions/gskills/gemini-extension.json"));
    await assert.rejects(
      () => stat(path.join(destDir, ".claude/skills/cli-skill/SKILL.md")),
      /ENOENT/
    );
  });
});

test("installs skill AGENTS instructions into the target project", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "maintainable-code",
      description: "Use when testing AGENTS injection.",
      resources: ["assets"]
    });

    const assetPath = path.join(repoDir, "skills", "maintainable-code", "assets", "AGENTS.md");
    await writeFile(assetPath, "## Code Generation\n\n- Follow local style.\n", "utf8");

    const destDir = path.join(repoDir, "consumer-project");
    await mkdir(destDir, { recursive: true });
    await writeFile(path.join(destDir, "AGENTS.md"), "# Existing Instructions\n", "utf8");

    const result = await installSkills({
      repoDir,
      destDir,
      tool: "codex",
      skills: ["maintainable-code"]
    });

    assert.deepEqual(result.agentsInstructions, [
      {
        skillName: "maintainable-code",
        path: path.join(destDir, "AGENTS.md")
      }
    ]);

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.match(agentsText, /# Existing Instructions/);
    assert.match(agentsText, /<!-- gskills:start maintainable-code -->/);
    assert.match(agentsText, /## Code Generation/);
    assert.match(agentsText, /- Follow local style\./);
    assert.match(agentsText, /<!-- gskills:end maintainable-code -->/);
  });
});

test("replaces existing skill AGENTS block instead of duplicating it", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "maintainable-code",
      description: "Use when testing AGENTS replacement.",
      resources: ["assets"]
    });

    const assetPath = path.join(repoDir, "skills", "maintainable-code", "assets", "AGENTS.md");
    await writeFile(assetPath, "## Code Generation\n\n- First version.\n", "utf8");

    const destDir = path.join(repoDir, "consumer-project");
    await installSkills({
      repoDir,
      destDir,
      tool: "codex",
      skills: ["maintainable-code"]
    });

    await writeFile(assetPath, "## Code Generation\n\n- Updated version.\n", "utf8");
    await installSkills({
      repoDir,
      destDir,
      tool: "codex",
      skills: ["maintainable-code"]
    });

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.equal(agentsText.match(/<!-- gskills:start maintainable-code -->/g).length, 1);
    assert.doesNotMatch(agentsText, /First version/);
    assert.match(agentsText, /Updated version/);
  });
});

test("collapses duplicate existing skill AGENTS blocks", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "maintainable-code",
      description: "Use when testing duplicate AGENTS cleanup.",
      resources: ["assets"]
    });

    const assetPath = path.join(repoDir, "skills", "maintainable-code", "assets", "AGENTS.md");
    await writeFile(assetPath, "## Code Generation\n\n- Updated version.\n", "utf8");

    const destDir = path.join(repoDir, "consumer-project");
    await mkdir(destDir, { recursive: true });
    await writeFile(
      path.join(destDir, "AGENTS.md"),
      [
        "# Existing Instructions",
        "",
        "<!-- gskills:start maintainable-code -->",
        "- Old version one.",
        "<!-- gskills:end maintainable-code -->",
        "",
        "<!-- gskills:start maintainable-code -->",
        "- Old version two.",
        "<!-- gskills:end maintainable-code -->",
        ""
      ].join("\n"),
      "utf8"
    );

    await installSkills({
      repoDir,
      destDir,
      tool: "codex",
      skills: ["maintainable-code"]
    });

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.equal(agentsText.match(/<!-- gskills:start maintainable-code -->/g).length, 1);
    assert.doesNotMatch(agentsText, /Old version one/);
    assert.doesNotMatch(agentsText, /Old version two/);
    assert.match(agentsText, /Updated version/);
  });
});
