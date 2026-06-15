# Generic Review Checklist

Use this checklist with `--checklist` when a task benefits from extra scrutiny.

- Verify the change satisfies the request, accepted design, and non-goals.
- Check that the diff does not include unrelated local work.
- Check user-visible behavior, integration contracts, state transitions, persistence, and error handling.
- Check security-sensitive areas such as authentication, authorization, secrets, injection, file access, network calls, and destructive operations.
- Check dependency, lockfile, build, CI, and deployment changes for compatibility risk.
- Check that verification commands are meaningful for the changed surface and that failures are treated as blocking.
- Check that generated artifacts, review briefs, logs, and model outputs do not leak secrets.
