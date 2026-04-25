# Unpacked Extension Not Loading in Controlled Chrome

[中文版本](./cookbook-controlled-chrome.zh-CN.md)

This controlled-browser workflow is now the primary development path for TurboRender. The broader day-to-day guide lives in [docs/plan/cdp-connected-development.md](./plan/cdp-connected-development.md).

## Primary Workflow

```bash
pnpm build
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
```

`pnpm check:mcp-chrome` now treats the default long `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` thread as the exact guardrail target and reports archive readiness, so it is a useful preflight before live smoke.

After each code change, run `pnpm build` and `pnpm reload:mcp-chrome`, then pick the real-host regression you actually need:

- `pnpm test:e2e` for the default chat-host smoke on `https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1`
- `pnpm test:e2e -- --chat-url=https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1` when you want to override the default chat target explicitly
- `pnpm test:e2e -- --use-active-tab` only when you know the active ChatGPT tab is already the intended long conversation target

`pnpm test:e2e:live` remains an explicit alias for the same live runner.

This cookbook documents a very specific failure mode: `chrome-devtools` is connected to a controlled browser, but the repo’s unpacked extension in `.output/chrome-mv3` never actually loads. The result is that TurboRender markers never appear on the page, and none of the folding UI shows up.

It is useful when:

- you want Codex `chrome-devtools` MCP to target a browser you control
- you want that browser to load the repo’s unpacked extension
- the browser starts, but the extension does not show up

## Symptoms

At first, everything looks correct:

- the controlled Chrome / Chromium window opens
- `chrome-devtools` can connect to `http://127.0.0.1:9222`
- the page URL is the intended ChatGPT page

But a closer look shows:

- `chrome://extensions/` does not list the expected extension
- the target page has no TurboRender injection markers
- `document.querySelector('[data-turbo-render-inline-history-root="true"]')` is `null`
- no batch cards, no `Expand / Collapse` rail, and no status UI appear

That means the problem is not page logic. It is the controlled browser launch path.

## What I got wrong first

These assumptions were wrong:

1. If `--load-extension` is on the command line, the extension must be loaded.
2. If MCP can connect to a browser, it must be the browser I just started.
3. If I manually load an unpacked extension in `chrome://extensions`, DevTools MCP will reliably reuse it.

That is not a safe mental model.

For this repository, stable Google Chrome is not a reliable unpacked-extension debugging target. A Chromium-based browser under repo control is much safer.

## Root Cause

There were two layers to the failure.

### 1. MCP was not always attached to the browser I thought it was

`chrome-devtools-mcp` will attach to whichever remote-debuggable browser it can see. Without an explicit, stable remote debugging port, it is easy to end up connected to the wrong instance or to one without the extension.

### 2. Stable Google Chrome was not a dependable target for this flow

In this environment, stable Google Chrome did not reliably honor `--load-extension` for unpacked extensions. The browser might start, but the extension still would not be injected.

What did work:

- Playwright’s `Google Chrome for Testing`
- Chromium-family browsers with unpacked-extension support
- a clean, isolated profile per controlled browser instance

## The Fix

The final solution is a repo-managed controlled browser flow.

### 1. Launch through a repo script

Use `scripts/debug-mcp-chrome.mjs` instead of loading the extension manually inside the MCP browser.

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/share/<share-id>
```

The launcher:

- checks that `.output/chrome-mv3` exists
- prefers Playwright’s `Google Chrome for Testing`
- falls back to local Chromium if available
- binds a fixed remote debugging port
- uses a dedicated `user-data-dir`
- preloads `.output/chrome-mv3`

### 2. Isolate the profile

One of the more subtle issues was stale browser state. A reused profile can let a browser launch, but the extension path remains unreliable.

The launcher now isolates profiles by browser kind and debug port, for example:

- `.wxt/mcp-chrome-profile/chrome-for-testing-9222`
- `.wxt/mcp-chrome-profile/chromium-9222`

That avoids inheriting bad state from an older run.

### 3. Point `chrome-devtools` MCP at this browser

The repo-level `.codex/config.toml` points `chrome-devtools` to `http://127.0.0.1:9222`. After restarting Codex, MCP reconnects to the controlled browser you launched, not to some unrelated browser.

## How to Verify

Use this sequence.

### 1. Confirm the browser actually launched

The launcher should print something like:

```text
[TurboRender] launched controlled Chrome on http://127.0.0.1:9222
[TurboRender] browser: chrome-for-testing (...)
[TurboRender] extension path: .../.output/chrome-mv3
[TurboRender] profile path: .../.wxt/mcp-chrome-profile/...
```

### 2. Run the repo health check

