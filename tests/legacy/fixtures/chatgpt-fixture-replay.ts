import type { Page } from '@playwright/test';

import {
  applyChatgptFixtureStorageState,
  readChatgptFixtureStorageState,
  resolveChatgptFixturePaths,
  resolveChatgptFixtureRoot,
  setDebugConversationId,
  type ChatgptFixtureDefinition,
} from './chatgpt-fixtures';
import type { ControlledBrowserHandle } from '../../e2e/controlled-browser';

interface OfflineChatgptFixturePageOptions {
  offline?: boolean;
  timeoutMs?: number;
}

function getControlledContext(handle: ControlledBrowserHandle) {
  const context = handle.browser.contexts()[0];
  if (context == null) {
    throw new Error('Controlled browser did not expose a default context.');
  }

  return context;
}

export async function withOfflineChatgptFixturePage(
  browserHandle: ControlledBrowserHandle,
  fixture: ChatgptFixtureDefinition,
  callback: (page: Page) => Promise<void>,
  options: OfflineChatgptFixturePageOptions = {},
): Promise<void> {
  const context = getControlledContext(browserHandle);
  const filePaths = resolveChatgptFixturePaths(fixture, resolveChatgptFixtureRoot());
  const storageState = await readChatgptFixtureStorageState(fixture);
  const page = await context.newPage();
  let offlineApplied = false;

  try {
    await applyChatgptFixtureStorageState(context, page, storageState, fixture.conversationId);

    const client = await context.newCDPSession(page);
    await client.send('Network.enable').catch(() => undefined);
    await client.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => undefined);
    await client.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => undefined);

    await page.routeFromHAR(filePaths.replayHarZip, { notFound: 'abort' });

    if (options.offline ?? true) {
      await context.setOffline(true);
      offlineApplied = true;
    }

    // Use 'load' instead of 'domcontentloaded' to give extension more time to initialize
    await page.goto(fixture.url, {
      waitUntil: 'load',
      timeout: options.timeoutMs ?? 60_000,
    });
    await setDebugConversationId(page, fixture.conversationId);

    // Wait a bit more for extension to process conversation data
    await page.waitForTimeout(2_000);

    await callback(page);
  } finally {
    if (offlineApplied) {
      await context.setOffline(false).catch(() => undefined);
    }
    await page.close().catch(() => undefined);
  }
}
