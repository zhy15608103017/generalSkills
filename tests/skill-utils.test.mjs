import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CODING_TARGETS,
  normalizeSkillName,
  parseSkillFrontmatter,
  resolveToolTargets,
  validateSkillName
} from "../scripts/lib/skill-utils.mjs";

test("normalizes a display title into a skill folder name", () => {
  assert.equal(normalizeSkillName("Plan Mode Helper"), "plan-mode-helper");
  assert.equal(normalizeSkillName("  GitHub: Review Comments!  "), "github-review-comments");
});

test("rejects invalid skill names", () => {
  assert.deepEqual(validateSkillName("good-skill-1"), []);
  assert.match(validateSkillName("Bad_Skill")[0], /lowercase letters/);
  assert.match(validateSkillName("a".repeat(65))[0], /64 characters/);
});

test("parses required SKILL.md frontmatter", () => {
  const text = [
    "---",
    "name: sample-skill",
    "description: Use when validating sample skills.",
    "---",
    "",
    "# Sample Skill",
    "",
    "Do the work."
  ].join("\n");

  assert.deepEqual(parseSkillFrontmatter(text), {
    name: "sample-skill",
    description: "Use when validating sample skills."
  });
});

test("reports malformed frontmatter with a useful error", () => {
  assert.throws(
    () => parseSkillFrontmatter("# Missing frontmatter"),
    /frontmatter/
  );
  assert.throws(
    () => parseSkillFrontmatter("---\nname: only-name\n---\n"),
    /description/
  );
});

test("resolves supported AI coding targets and aliases", () => {
  assert.ok(AI_CODING_TARGETS.some((target) => target.name === "cursor"));
  assert.ok(AI_CODING_TARGETS.some((target) => target.name === "trae"));
  assert.ok(AI_CODING_TARGETS.some((target) => target.name === "windsurf"));
  assert.ok(AI_CODING_TARGETS.some((target) => target.name === "gemini"));

  assert.deepEqual(resolveToolTargets("default")[0], {
    tool: "default",
    label: "Default / Agent Skills",
    relativePath: ".agents/skills"
  });
  assert.deepEqual(resolveToolTargets("claude-code")[0], {
    tool: "claude",
    label: "Claude Code",
    relativePath: ".claude/skills"
  });

  const targets = resolveToolTargets("all");
  assert.deepEqual(
    targets.map((target) => [target.tool, target.relativePath]),
    [
      ["codex", ".agents/skills"],
      ["claude", ".claude/skills"],
      ["cursor", ".cursor/skills"],
      ["gemini", ".gemini/skills"],
      ["opencode", ".opencode/skills"],
      ["trae", ".trae/skills"],
      ["windsurf", ".windsurf/skills"]
    ]
  );
});
