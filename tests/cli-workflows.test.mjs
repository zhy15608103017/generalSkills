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

test("does not install AGENTS instructions from assets without an install hook", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "maintainable-code",
      description: "Use when testing disabled AGENTS asset compatibility.",
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

    assert.deepEqual(result.installScripts, []);

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.equal(agentsText, "# Existing Instructions\n");
  });
});

test("runs skill install hook once and removes lifecycle scripts from installed skills", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "hooked-skill",
      description: "Use when testing install hooks.",
      resources: []
    });
    const hookDir = path.join(repoDir, "skills", "hooked-skill", ".gskills");
    await mkdir(hookDir, { recursive: true });
    await writeFile(
      path.join(hookDir, "install.mjs"),
      [
        "import path from \"node:path\";",
        "import { mkdir, writeFile } from \"node:fs/promises\";",
        "",
        "export async function install(context) {",
        "  const output = {",
        "    skillName: context.skillName,",
        "    tool: context.tool,",
        "    targetCount: context.targets.length,",
        "    targets: context.targets",
        "      .map((target) => ({",
        "        tool: target.tool,",
        "        relativePath: target.relativePath,",
        "        installedPath: path.relative(context.destDir, target.installedPath).replace(/\\\\/g, \"/\")",
        "      }))",
        "      .sort((left, right) => left.tool.localeCompare(right.tool))",
        "  };",
        "  await mkdir(context.destDir, { recursive: true });",
        "  await writeFile(path.join(context.destDir, \"hook-context.json\"), `${JSON.stringify(output, null, 2)}\\n`, \"utf8\");",
        "}"
      ].join("\n"),
      "utf8"
    );

    const destDir = path.join(repoDir, "consumer-project");
    const result = await installSkills({
      repoDir,
      destDir,
      tool: "all",
      skills: ["hooked-skill"]
    });

    assert.deepEqual(result.installScripts, [
      {
        skillName: "hooked-skill",
        path: path.join(".gskills", "install.mjs")
      }
    ]);

    const hookContext = JSON.parse(await readFile(path.join(destDir, "hook-context.json"), "utf8"));
    assert.deepEqual(hookContext, {
      skillName: "hooked-skill",
      tool: "all",
      targetCount: 7,
      targets: [
        {
          tool: "claude",
          relativePath: ".claude/skills",
          installedPath: ".claude/skills/hooked-skill"
        },
        {
          tool: "codex",
          relativePath: ".agents/skills",
          installedPath: ".agents/skills/hooked-skill"
        },
        {
          tool: "cursor",
          relativePath: ".cursor/skills",
          installedPath: ".cursor/skills/hooked-skill"
        },
        {
          tool: "gemini",
          relativePath: ".gemini/skills",
          installedPath: ".gemini/skills/hooked-skill"
        },
        {
          tool: "opencode",
          relativePath: ".opencode/skills",
          installedPath: ".opencode/skills/hooked-skill"
        },
        {
          tool: "trae",
          relativePath: ".trae/skills",
          installedPath: ".trae/skills/hooked-skill"
        },
        {
          tool: "windsurf",
          relativePath: ".windsurf/skills",
          installedPath: ".windsurf/skills/hooked-skill"
        }
      ]
    });

    for (const entry of result.installed) {
      await assert.rejects(
        () => stat(path.join(entry.path, ".gskills")),
        /ENOENT/
      );
    }
  });
});

test("rejects install hooks that do not export an install function", async () => {
  await withTempDir(async (repoDir) => {
    await createSkill({
      repoDir,
      name: "bad-hook",
      description: "Use when testing invalid install hooks.",
      resources: []
    });
    const hookDir = path.join(repoDir, "skills", "bad-hook", ".gskills");
    await mkdir(hookDir, { recursive: true });
    await writeFile(path.join(hookDir, "install.mjs"), "export const noop = true;\n", "utf8");

    const destDir = path.join(repoDir, "consumer-project");
    await assert.rejects(
      () => installSkills({
        repoDir,
        destDir,
        tool: "codex",
        skills: ["bad-hook"]
      }),
      /bad-hook: \.gskills\/install\.mjs must export an install\(context\) function\./
    );
    await assert.rejects(
      () => stat(path.join(destDir, ".agents", "skills", "bad-hook", ".gskills")),
      /ENOENT/
    );
  });
});

test("canonical AGENTS reminders are installed by skill hooks", async () => {
  await withTempDir(async (destDir) => {
    const selfImprovingInstruction =
      "Use `self-improving-agent` only for durable, future-useful learnings such as user corrections, non-obvious failures, recurring issues, project conventions, or reusable best practices; skip routine noise/secrets/personal data, search `.learnings/` first, and update existing `Pattern-Key`s instead of duplicating.";
    const result = await installSkills({
      repoDir: path.resolve("."),
      destDir,
      tool: "codex",
      skills: ["code-review-loop", "generate-maintainable-code", "self-improving-agent"]
    });

    assert.deepEqual(
      result.installScripts.map((entry) => entry.skillName).sort(),
      ["code-review-loop", "generate-maintainable-code", "self-improving-agent"]
    );

    const agentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.match(agentsText, /<!-- gskills:start code-review-loop -->/);
    assert.match(agentsText, /## AI Code Review/);
    assert.match(agentsText, /fix blocking `P0\/P1` findings/);
    assert.match(agentsText, /<!-- gskills:end code-review-loop -->/);
    assert.match(agentsText, /<!-- gskills:start generate-maintainable-code -->/);
    assert.match(agentsText, /## Code Generation/);
    assert.match(agentsText, /- Inspect nearby files before editing/);
    assert.match(agentsText, /<!-- gskills:end generate-maintainable-code -->/);
    assert.match(agentsText, /<!-- gskills:start self-improving-agent -->/);
    assert.equal(extractGskillsBlock(agentsText, "self-improving-agent"), selfImprovingInstruction);
    assert.match(agentsText, /<!-- gskills:end self-improving-agent -->/);

    await installSkills({
      repoDir: path.resolve("."),
      destDir,
      tool: "codex",
      skills: ["self-improving-agent"]
    });
    const updatedAgentsText = await readFile(path.join(destDir, "AGENTS.md"), "utf8");
    assert.equal(
      (updatedAgentsText.match(/<!-- gskills:start self-improving-agent -->/g) || []).length,
      1
    );
    assert.equal(
      (updatedAgentsText.match(/<!-- gskills:end self-improving-agent -->/g) || []).length,
      1
    );

    for (const entry of result.installed) {
      await assert.rejects(
        () => stat(path.join(entry.path, ".gskills")),
        /ENOENT/
      );
    }
  });
});

function extractGskillsBlock(text, skillName) {
  const startMarker = `<!-- gskills:start ${skillName} -->`;
  const endMarker = `<!-- gskills:end ${skillName} -->`;
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start + startMarker.length, end).trim();
}
