import { expect, test, type Locator, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY,
} from '../../lib/shared/constants';
import { UI_CLASS_NAMES } from '../../lib/shared/constants';
import { launchControlledBrowser, type ControlledBrowserHandle } from './controlled-browser';
const OUTPUT_DIR = path.resolve('.output/chrome-mv3');
const REAL_CONVERSATION_URL = 'https://chatgpt.com/c/e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f';
const REAL_CONVERSATION_ID = 'e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f';

function createStaticServer(rootDir: string): Promise<{ baseUrl: string; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const parsedUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(parsedUrl.pathname);
        const relativePath = pathname === '/' ? '/harness.html' : pathname;
        const resolvedPath = path.resolve(rootDir, `.${relativePath}`);
        const relativeToRoot = path.relative(rootDir, resolvedPath);

        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
          response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Forbidden');
          return;
        }

        const fileBuffer = await fs.readFile(resolvedPath);
        const extension = path.extname(resolvedPath).toLowerCase();
        const contentType =
          extension === '.html'
            ? 'text/html; charset=utf-8'
            : extension === '.js'
              ? 'text/javascript; charset=utf-8'
              : extension === '.css'
                ? 'text/css; charset=utf-8'
                : extension === '.json'
                  ? 'application/json; charset=utf-8'
                  : 'application/octet-stream';

        response.writeHead(200, { 'Content-Type': contentType });
        response.end(fileBuffer);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(message);
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        reject(new Error('Unable to start harness regression server.'));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          }),
      });
    });
  });
}

async function readRefreshCount(page: Page): Promise<number> {
  const value = await page.locator('#harness-status').getAttribute('data-refresh-count');
  return Number(value ?? '0');
}

