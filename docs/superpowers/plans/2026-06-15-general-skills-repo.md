# General Skills Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable skills repository scaffold with canonical skill storage, validation, creation, and installation commands.

**Architecture:** Store every skill once under `skills/`, then use Node.js scripts to create, validate, and copy skills into tool-specific directories. Shared behavior lives in `scripts/lib/skill-utils.mjs`; CLI entrypoints stay thin.

**Tech Stack:** Node.js built-in modules, ESM, `node:test`, Markdown documentation.

---

### Task 1: Repository Documentation

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `docs/compatibility.md`

- [ ] **Step 1: Write the repository quick start**

Create `README.md` with the canonical layout, creation command, validation command, and installation examples for Codex, Claude Code, and opencode.

- [ ] **Step 2: Write agent maintenance rules**

Create `AGENTS.md` with concise rules: keep `skills/` canonical, keep tool-specific output generated, use `npm test` and `npm run validate`, and do not add dependencies unless they remove real maintenance cost.

- [ ] **Step 3: Write compatibility notes**

Create `docs/compatibility.md` explaining that `.agents/skills` is used for Codex-style project skills, `.claude/skills` for Claude Code project skills, and `.opencode/skills` for opencode project skills.

### Task 2: Tests First

**Files:**
- Create: `package.json`
- Create: `tests/skill-utils.test.mjs`
- Create: `tests/cli-workflows.test.mjs`

- [ ] **Step 1: Add package scripts**

Create `package.json` with `test`, `validate`, `new-skill`, and `install-skills` scripts.

- [ ] **Step 2: Write utility tests**

Create tests for name normalization, frontmatter parsing, invalid frontmatter errors, and tool target mapping.

- [ ] **Step 3: Write CLI workflow tests**

Create tests that call exported functions to create a skill in a temp workspace, validate it, and install it into `.agents/skills`, `.claude/skills`, and `.opencode/skills`.

- [ ] **Step 4: Run tests and confirm red state**

Run `npm test`. The expected result is failure because `scripts/lib/skill-utils.mjs` does not exist yet.

### Task 3: Script Implementation

**Files:**
- Create: `scripts/lib/skill-utils.mjs`
- Create: `scripts/new-skill.mjs`
- Create: `scripts/validate-skills.mjs`
- Create: `scripts/install-skills.mjs`
- Create: `templates/skill/SKILL.md`
- Create: `skills/.gitkeep`

- [ ] **Step 1: Implement shared utilities**

Implement functions for validating skill names, parsing frontmatter, enumerating skill folders, copying directories, and resolving tool target directories.

- [ ] **Step 2: Implement skill creation**

Implement `createSkill()` and the CLI wrapper. It creates `skills/<name>/SKILL.md` and optional resource directories from a normalized name and description.

- [ ] **Step 3: Implement validation**

Implement `validateRepository()` and the CLI wrapper. It prints each validation error and exits non-zero when errors exist.

- [ ] **Step 4: Implement installation**

Implement `installSkills()` and the CLI wrapper. It copies selected skills to `.agents/skills`, `.claude/skills`, `.opencode/skills`, or all three.

- [ ] **Step 5: Run tests and confirm green state**

Run `npm test`. The expected result is all tests passing.

### Task 4: Final Verification

**Files:**
- Modify: generated repository files from previous tasks.

- [ ] **Step 1: Validate the repository**

Run `npm run validate`. The expected result is a successful validation report.

- [ ] **Step 2: Exercise sample workflow**

Run `npm run new-skill -- sample-skill --description "Use when testing repository tooling." --resources references,scripts`, then `npm run validate`, then `npm run install-skills -- --tool all --dest ./.tmp/install-check`, and confirm all three target directories contain `sample-skill/SKILL.md`.

- [ ] **Step 3: Remove temporary workflow artifacts**

Delete `.tmp/` and the sample skill after verification so the repository remains a clean scaffold.
