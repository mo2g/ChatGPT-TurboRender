# ChatGPT TurboRender Architecture Notes

This document describes the current implementation of TurboRender: the default performance mode keeps a hot transcript inside ChatGPT's native flow plus an extension-controlled archive region, while the optional sliding-window mode lets the official UI render only one data window at a time.

[中文版本](./architecture.zh-CN.md) | [Refactor Design and Pitfalls](./refactor-design-and-pitfalls.zh-CN.md) | [Archive Action Reuse Map](./action-reuse-map.zh-CN.md)

## Problem model

Long ChatGPT conversations stay expensive for one simple reason: too much UI remains live at once.

- finalized turns continue to participate in layout, style, and tree traversal
- streamed output keeps invalidating a large subtree
- scrolling and typing compete with rendering on the same main thread
- once enough history accumulates, the browser can become slow or unresponsive

TurboRender treats this primarily as a rendering-pressure problem, not a prompt-management problem.

## Goals

- Preserve the native ChatGPT reading and interaction flow
- Keep the latest interaction pairs fully interactive
- Move older history out of the live transcript subtree
- Keep archive history reversible and searchable at the batch level
- Offer an optional data-window mode that pages through long conversations without rendering archive cards
- Stay local-only and low-permission
- Fail safe when ChatGPT's DOM or loader data changes

## Non-goals for vNext

- A custom full-screen reader mode
- Cross-device sync
- Export tooling or deep search over the entire conversation corpus
- Backend-level network middleware or remote proxying
- Persisting complete transcript snapshots in performance mode
- Preserving host-native edit/regenerate menus inside archived history

## Runtime architecture

```mermaid
flowchart LR
  A["Popup / Options"] --> B["Background Service"]
  B --> C["Storage.local"]
  B --> D["Content Script on chatgpt.com"]
  D --> E["Route Resolver"]
  D --> F["ChatGPT DOM Adapter"]
  D --> G["Archive Manager"]
  D --> H["Hot Transcript Controller"]
  E --> I["MAIN-world bootstrap"]
  I --> J["/backend-api/conversation/:id"]
  I --> K["/share/:shareId loaderData"]
  G --> L["Fixed-slot archive batches"]
  H --> M["Latest 5 interaction pairs"]
  G --> N["Archive region above the hot transcript"]
```

## Execution flow

1. The content script resolves the page route into a runtime id:
   - `/c/:id` becomes `chat:<id>`
   - `/share/:id` becomes `share:<id>`
   - `/` becomes `chat:home`
   - unknown routes are tagged `chat:unknown`
2. The main-world bootstrap captures the initial payload before the full DOM pressure lands:
   - chat pages read `/backend-api/conversation/:id`
   - share pages read React Router loader data from `routes/share.$shareId.($action)`
3. The content script keeps the live transcript hot window small and moves older history into the archive region.
4. The archive region is rendered by TurboRender, not by the host React tree.
5. Search, collapse, restore, and sticky controls are handled inside the archive region.

In sliding-window mode, the main-world bootstrap instead caches the full conversation payload locally, returns a synthetic windowed conversation response, and lets the official ChatGPT renderer own the current window.

## Main subsystems

## 1. Route identity and DOM adapter

The adapter identifies:

- the ChatGPT transcript area
- the top-level turn nodes
- the scroll container
- the current route kind
- basic streaming heuristics

The adapter is deliberately layered and conservative. If the page structure does not fit the expected shape, the extension marks the page unsupported instead of forcing a brittle transform.

## 2. MAIN-world bootstrap

TurboRender now captures the initial session in the page main world before the official renderer fully expands the history.

- chat pages trim the initial `conversation/:id` payload down to a hot branch
- share pages extract the same payload shape from React Router loader data
- share pages do not rely on a separate network middleware path
- sliding-window mode can serve a clean cached conversation as a synthetic response before calling the native fetch
- if the payload shape changes, the system falls back to live-DOM-only history management

This keeps the first render smaller without depending on MV3 backend body rewriting.

## 3. Hot transcript plus archive region

TurboRender now uses a two-zone model.

- the official transcript keeps only the latest 5 interaction pairs
- older history is moved into an extension-controlled archive region above the hot transcript
- the archive region shares the page's main scroll container
- archive history does not get reinserted into the host transcript when expanded

This separation is the main lever for reducing input latency and scroll jank.

## 4. Optional sliding-window mode

Sliding-window is a data-window mode, not a history UI mode.

- the official ChatGPT UI renders the current N-pair synthetic payload
- TurboRender caches the complete conversation payload, pair index, and search index in local IndexedDB under the ChatGPT page origin
- Older, Newer, Latest, and Search write a target range to sessionStorage and reload the same route
- clean cache hits avoid redownloading the complete conversation payload on every page turn
- non-latest windows are treated as read-only by the content script
- the toolbar can clear the current conversation cache or all sliding-window caches

