#!/usr/bin/env node

import { chromium } from '@playwright/test';

import { waitForRemoteDebugEndpoint } from './debug-mcp-chrome-lib.mjs';
import { collectReloadableChatgptPageUrls } from './reload-mcp-chrome-lib.mjs';
import { hasTurboRenderInjection, waitForInspection } from './check-mcp-chrome-lib.mjs';

const debugPort = process.env.CHROME_DEBUG_PORT ?? '9222';

async function reloadChatgptPage(page) {
  const targetUrl = page.url();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TurboRender] failed to refresh ${targetUrl} on attempt ${attempt}: ${message}`);
    }

    const inspection = await waitForInspection(page, hasTurboRenderInjection, 12_000, 500);
    if (inspection != null && hasTurboRenderInjection(inspection)) {
      return true;
    }

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 1_500);
    });
  }

  return false;
}

function printHelp() {
  console.log(`ChatGPT TurboRender controlled Chrome reloader

Usage:
  pnpm reload:mcp-chrome

Environment:
  CHROME_DEBUG_PORT  Remote debugging port. Default: 9222
`);
}

async function main() {
  if (process.argv.slice(2).includes('--help') || process.argv.slice(2).includes('-h')) {
    printHelp();
    process.exit(0);
  }

  await waitForRemoteDebugEndpoint(debugPort, 5000);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  if (context == null) {
    console.error('[TurboRender] Connected browser did not expose a default context.');
    process.exit(1);
  }

  const reloadablePages = context.pages().filter((page) => collectReloadableChatgptPageUrls([page]).length > 0);
  if (reloadablePages.length === 0) {
    console.error(
      `[TurboRender] No reloadable ChatGPT tabs were found on debug port ${debugPort}. Open a ChatGPT conversation page first.`,
    );
    process.exit(1);
  }

  const extensionPage = await context.newPage();

  try {
    await extensionPage.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    let reloadButtonVisible = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      reloadButtonVisible = await extensionPage.evaluate(() => {
        const visited = new Set();
        const find = (root) => {
          if (root == null || visited.has(root)) {
            return null;
          }
          visited.add(root);

          const direct = root.querySelector?.('#dev-reload-button, [aria-label="重新加载"]');
          if (direct != null) {
            return direct;
          }

          const children = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
          for (const child of children) {
            const element = child;
            if (element.shadowRoot != null) {
              const nested = find(element.shadowRoot);
              if (nested != null) {
                return nested;
              }
            }
          }

          return null;
        };

        return find(document) != null;
      });
      if (reloadButtonVisible) {
        break;
      }
      await extensionPage.waitForTimeout(500);
    }

    if (!reloadButtonVisible) {
      throw new Error('Unable to locate the extension reload button on chrome://extensions.');
    }

    console.log('[TurboRender] requesting an in-place extension reload from chrome://extensions.');
    await extensionPage.evaluate(() => {
      const visited = new Set();
      const find = (root) => {
        if (root == null || visited.has(root)) {
          return null;
        }
        visited.add(root);

        const direct = root.querySelector?.('#dev-reload-button, [aria-label="重新加载"]');
        if (direct != null) {
          return direct;
        }

        const children = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const child of children) {
          const element = child;
          if (element.shadowRoot != null) {
            const nested = find(element.shadowRoot);
            if (nested != null) {
              return nested;
            }
          }
        }

        return null;
      };

      find(document)?.click();
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
  } finally {
    try {
      await extensionPage.close();
    } catch {
      // Ignore helper tab close failures after extension reload.
    }
  }

  let readyPages = 0;
  for (const page of reloadablePages) {
    if (await reloadChatgptPage(page)) {
      readyPages += 1;
      continue;
    }

    console.warn(`[TurboRender] ${page.url()} did not expose TurboRender markers after reload.`);
  }

  console.log(
    `[TurboRender] refreshed ${reloadablePages.length} ChatGPT tab(s) without closing the browser (${readyPages} ready).`,
  );
  process.exit(0);
}

await main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[TurboRender] reload failed: ${message}`);
  process.exit(1);
});
