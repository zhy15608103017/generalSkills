---
name: self-improving-agent
description: Use when durable project learning should be captured or reviewed: user corrections, non-obvious command or tool failures, outdated agent knowledge, recurring patterns, project conventions, missing capabilities, reusable best practices, `.learnings/` maintenance, promotion to local instruction files, or extraction into reusable skills.
---

# Self-Improving Agent

Capture durable knowledge from real work so future agent sessions avoid repeated mistakes.

## Capture Gate

Record a learning only when it is future-useful. Before writing, confirm:

- The event was non-obvious, recurring, user-corrected, high-impact, or likely to help a future session.
- The entry can name a specific next action, file, command, tool, or decision rule.
- The content can be recorded without secrets, credentials, private tokens, or unnecessary personal data.
- The same lesson is not already captured; if it is, update recurrence metadata instead of duplicating it.

Do not log routine failed experiments, obvious typos, transient network noise with no durable fix, or notes that only restate the current task.

## Operating Rules

- Follow local project instructions first. If `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, or another local instruction file sets stricter logging rules, obey those rules.
- Store working logs in the nearest project-level `.learnings/` directory unless local instructions specify another location.
- Search existing entries before adding a new one. Link related entries with `See Also` instead of duplicating the same lesson.
- If local instructions require user confirmation before writing, show the exact proposed entry and wait for explicit approval.
- Validate target markdown files as UTF-8 before appending. If a file is not valid UTF-8, stop and ask before repairing or writing.
- Remove terminal control characters from command output before logging it.
- Do not record secrets, credentials, private tokens, or unnecessary personal data. Redact sensitive values.

## Quick Routing

| Situation | Action |
|-----------|--------|
| Command or operation fails unexpectedly | Log to `.learnings/ERRORS.md` |
| User corrects the agent | Log to `.learnings/LEARNINGS.md` with category `correction` |
| User requests a missing capability | Log to `.learnings/FEATURE_REQUESTS.md` |
| External API or tool fails | Log to `.learnings/ERRORS.md` with integration details |
| Agent knowledge is outdated | Log to `.learnings/LEARNINGS.md` with category `knowledge_gap` |
| Better recurring approach is found | Log to `.learnings/LEARNINGS.md` with category `best_practice` |
| Similar entry already exists | Add `See Also`, increment recurrence fields if present, and consider a priority bump |
| Broadly useful lesson emerges | Promote to local instruction files or extract a reusable skill |

## Workflow

1. Review `.learnings/` before major work, when entering an area with previous issues, or after a non-obvious failure.
2. Classify the event as a learning, error, or feature request.
3. Search for related entries with `rg` or another fast search tool.
4. Prefer `scripts/log-entry.mjs` for mechanical logging, ID generation, initialization, recurrence updates, and redaction.
5. Use `references/entry-formats.md` when writing manually or reviewing generated entries.
6. Promote stable, broadly applicable guidance using `references/promotion.md`.
7. Resolve or update stale entries during natural task breakpoints.

## Storage

Create these files when missing and allowed:

- `.learnings/LEARNINGS.md`
- `.learnings/ERRORS.md`
- `.learnings/FEATURE_REQUESTS.md`

Use the templates in `assets/` when initializing files:

- `assets/LEARNINGS.md`
- `assets/ERRORS.md`
- `assets/FEATURE_REQUESTS.md`

## Logging Script

Use the cross-platform Node helper when available:

```bash
node scripts/log-entry.mjs learning --summary "..." --details "..." --action "..." --category best_practice --pattern-key area.short-key
node scripts/log-entry.mjs error --summary "..." --error "..." --command "..." --tool npm_test --reproducible yes
node scripts/log-entry.mjs feature --requested "..." --context "..." --capability capability_name
node scripts/log-entry.mjs review --status pending --priority high
node scripts/log-entry.mjs review --pattern-key area.short-key
```

Helpful options:

- `--root <path>` writes to that project's `.learnings/`.
- `--priority low|medium|high|critical` and `--area frontend|backend|infra|tests|docs|config|tooling|general` set routing metadata.
- `--pattern-key <key>` updates an existing learning's `Recurrence-Count` and `Last-Seen` instead of adding duplicates.
- `--related-files`, `--tags`, and `--see-also` keep entries searchable.
- `review` lists matching entries across `.learnings/` files for maintenance.

The helper creates missing `.learnings/` files from `assets/`, strips terminal control characters, and redacts common token patterns.

## Entry IDs

Use `TYPE-YYYYMMDD-XXX`.

- `LRN` for learnings
- `ERR` for errors
- `FEAT` for feature requests
- `YYYYMMDD` is the current date
- `XXX` is a sequence or short random suffix

Examples: `LRN-20260603-001`, `ERR-20260603-A7B`, `FEAT-20260603-002`.

## References

- Read `references/entry-formats.md` for complete entry templates.
- Read `references/examples.md` for concrete examples.
- Read `references/promotion.md` before changing durable project or agent instruction files.
- Read `references/hooks-setup.md` only when configuring optional hook reminders.

## Promotion

Promote a learning when it applies beyond a single incident, prevents recurring mistakes, or documents a project convention future agents need.

Prefer existing local instruction files over creating new ones. Common targets include:

- `AGENTS.md` for agent workflows and project-specific rules
- `CLAUDE.md` for Claude-facing project context
- `GEMINI.md` for Gemini-facing project context
- `.github/copilot-instructions.md` for GitHub Copilot context

Keep promoted guidance short and actionable. After promotion, update the original entry status to `promoted` and add the target file.

## Skill Extraction

Extract a reusable skill when a learning is recurring, verified, non-obvious, broadly applicable, or explicitly requested by the user.

Use the helper when appropriate:

```bash
bash scripts/extract-skill.sh skill-name --output-dir ./skills --dry-run
bash scripts/extract-skill.sh skill-name --output-dir ./skills
```

After extraction, update the original learning:

```markdown
**Status**: promoted_to_skill
**Skill-Path**: path/to/skill-name
```

## Hooks

Hooks are optional reminders. They should only print lightweight guidance and should not write files automatically.

Use `references/hooks-setup.md` for setup examples. Adjust paths to wherever this skill is installed.

## Periodic Review

At natural breakpoints:

- Resolve fixed items.
- Promote durable lessons.
- Link related entries.
- Escalate recurring issues.
- Remove or archive entries that are no longer useful.

Useful searches:

```bash
node scripts/log-entry.mjs review --status pending
node scripts/log-entry.mjs review --priority high
node scripts/log-entry.mjs review --pattern-key <key>
rg -n "Status\\*\\*: pending" .learnings
rg -n "Priority\\*\\*: high|Priority\\*\\*: critical" .learnings
rg -n "Pattern-Key: <key>" .learnings
```

## Quality Gate

Before treating a log entry as done, ensure it is specific, future-useful, and tied to concrete context. A good entry answers:

- What happened?
- Why was it non-obvious?
- What should a future agent do differently?
- Which files, commands, or tools are related?
