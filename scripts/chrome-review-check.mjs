#!/usr/bin/env node

import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';

import { buildStoreZipPath } from './package-browser-release-lib.mjs';
import { preflightChrome } from './publish-stores.mjs';
import { spawnLaunchableChromium, waitForRemoteDebugEndpoint } from './debug-mcp-chrome-lib.mjs';

const REQUIRED_POPUP_ASSET_PATHS = ['assets/wechat-sponsor.jpg', 'assets/aliapy-sponsor.jpg'];
const POPUP_SCENARIOS = ['unsupported-web', 'chatgpt-home', 'share', 'window-fallback', 'load-error'];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function runCommand(command, args, description) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function runCommandCapture(command, args, description) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 'unknown'}`);
  }

  return result.stdout ?? '';
}

function parsePopupResourcePaths(html) {
  const resourcePaths = new Set();

  for (const match of html.matchAll(/\b(?:src|href)=["']([^"'`]+)["']/g)) {
    const resourcePath = match[1];
    if (
      resourcePath.startsWith('http://') ||
      resourcePath.startsWith('https://') ||
      resourcePath.startsWith('data:') ||
      resourcePath.startsWith('blob:') ||
      resourcePath.startsWith('chrome-extension:')
    ) {
      continue;
    }

    resourcePaths.add(resourcePath.replace(/^\//, ''));
  }

  return [...resourcePaths].sort();
}

function normalizeZipResourcePath(resourcePath, fromPath = '') {
  const trimmed = resourcePath.split('?')[0].split('#')[0];

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('chrome-extension:')
  ) {
    return null;
  }

  if (trimmed.startsWith('/')) {
    return trimmed.slice(1);
  }

  if (trimmed.startsWith('.')) {
    const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), trimmed));
    return resolvedPath.startsWith('..') ? null : resolvedPath.replace(/^\.\//, '');
  }

  return trimmed;
}

function collectZipDependencies(zipPath, entryPath, collected = new Set(), visited = new Set()) {
  const normalizedEntryPath = normalizeZipResourcePath(entryPath);
  if (normalizedEntryPath == null || visited.has(normalizedEntryPath)) {
    return collected;
  }

  visited.add(normalizedEntryPath);

  let source = '';
  if (normalizedEntryPath.endsWith('.html') || normalizedEntryPath.endsWith('.js') || normalizedEntryPath.endsWith('.css')) {
    source = runCommandCapture('unzip', ['-p', zipPath, normalizedEntryPath], `Reading ${normalizedEntryPath} from Chrome zip`);
  }

  const importPatterns = [/(?:from|import)\s*["']([^"']+)["']/g, /url\(\s*["']?([^"')]+)["']?\s*\)/g];
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const dependency = normalizeZipResourcePath(match[1], normalizedEntryPath);
      if (dependency == null) {
        continue;
      }

      collected.add(dependency);
      if (dependency.endsWith('.js') || dependency.endsWith('.css') || dependency.endsWith('.html')) {
        collectZipDependencies(zipPath, dependency, collected, visited);
      }
    }
  }

  return collected;
}

function createBaseSettings() {
  return {
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
  };
}