async function readClientRect(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if ((await locator.count()) === 0) {
    return null;
  }

  return locator.first().evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function findVisibleMenuLocatorByText(
  page: Page,
  textPattern: RegExp,
  anchorBox?: { x: number; y: number; width: number; height: number } | null,
  previousMenuMarker?: string | null,
): Promise<{ locator: ReturnType<Page['locator']>; rect: { x: number; y: number; width: number; height: number } | null } | null> {
  const selectedMenuMarker = `turbo-render-target-menu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const matchedMenuData = await page.evaluate(([patternSource, anchor, previousMarker, targetMarker]) => {
    const pattern = new RegExp(patternSource, 'i');
    const allMenus = [...document.querySelectorAll<HTMLElement>('[role="menu"]')];
    const candidates = allMenus
      .map((menu, index) => {
        const rect = menu.getBoundingClientRect();
        const text = (menu.textContent ?? '').trim();
        const matches = pattern.test(text) || [...menu.querySelectorAll('[role="menuitem"], button')].some((item) =>
          pattern.test((item.textContent ?? item.getAttribute('aria-label') ?? '').trim()),
        );
        return {
          index,
          text,
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0,
          isNew: previousMarker == null || menu.getAttribute('data-turbo-render-test-menu-snapshot') !== previousMarker,
          matches,
        };
      })
      .filter(
        (candidate) =>
          candidate.visible &&
          candidate.matches &&
          candidate.bottom > 0 &&
          candidate.right > 0 &&
          candidate.y < window.innerHeight &&
          candidate.x < window.innerWidth,
      );

    if (candidates.length === 0) {
      return null;
    }

    let rankedCandidates = candidates.some((candidate) => candidate.isNew)
      ? candidates.filter((candidate) => candidate.isNew)
      : candidates;

    if (anchor != null) {
      const geometricallyBoundCandidates = rankedCandidates.filter((candidate) => {
        const horizontalDelta = Math.abs(candidate.x - anchor.x);
        const verticalDelta = Math.abs(candidate.y - anchor.y);
        return horizontalDelta <= 160 && verticalDelta <= 360;
      });
      rankedCandidates = geometricallyBoundCandidates.length > 0 ? geometricallyBoundCandidates : rankedCandidates;
    }

    if (anchor != null) {
      const anchorCenterX = anchor.x + anchor.width / 2;
      const anchorCenterY = anchor.y + anchor.height / 2;
      rankedCandidates.sort((left, right) => {
        const leftDistance = Math.hypot(left.x - anchorCenterX, left.y - anchorCenterY);
        const rightDistance = Math.hypot(right.x - anchorCenterX, right.y - anchorCenterY);
        return leftDistance - rightDistance;
      });
    } else {
      rankedCandidates.sort((left, right) => left.y - right.y);
    }

    const selectedIndex = rankedCandidates[0]?.index ?? null;

    if (selectedIndex == null) {
      return null;
    }

    for (const menu of allMenus) {
      menu.removeAttribute('data-turbo-render-test-target-menu');
    }
    allMenus[selectedIndex]?.setAttribute('data-turbo-render-test-target-menu', targetMarker);
    const selected = rankedCandidates[0] ?? null;
    if (selected == null) {
      return null;
    }
    return {
      marker: targetMarker,
      rect: {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
      },
    };
  }, [textPattern.source, anchorBox ?? null, previousMenuMarker ?? null, selectedMenuMarker] as const);

  if (matchedMenuData == null) {
    return null;
  }

  return {
    locator: page.locator(`[data-turbo-render-test-target-menu="${matchedMenuData.marker}"]`),
    rect: matchedMenuData.rect,
  };
}

async function openReadAloudMenuFromMoreButtons(
  page: Page,
  moreButtons: Locator,
): Promise<{
  moreButton: Locator;
  menu: ReturnType<Page['locator']>;
  moreButtonBox: { x: number; y: number; width: number; height: number };
  menuBox: { x: number; y: number; width: number; height: number } | null;
} | null> {
  const count = await moreButtons.count();
  const visibleIndices = await moreButtons.evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const rect = (button as HTMLElement).getBoundingClientRect();
        return {
          index,
          visible:
            rect.width > 0 &&
            rect.height > 0,
        };
      })
      .filter((candidate) => candidate.visible)
      .map((candidate) => candidate.index),
  );

  const candidateIndices = visibleIndices.length > 0 ? visibleIndices : Array.from({ length: count }, (_, index) => index);
  for (const index of candidateIndices) {
    const moreButton = moreButtons.nth(index);
    const previousMenuMarker = `turbo-render-menu-snapshot-${Date.now()}-${index}`;
    await page.evaluate((marker) => {
      for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
        const rect = menu.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          menu.setAttribute('data-turbo-render-test-menu-snapshot', marker);
        }
      }
    }, previousMenuMarker);
    await moreButton.scrollIntoViewIfNeeded();
    const anchorBox = await readClientRect(moreButton);
    if (anchorBox == null) {
      continue;
    }
    await moreButton.click();
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await page.waitForTimeout(100);
      const menu = await findVisibleMenuLocatorByText(page, /朗读|read aloud/i, anchorBox, previousMenuMarker);
      if (menu != null) {
        await page.evaluate(() => {
          document
            .querySelectorAll<HTMLElement>('[data-turbo-render-test-menu-snapshot]')
            .forEach((menuElement) => menuElement.removeAttribute('data-turbo-render-test-menu-snapshot'));
        });
        return {
          moreButton,
          menu: menu.locator,
          moreButtonBox: anchorBox,
          menuBox: menu.rect,
        };
      }
    }
    await page.evaluate(() => {
      document
        .querySelectorAll<HTMLElement>('[data-turbo-render-test-menu-snapshot]')
        .forEach((menuElement) => menuElement.removeAttribute('data-turbo-render-test-menu-snapshot'));
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(100);
  }

  return null;
}

async function withRealConversationPage(callback: (page: Page) => Promise<void>) {
  if (browserHandle == null) {
    throw new Error('Controlled browser is unavailable.');
  }

  const context = browserHandle.browser.contexts()[0];
  if (context == null) {
    throw new Error('Controlled browser did not expose a default context.');
  }

  const existingPage = context.pages().find((candidate) => candidate.url().startsWith('https://chatgpt.com/')) ?? null;
  const page = existingPage ?? (await context.newPage());
  try {
    await page.addInitScript(
      ({ conversationId }) => {
        const debugConversationId = conversationId.trim();
        (window as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId =
          debugConversationId;
        document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
      },
      { conversationId: REAL_CONVERSATION_ID },
    );
    if (page.url() !== REAL_CONVERSATION_URL) {
      await page.goto(REAL_CONVERSATION_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } else {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await page.evaluate((conversationId) => {
      const debugConversationId = conversationId.trim();
      (window as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId =
        debugConversationId;
      document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
      if (document.body != null) {
        document.body.dataset.turboRenderDebugConversationId = debugConversationId;
      }
    }, REAL_CONVERSATION_ID);
    await callback(page);
  } finally {
    if (existingPage == null) {
      await page.close();
    }
  }
}

let server: { baseUrl: string; close(): Promise<void> } | null = null;
let browserHandle: ControlledBrowserHandle | null = null;

test.beforeAll(async () => {
  server = await createStaticServer(OUTPUT_DIR);
  browserHandle = await launchControlledBrowser('about:blank');
});

test.afterAll(async () => {
  await server?.close();
  server = null;
  await browserHandle?.cleanup();
  browserHandle = null;
});

async function withHarnessPage(
  baseUrl: string,
  route: 'chat' | 'share' = 'chat',
  callback: (page: Page) => Promise<void>,
  options: {
    debugShareActions?: boolean;
    language?: 'en' | 'zh-CN';
  } = {},
) {
  if (browserHandle == null) {
    throw new Error('Controlled browser is unavailable.');
  }

  const context = browserHandle.browser.contexts()[0];
  if (context == null) {
    throw new Error('Controlled browser did not expose a default context.');
  }

  const page = await context.newPage();
  try {
    await page.addInitScript(
      ({ debugShareActions, language }) => {
        if (debugShareActions) {
          sessionStorage.setItem(TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY, '1');
          document.documentElement.dataset.turboRenderDebugShareActions = '1';
          (window as Window & { __turboRenderDebugShareActions?: boolean }).__turboRenderDebugShareActions = true;
        }
        if (language != null) {
          document.documentElement.lang = language;
        }
      },
      { debugShareActions: options.debugShareActions ?? false, language: options.language ?? null },
    );
    const routeQuery =
      route === 'share'
        ? `?route=share${options.debugShareActions ? `&${TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY}=1` : ''}`
        : '';
    await page.goto(`${baseUrl}/harness.html${routeQuery}`);
    await callback(page);
  } finally {
    await page.close();
  }
}

test('renders expanded archive batches with compact padding and official actions', async () => {
  if (server == null) {
    throw new Error('Harness regression server is unavailable.');
  }

  await withHarnessPage(server.baseUrl, 'chat', async (page) => {
    await page.locator('#seed-small').click();
    await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toBeVisible({ timeout: 15_000 });

    const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
    await expect(firstBatch).toBeVisible();
    await firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]').click();
    await expect(firstBatch).toHaveAttribute('data-state', 'expanded');

    const batchStyle = await firstBatch.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        backgroundColor: computed.backgroundColor,
        boxShadow: computed.boxShadow,
        borderTopWidth: computed.borderTopWidth,
        paddingLeft: computed.paddingLeft,
        paddingTop: computed.paddingTop,
        paddingRight: computed.paddingRight,
        paddingBottom: computed.paddingBottom,
      };
    });
    expect(batchStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(batchStyle.boxShadow).toBe('none');
    expect(batchStyle.borderTopWidth).toBe('1px');
    expect(batchStyle.paddingLeft).toBe('0px');
    expect(batchStyle.paddingTop).toBe('6px');
    expect(batchStyle.paddingRight).toBe('0px');
    expect(batchStyle.paddingBottom).toBe('0px');

    const mainStyle = await firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchMain}`).evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        gap: computed.gap,
      };
    });
    expect(mainStyle.gap).toBe('8px');

    const entries = firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchEntries}`);
    const firstEntry = firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchEntry}`).first();
    await expect(entries).toBeVisible();
    await expect(firstEntry).toBeVisible();
    await expect(firstEntry).toHaveAttribute('data-conversation-id', /.+/);

    const entryStyle = await firstEntry.evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        gap: computed.gap,
        paddingTop: computed.paddingTop,
      };
    });
    expect(entryStyle.gap).toBe('6px');
    expect(entryStyle.paddingTop).toBe('0px');

    const userActions = firstBatch.locator(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="user"]`);
    const assistantActions = firstBatch.locator(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`);
    await expect(userActions).toHaveCount(5);
    await expect(assistantActions).toHaveCount(5);
    await expect(userActions.first()).toBeVisible();
    await expect(assistantActions.first()).toBeVisible();
    await expect(userActions.first()).toHaveAttribute('data-template', 'host');
    await expect(assistantActions.first()).toHaveAttribute('data-template', 'host');
    await expect(userActions.first()).toHaveCSS('flex-wrap', 'nowrap');
    await expect(assistantActions.first()).toHaveCSS('flex-wrap', 'nowrap');
    await expect(userActions.first().locator('button')).toHaveCount(1);
    await expect(userActions.first().locator('button[data-testid="copy-turn-action-button"]')).toHaveCount(1);
    await expect(userActions.first().locator('button[data-testid="copy-turn-action-button"]')).toHaveText('');
    await expect(userActions.first().locator('button svg')).toHaveCount(1);
    await expect(userActions.locator('button[data-testid="copy-turn-action-button"]')).toHaveCount(5);
    await expect(assistantActions.first().locator('button')).toHaveCount(5);
    await expect(assistantActions.first().locator('button[data-testid="copy-turn-action-button"]')).toHaveText('');
    await expect(assistantActions.first().locator('button svg')).toHaveCount(5);
    await expect(assistantActions.locator('button')).toHaveCount(25);

    const assistantCopyButton = assistantActions.first().locator('button[data-action="copy"]');
    const assistantMoreButton = assistantActions.first().locator('button[data-action="more"]');
    const assistantCopyBox = await assistantCopyButton.boundingBox();
    const assistantMoreBox = await assistantMoreButton.boundingBox();
    expect(assistantCopyBox).not.toBeNull();
    expect(assistantMoreBox).not.toBeNull();
    expect(Math.abs((assistantCopyBox?.y ?? 0) - (assistantMoreBox?.y ?? 0))).toBeLessThan(2);
    const headerStyle = await firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchHeader}`).evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        display: computed.display,
        gridTemplateColumns: computed.gridTemplateColumns,
        position: computed.position,
        top: computed.top,
      };
    });
    expect(headerStyle.display).toBe('grid');
    expect(headerStyle.gridTemplateColumns).not.toBe('none');
    expect(headerStyle.position).toBe('sticky');
    expect(headerStyle.top).toBe('12px');

    const userBody = firstEntry.locator(`.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"]`).first();
    const assistantBody = firstEntry.locator(`.${UI_CLASS_NAMES.historyEntryBody}[data-lane="assistant"]`).first();
    await expect(userBody).toHaveAttribute('data-message-id', /.+/);
    await expect(assistantBody).toHaveAttribute('data-message-id', /.+/);
    const userBodyBox = await userBody.boundingBox();
    const userActionsBox = await userActions.first().boundingBox();
    const assistantBodyBox = await assistantBody.boundingBox();
    const assistantActionsBox = await assistantActions.first().boundingBox();
    expect(userBodyBox).not.toBeNull();
    expect(userActionsBox).not.toBeNull();
    expect(assistantBodyBox).not.toBeNull();
    expect(assistantActionsBox).not.toBeNull();
    expect((userActionsBox?.y ?? 0)).toBeGreaterThan((userBodyBox?.y ?? 0));
    expect(Math.abs(((userActionsBox?.x ?? 0) + (userActionsBox?.width ?? 0)) - ((userBodyBox?.x ?? 0) + (userBodyBox?.width ?? 0)))).toBeLessThan(12);
    expect(Math.abs((assistantActionsBox?.x ?? 0) - (assistantBodyBox?.x ?? 0))).toBeLessThan(12);

    await userActions.first().locator('button[data-testid="copy-turn-action-button"]').click();
    await assistantCopyButton.click();
    const firstAssistantLikeButton = assistantActions.first().locator('button[data-testid="good-response-turn-action-button"]');
    const firstAssistantDislikeButton = assistantActions.first().locator('button[data-testid="bad-response-turn-action-button"]');
    const beforeLikeScrollRoot = await page.evaluate(() =>
      document.querySelector('[class*="scroll-root"]') instanceof HTMLElement
        ? (document.querySelector('[class*="scroll-root"]') as HTMLElement).scrollTop
        : null,
    );
    await firstAssistantLikeButton.click();
    await page.waitForTimeout(300);
    await expect(firstAssistantLikeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(firstAssistantDislikeButton).toHaveCount(0);
    const afterLikeScrollRoot = await page.evaluate(() =>
      document.querySelector('[class*="scroll-root"]') instanceof HTMLElement
        ? (document.querySelector('[class*="scroll-root"]') as HTMLElement).scrollTop
        : null,
    );
    expect(afterLikeScrollRoot).toBe(beforeLikeScrollRoot);
    await firstAssistantLikeButton.click();
    await expect(firstAssistantLikeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(firstAssistantDislikeButton).toHaveCount(1);

    const secondAssistantActions = assistantActions.nth(1);
    await secondAssistantActions.locator('button[data-testid="bad-response-turn-action-button"]').click();
    await assistantActions.first().locator('button[data-testid="share-turn-action-button"]').click();
    await assistantMoreButton.click();
    const moreMenu = assistantActions.first().locator('[data-turbo-render-entry-menu="true"]');
    await expect(moreMenu).toBeVisible();
    await expect(moreMenu).toContainText('Branch in new chat');
    await expect(moreMenu).toContainText('Read aloud');
    const moreButtonBox = await assistantMoreButton.boundingBox();
    const moreMenuBox = await moreMenu.boundingBox();
    expect(moreButtonBox).not.toBeNull();
    expect(moreMenuBox).not.toBeNull();
    expect((moreMenuBox?.y ?? 0)).toBeLessThan((moreButtonBox?.y ?? 0));
    expect(Math.abs((moreMenuBox?.x ?? 0) - (moreButtonBox?.x ?? 0))).toBeLessThan(6);
    await moreMenu.locator('button[data-turbo-render-menu-action="branch"]').click();
    await assistantMoreButton.click();
    const reopenedMenu = assistantActions.first().locator('[data-turbo-render-entry-menu="true"]');
    await expect(reopenedMenu).toBeVisible();
    await reopenedMenu.locator('button[data-turbo-render-menu-action="read-aloud"]').click();
    const stopButton = reopenedMenu.locator('button[data-turbo-render-menu-action="stop-read-aloud"]');
    if ((await stopButton.count()) > 0) {
      await stopButton.click();
    }

    await expect(page.locator('body')).toHaveAttribute('data-host-action-copy-count', '2');
    await expect(page.locator('body')).toHaveAttribute('data-host-action-share-count', '1');
    await expect(page.locator('body')).toHaveAttribute('data-host-action-branch-count', '1');
    await expect(reopenedMenu).toBeVisible();
  });
});