This mode intentionally does not use archive cards or the parking renderer.

## 5. Fixed-slot batching

Archive history is grouped into fixed 5-pair slots.

- slot ranges are stable, such as `96-100` or `101-105`
- partially filled slots still show their full range plus a fill count
- new history continues filling the current slot until it reaches capacity
- initial-trim history and runtime-demoted history are merged into one archive timeline before slotting

This avoids tail rebalancing like `96-98 / 99-101` and keeps the UI stable across updates.

## 6. Archive rendering

The archive region uses a read-only, near-native transcript style instead of a nested card stack.

- collapsed batches show only the slot summary, preview text, match count, and a sticky `Expand / Collapse` rail
- expanded batches render user messages as right-aligned bubbles
- assistant messages stay in a centered reading flow
- markdown blocks, lists, quotes, and code blocks are rendered directly
- structured tool/system messages stay inside the interaction pair instead of surfacing as separate top-level messages
- visually hidden payload messages are suppressed entirely

The goal is to keep reading behavior close to ChatGPT's native flow while still removing cold history from the live subtree.

## 7. Parking engine

Older finalized live turns can be demoted out of the hot transcript.

- hard parking removes the nodes from the live transcript and stores them for later restoration
- soft-fold keeps the nodes in the DOM but collapses them when the host page is too unstable for hard parking
- live transcript mutations are observed only in the hot zone, not in the archive region or composer subtree

The parking engine exists to keep the live transcript small. The archive region is the user-visible way to inspect cold history.

## 8. Restore and scroll behavior

Archive controls are batch-level, not message-level.

- `Expand / Collapse` operates on a whole 5-pair slot
- the sticky rail belongs to the archive batch itself
- toggling a batch preserves scroll position instead of jumping to the top
- the archive region can be expanded batch by batch without affecting other batches

The restore model is intentionally coarse. It is designed to avoid turning the archive UI back into a heavy live subtree.

## 9. Search and diagnostics

TurboRender keeps search local to the archive region.

- searches are evaluated against archive batches
- hidden system scaffolds do not participate in search
- popup diagnostics report route kind, batch counts, observed root kind, and refresh counts
- the content script keeps the current build signature available for debugging

## Storage and privacy boundaries

TurboRender does not send conversation data to an external service.

- settings stay in extension storage
- performance mode does not persist complete transcript snapshots
- sliding-window mode stores complete conversation payloads locally in IndexedDB under the ChatGPT page origin
- sliding-window caches are used for paging and search, and can be cleared from the in-page toolbar
- there is no cloud sync, analytics pipeline, or off-device transcript upload

## Controlled Chrome validation

Development and manual validation use a repo-managed controlled Chrome instance instead of manually loading the unpacked extension inside the DevTools MCP browser.

- launch with `pnpm debug:mcp-chrome -- https://chatgpt.com/c/<chat-id>`
- the launcher prefers `Google Chrome for Testing` or a compatible Chromium binary
- the unpacked extension is preloaded from `.output/chrome-mv3`
- the browser runs with a dedicated profile and remote debugging port so the MCP session can reconnect reliably

This is important because stable Google Chrome no longer behaves reliably for unpacked extension loading through `--load-extension`.

## Why this architecture works

TurboRender limits the live subtree while preserving ChatGPT's reading flow.

- the hot transcript stays small enough to keep typing and streaming responsive
- the archive region keeps cold history available without remaining part of the live host subtree
- the first render is cheaper because long sessions are trimmed before the official renderer mounts the full history
- the system remains local-only and can safely fall back when the host page changes

## Testing strategy

- Unit tests cover route identity, payload trimming, fixed-slot batching, and background message handling
- Sliding-window unit tests cover range calculation, pair indexing, payload slicing, cache hit/miss/dirty behavior, content mode dispatch, toolbar bridge messages, and read-only controls
- Controlled Chrome plus `pnpm test:e2e` on the default logged-in `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` conversation is the primary host-compatibility validation path; `--use-active-tab` is an explicit convenience mode, and `pnpm test:e2e:live` remains an alias for the same live runner
- Integration tests and historical local fixture scripts remain supplemental targeted coverage for archive rendering, restore behavior, and soft-fold fallback rather than the host-truth path

## Future directions

- Collect more real-world DOM variants from ChatGPT updates
- Improve heuristics for streaming detection and protected regions
- Tighten the hot-zone observer further if real `/c/...` typing traces still show pressure
- Continue validating against long live chats before expanding the restore model
