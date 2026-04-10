import { expect, test, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

import { launchControlledBrowser } from './controlled-browser';

type PopupScenario = 'unsupported-web' | 'chatgpt-home' | 'share' | 'window-fallback' | 'load-error';

const OUTPUT_DIR = path.resolve('.output/chrome-mv3');

const BASE_SETTINGS = {
  enabled: true,
  autoEnable: true,
  language: 'en',
  mode: 'performance',
  minFinalizedBlocks: 120,
  minDescendants: 2500,
  keepRecentPairs: 5,
  batchPairCount: 5,
  initialHotPairs: 5,
  liveHotPairs: 5,
  keepRecentTurns: 10,
  viewportBufferTurns: 8,
  groupSize: 10,
  initialTrimEnabled: true,
  initialHotTurns: 10,
  liveHotTurns: 10,
  coldRestoreMode: 'placeholder',
  softFallback: false,
  frameSpikeThresholdMs: 48,
  frameSpikeCount: 4,
  frameSpikeWindowMs: 5000,
} as const;

function createRuntime(overrides: Record<string, unknown> = {}) {
  const paused = (overrides.paused as boolean | undefined) ?? false;
  const runtime = {
    supported: true,
    chatId: 'share:test-share',
    routeKind: 'share',
    reason: null,
    archiveOnly: false,
    active: !paused,
    paused,
    mode: 'performance',
    softFallback: false,
    initialTrimApplied: false,
    initialTrimmedTurns: 0,
    totalMappingNodes: 128,
    activeBranchLength: 40,
    totalTurns: 18,
    totalPairs: 9,
    hotPairsVisible: 5,
    finalizedTurns: 18,
    handledTurnsTotal: 6,
    historyPanelOpen: false,
    archivedTurnsTotal: 6,
    expandedArchiveGroups: 0,
    historyAnchorMode: 'hidden',
    slotBatchCount: 2,
    collapsedBatchCount: 2,
    expandedBatchCount: 0,
    parkedTurns: 6,
    parkedGroups: 2,
    liveDescendantCount: 128,
    visibleRange: { start: 4, end: 17 },
    observedRootKind: 'live-turn-container',
    refreshCount: 3,
    spikeCount: 1,
    lastError: null,
    contentScriptInstanceId: 'instance-test',
    contentScriptStartedAt: 1_700_000_000_000,
    buildSignature: 'test-build',
  };

  Object.assign(runtime, overrides);
  runtime.active = (overrides.active as boolean | undefined) ?? !paused;
  runtime.paused = paused;
  return runtime;
}

function createStatus(overrides: {
  activeTabId?: number | null;
  activeTabRouteKind?: 'chat' | 'share' | 'home' | 'unknown' | null;
  activeTabSupportedHost?: boolean;
  paused?: boolean;
  runtime?: Record<string, unknown> | null;
  targetTabId?: number | null;
  usingWindowFallback?: boolean;
} = {}) {
  const paused = overrides.paused ?? false;
  const runtime =
    overrides.runtime === undefined
      ? createRuntime({ paused })
      : overrides.runtime === null
        ? null
        : createRuntime({ paused, ...overrides.runtime });

  return {
    settings: BASE_SETTINGS,
    paused: runtime?.paused ?? paused,
    runtime,
    targetTabId: overrides.targetTabId === undefined ? 77 : overrides.targetTabId,
    activeTabId: overrides.activeTabId === undefined ? 77 : overrides.activeTabId,
    usingWindowFallback: overrides.usingWindowFallback ?? false,
    activeTabSupportedHost: overrides.activeTabSupportedHost ?? true,
    activeTabRouteKind: overrides.activeTabRouteKind === undefined ? 'share' : overrides.activeTabRouteKind,
  };
}

function createScenarioStatus(scenario: PopupScenario) {
  switch (scenario) {
    case 'unsupported-web':
      return createStatus({
        activeTabSupportedHost: false,
        activeTabRouteKind: null,
        runtime: null,
      });
    case 'chatgpt-home':
      return createStatus({
        activeTabSupportedHost: true,
        activeTabRouteKind: 'home',
        runtime: null,
      });
    case 'share':
      return createStatus({
        activeTabSupportedHost: true,
        activeTabRouteKind: 'share',
        runtime: createRuntime({
          chatId: 'share:test-share',
          routeKind: 'share',
          active: true,
          paused: false,
        }),
      });
    case 'window-fallback':
      return createStatus({
        activeTabSupportedHost: true,
        activeTabRouteKind: 'share',
        runtime: createRuntime({
          chatId: 'share:fallback',
          routeKind: 'share',
          active: true,
          paused: false,
        }),
        targetTabId: 88,
        activeTabId: 11,
        usingWindowFallback: true,
      });
    case 'load-error':
      return null;
  }
}

function createStaticServer(rootDir: string): Promise<{ baseUrl: string; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const parsedUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(parsedUrl.pathname);
        const relativePath = pathname === '/' ? '/popup.html' : pathname;
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
                  : extension === '.jpg' || extension === '.jpeg'
                    ? 'image/jpeg'
                    : extension === '.png'
                      ? 'image/png'
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
        reject(new Error('Unable to start popup smoke-test server.'));
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

async function installPopupMock(page: Page, baseUrl: string, scenario: PopupScenario) {
  const scenarioStatus = createScenarioStatus(scenario);

  await page.addInitScript(
    ({ baseUrl: scriptBaseUrl, scenarioName, status }) => {
      const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
      let currentStatus = clone(status);

      const sendMessage = async (message: { type?: string; paused?: boolean }) => {
        if (message?.type === 'GET_TAB_STATUS') {
          if (scenarioName === 'load-error') {
            throw new Error('background unavailable');
          }

          return clone(currentStatus);
        }

        if (message?.type === 'PAUSE_CHAT') {
          if (currentStatus.runtime == null) {
            return null;
          }

          const paused = Boolean(message.paused);
          currentStatus = {
            ...currentStatus,
            paused,
            runtime: {
              ...currentStatus.runtime,
              paused,
              active: !paused,
            },
          };
          return clone(currentStatus);
        }

        return clone(currentStatus);
      };

      if (scenarioName === 'window-fallback') {
        currentStatus = {
          ...currentStatus,
          usingWindowFallback: true,
        };
      }

      if (scenarioName === 'share') {
        currentStatus = {
          ...currentStatus,
          runtime: {
            ...currentStatus.runtime,
            chatId: 'share:test-share',
            routeKind: 'share',
            active: true,
            paused: false,
          },
        };
      }

      if (scenarioName === 'chatgpt-home') {
        currentStatus = {
          ...currentStatus,
          runtime: null,
          activeTabSupportedHost: true,
          activeTabRouteKind: 'home',
        };
      }

      if (scenarioName === 'unsupported-web') {
        currentStatus = {
          ...currentStatus,
          runtime: null,
          activeTabSupportedHost: false,
          activeTabRouteKind: null,
        };
      }

      const root = globalThis as unknown as { chrome?: { runtime?: Record<string, unknown> } };
      const chromeObject = root.chrome ?? {};
      chromeObject.runtime = chromeObject.runtime ?? {};
      chromeObject.runtime.id = 'mock-extension';
      chromeObject.runtime.getURL = (resourcePath: string) => new URL(resourcePath, scriptBaseUrl).href;
      chromeObject.runtime.openOptionsPage = async () => undefined;
      chromeObject.runtime.sendMessage = sendMessage;
      if (root.chrome == null) {
        root.chrome = chromeObject;
      }
    },
    {
      baseUrl,
      scenarioName: scenario,
      status: scenarioStatus,
    },
  );
}

async function withPopupPage(
  baseUrl: string,
  scenario: PopupScenario,
  callback: (page: Page) => Promise<void>,
) {
  if (browserHandle == null) {
    throw new Error('Popup smoke-test browser is unavailable.');
  }

  const context = browserHandle.browser.contexts()[0];
  if (context == null) {
    throw new Error('Popup smoke-test browser did not expose a default context.');
  }

  const page = await context.newPage();
  try {
    await installPopupMock(page, baseUrl, scenario);
    await page.goto(`${baseUrl}/popup.html`);
    await expect(page.locator('[data-popup-state]')).toBeVisible({ timeout: 15_000 });
    await callback(page);
  } finally {
    await page.close();
  }
}

let server: { baseUrl: string; close(): Promise<void> } | null = null;
let browserHandle: ControlledBrowserHandle | null = null;

test.beforeAll(async () => {
  server = await createStaticServer(OUTPUT_DIR);
  browserHandle = await launchControlledBrowser('about:blank');
});

test.afterAll(async () => {
  await browserHandle?.cleanup();
  browserHandle = null;
  await server?.close();
  server = null;
});

test('renders the unsupported-web state for a regular page', async () => {
  if (server == null) {
    throw new Error('Popup smoke-test server is unavailable.');
  }

  await withPopupPage(server.baseUrl, 'unsupported-web', async (page) => {
    const hero = page.locator('[data-popup-state="unsupported-web"]');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('No supported ChatGPT tab was found in the active window.');
    await expect(hero).toContainText('https://chatgpt.com/c/<id>');
    await expect(page.locator('#open-demo')).toBeVisible();
    await expect(page.locator('#open-help')).toBeVisible();
    await expect(page.locator('[data-popup-section="current-tab"]')).toHaveCount(0);
    await expect(page.locator('[data-popup-section="settings"]')).toHaveCount(0);
  });
});

test('renders the unsupported-chatgpt-home state for ChatGPT home', async () => {
  if (server == null) {
    throw new Error('Popup smoke-test server is unavailable.');
  }

  await withPopupPage(server.baseUrl, 'chatgpt-home', async (page) => {
    const hero = page.locator('[data-popup-state="unsupported-chatgpt-home"]');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('ChatGPT is open, but the home page is not a supported conversation route.');
    await expect(hero).toContainText('https://chatgpt.com/share/<id>');
    await expect(page.locator('[data-popup-section="current-tab"]')).toHaveCount(0);
    await expect(page.locator('[data-popup-section="settings"]')).toHaveCount(0);
  });
});

test('renders the /share/<id> state on supported ChatGPT conversations', async () => {
  if (server == null) {
    throw new Error('Popup smoke-test server is unavailable.');
  }

  await withPopupPage(server.baseUrl, 'share', async (page) => {
    const hero = page.locator('[data-popup-state="active"]');
    await expect(hero).toBeVisible();
    await expect(page.locator('#toggle-chat-mode')).toHaveText('Restore this chat');
    await expect(page.locator('[data-popup-section="current-tab"]')).toBeVisible();
    await expect(page.locator('[data-popup-section="settings"]')).toBeVisible();
    await expect(page.locator('#enabled-toggle')).toBeVisible();
    await expect(page.locator('#language-select')).toBeVisible();
  });
});

test('renders the supported-page recovery state when another supported tab is selected', async () => {
  if (server == null) {
    throw new Error('Popup smoke-test server is unavailable.');
  }

  await withPopupPage(server.baseUrl, 'window-fallback', async (page) => {
    const hero = page.locator('[data-popup-state="window-fallback"]');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('This popup is showing the status from another supported ChatGPT tab in the same window.');
    await expect(page.locator('[data-popup-section="current-tab"]')).toBeVisible();
    await expect(page.locator('[data-popup-section="settings"]')).toBeVisible();
    const bodyText = await page.locator('body').innerText();
    expect(
      bodyText.match(/This popup is showing the status from another supported ChatGPT tab in the same window\./g) ?? [],
    ).toHaveLength(1);
  });
});

test('renders a readable error state when sendMessage fails', async () => {
  if (server == null) {
    throw new Error('Popup smoke-test server is unavailable.');
  }

  await withPopupPage(server.baseUrl, 'load-error', async (page) => {
    const hero = page.locator('[data-popup-state="error"]');
    await expect(hero).toBeVisible();
    await expect(hero.locator('.popup-error-detail code')).toHaveText('background unavailable');
    await expect(page.locator('#refresh-status')).toBeVisible();
    await expect(page.locator('#open-demo')).toBeVisible();
    await expect(page.locator('#open-help')).toBeVisible();
    await expect(page.locator('[data-popup-section="current-tab"]')).toHaveCount(0);
    await expect(page.locator('[data-popup-section="settings"]')).toHaveCount(0);
  });
});
