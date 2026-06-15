# Repository Agent Instructions

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
- Do not hand-edit generated `.agents/skills`, `.claude/skills`, or `.opencode/skills` copies in consumer projects.
- Keep the npm package lightweight: do not include `skills/` in `package.json` `files`.
- Keep `gskills` remote-first; it should fetch skills from the configured GitHub source instead of depending on packaged skill content.
- Keep `--aicoding` as the primary install target flag. Preserve `--tool` as a compatibility alias.

## Verification

- Run `npm test` after script changes.
- Run `npm run validate` after skill changes.
- Keep the tooling dependency-free unless a dependency removes clear maintenance cost.
