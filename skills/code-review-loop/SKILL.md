---
name: code-review-loop
description: Use when feature, bug fix, refactor, or other code-bearing local changes need an external AI code review before completion. Do not trigger for docs-only, formatting, comment, typo, lockfile, generated-output, `.ai-review/` artifact, or plain dependency-version-only changes.
---

# Code Review Loop

Use this skill to run a local AI review loop over the current Git changes. The reviewer model audits the work; the current coding agent owns fixes.

## Non-Negotiable Rules

- Create or update `.ai-review/review-context/current-request.md` before every non-dry-run review.
- Make the context self-contained. The reviewer cannot see the conversation, so inline the original request, later corrections, current understanding, explicit anti-examples, design decisions, non-goals, acceptance criteria, and verification commands.
- Do not let the reviewer model edit files directly. It returns structured findings; the current coding agent fixes, verifies, and reruns review.
- Treat only `P0` and `P1` findings as blocking unless the user says otherwise.
- Do not run unbounded review/fix cycles unless the review-round limit is explicitly configured as `infinity`. The default maximum is three review rounds; configure it with `--max-review-rounds` or `AI_REVIEW_MAX_REVIEW_ROUNDS`.
- Never mark work complete only because AI review passed. Also report local verification commands and results.

## Context File

Prefer the bundled context writer:

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "<user request>" --corrections "<later corrections>" --understanding "<current agent understanding>" --anti-examples "<rejected behavior>" --design "<accepted design>" --acceptance "<acceptance criteria>" --non-goals "<out of scope>" --verification "<verification commands>"
```

For full Markdown context, write from a UTF-8 file:

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-file .ai-review/review-context/draft-request.md
```

For a new feature, overwrite the current context instead of appending old requirements. Keep `current-design.md` and `current-plan.md` concise when needed; pass large extra docs with `--doc` only when the review needs them.

## Requirement Understanding Gate

Every non-dry-run review runs a requirement-understanding audit before code review. The gate uses `references/requirement-auditor-prompt.md` and the same structured result schema.

The gate must pass before code is reviewed. If it returns `fail` or `needs_human`, the script writes `.ai-review/latest-result.json` and `.ai-review/latest-report.md`, skips code review, and exits with the same blocking semantics as a code review failure.

Successful audits are cached; the gate skips re-auditing when context, prompt, and model have not changed. To force a fresh requirement audit, pass `--no-requirement-audit-cache`.

## Default Flow

1. Create or update `.ai-review/review-context/current-request.md` with the original request, user corrections, current agent understanding, anti-examples, design, non-goals, acceptance criteria, and suggested verification.
2. Confirm there are local changes to review with `git status --short`.
3. Run local verification commands that match the change (e.g. `git diff --check`, `npm test`).
4. Optionally, run with `--dry-run` first to inspect the review brief without calling a model.
5. Run the bundled review script from the repository root. It first runs the requirement-understanding gate, then runs code review only if the gate passes:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

6. Read `.ai-review/latest-result.json` and `.ai-review/latest-report.md`; inspect requirement-audit artifacts when the gate blocks.
7. Report all findings, but fix blocking `P0` and `P1` findings before completion.
8. Fix blocking findings yourself, then rerun local verification.
9. Repeat the review loop up to the configured maximum (`3` by default; `infinity` means no round cap).
10. If blocking findings remain after the configured maximum, stop and return the remaining issues for human decision.

## Commands

The full command catalog — dry run, provider and OpenAI-compatible endpoints, CodeGraph impact context, staged review, second reviewer, checklists, profiles, and `.ai-reviewignore` — is in `references/workflow.md`. Provider, model, dual-reviewer, timeout, and environment-variable configuration is in `references/configuration.md` and `references/provider-config.md`.

The standard invocation:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

## Reviewer Verdict

- `pass`: No blocking findings. Warnings may still be reported.
- `fail`: One or more `P0` or `P1` findings must be fixed before completion.
- `needs_human`: The reviewer cannot decide safely because context is missing, requirements conflict, or the patch is too risky for automatic repair.

If reviewer output is malformed, retry with the same configurable retry parameters. If retries are exhausted, stop and report the tool failure.

## Review Limits and Retries

- Review/fix loop limit: `--max-review-rounds <count|infinity>` or `AI_REVIEW_MAX_REVIEW_ROUNDS`; default `3`.
- Retryable model failures retry only when an attempt fails quickly. Defaults: `AI_REVIEW_RETRIES=3`, `AI_REVIEW_RETRY_FAST_FAILURE_MS=10000`, and `AI_REVIEW_RETRY_DELAY_MS=5000`.
- Override the same retry budget for the second reviewer with `--second-retries`, `--second-retry-fast-failure-ms`, `--second-retry-delay-ms`, or `AI_REVIEW_SECOND_*` equivalents. When unset, second review inherits the primary budget.

## References

- Workflow guide and full command catalog: `references/workflow.md`
- Configuration guide: `references/configuration.md`
- Provider setup: `references/provider-config.md`
- Requirement auditor prompt: `references/requirement-auditor-prompt.md`
- Reviewer prompt: `references/reviewer-prompt.md`
- Output schema: `references/review-result.schema.json`
- Model list: `references/model-providers.json`

## Security

Treat `.ai-review/` artifacts as potentially sensitive — they may contain local code context and review details. Never upload them to public locations.