function createBaseRuntime() {
  return {
    supported: true,
    chatId: 'share:test-share',
    routeKind: 'share',
    reason: null,
    archiveOnly: false,
    active: true,
    paused: false,
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
}

function createScenarioStatus(scenario) {
  const base = {
    settings: createBaseSettings(),
    paused: false,
    runtime: createBaseRuntime(),
    targetTabId: 77,
    activeTabId: 77,
    usingWindowFallback: false,
    activeTabSupportedHost: true,
    activeTabRouteKind: 'share',
  };

  switch (scenario) {
    case 'unsupported-web':
      return {
        ...base,
        runtime: null,
        activeTabSupportedHost: false,
        activeTabRouteKind: null,
      };
    case 'chatgpt-home':
      return {
        ...base,
        runtime: null,
        activeTabSupportedHost: true,
        activeTabRouteKind: 'home',
      };
    case 'share':
      return {
        ...base,
        runtime: {
          ...base.runtime,
          chatId: 'share:test-share',
          routeKind: 'share',
        },
      };
    case 'window-fallback':
      return {
        ...base,
        runtime: {
          ...base.runtime,
          chatId: 'share:fallback',
          routeKind: 'share',
        },
        targetTabId: 88,
        activeTabId: 11,
        usingWindowFallback: true,
        activeTabSupportedHost: false,
        activeTabRouteKind: null,
      };
    case 'load-error':
      return null;
    default:
      throw new Error(`Unsupported popup scenario: ${scenario}`);
  }
}

async function createStaticServer(rootDir) {
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

      const fileBuffer = await readFile(resolvedPath);
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Unable to start popup review server.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function installPopupMock(page, baseUrl, scenario) {
  const status = createScenarioStatus(scenario);

  await page.addInitScript(
    ({ baseUrl: scriptBaseUrl, scenarioName, initialStatus }) => {
      const clone = (value) => JSON.parse(JSON.stringify(value));
      let currentStatus = clone(initialStatus);

      const sendMessage = async (message) => {
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

      const chromeObject = globalThis.chrome ?? {};
      chromeObject.runtime = chromeObject.runtime ?? {};
      chromeObject.runtime.id = 'mock-extension';
      chromeObject.runtime.getURL = (resourcePath) => new URL(resourcePath, scriptBaseUrl).href;
      chromeObject.runtime.openOptionsPage = async () => undefined;
      chromeObject.runtime.sendMessage = sendMessage;
      if (globalThis.chrome == null) {
        globalThis.chrome = chromeObject;
      }
    },
    {
      baseUrl,
      scenarioName: scenario,
      initialStatus: status,
    },
  );
}

async function smokePopupScenario({ baseUrl, scenario, expectedState, expectedText }) {
  const debugPort = process.env.CHROME_DEBUG_PORT;
  let launch = null;
  let browser;

  try {
    if (debugPort) {
      await waitForRemoteDebugEndpoint(Number(debugPort));
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    } else {
      launch = await spawnLaunchableChromium({
        repoRoot,
        extensionPath: path.join(repoRoot, '.output', 'chrome-mv3'),
        targetUrl: 'about:blank',
      });
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.debugPort}`);
    }

    const context = browser.contexts()[0];
    if (context == null) {
      throw new Error('Popup review browser did not expose a default context.');
    }

    try {
      const page = await context.newPage();
      await installPopupMock(page, baseUrl, scenario);
      await page.goto(`${baseUrl}/popup.html`);
      await page.locator(`[data-popup-state="${expectedState}"]`).waitFor({ state: 'visible', timeout: 15_000 });
      if (expectedText != null) {
        await expect(page.locator(`[data-popup-state="${expectedState}"]`)).toContainText(expectedText);
      }

      const currentTabSection = page.locator('[data-popup-section="current-tab"]');
      const settingsSection = page.locator('[data-popup-section="settings"]');
      if (scenario === 'unsupported-web' || scenario === 'chatgpt-home' || scenario === 'load-error') {
        await expect(currentTabSection).toHaveCount(0);
        await expect(settingsSection).toHaveCount(0);
      } else {
        await expect(currentTabSection).toBeVisible();
        await expect(settingsSection).toBeVisible();
      }

      if (scenario === 'share') {
        await page.locator('#toggle-chat-mode').waitFor({ state: 'visible', timeout: 15_000 });
        await expect(page.locator('#toggle-chat-mode')).toHaveText('Restore this chat');
      }

      if (scenario === 'window-fallback') {
        const bodyText = await page.locator('body').innerText();
        const matches = bodyText.match(
          /This popup is showing the status from another supported ChatGPT tab in the same window\./g,
        ) ?? [];
        expect(matches).toHaveLength(1);
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (launch != null && launch.child.exitCode == null && launch.child.signalCode == null) {
      launch.child.kill('SIGTERM');
    }
    if (launch != null) {
      await rm(launch.userDataDir, { recursive: true, force: true });
    }
  }
}

async function buildAndPackageChrome() {
  runCommand('pnpm', ['build'], 'Chrome build');
  runCommand('pnpm', ['package:chrome'], 'Chrome package');
}

async function assertPopupZipResources(zipPath) {
  const entries = runCommandCapture('unzip', ['-Z', '-1', zipPath], 'Listing Chrome zip entries')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const entrySet = new Set(entries);
  if (!entrySet.has('popup.html')) {
    throw new Error('Chrome zip is missing popup.html.');
  }

  if (!entrySet.has('manifest.json')) {
    throw new Error('Chrome zip is missing manifest.json.');
  }

  for (const assetPath of REQUIRED_POPUP_ASSET_PATHS) {
    if (!entrySet.has(assetPath)) {
      throw new Error(`Chrome zip is missing popup support asset: ${assetPath}`);
    }
  }

  const popupHtml = runCommandCapture('unzip', ['-p', zipPath, 'popup.html'], 'Reading popup.html from Chrome zip');
  const referencedResources = new Set(parsePopupResourcePaths(popupHtml));
  for (const resourcePath of [...referencedResources]) {
    collectZipDependencies(zipPath, resourcePath, referencedResources);
  }

  const missingResources = [...referencedResources].filter((resourcePath) => !entrySet.has(resourcePath));

  if (missingResources.length > 0) {
    throw new Error(`Chrome zip is missing popup-referenced resources: ${missingResources.join(', ')}`);
  }

  return { entrySet, popupHtml };
}

async function smokeTestChromeZip(zipPath) {
  const unpackDir = await mkdtemp(path.join(os.tmpdir(), 'turborender-chrome-zip-'));

  try {
    runCommand('unzip', ['-oq', zipPath, '-d', unpackDir], 'Unpacking Chrome zip');
    const server = await createStaticServer(unpackDir);

    try {
      for (const scenario of POPUP_SCENARIOS) {
        const expectedState =
          scenario === 'unsupported-web'
            ? 'unsupported-web'
            : scenario === 'chatgpt-home'
              ? 'unsupported-chatgpt-home'
              : scenario === 'share'
                ? 'active'
                : scenario === 'window-fallback'
                  ? 'window-fallback'
                  : 'error';

        const expectedText =
          scenario === 'unsupported-web'
            ? 'No supported ChatGPT tab was found in the active window.'
            : scenario === 'chatgpt-home'
              ? 'ChatGPT is open, but the home page is not a supported conversation route.'
              : scenario === 'share'
                ? 'Restore this chat'
                : scenario === 'window-fallback'
                  ? 'This popup is showing the status from another supported ChatGPT tab in the same window.'
                  : 'background unavailable';

        await smokePopupScenario({
          baseUrl: server.baseUrl,
          scenario,
          expectedState,
          expectedText,
        });
      }
    } finally {
      await server.close();
    }
  } finally {
    await rm(unpackDir, { recursive: true, force: true });
  }
}

export async function main() {
  await buildAndPackageChrome();
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const rawPackageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  if (typeof rawPackageJson.version !== 'string' || rawPackageJson.version.length === 0) {
    throw new Error(`Unable to read package version from ${packageJsonPath}`);
  }
  const version = rawPackageJson.version;

  const zipPath = buildStoreZipPath(path.join(repoRoot, 'release'), version, 'chrome');
  const { entrySet } = await assertPopupZipResources(zipPath);
  console.log(`[TurboRender] verified ${entrySet.size} entries in ${zipPath}`);
  await smokeTestChromeZip(zipPath);
  await preflightChrome();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export {
  assertPopupZipResources,
  createStaticServer,
  createScenarioStatus,
  installPopupMock,
  parsePopupResourcePaths,
  smokePopupScenario,
  smokeTestChromeZip,
};
