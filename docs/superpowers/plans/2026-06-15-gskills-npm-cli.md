# gskills npm CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a publishable npm CLI named `gskills` that lists, installs, and removes remote skills from the GitHub repository without bundling `skills/` in the npm package.

**Architecture:** Keep current local repository scripts intact. Add remote GitHub helpers in `scripts/lib/remote-skills.mjs` and a user-facing CLI in `bin/gskills.mjs`. Reuse existing tool target mapping, validation, and copy helpers from `scripts/lib/skill-utils.mjs`.

**Tech Stack:** Node.js 20 ESM, built-in `fetch`, built-in `node:test`, GitHub REST/tree and raw content endpoints.

---

### Task 1: Package Metadata

**Files:**
- Modify: `package.json`

- [ ] Remove `private: true`.
- [ ] Add `bin: { "gskills": "./bin/gskills.mjs" }`.
- [ ] Add a `files` allowlist that includes CLI code and excludes `skills/`.
- [ ] Add script aliases for `gskills`.

### Task 2: Tests First

**Files:**
- Create: `tests/remote-skills.test.mjs`
- Create: `tests/gskills-cli.test.mjs`
- Modify: `tests/skill-utils.test.mjs`

- [ ] Write tests for parsing `owner/repo`, GitHub HTTPS URLs, and SSH Git URLs.
- [ ] Write tests for listing remote skills from a mocked tree response and mocked `SKILL.md` downloads.
- [ ] Write tests for installing two remote skills into all tool targets.
- [ ] Write tests for removing a skill from selected tool targets.
- [ ] Write tests that `package.json` exposes `gskills` and does not allowlist `skills/`.
- [ ] Run `npm test` and confirm failure because the new modules do not exist yet.

### Task 3: Remote Helpers

**Files:**
- Create: `scripts/lib/remote-skills.mjs`
- Modify: `scripts/lib/skill-utils.mjs`

- [ ] Add source parsing and default source/ref resolution.
- [ ] Add remote tree fetching and available skill discovery.
- [ ] Add raw file download helpers.
- [ ] Add remote skill download into a temp directory.
- [ ] Add remove helper that deletes only selected generated skill directories.

### Task 4: User CLI

**Files:**
- Create: `bin/gskills.mjs`
- Modify: `README.md`
- Modify: `docs/compatibility.md`

- [ ] Implement `list`, `add`, `remove`, `tools`, and `help`.
- [ ] Use `--source`, `--ref`, `--tool`, `--dest`, and environment variable overrides.
- [ ] Print concise user-facing output for each command.
- [ ] Update docs with npm install and `npx` examples.

### Task 5: Verification

**Files:**
- All changed files.

- [ ] Run `npm test`.
- [ ] Run `npm run validate`.
- [ ] Run `node bin/gskills.mjs tools`.
- [ ] Run `node bin/gskills.mjs help`.
- [ ] Use mocked tests as network-independent proof for list/add/remove behavior.
