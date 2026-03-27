# Manual Merge Checklist

Use this before merging any Codex-assisted branch.

## Pre-Merge

- [ ] Relevant verification has passed.
- [ ] Diff is within approved scope and contains no unrelated edits.
- [ ] `merge-check` has a clear outcome.
- [ ] Risks and rollback notes are understood.

## Merge

- [ ] Merge is executed manually by a human.
- [ ] No opportunistic scope expansion is introduced during conflict resolution.

## Post-Merge

- [ ] Re-run verification on `main` (or the integration target).
- [ ] If verification fails, stop and fix before considering the task finished.
