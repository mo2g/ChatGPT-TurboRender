# Unpacked Extension Not Loading in Controlled Chrome

[中文版本](./cookbook-controlled-chrome.zh-CN.md)

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

### 2. Confirm the debugging port is live

```bash
curl http://127.0.0.1:9222/json/version
```

You should get a valid `webSocketDebuggerUrl`.

### 3. Check the target page for injection markers

In DevTools, evaluate:

```js
document.querySelector('[data-turbo-render-inline-history-root="true"]')
document.querySelectorAll('[data-turbo-render-group-id]').length
document.querySelectorAll('[data-turbo-render-action="toggle-group"]').length
```

If the extension is active, at least the inline history root should exist, and long threads will show batch groups and toggle rails.

### 4. Do not trust `chrome://extensions` alone

Seeing the extension page does not prove the target page is injected. The stronger signal is the DOM on the actual ChatGPT page.

## Practical Lessons

- Do not use stable Google Chrome as the default unpacked-extension debug target in this flow.
- Use the remote debugging port as the source of truth.
- Keep a separate profile per browser kind and port.
- Verify the page itself, not just the extension manager.
- Put the launch recipe and the verification recipe in the same cookbook.

## Final Rule of Thumb

If you remember only one thing:

> Launch a dedicated Chromium-based browser from the repo, give it a stable remote debugging port, isolate its profile, and point `chrome-devtools` MCP at that browser.

That is much more reliable than manually loading an unpacked extension inside MCP’s own browser.
