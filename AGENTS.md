# Repository Agent Instructions

## 超能力技能覆盖

- 不要在这个项目中使用或遵循 `superpowers:test-driven-development`，即使对于错误修复或功能工作也是如此。
- 调试或改变行为时，仍要调查根本原因并运行适当的验证，但不要在生产代码更改前要求失败的测试。

## Purpose

This repository stores reusable Agent Skills for coding tools. Keep `skills/` as the canonical source and use scripts to generate tool-specific copies.

## Browser Preference

- When browser access is needed, default to Chrome.
- Use the in-app Browser only when the user explicitly requests it, the task depends on it, or Chrome is unsuitable.

## Skill Authoring

- Put every skill in `skills/<skill-name>/`.
- Use lowercase letters, digits, and hyphens for skill names.
- Keep each `SKILL.md` frontmatter to `name` and `description`.
- Put detailed, optional context in `references/`; put repeatable helpers in `scripts/`; put reusable output files in `assets/`.
- Put install-time lifecycle hooks in `.gskills/install.mjs`; installed skill copies must not keep `.gskills/`.
- Do not hand-edit generated `.agents/skills`, `.claude/skills`, or `.opencode/skills` copies in consumer projects.
- Keep the npm package lightweight: do not include `skills/` in `package.json` `files`.
- Keep `gskills` remote-first; it should fetch skills from the configured GitHub source instead of depending on packaged skill content.
- Keep `--aicoding` as the primary install target flag. Preserve `--tool` as a compatibility alias.

## Verification

- Run `npm test` after script changes.
- Run `npm run validate` after skill changes.
- Keep the tooling dependency-free unless a dependency removes clear maintenance cost.

<!-- gskills:start code-review-loop -->
## AI Code Review

For feature, bug fix, refactor, or other local code changes, use the `code-review-loop` skill before reporting completion. Create `.ai-review/review-context/current-request.md`, run verification and the review loop, fix blocking `P0/P1` findings, and clearly report any review setup failure.
<!-- gskills:end code-review-loop -->
