# ChatGPT TurboRender

Keep long ChatGPT conversations responsive without replacing the native UI.

[中文说明](./README.zh-CN.md) | [Architecture Notes](./docs/architecture.md) | [架构说明](./docs/architecture.zh-CN.md) | [CDP Live Guide](./docs/plan/cdp-connected-development.md) | [Controlled Chrome Cookbook](./docs/cookbook-controlled-chrome.md) | [受控 Chrome Cookbook](./docs/cookbook-controlled-chrome.zh-CN.md)

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
- Runs on supported ChatGPT conversation routes (`/c/<id>` and `/share/<id>`) on `chatgpt.com` and `chat.openai.com`
- Keeps the latest 5 interaction pairs live and folds older history inline in the original transcript order
- Auto-activates only when thresholds are reached (finalized turns, live DOM descendants, or frame-spike count)
- Trims the initial `/backend-api/conversation/:id` payload in page context and also reads share-page loader data
- Parks cold message groups and replaces them with compact inline batch cards
- Popup acts as a status/control panel only on supported ChatGPT conversation pages; when a supported page temporarily loses its runtime, it can show a recovery state for that same page
- Keeps a sticky `Expand / Collapse` control on the right side of long opened batches
- Supports English and Simplified Chinese, with auto-follow plus manual override
- Falls back to a safer soft-fold mode if the host page re-renders aggressively
- Stores settings locally only and does not send conversation data to any external service

## Project status

- Browser target: Chrome and Edge first
- Runtime model: Manifest V3
- Storage model: local only
- Network model: page-layer interception of the initial conversation payload in the main world, no backend, no cloud sync
- Developer mainline: `pnpm debug:mcp-chrome` + `pnpm reload:mcp-chrome` + `pnpm test:e2e` against a logged-in controlled browser on real `chatgpt.com` (defaults to `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`)
- Historical fixture note: offline fixture scripts remain under explicit `pnpm legacy:fixtures:*` maintenance commands only; fake-host browser replay is no longer part of E2E

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
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
pnpm reload:mcp-chrome
pnpm test
pnpm test:e2e
pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1
pnpm test:e2e -- --use-active-tab
pnpm test:all
pnpm package:chrome
pnpm package:edge
pnpm package:firefox
```

`pnpm test:e2e:live` remains available as an explicit alias for the same real-page smoke suite. `pnpm test:all` runs `pnpm test:unit` first and then forwards the same live-host arguments to that runner. Historical fixture maintenance commands remain available as `pnpm legacy:fixtures:capture`, `pnpm legacy:fixtures:check`, `pnpm legacy:fixtures:diagnose`, and `pnpm legacy:fixtures:update-id`.

## Browser releases

GitHub Actions builds Chrome and Edge `.zip` archives plus a signed Firefox `.xpi` from tagged releases in [.github/workflows/browser-packages.yml](./.github/workflows/browser-packages.yml) and publishes them to GitHub Releases.

See [docs/browser-packages.md](./docs/browser-packages.md) for the tag trigger, release asset names, required signing secrets, and manual install steps.

Store publishing automation is documented separately in [docs/store-publishing.md](./docs/store-publishing.md).

## Controlled Chrome Debugging

This is the primary development and live-validation path for the repo. To debug the unpacked extension with `chrome-devtools` MCP, use the repo-managed browser instead of loading the extension manually inside the MCP browser:

```bash
pnpm build
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
```

`pnpm check:mcp-chrome` now treats the default long `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` session as the exact guardrail target and reports archive readiness, so it is a useful preflight before live smoke.

After each change, use `pnpm build` followed by `pnpm reload:mcp-chrome`, then run one of these real-host regressions:

- `pnpm test:e2e` for the default chat-host smoke on `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`
- `pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` when you want to override the default chat target explicitly
- `pnpm test:e2e -- --use-active-tab` only as a convenience mode when you are sure the active ChatGPT tab is already the intended long conversation

The launcher starts a dedicated Chromium-based browser on `http://127.0.0.1:9222` with `.output/chrome-mv3` preloaded. It prefers the repo-managed Playwright browser (`Google Chrome for Testing`) or a local Chromium build, because stable Google Chrome no longer honors `--load-extension` for unpacked extensions. After launching it, restart Codex in this repo so the project-level `[.codex/config.toml](./.codex/config.toml)` can point `chrome-devtools` MCP at that browser. For the full guide, see [docs/plan/cdp-connected-development.md](./docs/plan/cdp-connected-development.md).

## Legacy Offline Fixtures

Offline fixture material remains in the repo as historical reference only. It is no longer the primary development or acceptance workflow, and fake-host browser replay specs have been removed from the E2E path.

- `pnpm test:e2e` is the mainline signed-in real-page smoke path
- `pnpm test:e2e:live` remains as an explicit alias for that same real-page smoke suite
- popup and other extension-owned UI remain outside host E2E and are covered through unit/integration tests plus manual checks
- `pnpm legacy:fixtures:capture`, `pnpm legacy:fixtures:check`, `pnpm legacy:fixtures:diagnose`, and `pnpm legacy:fixtures:update-id` remain available for historical local maintenance
- Historical fixture capture is no longer treated as host-compatibility evidence
- Historical background lives in [docs/offline-development.md](./docs/offline-development.md) and [docs/requirements/offline-chatgpt-environment.md](./docs/requirements/offline-chatgpt-environment.md)

Each fixture bundle contains `replay.har.zip`, `page.mhtml`, `conversation.json`, `storage-state.json`, and `metadata.json` under `tests/fixtures-local/chatgpt` by default. That directory is gitignored and intended for the current machine only.

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
- no persisted full transcript snapshots in runtime
- legacy offline fixture bundles are opt-in local test artifacts only, stored under a gitignored local directory by default

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

<a id="popup-status-control-panel"></a>

## Popup Status/Control Panel

The popup is a status/control panel for supported ChatGPT conversation pages only.

- Supported routes: `https://chatgpt.com/c/<id>`, `https://chatgpt.com/share/<id>`, `https://chat.openai.com/c/<id>`, `https://chat.openai.com/share/<id>`
- Unsupported ChatGPT pages show an explicit unsupported state and a link to the supported URL rules
- When the active tab is a supported ChatGPT conversation page but its runtime is temporarily unavailable, the popup can show a recovery state for that page
- The demo button opens a stable share page: [https://chatgpt.com/share/69cb7947-c818-83e8-9851-1361e4480e08](https://chatgpt.com/share/69cb7947-c818-83e8-9851-1361e4480e08)
- The help button opens this section

## Support

If TurboRender saves you time, you can support ongoing maintenance and compatibility updates.

| WeChat sponsor code | Alipay sponsor code |
| --- | --- |
| <img src="./public/assets/wechat-sponsor.jpg" alt="WeChat sponsor code" width="280" /> | <img src="./public/assets/aliapy-sponsor.jpg" alt="Alipay sponsor code" width="280" /> |

Support helps cover maintenance, long-thread testing, and ChatGPT compatibility updates.

## License

[MIT](./LICENSE)
