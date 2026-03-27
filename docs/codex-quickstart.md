# Codex App Quickstart

## First Pass In A Repository

1. Read `AGENTS.md`.
2. Inspect `.codex/config.toml` and confirm the verify hooks match the real stack.
3. Check whether the repository keeps extra skills under `.agents/skills/`.
4. If the task is not trivial, start with `planner`.

Typical verification commands:

- Node: `npm test`, `pnpm test`, or `yarn test`
- Go: `go test ./...`
- Rust: `cargo test`
- Polyglot: prefer one shared entrypoint such as `make verify`

## When To Plan First

Use `planner` when:

- scope is ambiguous
- multiple subsystems are involved
- regression risk is meaningful
- you may need to split work into another thread or worktree

Use `implementer` once the change is bounded and ready to code.

## When To Split Work

- Use a new Codex thread when the work can be reviewed independently.
- Add a worktree when filesystem or branch isolation will reduce merge risk.
- Keep one thread when the work is tightly coupled and fast feedback matters more than parallelism.

## Merge Readiness

Use `merge-check` when:

- the implementation is complete
- verification has been run
- a human needs a go or no-go recommendation before merge

Humans merge after scope, verification, and review are all clear. After merge, rerun the main-branch verification commands.