test('hides archive actions on share routes', async () => {
  if (server == null) {
    throw new Error('Harness regression server is unavailable.');
  }

  await withHarnessPage(server.baseUrl, 'share', async (page) => {
    await expect(page.locator('#harness-status')).toHaveAttribute('data-route-kind', 'share');
    const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
    await expect(firstBatch).toBeVisible();
    await firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]').click();
    await expect(page.locator(`.${UI_CLASS_NAMES.historyEntryActions}`)).toHaveCount(0);
  });
});

test('keeps refreshCount bounded while dragging a large archive transcript', async () => {
  if (server == null) {
    throw new Error('Harness regression server is unavailable.');
  }

  await withHarnessPage(server.baseUrl, 'chat', async (page) => {
    await page.locator('#seed-large').click();
    await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toBeVisible({ timeout: 15_000 });

    const scroller = page.locator('[data-testid="conversation-scroller"]');
    const scrollMetrics = await scroller.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    await page.locator('#refresh-status').click();
    const refreshBefore = await readRefreshCount(page);
    const maxScrollTop = Math.max(0, scrollMetrics.scrollHeight - scrollMetrics.clientHeight);

    for (let index = 0; index < 18; index += 1) {
      const nextTop = Math.round((maxScrollTop * index) / 17);
      await scroller.evaluate((node, top) => {
        node.scrollTop = Number(top);
      }, nextTop);
      await page.waitForTimeout(25);
    }

    await page.waitForTimeout(180);
    await page.locator('#refresh-status').click();
    const refreshAfter = await readRefreshCount(page);
    expect(refreshAfter).toBe(refreshBefore);
  });
});