```bash
pnpm check:mcp-chrome
```

This verifies the CDP endpoint, reports the exact matched ChatGPT tab, and checks whether TurboRender DOM markers and archive readiness are present.

### 3. Confirm the debugging port manually if needed

```bash
curl http://127.0.0.1:9222/json/version
```

You should get a valid `webSocketDebuggerUrl`.

### 4. Check the target page for injection markers

In DevTools, evaluate:

```js
document.querySelector('[data-turbo-render-inline-history-root="true"]')
document.querySelectorAll('[data-turbo-render-group-id]').length
document.querySelectorAll('[data-turbo-render-action="toggle-archive-group"]').length
```

If the extension is active, at least the inline history root should exist, and long threads will show batch groups and toggle rails.

### 5. Do not trust `chrome://extensions` alone

Seeing the extension page does not prove the target page is injected. The stronger signal is the DOM on the actual ChatGPT page.

## Live Smoke Troubleshooting

If `pnpm test:e2e` or `pnpm test:e2e:live` fails, reduce the problem to one of these four buckets before changing code.

### 1. CDP endpoint is unreachable

Symptoms:

- `pnpm check:mcp-chrome` fails before it can report a ChatGPT tab
- `curl http://127.0.0.1:9222/json/version` fails or returns nothing

Recovery:

```bash
pnpm build
pnpm debug:mcp-chrome -- https://chatgpt.com/
pnpm check:mcp-chrome
```

### 2. The controlled browser is on the wrong ChatGPT tab

Symptoms:

- `pnpm check:mcp-chrome` attaches, but the reported tab URL is not the exact intended `/c/...` route
- live smoke fails because runtime status is `null` or the route kind is wrong

Recovery:

- close duplicate ChatGPT tabs inside the controlled browser
- reopen the intended target route
- rerun `pnpm check:mcp-chrome` before rerunning the smoke suite

### 3. TurboRender injection is missing

Symptoms:

- the page loads, but `[data-turbo-render-inline-history-root="true"]` never appears
- `pnpm check:mcp-chrome` reports `inline-history=0` or `ui-root=0`

Recovery:

```bash
pnpm build
pnpm reload:mcp-chrome
pnpm check:mcp-chrome
```

If that still fails, verify the unpacked extension path and profile isolation steps in the earlier sections of this cookbook.

### 4. The host read-aloud menu does not open or anchor correctly

Symptoms:

- the archive batch expands, but the official-style more menu does not expose `Read aloud`
- the menu opens detached from the more button, or read-aloud never triggers `/backend-api/synthesize`

Recovery:

- verify the target is the intended `/c/...` conversation route, not an unrelated ChatGPT tab
- wait for the assistant archive entry to be visible before opening the more menu
- rerun `pnpm reload:mcp-chrome` and confirm the page still shows TurboRender markers before rerunning the read-aloud smoke

## Practical Lessons

- Do not use stable Google Chrome as the default unpacked-extension debug target in this flow.
- Use the remote debugging port as the source of truth.
- Keep a separate profile per browser kind and port.
- Verify the page itself, not just the extension manager.
- Put the launch recipe and the verification recipe in the same cookbook.

## Legacy: Capturing Offline Real-Page Fixtures

This flow can still be used to maintain offline ChatGPT fixture bundles, but that path is now historical and supplemental rather than the primary development workflow. Fake-host browser replay specs are no longer part of E2E.

1. Launch a controlled browser and sign in:

```bash
pnpm debug:mcp-chrome -- https://chatgpt.com/
```

2. Capture the local-only fixture bundle:

```bash
pnpm legacy:fixtures:capture
```

`pnpm legacy:fixtures:capture` will connect to the logged-in controlled Chrome, clone that browser profile into a temporary capture profile, and record the fixture from there. Keep the source browser running and signed in while capture is in progress.

3. Optionally move the bundle somewhere else on your machine:

```bash
TURBO_RENDER_FIXTURE_ROOT=/absolute/path pnpm legacy:fixtures:capture
```

4. Validate the bundle with the remaining legacy maintenance commands:

```bash
pnpm legacy:fixtures:check
pnpm legacy:fixtures:diagnose <fixture-id>
```

The captured files live under `tests/fixtures-local/chatgpt` by default, are gitignored, and are only for local development/testing. The old browser replay specs have been removed, so these bundles are no longer treated as host-compatibility evidence.

## Final Rule of Thumb

If you remember only one thing:

> Launch a dedicated Chromium-based browser from the repo, give it a stable remote debugging port, isolate its profile, and point `chrome-devtools` MCP at that browser.

That is much more reliable than manually loading an unpacked extension inside MCP’s own browser.
