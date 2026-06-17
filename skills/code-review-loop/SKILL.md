---
name: code-review-loop
description: Use when local code changes, completed feature work, pre-commit checks, or user requests need an external AI code review before considering the work complete.
---

# Code Review Loop

Use this skill to run a local AI review loop over the current Git changes. The reviewer model audits the work; the current coding agent owns fixes.

## Mandatory Context Capture

**This step is NOT optional. You MUST create `.ai-review/review-context/current-request.md` before running any review.** Skipping this step means the reviewer model has no idea what you are trying to accomplish and will produce useless results.

When this skill is used for a feature addition, behavior change, bug fix, or code review, first create or update `.ai-review/review-context/current-request.md`. This file is the default requirement source for later AI review.

If the current conversation contains the user request or accepted design, summarize it into the context file before editing or reviewing code. Keep it concise: record the current feature only, prefer 100-300 lines or less, and do not paste the full chat log. If context is incomplete, write what is known and mark missing parts clearly.

**CRITICAL: The context file must be self-contained.** The reviewer model cannot see your conversation history. Never write references like "implement #7-#15" or "fix the issues from the list" without including the actual content. Always inline the specific requirements, design decisions, and acceptance criteria so the reviewer can evaluate the work independently.

**Detail requirements:**
- `--request`: Include the user's original request with all specific requirements, not just a summary or reference number. If the user listed 9 items, write all 9 items.
- `--corrections`: Include later user corrections, clarifications, and changed expectations in their own section. If none exist, write `无`.
- `--understanding`: Include the current agent's understanding as something to be audited. Do not write it as unquestioned truth.
- `--anti-examples`: Include explicit examples of behavior the user rejected or said was wrong. If none exist, write `无`.
- `--design`: Include key design decisions, architecture choices, trade-offs, and why certain approaches were chosen.
- `--acceptance`: Include concrete, verifiable acceptance criteria. Each criterion should be a specific, testable statement derived from the original request and corrections.
- `--non-goals`: Explicitly state what is out of scope to prevent the reviewer from flagging intentional omissions.
- `--verification`: List the exact commands that should pass to verify the work.

**Before running the review, verify the context file exists and is complete:**
```bash
test -f .ai-review/review-context/current-request.md && echo "EXISTS" || echo "MISSING - create it first"
```

For a new feature, overwrite the current context instead of appending old requirements. Keep `current-design.md` and `current-plan.md` as concise summaries when they are needed; pass large extra docs explicitly with `--doc` only when the review needs them.

Files generated under `.ai-review/` should use Simplified Chinese for human-readable content by default, including review context, brief, reports, summaries, findings, and verification notes. Keep code identifiers, commands, file paths, JSON property names, enum values, and external error text in their original form when that is clearer.

Create a structured context file:

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --request "<user request>" --corrections "<later corrections>" --understanding "<current agent understanding>" --anti-examples "<rejected behavior>" --design "<accepted design>" --acceptance "<acceptance criteria>"
```

Use `--out .ai-review/review-context/current-design.md` or `--out .ai-review/review-context/current-plan.md` to write concise design or plan context files.

Or write a full Markdown context from stdin:

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-stdin
```

On Windows PowerShell, piping non-ASCII Markdown into native processes can replace Chinese text with `?` before Node receives it. For full Markdown context on Windows, prefer a UTF-8 file:

```bash
node .agents/skills/code-review-loop/scripts/write-review-context.mjs --from-file .ai-review/review-context/draft-request.md
```

## Core Rule

Do not let the reviewer model edit files directly. It must return structured findings. If the verdict is `fail`, fix the blocking findings in the current workspace, run local verification, and review again.

## Requirement Understanding Gate

Every non-dry-run review runs a requirement-understanding audit before code review. The gate uses `references/requirement-auditor-prompt.md` and the same structured result schema.

