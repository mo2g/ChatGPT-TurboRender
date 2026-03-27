# ChatGPT TurboRender

Keep long ChatGPT conversations responsive without replacing the native UI.

[中文说明](./README.zh-CN.md) | [Architecture Notes](./docs/architecture.md) | [架构说明](./docs/architecture.zh-CN.md)

ChatGPT TurboRender is a Chromium-first browser extension that reduces UI jank in very long ChatGPT threads by trimming cold history before first render, preserving a hot interaction window, and restoring old turns on demand.

If this project saves your browser from melting down, star the repo and share a trace or screenshot. Real-world long-thread cases are the fastest way to make the extension better.

## Why this exists

Long ChatGPT sessions eventually push the browser into a bad state:

- too many DOM nodes stay live
- streamed responses keep touching an already huge tree
- scrolling gets sticky
- input latency rises
- memory and CPU keep climbing

TurboRender focuses on the rendering bottleneck instead of changing your workflow. It keeps the latest turns interactive, trims or folds older finalized turns into lightweight history blocks, and restores them only when you actually need them.

## What it does

- Preserves the native ChatGPT UI instead of forcing a custom reader mode
- Adds a top-of-conversation history shelf so managed history is easy to find
- Activates automatically when thread size or frame-pressure heuristics cross a threshold
- Trims the initial `/backend-api/conversation/:id` payload in page context so very long chats do not fully hit the official first render path
- Parks cold message groups and replaces them with compact restore blocks
- Restores nearby or all history on demand
- Supports English and Simplified Chinese, with auto-follow plus manual override
- Falls back to a safer soft-fold mode if the host page re-renders aggressively
- Stores settings locally only and does not send conversation data to any external service

## Project status

- Browser target: Chrome and Edge first
- Runtime model: Manifest V3
- Storage model: local only
- Network model: page-layer interception of the initial conversation payload in the main world, no backend, no cloud sync
- Current E2E note: Playwright extension tests are included, but launching a persistent Chromium extension context can still be environment-sensitive in headless sandboxes

## How to view managed history

When TurboRender processes older turns, it adds a sticky history shelf at the top of the conversation.

- Click `View history` to reveal the managed history block and temporarily pause auto-parking
- Use `More` to access `Restore nearby`, `Restore all`, or pause the current chat
- Group placeholders inside the transcript still work, but they are secondary shortcuts now

## Quick start

```bash
pnpm install
pnpm build
```

Load the generated extension from `.output/chrome-mv3` in Chrome or Edge.

Useful commands:

```bash
pnpm dev
pnpm test
pnpm test:all
pnpm zip
```

## Repository map

- `entrypoints/`: WXT entrypoints for background, content script, popup, options, and harness pages
- `lib/content/`: ChatGPT page adapter, parking engine, visibility logic, and in-page status UI
- `lib/background/`: background-side runtime message handling and state orchestration
- `lib/shared/`: settings, types, message contracts, and chat-id helpers
- `lib/testing/`: local transcript fixture used by harness and tests
- `tests/`: unit, integration, and extension-level Playwright coverage
- `docs/`: design rationale and deeper implementation notes

## Design principles

- Solve rendering pressure first
- Preserve the native interaction model
- Keep the extension transparent and reversible
- Prefer local-only state and minimal permissions
- Fail safe when the host DOM changes

## Privacy

TurboRender does not send conversation data to any external service.

- no cloud sync
- no analytics pipeline
- no off-device transcript upload
- no persisted full transcript snapshots in v1

## Roadmap

- More resilient ChatGPT DOM adapters
- Better per-chat diagnostics in the popup
- Firefox support with a background-runtime swap
- Store-ready assets, screenshots, and publishing metadata
- Larger real-world performance benchmark corpus

## Contributing

Issues and PRs are welcome, especially if you can provide:

- a reproducible long-thread slowdown case
- a DOM snapshot or screen recording after a ChatGPT UI change
- a performance profile comparing extension on vs. off

## License

[MIT](./LICENSE)
