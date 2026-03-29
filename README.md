# ChatGPT TurboRender

Keep long ChatGPT conversations responsive without replacing the native UI.

[中文说明](./README.zh-CN.md) | [Architecture Notes](./docs/architecture.md) | [架构说明](./docs/architecture.zh-CN.md) | [Controlled Chrome Cookbook](./docs/cookbook-controlled-chrome.md) | [受控 Chrome Cookbook](./docs/cookbook-controlled-chrome.zh-CN.md)

ChatGPT TurboRender is a Chromium-first browser extension that reduces UI jank in very long ChatGPT threads by trimming cold history before first render, preserving a hot interaction window, and restoring old turns on demand.

If this project saves your browser from melting down, star the repo and share a trace or screenshot. Real-world long-thread cases are the fastest way to make the extension better.

If it also saves you time, see the [Support](#support) section below.

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
- Keeps the latest 5 interaction pairs live and folds older history inline in the original transcript order
- Activates automatically when thread size or frame-pressure heuristics cross a threshold
- Trims the initial `/backend-api/conversation/:id` payload in page context and also reads share-page loader data
- Parks cold message groups and replaces them with compact inline batch cards
- Keeps a sticky `Expand / Collapse` control on the right side of long opened batches
- Supports English and Simplified Chinese, with auto-follow plus manual override
- Falls back to a safer soft-fold mode if the host page re-renders aggressively
- Stores settings locally only and does not send conversation data to any external service

## Project status

- Browser target: Chrome and Edge first
- Runtime model: Manifest V3
- Storage model: local only
- Network model: page-layer interception of the initial conversation payload in the main world, no backend, no cloud sync
- Current E2E note: Playwright extension tests are included, but launching a persistent Chromium extension context can still be environment-sensitive in headless sandboxes

## How folded history works

TurboRender keeps the newest 5 interaction pairs visible in the native ChatGPT transcript.

- Older history stays inline, above the hot window, as collapsible batch cards
- Each batch holds 5 interaction pairs in the original order
- Expanding a parked batch restores the original host DOM when available
- Expanding an initial-trim batch shows a read-only near-native renderer in the same position
- Long expanded batches keep a sticky `Expand / Collapse` action rail on the right so you can fold them back quickly

## Quick start

```bash
pnpm install
pnpm build
```

Use `pnpm build` for Chrome, `pnpm build:edge` for Edge, and `pnpm build:firefox` for Firefox if you want unpacked local builds. Load `.output/chrome-mv3`, `.output/edge-mv3`, or `.output/firefox-mv2` to sideload those local builds. Use `pnpm package:chrome`, `pnpm package:edge`, and `pnpm package:firefox` if you want GitHub Release archives (`.zip` for Chrome/Edge, signed `.xpi` for Firefox).

Useful commands:

```bash
pnpm dev
pnpm test
pnpm test:all
pnpm package:chrome
pnpm package:edge
pnpm package:firefox
```

## Browser releases

GitHub Actions builds Chrome and Edge `.zip` archives plus a signed Firefox `.xpi` from tagged releases in [.github/workflows/browser-packages.yml](./.github/workflows/browser-packages.yml) and publishes them to GitHub Releases.

See [docs/browser-packages.md](./docs/browser-packages.md) for the tag trigger, release asset names, required signing secrets, and manual install steps.

Store publishing automation is documented separately in [docs/store-publishing.md](./docs/store-publishing.md).

## Controlled Chrome Debugging

To debug the unpacked extension with `chrome-devtools` MCP, use the repo-managed browser instead of loading the extension manually inside the MCP browser:

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/share/69c62773-7b4c-83e8-b441-48520275c284
```

This launches a dedicated Chromium-based browser on `http://127.0.0.1:9222` with `.output/chrome-mv3` preloaded. The launcher prefers the repo-managed Playwright browser (`Google Chrome for Testing`) or a local Chromium build, because stable Google Chrome no longer honors `--load-extension` for unpacked extensions. After launching it, restart Codex in this repo so the project-level `[.codex/config.toml](./.codex/config.toml)` can point `chrome-devtools` MCP at that browser.

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

<a id="support"></a>

## Support

If TurboRender saves you time, you can support ongoing maintenance and compatibility updates.

| WeChat sponsor code | Alipay sponsor code |
| --- | --- |
| <img src="./public/assets/wechat-sponsor.jpg" alt="WeChat sponsor code" width="280" /> | <img src="./public/assets/aliapy-sponsor.jpg" alt="Alipay sponsor code" width="280" /> |

Support helps cover maintenance, long-thread testing, and ChatGPT compatibility updates.

## License

[MIT](./LICENSE)
