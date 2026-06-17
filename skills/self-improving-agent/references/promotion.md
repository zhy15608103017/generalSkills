# Promotion Guide

Promote learnings when they should influence future work, not merely document one incident.

## Promote When

- The learning applies across multiple files, tasks, or sessions.
- It prevents a likely recurring mistake.
- It documents a project convention, workflow, or tool constraint.
- It captures an integration behavior that is easy to forget.
- The same pattern appears at least twice, or once with high impact.

## Promotion Targets

Use the local instruction files already present in the project.

| Target | Use For |
|--------|---------|
| `AGENTS.md` | Agent workflows, repository rules, automation guidance |
| `CLAUDE.md` | Claude-specific project context |
| `GEMINI.md` | Gemini-specific project context |
| `.github/copilot-instructions.md` | GitHub Copilot context |
| Other local instruction files | Only when the project already documents them |

Avoid creating a new instruction file unless the project already expects it or the user asks.

## How To Promote

1. Distill the learning into one short rule or checklist item.
2. Add it to the most specific relevant section.
3. Keep wording action-oriented.
4. Update the original `.learnings/` entry:

```markdown
**Status**: promoted
**Promoted**: AGENTS.md
```

5. Add a resolution block if the original issue is fully handled.

## Recurring Pattern Rule

When an entry has a stable `Pattern-Key`, promote it when all are true:

- `Recurrence-Count >= 3`
- It appears across at least two distinct tasks or contexts
- The pattern occurred within a practical review window

Write promoted rules as prevention guidance, not as incident reports.