test('keeps archived actions aligned on the real ChatGPT conversation page', async () => {
  await withRealConversationPage(async (page) => {
    await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toBeVisible({ timeout: 20_000 });

    const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
    await expect(firstBatch).toBeVisible();
    const toggle = firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]');
    await toggle.click();
    await page.waitForTimeout(1200);

    const batchBox = await firstBatch.boundingBox();
    const toggleAfter = await toggle.boundingBox();
    const titleBox = await firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchMeta}`).boundingBox();
    const railBox = await firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchRail}`).boundingBox();
    expect(batchBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(Math.abs((titleBox?.y ?? 0) - (toggleAfter?.y ?? 0))).toBeLessThan(12);
    expect(Math.abs((railBox?.y ?? 0) - (titleBox?.y ?? 0))).toBeLessThan(12);
    expect(Math.abs((toggleAfter?.x ?? 0) - (railBox?.x ?? 0))).toBeLessThan(12);

    const assistantEntry = firstBatch
      .locator(`.${UI_CLASS_NAMES.inlineBatchEntry}`)
      .filter({ has: page.locator(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`) })
      .first();
    await assistantEntry.scrollIntoViewIfNeeded();
    await expect(assistantEntry).toHaveAttribute('data-conversation-id', /.+/);
    const assistantActions = assistantEntry.locator(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`).first();
    await expect(assistantActions).toBeVisible();
    await expect(assistantActions.locator('button')).toHaveCount(5);

    const actionBoxes = await assistantActions.locator('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = (button as HTMLElement).getBoundingClientRect();
        return {
          tid: button.getAttribute('data-testid'),
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
        };
      }),
    );
    expect(actionBoxes.every((box) => box.w >= 30 && box.h >= 30)).toBe(true);
    expect(Math.abs((actionBoxes[0]?.y ?? 0) - (actionBoxes[4]?.y ?? 0))).toBeLessThan(2);
    expect(Math.abs((actionBoxes[0]?.x ?? 0) - (actionBoxes[1]?.x ?? 0))).toBeGreaterThan(0);

    const assistantMoreButtons = assistantActions.locator('button[data-turbo-render-action="more"]:visible');
    const hostMenuData = await openReadAloudMenuFromMoreButtons(page, assistantMoreButtons);
    expect(hostMenuData, 'expected an official-style read-aloud popover').not.toBeNull();
    const { menu: hostMenu, moreButtonBox, menuBox: moreMenuBox } = hostMenuData!;
    await expect(hostMenu).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-turbo-render-entry-menu="true"]')).toHaveCount(0);
    const hostReadButton = hostMenu!.getByRole('menuitem', { name: /朗读|read aloud/i });
    await expect(hostReadButton).toBeVisible({ timeout: 10_000 });
    const hostBranchButton = hostMenu!.getByRole('menuitem', { name: /新聊天中的分支|branch in new chat/i });
    expect(moreButtonBox).not.toBeNull();
    expect(moreMenuBox).not.toBeNull();
    expect((moreMenuBox?.y ?? 0)).toBeLessThan((moreButtonBox?.y ?? 0));
    expect(Math.abs((moreMenuBox?.x ?? 0) - (moreButtonBox?.x ?? 0))).toBeLessThan(24);
    if ((await hostBranchButton.count()) > 0) {
      await expect(hostBranchButton).toBeVisible();
    }

    const beforeMoreScrollRoot = await page.evaluate(() =>
      document.querySelector('[class*="scroll-root"]') instanceof HTMLElement
        ? (document.querySelector('[class*="scroll-root"]') as HTMLElement).scrollTop
        : null,
    );

    await page.waitForTimeout(300);
    await hostReadButton.click();
    await expect(hostMenu).toBeVisible({ timeout: 20_000 });
    await expect(
      hostMenu.locator(
        'button[data-testid="voice-stop-turn-action-button"], button[data-testid="stop-read-aloud-turn-action-button"], [role="menuitem"]:has-text("停止朗读"), [role="menuitem"]:has-text("Stop reading"), [role="menuitem"]:has-text("Stop read aloud")',
      ),
    ).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(1200);

    const likeButton = assistantActions.locator('button[data-turbo-render-action="like"]');
    const dislikeButton = assistantActions.locator('button[data-turbo-render-action="dislike"]');
    const beforeLikeScrollRoot = await page.evaluate(() =>
      document.querySelector('[class*="scroll-root"]') instanceof HTMLElement
        ? (document.querySelector('[class*="scroll-root"]') as HTMLElement).scrollTop
        : null,
    );
    await likeButton.click();
    await page.waitForTimeout(300);
    await page.waitForTimeout(1200);
    await expect(likeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(dislikeButton).toHaveCount(0);
    const afterLikeScrollRoot = await page.evaluate(() =>
      document.querySelector('[class*="scroll-root"]') instanceof HTMLElement
        ? (document.querySelector('[class*="scroll-root"]') as HTMLElement).scrollTop
        : null,
    );
    expect(afterLikeScrollRoot).toBe(beforeLikeScrollRoot);
    await likeButton.click();
    await expect(likeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(assistantActions.locator('button[data-turbo-render-action="dislike"]')).toHaveCount(1);

    await toggle.click();
    await page.waitForTimeout(1200);
    const collapsedHeader = await firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchHeader}`).boundingBox();
    const collapsedRail = await firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchRail}`).boundingBox();
    const collapsedScrollRoot = await page.evaluate(() =>
      document.querySelector('[class*="scroll-root"]') instanceof HTMLElement
        ? (document.querySelector('[class*="scroll-root"]') as HTMLElement).scrollTop
        : null,
    );
    expect(Math.abs((collapsedHeader?.y ?? 0) - (collapsedRail?.y ?? 0))).toBeLessThan(12);
    expect((collapsedScrollRoot ?? 0)).toBeLessThan(beforeMoreScrollRoot ?? Number.POSITIVE_INFINITY);
  });
});

