# Chrome Web Store Review Notes

## Chrome Web Store listing copy

### Short description

Single-card status/control panel for supported ChatGPT conversation pages.

### Long description

ChatGPT TurboRender keeps long ChatGPT conversations responsive by reducing live DOM pressure, preserving the latest interaction window, and restoring older turns only when needed.

- Works on supported ChatGPT conversation routes: `/c/<id>` and `/share/<id>` on `chatgpt.com` and `chat.openai.com`
- Shows a popup status/control panel only on supported ChatGPT conversation pages
- Keeps the top popup card as the only active control surface; unsupported pages show a clear unsupported state instead of duplicate status cards
- Shows a recovery state only when a supported ChatGPT conversation page temporarily loses its runtime
- Keeps recent interaction pairs live and folds older history inline as collapsible batches
- Auto-activation runs only after configured thresholds are reached
- Stores settings locally in the browser profile and does not upload conversation data

### Test instructions

1. Open a regular webpage such as `https://example.com`.
2. Open the extension popup.
3. Confirm the popup shows an explicit unsupported state, the supported URL rules, and the demo/help buttons.
4. Open ChatGPT home such as `https://chatgpt.com/` or `https://chat.openai.com/`.
5. Confirm the popup explains that home pages are not supported conversation routes.
6. Open a supported conversation page such as `https://chatgpt.com/c/<id>` or `https://chatgpt.com/share/<id>`.
7. Confirm the popup shows the current conversation status/control panel in the top card, with inline controls when the page is supported.
8. With a supported ChatGPT conversation page active but temporarily unavailable, confirm the popup can show the recovery state for that page.
9. With a regular webpage active, confirm the popup stays on the explicit unsupported state and does not surface another tab's ChatGPT status.

### Screenshot checklist

- Popup on a supported ChatGPT conversation page
- Popup on a regular webpage showing the unsupported state
- Popup on ChatGPT home showing the unsupported home-page state
- Popup showing the recovery state on a supported ChatGPT conversation page
- Popup on a supported ChatGPT conversation page showing the inline controls in the top card

## Internal reference description (中文)

ChatGPT TurboRender keeps long ChatGPT conversations responsive by reducing live DOM pressure.

- Works on supported ChatGPT conversation routes (`/c/<id>` and `/share/<id>`) on `chatgpt.com` and `chat.openai.com`
- Keeps recent interaction pairs live and folds older history inline as collapsible batches
- Popup shows status in one top card for the current supported ChatGPT tab; if that supported page temporarily loses its runtime, it shows a recovery state for the same page
- Auto-activation runs only after configured thresholds are reached (conversation size, live DOM pressure, or frame-spike signals)
- Settings are stored locally in the browser profile

## Accurate store description (中文)

ChatGPT TurboRender 通过降低实时 DOM 压力，让超长 ChatGPT 对话保持流畅。

- 仅支持 ChatGPT 会话路由（`/c/<id>`、`/share/<id>`），域名覆盖 `chatgpt.com` 与 `chat.openai.com`
- 保留最近交互在主对话中可见，较早历史以内联可折叠批次展示
- Popup 以顶部单卡展示当前受支持 ChatGPT 标签页状态；如果该受支持页面的运行时暂时失联，则显示该页面的恢复态
- 仅在达到自动激活阈值后介入（会话规模、DOM 压力、帧抖动信号）
- 所有设置仅保存在浏览器本地

## What changed

- Added host coverage for both `chatgpt.com` and `chat.openai.com`
- Updated background tab selection logic:
  - Prefer the current active tab runtime when available
  - Only use same-window recovery when the current active tab is itself a supported ChatGPT conversation page and its runtime is temporarily unavailable
- Improved popup status clarity:
  - Explicitly distinguishes unavailable vs unsupported
  - Shows unsupported reasons (missing main container, no conversation turns, split host containers) without duplicating the current tab card
  - Explains that auto-activation depends on thresholds
- Updated README wording to match actual behavior and removed over-promising phrasing

## Permissions justification for `scripting`

Use this text in the Chrome Web Store privacy / permissions tab:

**English**

TurboRender uses the `scripting` permission only to inject its own content scripts into already-open, supported ChatGPT conversation pages (`/c/<id>` and `/share/<id>` on `chatgpt.com` and `chat.openai.com`) when the extension needs to re-attach or recover from a missing content-script connection. The script runs only on supported ChatGPT pages, affects only TurboRender's own UI and history management, and does not access or transmit data from other websites.

**中文**

TurboRender 仅在已打开的受支持 ChatGPT 会话页（`chatgpt.com` 和 `chat.openai.com` 上的 `/c/<id>`、`/share/<id>`）中使用 `scripting` 权限，用来注入扩展自身的内容脚本，以便在扩展需要重新挂载或内容脚本连接丢失时恢复功能。该脚本只在受支持的 ChatGPT 页面上运行，只影响 TurboRender 自己的界面和历史管理，不会访问或传输其他网站的数据。

## Reviewer notes / reproduction steps

1. Open any non-ChatGPT tab (for example `https://example.com`).
2. In the same window, open a supported ChatGPT conversation page (`https://chatgpt.com/c/<id>`, `https://chatgpt.com/share/<id>`, or equivalent `chat.openai.com` route).
3. Click the extension icon.
4. Verify popup status is shown on the current page; unsupported pages remain unsupported and supported pages may show a temporary recovery state if their runtime is unavailable.
5. Verify the top popup card is the only active control surface on supported pages, with support content remaining secondary.
6. On unsupported ChatGPT pages (for example non-conversation routes), verify popup shows `Unsupported` with a clear reason and does not render duplicate current-tab or settings cards.
7. On supported pages that are below thresholds, verify popup shows `Monitoring` and threshold-based activation guidance inside the top card.
8. On long conversations or high-pressure conditions, verify state changes from `Monitoring` to `Active`.
