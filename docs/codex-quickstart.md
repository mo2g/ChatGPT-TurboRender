# Codex App Quickstart

## First Pass In A Repository

1. Read `AGENTS.md`.
2. Inspect the repo manifests, nearby tests, and `.codex/config.toml` if the repository already keeps one.
3. Check whether the repository keeps extra skills under `.agents/skills/`.
4. If the task is not trivial, start with `planner`.

Typical verification signals:

- `package.json` and lockfiles
- `go.mod`
- `Cargo.toml`
- `pyproject.toml`
- test configs, scripts, CI entrypoints, and nearby test files
- optional hooks in `.codex/config.toml`

## When To Plan First

Use `planner` when:

- scope is ambiguous
- multiple subsystems are involved
- regression risk is meaningful
- you may need to split work into another thread or worktree

`planner` should:

- clarify the goal, success criteria, in-scope and out-of-scope behavior
- identify risks and whether split or worktree is even necessary
- only then write the bounded implementation plan and `change-check` gate

Use `implementer` once the intent is locked and the change is bounded and ready to code.

## When To Split Work

- Keep one thread by default.
- Use a new Codex thread when the work can be reviewed independently.
- Add a worktree when filesystem or branch isolation will reduce merge risk.

## Final Change Check

Use `change-check` when:

- implementation is complete or close enough for a final evidence pass
- the diff may need new or stronger tests
- a human needs verification evidence and commit guidance before commit or manual merge

`change-check` should:

- inspect the diff and nearby tests
- add or update direct tests when behavior changed
- detect the stack and choose the best-fit verification commands
- treat `.codex/config.toml` hooks as hints or overrides, not the only truth
- report evidence, remaining risk, and a recommended commit message

If no reliable verification path can be inferred, stop and say why instead of claiming the change was fully verified.

## Controlled Chrome For DevTools MCP

This repo keeps a project-level `[.codex/config.toml](../.codex/config.toml)` that points `chrome-devtools` MCP at `http://127.0.0.1:9222`.

Use the dedicated launcher instead of loading the unpacked extension manually inside the MCP browser:

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/c/<chat-id>
```

or

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/share/<share-id>
```

The launcher starts a dedicated Chromium-based profile with `.output/chrome-mv3` preloaded. It prefers the repo-managed Playwright browser (`Google Chrome for Testing`) or a local Chromium build, because stable Google Chrome no longer loads unpacked extensions through `--load-extension`. Restart Codex after launching it so the MCP session reconnects to that controlled browser.

If you already have a logged-in controlled browser on `9222`, prefer reloading the extension in place instead of restarting the browser:

```bash
pnpm reload:mcp-chrome
```

That keeps the existing profile and sign-in state intact while refreshing ChatGPT tabs after `pnpm build`.
