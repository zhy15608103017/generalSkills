# Errors

Unexpected command failures, tool failures, exceptions, and integration issues captured during development.

**Areas**: frontend | backend | infra | tests | docs | config | tooling | general
**Statuses**: pending | in_progress | resolved | wont_fix | promoted

---

## [ERR-20260717-001] codegraph

**Logged**: 2026-07-17T07:47:58.571Z
**Priority**: low
**Status**: pending
**Area**: tooling

### Summary
CodeGraph sync 不支持 JSON 输出参数

### Error
```text
codegraph sync -j 返回 unknown option '-j'
```

### Context
- Command/operation attempted: codegraph sync -j <project>
- Input or parameters: N/A
- Environment details: N/A

### Suggested Fix
运行 `codegraph sync <project>`，需要 JSON 状态时再单独运行 `codegraph status -j <project>`；不要向 `sync` 传递 `-j`。

### Metadata
- Reproducible: yes
- Related Files: N/A
- See Also: N/A

---
