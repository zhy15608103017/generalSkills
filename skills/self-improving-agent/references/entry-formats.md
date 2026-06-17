# Entry Formats

Use these templates when writing `.learnings/` entries.

Prefer `scripts/log-entry.mjs` for new entries because it initializes files,
generates IDs, strips terminal control characters, redacts common secrets, and
updates recurrence metadata when a matching `Pattern-Key` exists.

```bash
node scripts/log-entry.mjs learning --summary "..." --details "..." --action "..." --category insight
node scripts/log-entry.mjs error --summary "..." --error "..." --command "..."
node scripts/log-entry.mjs feature --requested "..." --context "..."
node scripts/log-entry.mjs review --status pending --priority high
```

## Learning Entry

Append to `.learnings/LEARNINGS.md`.

```markdown
## [LRN-YYYYMMDD-XXX] category

**Logged**: ISO-8601 timestamp
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config | tooling | general

### Summary
One-line description of what was learned.

### Details
Full context: what happened, what was wrong, and what is correct.

### Suggested Action
Specific fix or improvement for future sessions.

### Metadata
- Source: conversation | error | user_feedback | investigation
- Related Files: path/to/file.ext
- Tags: tag1, tag2
- See Also: LRN-YYYYMMDD-XXX
- Pattern-Key: category.short_key
- Recurrence-Count: 1
- First-Seen: YYYY-MM-DD
- Last-Seen: YYYY-MM-DD

---
```

Use category values such as `correction`, `insight`, `knowledge_gap`, or `best_practice`.

## Error Entry

Append to `.learnings/ERRORS.md`.

````markdown
## [ERR-YYYYMMDD-XXX] command_or_tool_name

**Logged**: ISO-8601 timestamp
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config | tooling | general

### Summary
Brief description of what failed.

### Error
```text
Sanitized error message or output.
```

### Context
- Command/operation attempted:
- Input or parameters:
- Environment details:

### Suggested Fix
If identifiable, describe what might resolve this.

### Metadata
- Reproducible: yes | no | unknown
- Related Files: path/to/file.ext
- See Also: ERR-YYYYMMDD-XXX

---
````

## Feature Request Entry

Append to `.learnings/FEATURE_REQUESTS.md`.

```markdown
## [FEAT-YYYYMMDD-XXX] capability_name

**Logged**: ISO-8601 timestamp
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config | tooling | general

### Requested Capability
What the user wanted to do.

### User Context
Why they needed it and what problem they were solving.

### Complexity Estimate
simple | medium | complex

### Suggested Implementation
How this could be built, what it might extend, and likely constraints.

### Metadata
- Frequency: first_time | recurring
- Related Features: existing_feature_name

---
```

## Resolution Block

When an item is fixed, promoted, or intentionally closed, update the status and add:

```markdown
### Resolution
- **Resolved**: ISO-8601 timestamp
- **Commit/PR**: commit hash, PR number, or N/A
- **Notes**: Brief description of what changed.
```

Valid statuses:

| Status | Meaning |
|--------|---------|
| `pending` | Not yet addressed |
| `in_progress` | Actively being worked on |
| `resolved` | Issue fixed or knowledge integrated |
| `wont_fix` | Intentionally not addressed |
| `promoted` | Elevated to a local instruction file |
| `promoted_to_skill` | Extracted as a reusable skill |