test('uses the host message id when requesting real-page read aloud audio', async () => {
  await withRealConversationPage(async (page) => {
    const synthesizeRequests: string[] = [];
    const synthesizeHeaders: Array<Record<string, string>> = [];
    let debugData: Record<string, string> | null = null;
    await page.evaluate(async (conversationId) => {
      const response = await fetch(
        `https://chatgpt.com/backend-api/conversation/${conversationId}?__turbo_render_read_aloud_snapshot=1`,
        {
          credentials: 'include',
        },
      );
      await response.text();
    }, REAL_CONVERSATION_ID);
    await page.route('**/backend-api/synthesize**', async (route) => {
      synthesizeRequests.push(route.request().url());
      synthesizeHeaders.push(route.request().headers());
      debugData = await page.evaluate(() => ({
        debugUrlWindow: (window as Window & { __turboRenderDebugReadAloudUrl?: string }).__turboRenderDebugReadAloudUrl ?? '',
        debugUrlBody: document.body.getAttribute('data-turbo-render-debug-read-aloud-url') ?? '',
        debugUrlDocument: document.documentElement.getAttribute('data-turbo-render-debug-read-aloud-url') ?? '',
        debugRouteBody: document.body.dataset.turboRenderDebugReadAloudRoute ?? '',
        debugRouteDocument: document.documentElement.dataset.turboRenderDebugReadAloudRoute ?? '',
        debugMenuActionBody: document.body.dataset.turboRenderDebugReadAloudMenuAction ?? '',
        debugMenuActionDocument: document.documentElement.dataset.turboRenderDebugReadAloudMenuAction ?? '',
        debugHostMenuFoundBody: document.body.dataset.turboRenderDebugReadAloudHostMenuFound ?? '',
        debugHostMenuFoundDocument: document.documentElement.dataset.turboRenderDebugReadAloudHostMenuFound ?? '',
        rendered: document.body.dataset.turboRenderDebugReadAloudCandidateRendered ?? '',
        parked: document.body.dataset.turboRenderDebugReadAloudCandidateParked ?? '',
        host: document.body.dataset.turboRenderDebugReadAloudCandidateHost ?? '',
        snapshot: document.body.dataset.turboRenderDebugReadAloudCandidateSnapshot ?? '',
        record: document.body.dataset.turboRenderDebugReadAloudCandidateRecord ?? '',
        node: document.body.dataset.turboRenderDebugReadAloudCandidateNode ?? '',
        resolved: document.body.dataset.turboRenderDebugReadAloudMessageId ?? '',
        hostPrecisePair: document.body.dataset.turboRenderDebugReadAloudHostPrecisePairId ?? '',
        hostPreciseTarget: document.body.dataset.turboRenderDebugReadAloudHostPreciseTargetId ?? '',
        hostTurnPair: document.body.dataset.turboRenderDebugReadAloudHostTurnPairId ?? '',
        hostTurnTarget: document.body.dataset.turboRenderDebugReadAloudHostTurnTargetId ?? '',
        hostSelectedSource: document.body.dataset.turboRenderDebugReadAloudHostSelectedSource ?? '',
        hostSelectedId: document.body.dataset.turboRenderDebugReadAloudHostSelectedId ?? '',
        resolvedConversationId: document.body.dataset.turboRenderDebugReadAloudResolvedConversationId ?? '',
        resolvedMessageId: document.body.dataset.turboRenderDebugReadAloudResolvedMessageId ?? '',
        resolvedSource: document.body.dataset.turboRenderDebugReadAloudResolvedSource ?? '',
        readCount: document.body.dataset.hostActionReadAloudCount ?? '',
        stopCount: document.body.dataset.hostActionStopReadAloudCount ?? '',
      }));
      await route.continue();
    });

    await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toBeVisible({ timeout: 20_000 });

    const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
    await firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]').click();
    await page.waitForTimeout(1200);
    const assistantEntry = firstBatch
      .locator(`.${UI_CLASS_NAMES.inlineBatchEntry}`)
      .filter({ has: page.locator(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`) })
      .first();
    await assistantEntry.scrollIntoViewIfNeeded();
    await expect(assistantEntry).toHaveAttribute('data-conversation-id', REAL_CONVERSATION_ID);
    const assistantBody = assistantEntry.locator(`.${UI_CLASS_NAMES.historyEntryBody}[data-lane="assistant"]`).first();
    await expect(assistantBody).toHaveAttribute('data-message-id', /.+/);
    const assistantActions = assistantEntry.locator(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`).first();
    const assistantMoreButtons = assistantActions.locator('button[data-turbo-render-action="more"]:visible');
    const hostMenuData = await openReadAloudMenuFromMoreButtons(page, assistantMoreButtons);
    expect(hostMenuData, 'expected an official-style read-aloud popover').not.toBeNull();
    const { menu: hostMenu, moreButtonBox, menuBox: hostMenuBox } = hostMenuData!;
    await expect(hostMenu).toBeVisible({ timeout: 10_000 });
    const hostReadButton = hostMenu.getByRole('menuitem', { name: /朗读|read aloud/i });
    const hostBranchButton = hostMenu.getByRole('menuitem', { name: /新聊天中的分支|branch in new chat/i });
    await expect(hostReadButton).toBeVisible({ timeout: 10_000 });
    if ((await hostBranchButton.count()) > 0) {
      await expect(hostBranchButton).toBeVisible({ timeout: 10_000 });
    }
    await expect(page.locator('[data-turbo-render-entry-menu="true"]')).toHaveCount(0);
    expect(hostMenuBox).not.toBeNull();
    expect(moreButtonBox).not.toBeNull();
    expect((hostMenuBox?.y ?? 0)).toBeLessThan((moreButtonBox?.y ?? 0));
    expect(Math.abs((hostMenuBox?.x ?? 0) - (moreButtonBox?.x ?? 0))).toBeLessThan(24);

    await hostReadButton.click();
    await page.waitForTimeout(800);
    expect(synthesizeRequests.length).toBeGreaterThan(0);
    const requestUrl = new URL(synthesizeRequests[0]!);
    expect(requestUrl.searchParams.get('conversation_id')).toBe(REAL_CONVERSATION_ID);
    const messageId = requestUrl.searchParams.get('message_id');
    expect(messageId, JSON.stringify(debugData, null, 2)).not.toBeNull();
    if ((debugData?.resolvedMessageId ?? '').trim().length > 0) {
      expect(messageId).toBe(debugData.resolvedMessageId.trim());
    } else {
      expect(messageId).not.toBe('');
    }
    expect(messageId, JSON.stringify(debugData, null, 2)).not.toMatch(/^turn-chat:/);
    expect(requestUrl.searchParams.get('voice')).toBe('cove');
    expect(requestUrl.searchParams.get('format')).toBe('aac');
    expect(synthesizeHeaders[0]?.authorization, JSON.stringify(synthesizeHeaders[0] ?? {}, null, 2)).toMatch(
      /.+/,
    );

    await expect(hostMenu).toBeVisible({ timeout: 20_000 });
    const hostStopButton = hostMenu.getByRole('menuitem', { name: /停止朗读|stop reading|stop read aloud/i });
    await expect(hostStopButton).toBeVisible({ timeout: 20_000 });
    await hostStopButton.click();
  });
});