The gate must pass before code is reviewed. If it returns `fail` or `needs_human`, the script writes `.ai-review/latest-result.json` and `.ai-review/latest-report.md`, skips code review, and exits with the same blocking semantics as a code review failure.

The requirement auditor checks only whether the current agent understanding and acceptance criteria faithfully match the user's original request, later corrections, clarifications, and explicit anti-examples. It must not treat the current understanding as ground truth.

## Default Flow

1. Create or update `.ai-review/review-context/current-request.md` with the original request, user corrections, current agent understanding, anti-examples, design, non-goals, acceptance criteria, and suggested verification.
2. Confirm there are local changes to review with `git status --short`.
3. Gather review context (auto-collected: diff, changed files, AGENTS.md, verification output, context docs). When CodeGraph is available and the change may have indirect impact, add `--codegraph` to include best-effort affected-test context; do not use it for the requirement-understanding gate.
4. Run the bundled review script from the repository root. It first runs the requirement-understanding gate, then runs code review only if the gate passes:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --verify "git diff --check"
```

5. Read `.ai-review/latest-result.json` and `.ai-review/latest-report.md`. For the pre-code gate, also inspect `.ai-review/latest-requirement-audit-result.json` and `.ai-review/latest-requirement-audit-brief.md` when needed.
6. Treat only `P0` and `P1` findings as blocking unless the user says otherwise.
7. Fix blocking findings yourself, then rerun local verification.
8. Repeat the review loop up to three times.
9. If blocking findings remain after three rounds, stop and return the remaining issues for human decision.

## Common Commands

Dry run without calling a model:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --dry-run
```

Review with a provider (see `references/provider-config.md` for all providers):

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --provider deepseek --model deepseek-v4-pro
```

Review with an OpenAI-compatible endpoint:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --provider openai-compatible --base-url https://api.example.com/v1 --model <model>
```

Include verification output:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --verify "git diff --check"
```

Include optional CodeGraph impact context:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --codegraph --verify "git diff --check"
```

If using the agent-side CodeGraph MCP instead of the CLI, write a concise `.ai-review/review-context/codegraph.md` with relevant `affected`, `callers`, `callees`, or `impact` findings, then pass it explicitly:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --doc .ai-review/review-context/codegraph.md --verify "git diff --check"
```

Review only a task path:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --path src --verify "git diff --check"
```

Review staged changes before committing:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --staged --verify "git diff --cached --check"
```

Use automatic high-accuracy profile:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --profile auto --path src --verify "git diff --check"
```

Use a second reviewer model:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --path src --second-provider openai --second-model gpt-5.5
```

Include an explicit project or domain checklist:

```bash
node .agents/skills/code-review-loop/scripts/ai-review.mjs --checklist docs/review-checklist.md --path src
```

## Reviewer Verdict

- `pass`: No blocking findings. Warnings may still be reported.
- `fail`: One or more `P0` or `P1` findings must be fixed before completion.
- `needs_human`: The reviewer cannot decide safely because context is missing, requirements conflict, or the patch is too risky for automatic repair.

## Fix Loop Boundaries

- Never run infinite review/fix cycles.
- Never hide warnings; include them in the final report.
- Never mark work complete only because the reviewer passed; also report local verification commands.
- If reviewer output is malformed, rerun once with the same context. If it is malformed again, stop and report the tool failure.
- Treat `.ai-review/latest-brief.md`, `.ai-review/cache/`, `.ai-review/runs/`, `.ai-review/history.jsonl`, and `.ai-review/history.md` as potentially sensitive local artifacts: they may contain redacted but still task-specific code context, findings, reviewer model metadata, and review details.

## References

- Provider setup: `references/provider-config.md`
- Workflow guide: `references/workflow.md`
- Configuration guide: `references/configuration.md`
- Requirement auditor prompt: `references/requirement-auditor-prompt.md`
- Reviewer prompt: `references/reviewer-prompt.md`
- Output schema: `references/review-result.schema.json`
- Model list: `references/model-providers.json`
