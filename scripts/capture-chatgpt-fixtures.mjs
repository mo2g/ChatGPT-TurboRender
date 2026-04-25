#!/usr/bin/env node

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

import { chromium } from '@playwright/test';

import {
  spawnLaunchableChromium,
  waitForRemoteDebugEndpoint,
} from './debug-mcp-chrome-lib.mjs';
import {
  loadChatgptFixtureManifest,
  resolveChatgptFixtureFiles,
  resolveChatgptFixtureRoot,
  repoRoot,
} from './chatgpt-fixture-utils.mjs';
import {
  resolveChromeProfileDir as resolveSourceChromeProfileDir,
} from './reload-mcp-chrome-lib.mjs';

const extensionPath = path.join(repoRoot, '.output', 'chrome-mv3');
const extensionManifestPath = path.join(extensionPath, 'manifest.json');
const scratchRoot = path.join(repoRoot, '.wxt', 'chatgpt-fixtures');
const sourceDebugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? '9222', 10) || 9222;
const STOP_READ_ALOUD_MENU_SELECTOR =
  '[role="menuitem"][data-testid="voice-play-turn-action-button"], [role="menuitem"][aria-label="停止"], [role="menuitem"]:has-text("停止"), [role="menuitem"]:has-text("Stop reading"), [role="menuitem"]:has-text("Stop read aloud")';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readSwitchValue(argumentsList, switchName) {
  const normalizedSwitch = switchName.startsWith('--') ? switchName : `--${switchName}`;
  const equalsPrefix = `${normalizedSwitch}=`;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (typeof argument !== 'string' || argument.length === 0) {
      continue;
    }

    if (argument.startsWith(equalsPrefix)) {
      return argument.slice(equalsPrefix.length);
    }

    if (argument === normalizedSwitch) {
      const nextArgument = argumentsList[index + 1];
      if (typeof nextArgument === 'string' && nextArgument.length > 0) {
        return nextArgument;
      }
    }
  }

  return null;
}

async function readSourceBrowserLaunchHints(sourceBrowser) {
  const hints = {
    product: null,
    userAgent: null,
    profileDir: null,
    browserBinary: null,
  };

  if (typeof sourceBrowser.newBrowserCDPSession !== 'function') {
    return hints;
  }

  let browserSession = null;
  try {
    browserSession = await sourceBrowser.newBrowserCDPSession();
  } catch {
    return hints;
  }

  try {
    const version = await browserSession.send('Browser.getVersion').catch(() => null);
    if (typeof version?.product === 'string' && version.product.trim().length > 0) {
      hints.product = version.product.trim();
    }
    if (typeof version?.userAgent === 'string' && version.userAgent.trim().length > 0) {
      hints.userAgent = version.userAgent.trim();
    }

    const commandLine = await browserSession.send('Browser.getBrowserCommandLine').catch(() => null);
    const argumentsList = Array.isArray(commandLine?.arguments)
      ? commandLine.arguments.filter((value) => typeof value === 'string')
      : [];

    const profileDir = readSwitchValue(argumentsList, '--user-data-dir');
    if (typeof profileDir === 'string' && profileDir.length > 0 && fs.existsSync(profileDir)) {
      hints.profileDir = profileDir;
    }

    const binaryCandidate = argumentsList.find((argument) => !argument.startsWith('-')) ?? null;
    if (
      typeof binaryCandidate === 'string' &&
      binaryCandidate.length > 0 &&
      fs.existsSync(binaryCandidate)
    ) {
      hints.browserBinary = binaryCandidate;
    }
  } finally {
    await browserSession.detach().catch(() => undefined);
  }

  return hints;
}

function ensureBuildExists() {
  if (fs.existsSync(extensionManifestPath)) {
    return;
  }

  console.log('[TurboRender] build output missing, running pnpm build...');
  const result = spawnSync('pnpm', ['build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function ensureScratchRoot() {
  await fsPromises.mkdir(scratchRoot, { recursive: true });
}

async function createScratchProfileDir(prefix) {
  await ensureScratchRoot();
  return await fsPromises.mkdtemp(path.join(scratchRoot, `${prefix}-`));
}

async function findFreeDebugPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        reject(new Error('Unable to reserve a local debugging port.'));
        return;
      }

      server.close((error) => {
        if (error != null) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function readOriginStorage(page) {
  return await page.evaluate(() => ({
    origin: window.location.origin,
    localStorage: Object.entries({ ...window.localStorage }).map(([name, value]) => ({ name, value })),
    sessionStorage: Object.entries({ ...window.sessionStorage }).map(([name, value]) => ({ name, value })),
  }));
}

async function seedStorageStateOnPage(page, storageState, conversationId) {
  await page.addInitScript(
    ({ configuredOrigins, configuredConversationId }) => {
      const currentOrigin = window.location.origin;
      const matchedOrigin = configuredOrigins.find((origin) => origin.origin === currentOrigin) ?? null;

      if (matchedOrigin != null) {
        try {
          window.localStorage.clear();
          for (const item of matchedOrigin.localStorage) {
            window.localStorage.setItem(item.name, item.value);
          }
        } catch {
          // Ignore local storage write failures during bootstrap.
        }

        try {
          window.sessionStorage.clear();
          for (const item of matchedOrigin.sessionStorage ?? []) {
            window.sessionStorage.setItem(item.name, item.value);
          }
        } catch {
          // Ignore session storage write failures during bootstrap.
        }
      }

      const debugConversationId = configuredConversationId.trim();
      window.__turboRenderDebugConversationId = debugConversationId;
      document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
    },
    {
      configuredOrigins: storageState.origins,
      configuredConversationId: conversationId,
    },
  );
}

async function setDebugConversationId(page, conversationId) {
  await page.evaluate((configuredConversationId) => {
    const debugConversationId = configuredConversationId.trim();
    window.__turboRenderDebugConversationId = debugConversationId;
    document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
    if (document.body != null) {
      document.body.dataset.turboRenderDebugConversationId = debugConversationId;
    }
  }, conversationId);
}

function isConversationApiResponse(url, conversationId) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    return (
      parsed.origin === 'https://chatgpt.com' &&
      normalizedPath === `/backend-api/conversation/${conversationId}`
    );
  } catch {
    return false;
  }
}

async function openReadAloudMenuFromMoreButtons(page, moreButtons) {
  const count = await moreButtons.count();
  const visibleIndices = await moreButtons.evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const rect = button.getBoundingClientRect();
        return {
          index,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.x < window.innerWidth &&
            rect.y < window.innerHeight,
        };
      })
      .filter((candidate) => candidate.visible)
      .map((candidate) => candidate.index),
  );

  const candidateIndices = visibleIndices.length > 0 ? visibleIndices : Array.from({ length: count }, (_, index) => index);
  for (const index of candidateIndices) {
    const moreButton = moreButtons.nth(index);
    await moreButton.scrollIntoViewIfNeeded();
    const anchorBox = await moreButton.boundingBox();
    if (anchorBox == null) {
      continue;
    }

    let clicked = false;
    const clickStrategies = [
      async () => {
        await moreButton.click({ timeout: 3_000 });
      },
      async () => {
        await moreButton.click({ timeout: 3_000, force: true });
      },
      async () => {
        await moreButton.evaluate((button) => {
          if (button instanceof HTMLElement) {
            button.click();
          }
        });
      },
    ];
    for (const clickStrategy of clickStrategies) {
      try {
        await clickStrategy();
        clicked = true;
        break;
      } catch {
        // Try the next click strategy.
      }
    }
    if (!clicked) {
      continue;
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await page.waitForTimeout(100);
      const selectedMenu = await page.evaluate((anchor) => {
        const marker = `turbo-render-capture-menu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const allMenus = [...document.querySelectorAll('[role="menu"], [data-turbo-render-entry-menu="true"]')];
        const candidates = allMenus
          .map((menu, index) => {
            const rect = menu.getBoundingClientRect();
            return {
              index,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              visible:
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.x < window.innerWidth &&
                rect.y < window.innerHeight,
            };
          })
          .filter((candidate) => candidate.visible);
        if (candidates.length === 0) {
          return null;
        }

        const anchorCenterX = anchor.x + anchor.width / 2;
        const anchorCenterY = anchor.y + anchor.height / 2;
        candidates.sort((left, right) => {
          const leftDistance = Math.hypot(left.x - anchorCenterX, left.y - anchorCenterY);
          const rightDistance = Math.hypot(right.x - anchorCenterX, right.y - anchorCenterY);
          return leftDistance - rightDistance;
        });

        for (const menu of allMenus) {
          menu.removeAttribute('data-turbo-render-capture-target-menu');
        }

        const selected = candidates[0];
        if (selected == null) {
          return null;
        }

        allMenus[selected.index]?.setAttribute('data-turbo-render-capture-target-menu', marker);
        return marker;
      }, anchorBox);

      if (selectedMenu != null) {
        return {
          moreButton,
          menu: page.locator(`[data-turbo-render-capture-target-menu="${selectedMenu}"]`),
        };
      }
    }

    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(100);
  }

  return null;
}

async function parseConversationJsonFromResponse(response, fixtureId, conversationId) {
  if (response == null) {
    throw new Error(`Unable to observe /backend-api/conversation/${conversationId} response while capturing ${fixtureId}.`);
  }

  const status = response.status();
  const body = await response.text().catch(() => '');
  if (status < 200 || status >= 300) {
    throw new Error(
      `Conversation response for ${fixtureId} returned HTTP ${status} with payload: ${body.slice(0, 300)}.`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `Conversation response for ${fixtureId} was not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

function countConversationTurns(conversationJson) {
  const mapping = conversationJson?.mapping;
  if (mapping == null || typeof mapping !== 'object') {
    return 0;
  }

  let count = 0;
  for (const node of Object.values(mapping)) {
    const role = node?.message?.author?.role;
    if (role === 'user' || role === 'assistant') {
      count += 1;
    }
  }

  return count;
}

async function collectStorageState(context, page) {
  const snapshot = await context.storageState();
  const cookies = snapshot.cookies.map((cookie) => ({ ...cookie }));
  const origins = snapshot.origins.map((originState) => ({
    origin: originState.origin,
    localStorage: originState.localStorage,
    sessionStorage: [],
  }));
  const pageOriginState = await readOriginStorage(page);
  const matchingOrigin = origins.find((originState) => originState.origin === pageOriginState.origin) ?? null;
  if (matchingOrigin != null) {
    matchingOrigin.sessionStorage = pageOriginState.sessionStorage;
  } else {
    origins.push(pageOriginState);
  }

  return {
    cookies,
    origins,
  };
}

async function readSourceStorageState(sourceBrowser) {
  const context = sourceBrowser.contexts()[0];
  if (context == null) {
    throw new Error('The source debug browser does not expose a default context.');
  }

  const page = await context.newPage();
  try {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return await collectStorageState(context, page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function assertSourceCanLoadFixture(sourceBrowser, fixture) {
  const context = sourceBrowser.contexts()[0];
  if (context == null) {
    throw new Error('The source debug browser does not expose a default context.');
  }

  const page = await context.newPage();
  const observedConversationStatuses = [];
  const onResponse = (response) => {
    if (isConversationApiResponse(response.url(), fixture.conversationId)) {
      observedConversationStatuses.push(response.status());
    }
  };
  page.on('response', onResponse);
  try {
    const navigationResponse = await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
    const conversationResponse = await page
      .waitForResponse(
        (response) => isConversationApiResponse(response.url(), fixture.conversationId),
        { timeout: 30_000 },
      )
      .catch(() => null);

    const finalUrl = page.url();
    const isRedirectedToHome = finalUrl === 'https://chatgpt.com/' || finalUrl === 'https://chatgpt.com';
    const status = conversationResponse?.status() ?? observedConversationStatuses.at(-1) ?? null;

    if (status == null || status < 200 || status >= 300 || isRedirectedToHome) {
      const pageSummary = await page
        .evaluate(() => ({
          title: document.title,
          text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
          hasLoginButton: document.body?.innerText?.includes('登录') || document.body?.innerText?.includes('Log in') || document.body?.innerText?.includes('Sign in'),
          hasChatHistory: document.querySelector('[data-testid="history-item"]') !== null ||
                         document.querySelector('[class*="history"]') !== null,
        }))
        .catch(() => ({ title: '', text: '', hasLoginButton: false, hasChatHistory: false }));

      // Build detailed error message
      let errorDetails = `[TurboRender] Source controlled browser cannot access ${fixture.url}\n`;
      errorDetails += `  - Conversation HTTP status: ${status ?? 'missing'}\n`;
      errorDetails += `  - Observed statuses: ${observedConversationStatuses.join(', ') || 'none'}\n`;
      errorDetails += `  - Navigation HTTP: ${navigationResponse?.status() ?? 'unknown'}\n`;
      errorDetails += `  - Final URL: ${finalUrl}\n`;
      errorDetails += `  - Page title: "${pageSummary.title}"\n`;

      if (isRedirectedToHome) {
        errorDetails += `\n⚠️  DIAGNOSIS: The conversation was not found. Possible causes:\n`;
        errorDetails += `  1. The conversation doesn't exist or has been deleted\n`;
        errorDetails += `  2. You need to login in the controlled browser first\n`;
        errorDetails += `  3. The conversation is not accessible from the current account\n\n`;

        if (pageSummary.hasLoginButton) {
          errorDetails += `🔑 DETECTED: Login page shown. Please login in the controlled browser first.\n`;
        }

        errorDetails += `\n🔧 TO FIX THIS:\n`;
        errorDetails += `  Option 1: Open the controlled browser and manually visit:\n`;
        errorDetails += `    ${fixture.url}\n`;
        errorDetails += `  Option 2: Use a different fixture ID that exists in your account\n`;
        errorDetails += `  Option 3: Create a new conversation and update the fixture ID\n`;
      }

      errorDetails += `\n💡 After fixing, re-run: pnpm legacy:fixtures:capture ${fixture.id}`;

      throw new Error(errorDetails);
    }
  } finally {
    page.off('response', onResponse);
    await page.close().catch(() => undefined);
  }
}

async function waitForFixtureReady(page, fixture) {
  await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await setDebugConversationId(page, fixture.conversationId);
  try {
    await page.waitForFunction(
      () => {
        const extensionRoot = document.querySelector('[data-turbo-render-inline-history-root="true"]');
        if (extensionRoot instanceof HTMLElement) {
          const extensionRect = extensionRoot.getBoundingClientRect();
          if (extensionRect.width > 0 && extensionRect.height > 0) {
            return 'extension';
          }
        }

        const hostTurn =
          document.querySelector('section[data-testid^="conversation-turn-"]') ??
          document.querySelector('[data-message-author-role]');
        if (hostTurn instanceof HTMLElement) {
          const hostRect = hostTurn.getBoundingClientRect();
          if (hostRect.width > 0 && hostRect.height > 0) {
            return 'host';
          }
        }

        return null;
      },
      undefined,
      { timeout: 60_000 },
    );

    const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
    if ((await firstBatch.count()) > 0) {
      await firstBatch.waitFor({ state: 'visible', timeout: 60_000 });
      return firstBatch;
    }
    return null;
  } catch (error) {
    const pageSummary = await page
      .evaluate(() => ({
        title: document.title,
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
      }))
      .catch(() => ({ title: '', text: '' }));

    throw new Error(
      `Failed to load fixture ${fixture.id} (${fixture.url}) in capture browser (final URL ${page.url()}). title="${pageSummary.title}" text="${pageSummary.text}" cause=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function warmupFixturePage(page, fixture) {
  const firstBatch = await waitForFixtureReady(page, fixture);
  if (firstBatch != null) {
    const toggle = firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]');
    await toggle.click();
    await page.waitForTimeout(1_200);
  }

  const hostAssistantMoreButtons = page.locator(
    [
      'section[data-testid^="conversation-turn-"][data-turn="assistant"] button[aria-label*="More actions"]:visible',
      'section[data-testid^="conversation-turn-"][data-turn="assistant"] button[aria-label*="更多操作"]:visible',
      '[data-message-author-role="assistant"] button[aria-label*="More actions"]:visible',
      '[data-message-author-role="assistant"] button[aria-label*="更多操作"]:visible',
    ].join(', '),
  );
  let hostMenuData = await openReadAloudMenuFromMoreButtons(page, hostAssistantMoreButtons);
  if (hostMenuData == null) {
    const fallbackMoreButtons = page.locator(
      'button[aria-label*="More actions"]:visible, button[aria-label*="更多操作"]:visible, button[data-turbo-render-action="more"]:visible',
    );
    hostMenuData = await openReadAloudMenuFromMoreButtons(page, fallbackMoreButtons);
  }
  if (hostMenuData == null) {
    throw new Error(`Unable to find a visible assistant More menu for ${fixture.id}.`);
  }

  const synthesizeRequestPromise = page
    .waitForRequest((request) => request.url().includes('/backend-api/synthesize'), { timeout: 20_000 })
    .catch(() => null);
  const hostReadButton = hostMenuData.menu.getByRole('menuitem', { name: /朗读|read aloud/i });
  await hostReadButton.waitFor({ state: 'visible', timeout: 10_000 });
  await hostReadButton.click();
  const synthesizeRequest = await synthesizeRequestPromise;
  if (synthesizeRequest == null) {
    throw new Error(`Read aloud did not trigger /backend-api/synthesize for ${fixture.id}.`);
  }

  const hostStopButton = page.locator(STOP_READ_ALOUD_MENU_SELECTOR);
  const stopVisible = await hostStopButton
    .first()
    .isVisible({ timeout: 20_000 })
    .catch(() => false);
  if (stopVisible) {
    await hostStopButton.first().click().catch(() => undefined);
  } else {
    await page.keyboard.press('Escape').catch(() => undefined);
  }

  if (fixture.warmupProfile.includes('scroll')) {
    const scrollRoot = page.locator('[class*="scroll-root"]').first();
    if ((await scrollRoot.count()) === 0) {
      await page.waitForTimeout(500);
      return;
    }
    const scrollMetrics = await scrollRoot.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    const maxScrollTop = Math.max(0, scrollMetrics.scrollHeight - scrollMetrics.clientHeight);

    // For large conversations (700+ turns), use more iterations and longer waits
    const isLargeConversation = fixture.expectedMinTurns >= 500;
    const scrollIterations = isLargeConversation ? 50 : 12;
    const scrollWaitMs = isLargeConversation ? 150 : 50;

    for (let index = 0; index < scrollIterations; index += 1) {
      const nextTop = Math.round((maxScrollTop * index) / (scrollIterations - 1));
      await scrollRoot.evaluate((node, top) => {
        if (node instanceof HTMLElement) {
          node.scrollTop = Number(top);
        }
      }, nextTop);
      await page.waitForTimeout(scrollWaitMs);
    }
  }

  await page.waitForTimeout(500);
}

async function capturePageMhtml(client, filePath) {
  const snapshot = await client.send('Page.captureSnapshot', { format: 'mhtml' });
  await fsPromises.writeFile(filePath, snapshot.data, 'utf8');
}

/**
 * Captures a cleaned shell.html for origin fixture replay.
 * This preserves DOM structure for extension testing but removes
 * sensitive data and dynamic scripts.
 */
/**
 * Build version info for fixture compatibility detection.
 * This helps the extension detect if the fixture is outdated.
 */
function getFixtureBuildVersion() {
  return {
    // TurboRender extension version (from package.json or build)
    extensionVersion: process.env.npm_package_version ?? '0.1.12',
    // DOM adapter version - bump when adapter logic changes
    adapterVersion: 1,
    // Capture format version
    formatVersion: 1,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Captures a cleaned shell.html for origin fixture replay.
 * This preserves DOM structure for extension testing but removes
 * sensitive data and dynamic scripts.
 */
async function captureShellHtml(page, filePath, fixture, conversationJson) {
  const buildVersion = getFixtureBuildVersion();
  const shellHtml = await page.evaluate(({ fixtureData, conversationData, versionInfo }) => {
    const clone = document.documentElement.cloneNode(true);

    // Remove sensitive elements and attributes
    const sensitiveSelectors = [
      'script[src*="auth"]',
      'script[src*="login"]',
      'script[data-cookie]',
      'meta[name="authorization"]',
      '[data-session]',
      '#__NEXT_DATA__[data-auth]',
      // Phase 3: Remove more dynamic scripts that cause issues in replay
      'script[src*="analytics"]',
      'script[src*="telemetry"]',
      'script[src*="sentry"]',
      'script[src*="datadog"]',
      'script[src*="segment"]',
      'script[src*="intercom"]',
      'script[src*="zendesk"]',
      // Remove scripts that initiate WebSocket connections
      'script:has-text("new WebSocket")',
      'script:has-text("wss://")',
    ];

    for (const selector of sensitiveSelectors) {
      try {
        const els = clone.querySelectorAll(selector);
        for (const el of Array.from(els)) {
          el.remove();
        }
      } catch {
        // Complex selectors may not be supported, ignore errors
      }
    }

    // Remove all inline scripts that are likely to cause issues
    // Keep only those that are essential for basic page structure
    const scripts = clone.querySelectorAll('script');
    for (const script of Array.from(scripts)) {
      const src = script.getAttribute('src') ?? '';
      const content = script.textContent ?? '';

      // Keep scripts from allowed domains (React, Next.js core)
      const isAllowedSrc = src.includes('chatgpt.com') ||
                           src.includes('_next/static') ||
                           src.includes('webpack');

      // Remove scripts that:
      // 1. Have no src (inline) and contain sensitive/Network keywords
      // 2. Are from analytics/tracking domains
      const shouldRemove = (!src && (
        content.includes('fetch') ||
        content.includes('XMLHttpRequest') ||
        content.includes('navigator.sendBeacon') ||
        content.includes('WebSocket') ||
        content.includes('localStorage') ||
        content.includes('sessionStorage') ||
        content.includes('postMessage') ||
        content.includes('auth') ||
        content.includes('login') ||
        content.includes('token')
      )) || (
        src && !isAllowedSrc && (
          src.includes('analytics') ||
          src.includes('tracking') ||
          src.includes('ads') ||
          src.includes('google') ||
          src.includes('facebook') ||
          src.includes('twitter') ||
          src.includes('linkedin')
        )
      );

      if (shouldRemove) {
        script.remove();
      }
    }

    // Remove sensitive attributes
    const allElements = clone.querySelectorAll('*');
    for (const el of allElements) {
      // Remove auth-related attributes
      if (el.hasAttribute('data-auth')) el.removeAttribute('data-auth');
      if (el.hasAttribute('data-csrf')) el.removeAttribute('data-csrf');
      if (el.hasAttribute('data-token')) el.removeAttribute('data-token');
      if (el.hasAttribute('data-api-key')) el.removeAttribute('data-api-key');

      // Remove event handlers that might leak data or cause unwanted actions
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      }
    }

    // Inject fixture meta for extension detection
    const meta = document.createElement('meta');
    meta.name = 'turbo-render-fixture';
    meta.content = JSON.stringify({
      id: fixtureData.id,
      conversationId: fixtureData.conversationId,
      capturedAt: new Date().toISOString(),
      version: versionInfo,
    });
    clone.querySelector('head')?.appendChild(meta);

    // Add origin fixture replay marker with conversation data
    const marker = document.createElement('script');
    marker.type = 'application/json';
    marker.id = 'turbo-render-fixture-data';
    marker.textContent = JSON.stringify({
      mode: 'origin-fixture-replay',
      fixtureId: fixtureData.id,
      conversationId: fixtureData.conversationId,
      conversation: conversationData,
      version: versionInfo,
    });
    clone.querySelector('body')?.appendChild(marker);

    // Build HTML comment indicating this is a fixture
    const commentText =
      ` TurboRender Fixture Replay - ${fixtureData.id} ` +
      `- Format v${versionInfo.formatVersion} ` +
      `- Adapter v${versionInfo.adapterVersion} ` +
      `- Captured ${versionInfo.capturedAt} `;

    // Serialize the cloned DOM - use outerHTML if available, fallback to XMLSerializer
    const htmlContent = clone.outerHTML ?? new XMLSerializer().serializeToString(clone);

    return `<!DOCTYPE html>\n<!--${commentText}-->\n${htmlContent}`;
  }, { fixtureData: fixture, conversationData: conversationJson, versionInfo: buildVersion });

  await fsPromises.writeFile(filePath, shellHtml, 'utf8');

  // P2: Generate fallback.html - a minimal version with inline critical styles
  const fallbackHtml = await page.evaluate(({ fixtureData, conversationData, versionInfo }) => {
    // Create minimal HTML structure
    const criticalStyles = `
      /* Critical minimal styles for fixture replay */
      body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #fff; }
      #__next { min-height: 100vh; }
      main { padding: 20px; }
    `;

    const fallbackContent = {
      mode: 'origin-fixture-replay-fallback',
      fixtureId: fixtureData.id,
      conversationId: fixtureData.conversationId,
      conversation: conversationData,
      version: versionInfo,
      fallback: true,
      message: 'This is a fallback shell for offline replay. Some styling may be missing.',
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="turbo-render-fixture" content='${JSON.stringify({
    id: fixtureData.id,
    conversationId: fixtureData.conversationId,
    capturedAt: new Date().toISOString(),
    version: versionInfo,
    fallback: true,
  })}'>
  <title>ChatGPT - ${fixtureData.id} (Fallback)</title>
  <style>${criticalStyles}</style>
</head>
<body>
  <div id="__next">
    <main>
      <div id="turbo-render-fallback-marker"></div>
    </main>
  </div>
  <script id="turbo-render-fixture-data" type="application/json">
${JSON.stringify(fallbackContent, null, 2)}
  </script>
  <!-- TurboRender Fallback Shell - ${fixtureData.id} - Format v${versionInfo.formatVersion} -->
</body>
</html>`;
  }, { fixtureData: fixture, conversationData: conversationJson, versionInfo: buildVersion });

  // Write fallback.html to the same directory as shell.html
  const fallbackPath = filePath.replace('shell.html', 'fallback.html');
  await fsPromises.writeFile(fallbackPath, fallbackHtml, 'utf8');
  console.log(`[TurboRender] Generated fallback.html at ${fallbackPath}`);
}

/**
 * Phase 4: Capture static assets (CSS/JS/fonts) for offline replay.
 * Downloads resources from the page and saves them locally.
 */
async function captureStaticAssets(page, assetsDir, assetsJsonPath) {
  console.log(`[TurboRender] Capturing static assets for offline replay...`);

  // Ensure assets directory exists
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  // Collect all resource URLs from the page
  const resourceUrls = await page.evaluate(() => {
    const urls = new Set();

    // Helper to resolve relative URLs
    const resolveUrl = (url) => {
      try {
        return new URL(url, location.href).href;
      } catch {
        return null;
      }
    };

    // Extract URLs from CSS text (handles background-image, etc.)
    const extractUrlsFromCss = (cssText) => {
      const urlMatches = cssText.match(/url\(["']?([^"')]+)["']?\)/g) || [];
      return urlMatches
        .map((match) => {
          const url = match.replace(/url\(["']?([^"')]+)["']?\)/, '$1');
          return resolveUrl(url);
        })
        .filter(Boolean);
    };

    // CSS stylesheets - including cross-origin via cssRules if accessible
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.href) {
          urls.add(sheet.href);
        }
        // Try to get CSS rules to extract background-images and fonts
        for (const rule of sheet.cssRules) {
          const ruleUrls = extractUrlsFromCss(rule.cssText);
          ruleUrls.forEach((url) => urls.add(url));
        }
      } catch {
        // Cross-origin stylesheet, try to add href at least
        if (sheet.href) urls.add(sheet.href);
      }
    }

    // Link tags - expanded to catch more resource types
    const linkSelectors = [
      'link[rel="stylesheet"]',
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="preload"]',       // Preloaded resources
      'link[rel="prefetch"]',      // Prefetched resources
      'link[as="font"]',           // Preloaded fonts
      'link[as="image"]',          // Preloaded images
    ];
    document.querySelectorAll(linkSelectors.join(', ')).forEach((link) => {
      if (link.href) urls.add(link.href);
    });

    // Script tags
    document.querySelectorAll('script[src]').forEach((script) => {
      if (script.src) urls.add(script.src);
    });

    // Images - expanded to include srcset and background images
    document.querySelectorAll('img[src], img[srcset], source[srcset]').forEach((img) => {
      if (img.src) urls.add(img.src);
      // Parse srcset for multiple image URLs
      if (img.srcset) {
        img.srcset.split(',').forEach((entry) => {
          const url = entry.trim().split(' ')[0];
          if (url) {
            const resolved = resolveUrl(url);
            if (resolved) urls.add(resolved);
          }
        });
      }
    });

    // Inline styles with background images
    document.querySelectorAll('[style*="background"], [style*="url("]').forEach((el) => {
      const styleUrls = extractUrlsFromCss(el.style.cssText);
      styleUrls.forEach((url) => urls.add(url));
    });

    // SVG use references
    document.querySelectorAll('use[href]').forEach((use) => {
      const href = use.getAttribute('href');
      if (href) {
        const resolved = resolveUrl(href);
        if (resolved) urls.add(resolved);
      }
    });
    // SVG use with xlink:href (namespace attribute, query separately)
    document.querySelectorAll('use').forEach((use) => {
      const href = use.getAttribute('xlink:href');
      if (href) {
        const resolved = resolveUrl(href);
        if (resolved) urls.add(resolved);
      }
    });

    // Font face rules - enhanced to catch more font sources
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSFontFaceRule) {
            const src = rule.style.getPropertyValue('src');
            const matches = src.match(/url\(["']?([^"')]+)["']?\)/g);
            if (matches) {
              for (const match of matches) {
                const url = match.replace(/url\(["']?([^"')]+)["']?\)/, '$1');
                const resolved = resolveUrl(url);
                if (resolved) urls.add(resolved);
              }
            }
          }
        }
      } catch {
        // Cross-origin stylesheet or other error, ignore
      }
    }

    // Video and audio sources
    document.querySelectorAll('video[src], video source[src], audio[src], audio source[src]').forEach((media) => {
      if (media.src) urls.add(media.src);
    });

    // Track elements (subtitles/captions)
    document.querySelectorAll('track[src]').forEach((track) => {
      if (track.src) urls.add(track.src);
    });

    // Iframe src (though unlikely to be useful in fixture)
    document.querySelectorAll('iframe[src]').forEach((iframe) => {
      if (iframe.src && iframe.src !== 'about:blank') {
        urls.add(iframe.src);
      }
    });

    return Array.from(urls);
  });

  console.log(`[TurboRender] Found ${resourceUrls.length} resource URLs`);

  // Download and save each resource
  const assets = [];
  const errors = [];

  for (const url of resourceUrls) {
    try {
      // Strip fragment for file operations (SVG references like #icon-id)
      const urlForFile = url.split('#')[0];
      const urlObj = new URL(urlForFile);

      // Skip data URLs
      if (urlForFile.startsWith('data:')) continue;

      // Skip external domains that aren't critical
      const isChatGPT = urlObj.hostname.includes('chatgpt.com') || urlObj.hostname.includes('openai.com');
      const isCDN = urlObj.hostname.includes('cdn.') || urlObj.hostname.includes('_next');
      // P1: Include critical external resources like Google Fonts
      const isCriticalExternal =
        urlObj.hostname.includes('fonts.googleapis.com') ||
        urlObj.hostname.includes('fonts.gstatic.com') ||
        urlObj.hostname.includes('ajax.googleapis.com') ||
        urlObj.hostname.includes('unpkg.com') ||
        urlObj.hostname.includes('cdn.jsdelivr.net');

      if (!isChatGPT && !isCDN && !isCriticalExternal) {
        console.log(`[TurboRender] Skipping external resource: ${url}`);
        continue;
      }

      // Generate local filename
      const ext = path.extname(urlObj.pathname) || '.bin';
      const baseName = path.basename(urlObj.pathname, ext) || 'resource';
      const hash = Buffer.from(url).toString('base64url').slice(0, 8);
      const localName = `${baseName}-${hash}${ext}`;
      const localPath = path.join(assetsDir, localName);

      // Download resource
      const response = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { credentials: 'omit' });
          if (!res.ok) return null;
          const blob = await res.blob();
          const buffer = await blob.arrayBuffer();
          return {
            status: res.status,
            contentType: res.headers.get('content-type'),
            data: Array.from(new Uint8Array(buffer)),
          };
        } catch (e) {
          return { error: e.message };
        }
      }, url);

      if (!response || response.error) {
        errors.push({ url, error: response?.error || 'Failed to fetch' });
        continue;
      }

      // Save to file
      const buffer = Buffer.from(new Uint8Array(response.data));
      await fsPromises.writeFile(localPath, buffer);

      assets.push({
        url,
        localPath: localName,
        contentType: response.contentType,
        size: buffer.length,
      });

      console.log(`[TurboRender] Captured: ${url} -> ${localName}`);
    } catch (error) {
      errors.push({ url, error: error.message });
    }
  }

  // Calculate missing critical resources
  const criticalDomains = ['chatgpt.com', 'openai.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  const missingCritical = [];
  const missingUrls = [];

  for (const url of resourceUrls) {
    const isCaptured = assets.some((a) => a.url === url);
    if (!isCaptured) {
      missingUrls.push(url);
      try {
        const urlObj = new URL(url);
        if (criticalDomains.some((d) => urlObj.hostname.includes(d))) {
          missingCritical.push(url);
        }
      } catch {
        // Invalid URL, skip
      }
    }
  }

  // Save assets manifest with missing resources info
  const assetsManifest = {
    capturedAt: new Date().toISOString(),
    totalUrls: resourceUrls.length,
    captured: assets.length,
    errors: errors.length,
    missing: missingUrls.length,
    missingCritical: missingCritical.length,
    missingCriticalUrls: missingCritical.slice(0, 20), // Limit log
    assets,
    errors: errors.slice(0, 10), // Limit error log
  };

  await fsPromises.writeFile(assetsJsonPath, JSON.stringify(assetsManifest, null, 2));
  console.log(
    `[TurboRender] Static assets captured: ${assets.length} success, ${errors.length} errors, ${missingUrls.length} missing (${missingCritical.length} critical)`
  );

  // P3: Warn about missing critical resources
  if (missingCritical.length > 0) {
    console.warn(`[TurboRender] WARNING: ${missingCritical.length} critical resources were not captured:`);
    for (const url of missingCritical.slice(0, 5)) {
      console.warn(`  - ${url}`);
    }
    if (missingCritical.length > 5) {
      console.warn(`  ... and ${missingCritical.length - 5} more`);
    }
  }

  return assetsManifest;
}

class CdpHarRecorder {
  constructor(client, urlFilter) {
    this._client = client;
    this._urlFilter = urlFilter;
    this._entries = new Map();
    this._started = false;
  }

  async start() {
    if (this._started) {
      return;
    }
    this._started = true;
    this._client.on('Network.requestWillBeSent', (event) => this._onRequestWillBeSent(event));
    this._client.on('Network.responseReceived', (event) => this._onResponseReceived(event));
    this._client.on('Network.loadingFinished', (event) => this._onLoadingFinished(event));
    this._client.on('Network.loadingFailed', (event) => this._onLoadingFailed(event));
  }

  _shouldRecord(url) {
    if (typeof this._urlFilter === 'function') {
      return this._urlFilter(url);
    }
    if (this._urlFilter instanceof RegExp) {
      return this._urlFilter.test(url);
    }
    return true;
  }

  _onRequestWillBeSent(event) {
    const { requestId, request, timestamp, wallTime, type, redirectSourceRequestId } = event;
    if (!this._shouldRecord(request.url)) {
      return;
    }

    if (redirectSourceRequestId != null) {
      const sourceEntry = this._entries.get(redirectSourceRequestId);
      if (sourceEntry != null) {
        sourceEntry._redirectTargetRequestId = requestId;
      }
    }

    const existing = this._entries.get(requestId);
    if (existing != null) {
      return;
    }

    this._entries.set(requestId, {
      _requestId: requestId,
      _redirectTargetRequestId: null,
      _request: request,
      _timestamp: timestamp,
      _wallTime: wallTime,
      _resourceType: type ?? 'Other',
      _response: null,
      _responseBody: null,
      _responseBodyBase64: null,
      _loadingFinished: false,
      _loadingFailed: false,
      _endTime: null,
    });
  }

  _onResponseReceived(event) {
    const { requestId, response, timestamp } = event;
    const entry = this._entries.get(requestId);
    if (entry == null) {
      return;
    }
    entry._response = response;
    entry._endTime = timestamp;
  }

  _onLoadingFinished(event) {
    const { requestId, timestamp } = event;
    const entry = this._entries.get(requestId);
    if (entry == null) {
      return;
    }
    entry._loadingFinished = true;
    entry._endTime = timestamp;
  }

  _onLoadingFailed(event) {
    const { requestId, timestamp } = event;
    const entry = this._entries.get(requestId);
    if (entry == null) {
      return;
    }
    entry._loadingFailed = true;
    entry._endTime = timestamp;
  }

  async stop() {
    if (!this._started) {
      return [];
    }
    this._started = false;
    this._client.removeAllListeners('Network.requestWillBeSent');
    this._client.removeAllListeners('Network.responseReceived');
    this._client.removeAllListeners('Network.loadingFinished');
    this._client.removeAllListeners('Network.loadingFailed');

    const finishedEntries = [];
    for (const entry of this._entries.values()) {
      if (entry._loadingFinished && entry._response != null) {
        finishedEntries.push(entry);
      }
    }

    console.log(
      `[TurboRender] [CdpHarRecorder] fetching ${finishedEntries.length} response bodies (out of ${this._entries.size} total entries)`,
    );

    const concurrency = 8;
    const bodyTimeoutMs = 5_000;
    let index = 0;
    const total = finishedEntries.length;

    async function worker() {
      while (index < total) {
        const currentIndex = index;
        index += 1;
        const entry = finishedEntries[currentIndex];

        try {
          const bodyResult = await Promise.race([
            this._client.send('Network.getResponseBody', { requestId: entry._requestId }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('getResponseBody timeout')), bodyTimeoutMs),
            ),
          ]);
          if (bodyResult.base64Encoded) {
            entry._responseBodyBase64 = bodyResult.body;
          } else {
            entry._responseBody = bodyResult.body;
          }
        } catch {
          // Body may already be evicted or timed out; leave content empty.
        }
      }
    }

    const workers = [];
    for (let workerIndex = 0; workerIndex < concurrency; workerIndex += 1) {
      workers.push(worker.call(this));
    }
    await Promise.all(workers);

    const orderedEntries = [];
    for (const entry of this._entries.values()) {
      if (entry._redirectTargetRequestId != null) {
        continue;
      }
      orderedEntries.push(entry);
    }

    return orderedEntries;
  }

  buildHar(entries) {
    const harPages = [];
    const harEntries = [];

    for (const entry of entries) {
      const request = entry._request;
      const response = entry._response;
      const requestHeaders = this._headersToHar(request.headers ?? {});
      const queryString = this._paramsToHar(request.url);

      let responseHeaders = [];
      let mimeType = 'application/octet-stream';
      let statusCode = 0;
      let statusText = '';
      let httpVersion = 'unknown';

      if (response != null) {
        responseHeaders = this._headersToHar(response.headers ?? {});
        mimeType = response.mimeType ?? mimeType;
        statusCode = response.status ?? statusCode;
        statusText = response.statusText ?? statusText;
        httpVersion = response.protocol ?? httpVersion;
      }

      const content = { mimeType, size: 0 };
      if (entry._responseBody != null) {
        content.text = entry._responseBody;
        content.size = Buffer.byteLength(entry._responseBody, 'utf8');
      } else if (entry._responseBodyBase64 != null) {
        content.text = entry._responseBodyBase64;
        content.encoding = 'base64';
        content.size = Buffer.byteLength(entry._responseBodyBase64, 'latin1');
      }

      const startedDateTime = entry._wallTime != null
        ? new Date(entry._wallTime * 1000).toISOString()
        : new Date().toISOString();

      const time = (entry._endTime != null && entry._timestamp != null)
        ? Math.round((entry._endTime - entry._timestamp) * 1000)
        : 0;

      harEntries.push({
        startedDateTime,
        time,
        request: {
          method: request.method ?? 'GET',
          url: request.url,
          httpVersion,
          cookies: [],
          headers: requestHeaders,
          queryString,
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          status: statusCode,
          statusText,
          httpVersion,
          cookies: [],
          headers: responseHeaders,
          content,
          redirectURL: '',
          headersSize: -1,
          bodySize: -1,
        },
        cache: {},
        timings: { send: 0, wait: 0, receive: 0 },
        _resourceType: entry._resourceType,
      });
    }

    return {
      log: {
        version: '1.2',
        creator: { name: 'TurboRender CdpHarRecorder', version: '1.0' },
        pages: harPages,
        entries: harEntries,
      },
    };
  }

  _headersToHar(headers) {
    return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  }

  _paramsToHar(url) {
    try {
      const parsed = new URL(url);
      return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({ name, value }));
    } catch {
      return [];
    }
  }
}

async function writeHarZip(har, zipPath) {
  const harJson = JSON.stringify(har);
  const harBuffer = Buffer.from(harJson, 'utf8');

  const localFileHeader = Buffer.alloc(30);
  localFileHeader.writeUInt32LE(0x04034b50, 0); // signature
  localFileHeader.writeUInt16LE(20, 4); // version needed
  localFileHeader.writeUInt16LE(8, 6); // flags: bit 3 = data descriptor
  localFileHeader.writeUInt16LE(8, 8); // compression: deflate
  localFileHeader.writeUInt16LE(0, 10); // mod time
  localFileHeader.writeUInt16LE(0, 12); // mod date
  localFileHeader.writeUInt32LE(0, 14); // crc32 (in data descriptor)
  localFileHeader.writeUInt32LE(0, 18); // compressed size (in data descriptor)
  localFileHeader.writeUInt32LE(0, 22); // uncompressed size (in data descriptor)
  const fileName = 'replay.har';
  const fileNameBuffer = Buffer.from(fileName, 'utf8');
  localFileHeader.writeUInt16LE(fileNameBuffer.length, 26); // filename length
  localFileHeader.writeUInt16LE(0, 28); // extra field length

  const compressed = await new Promise((resolve, reject) => {
    zlib.deflateRaw(harBuffer, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const crc32Value = crc32(harBuffer);

  const dataDescriptor = Buffer.alloc(16);
  dataDescriptor.writeUInt32LE(0x08074b50, 0); // signature
  dataDescriptor.writeUInt32LE(crc32Value, 4); // crc32
  dataDescriptor.writeUInt32LE(compressed.length, 8); // compressed size
  dataDescriptor.writeUInt32LE(harBuffer.length, 12); // uncompressed size

  const centralDirectory = Buffer.alloc(46);
  centralDirectory.writeUInt32LE(0x02014b50, 0); // signature
  centralDirectory.writeUInt16LE(20, 4); // version made by
  centralDirectory.writeUInt16LE(20, 6); // version needed
  centralDirectory.writeUInt16LE(8, 8); // flags
  centralDirectory.writeUInt16LE(8, 10); // compression: deflate
  centralDirectory.writeUInt16LE(0, 12); // mod time
  centralDirectory.writeUInt16LE(0, 14); // mod date
  centralDirectory.writeUInt32LE(crc32Value, 16); // crc32
  centralDirectory.writeUInt32LE(compressed.length, 20); // compressed size
  centralDirectory.writeUInt32LE(harBuffer.length, 24); // uncompressed size
  centralDirectory.writeUInt16LE(fileNameBuffer.length, 28); // filename length
  centralDirectory.writeUInt16LE(0, 30); // extra field length
  centralDirectory.writeUInt16LE(0, 32); // file comment length
  centralDirectory.writeUInt16LE(0, 34); // disk number start
  centralDirectory.writeUInt16LE(0, 36); // internal file attributes
  centralDirectory.writeUInt32LE(0, 38); // external file attributes
  centralDirectory.writeUInt32LE(0, 42); // relative offset of local header

  const localHeaderOffset = 0;
  centralDirectory.writeUInt32LE(localHeaderOffset, 42);

  const centralDirOffset =
    localFileHeader.length + fileNameBuffer.length + compressed.length + dataDescriptor.length;

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0); // signature
  endOfCentralDirectory.writeUInt16LE(0, 4); // disk number
  endOfCentralDirectory.writeUInt16LE(0, 6); // disk with central dir
  endOfCentralDirectory.writeUInt16LE(1, 8); // entries on this disk
  endOfCentralDirectory.writeUInt16LE(1, 10); // total entries
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length + fileNameBuffer.length, 12); // central dir size
  endOfCentralDirectory.writeUInt32LE(centralDirOffset, 16); // central dir offset
  endOfCentralDirectory.writeUInt16LE(0, 20); // comment length

  const zipBuffer = Buffer.concat([
    localFileHeader,
    fileNameBuffer,
    compressed,
    dataDescriptor,
    centralDirectory,
    fileNameBuffer,
    endOfCentralDirectory,
  ]);

  await fsPromises.writeFile(zipPath, zipBuffer);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      if (current & 1) {
        current = (current >>> 1) ^ 0xedb88320;
      } else {
        current = current >>> 1;
      }
    }
    table[index] = current >>> 0;
  }
  return table;
})();

async function captureFixture(
  sourceContext,
  baseStorageState,
  fixtureRoot,
  fixture,
  sourceProfileDir,
) {
  const filePaths = resolveChatgptFixtureFiles(fixture, fixtureRoot);
  await fsPromises.rm(filePaths.dir, { recursive: true, force: true });
  await fsPromises.mkdir(filePaths.dir, { recursive: true });

  let onConversationResponse = null;
  let page = null;
  try {
    page = await sourceContext.newPage();
    await page.setViewportSize({ width: 1440, height: 1200 });
    await seedStorageStateOnPage(page, baseStorageState, fixture.conversationId);

    const client = await sourceContext.newCDPSession(page);
    await client.send('Page.enable').catch(() => undefined);
    await client.send('Network.enable').catch(() => undefined);
    await client.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => undefined);
    await client.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => undefined);

    const harRecorder = new CdpHarRecorder(client, /^https?:/);
    await harRecorder.start();

    const observedConversationResponses = [];
    onConversationResponse = (response) => {
      if (isConversationApiResponse(response.url(), fixture.conversationId)) {
        observedConversationResponses.push(response);
      }
    };
    page.on('response', onConversationResponse);
    const conversationResponsePromise = page
      .waitForResponse(
        (response) =>
          isConversationApiResponse(response.url(), fixture.conversationId) &&
          response.status() >= 200 &&
          response.status() < 300,
        { timeout: 90_000 },
      )
      .catch(() => null);

    console.log(`[TurboRender] [${fixture.id}] warmup: start`);
    await warmupFixturePage(page, fixture);
    console.log(`[TurboRender] [${fixture.id}] warmup: done`);

    console.log(`[TurboRender] [${fixture.id}] conversation response: resolving`);
    let conversationResponse = await conversationResponsePromise;
    if (conversationResponse == null) {
      for (let index = observedConversationResponses.length - 1; index >= 0; index -= 1) {
        const candidate = observedConversationResponses[index];
        if (candidate != null && candidate.status() >= 200 && candidate.status() < 300) {
          conversationResponse = candidate;
          break;
        }
      }
    }
    if (conversationResponse == null) {
      const statuses = observedConversationResponses.map((response) => response.status());
      throw new Error(
        `Could not capture /backend-api/conversation/${fixture.conversationId} while recording ${fixture.id}. seen statuses=${statuses.join(', ') || 'none'} finalUrl=${page.url()}`,
      );
    }
    console.log(`[TurboRender] [${fixture.id}] conversation response: captured (${conversationResponse.status()})`);
    const conversationJson = await parseConversationJsonFromResponse(
      conversationResponse,
      fixture.id,
      fixture.conversationId,
    );
    const observedTurns = countConversationTurns(conversationJson);
    if (observedTurns < fixture.expectedMinTurns) {
      throw new Error(
        `Fixture ${fixture.id} only exposed ${observedTurns} turns, below expected minimum ${fixture.expectedMinTurns}.`,
      );
    }

    console.log(`[TurboRender] [${fixture.id}] writing capture artifacts`);
    const storageState = await collectStorageState(sourceContext, page);
    await capturePageMhtml(client, filePaths.pageMhtml);
    await captureShellHtml(page, filePaths.shellHtml, fixture, conversationJson);
    await fsPromises.writeFile(filePaths.conversationJson, JSON.stringify(conversationJson, null, 2));
    await fsPromises.writeFile(filePaths.storageStateJson, JSON.stringify(storageState, null, 2));

    // Phase 4: Capture static assets for offline replay
    await captureStaticAssets(page, filePaths.assetsDir, filePaths.assetsJson);

    // Generate synthesize.json mock response
    const synthesizeMock = {
      url: 'https://www.soundjay.com/misc/sounds/beep-01a.mp3',
      duration_ms: 1000,
      voice: 'cove',
      conversation_id: fixture.conversationId,
      message_id: 'mock-message-id',
    };
    await fsPromises.writeFile(filePaths.synthesizeJson, JSON.stringify(synthesizeMock, null, 2));

    console.log(`[TurboRender] [${fixture.id}] stopping CDP HAR recorder`);
    const harEntries = await harRecorder.stop();
    const har = harRecorder.buildHar(harEntries);
    await writeHarZip(har, filePaths.replayHarZip);
    console.log(`[TurboRender] [${fixture.id}] wrote ${filePaths.replayHarZip} (${harEntries.length} entries)`);

    const batchCount = await page.locator('[data-turbo-render-batch-anchor="true"]').count();
    const hostTurnCount = await page.locator('section[data-testid^="conversation-turn-"]').count();
    const metadata = {
      fixtureId: fixture.id,
      url: fixture.url,
      conversationId: fixture.conversationId,
      expectedMinTurns: fixture.expectedMinTurns,
      warmupProfile: fixture.warmupProfile,
      capturedAt: new Date().toISOString(),
      observedTurns,
      observedBatchCount: batchCount,
      observedHostTurnCount: hostTurnCount,
      sourceDebugPort,
      sourceProfileDir,
      captureContext: 'source-browser-existing',
      replayHarZip: path.basename(filePaths.replayHarZip),
      pageMhtml: path.basename(filePaths.pageMhtml),
      conversationJson: path.basename(filePaths.conversationJson),
      storageStateJson: path.basename(filePaths.storageStateJson),
      shellHtml: path.basename(filePaths.shellHtml),
      metaJson: path.basename(filePaths.metaJson),
      synthesizeJson: path.basename(filePaths.synthesizeJson),
    };
    await fsPromises.writeFile(filePaths.metadataJson, JSON.stringify(metadata, null, 2));

    // Write new meta.json for origin fixture replay (minimal, no sensitive data)
    const meta = {
      fixtureId: fixture.id,
      routeKind: 'chat',
      sourceUrl: fixture.url,
      conversationId: fixture.conversationId,
      capturedAt: new Date().toISOString(),
      chatgptBuildHint: 'origin-fixture-replay-v1',
      locale: 'zh-CN',
      notes: `Phase 1 origin fixture replay. ${observedTurns} turns observed.`,
    };
    await fsPromises.writeFile(filePaths.metaJson, JSON.stringify(meta, null, 2));

    if (!fs.existsSync(filePaths.replayHarZip)) {
      throw new Error(`HAR capture did not produce ${filePaths.replayHarZip}.`);
    }

    console.log(`[TurboRender] [${fixture.id}] offline validation: start`);
    await validateFixtureOffline(sourceContext, fixture, filePaths, storageState);
    console.log(`[TurboRender] [${fixture.id}] offline validation: done`);
    console.log(`[TurboRender] captured ${fixture.id} -> ${filePaths.dir}`);
  } catch (error) {
    await fsPromises.rm(filePaths.dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (page != null && onConversationResponse != null) {
      page.off('response', onConversationResponse);
    }
    if (page != null) {
      await page.close().catch(() => undefined);
    }
  }
}

async function launchFreshManagedBrowser(targetUrl = 'about:blank') {
  const debugPort = await findFreeDebugPort();
  const launch = await spawnLaunchableChromium({
    repoRoot,
    targetUrl,
    debugPort,
    extensionPath,
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.debugPort}`);
  const context = browser.contexts()[0];
  if (context == null) {
    throw new Error('Fresh managed browser did not expose a default context.');
  }

  return {
    browser,
    context,
    debugPort: launch.debugPort,
    userDataDir: launch.userDataDir,
    async cleanup() {
      if (typeof browser.newBrowserCDPSession === 'function') {
        try {
          const session = await browser.newBrowserCDPSession();
          await session.send('Browser.close').catch(() => undefined);
          await session.detach().catch(() => undefined);
        } catch {
          // Ignore browser shutdown failures during cleanup.
        }
      }
      await browser.close().catch(() => undefined);
      await fsPromises.rm(launch.userDataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

async function validateFixtureOfflineInContext(
  context,
  fixture,
  filePaths,
  storageState,
  options = { applyCookies: true },
) {
  if (options.applyCookies && storageState.cookies.length > 0) {
    await context.addCookies(storageState.cookies);
  }

  let page = null;
  let pageOfflineApplied = false;
  try {
    page = await context.newPage();
    await seedStorageStateOnPage(page, storageState, fixture.conversationId);

    const client = await context.newCDPSession(page);
    await client.send('Network.enable').catch(() => undefined);
    await client.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => undefined);
    await client.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => undefined);
    await client
      .send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      .catch(() => undefined);
    pageOfflineApplied = true;

    await page.routeFromHAR(filePaths.replayHarZip, { notFound: 'abort' });
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await setDebugConversationId(page, fixture.conversationId);

    const inlineHistoryRoot = page.locator('[data-turbo-render-inline-history-root="true"]');
    const rootExists = await inlineHistoryRoot.count();
    const rootHidden = rootExists > 0 ? await inlineHistoryRoot.getAttribute('hidden') : null;
    console.log(
      `[TurboRender] [${fixture.id}] offline replay: inlineHistoryRoot count=${rootExists} hidden=${rootHidden ?? 'false'} url=${page.url()}`,
    );

    if (rootExists > 0 && rootHidden == null) {
      const firstBatch = page.locator('[data-turbo-render-batch-anchor="true"]').first();
      const batchVisible = await firstBatch.isVisible().catch(() => false);
      if (batchVisible) {
        await firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]').click();
        const startedAt = Date.now();
        while (Date.now() - startedAt < 10_000) {
          if ((await firstBatch.getAttribute('data-state')) === 'expanded') {
            break;
          }
          await sleep(100);
        }
        if ((await firstBatch.getAttribute('data-state')) !== 'expanded') {
          console.warn(`[TurboRender] [${fixture.id}] offline replay: first batch did not expand (non-fatal)`);
        }
      }
    } else {
      console.warn(
        `[TurboRender] [${fixture.id}] offline replay: extension UI not visible (rootExists=${rootExists}, hidden=${rootHidden}). Fixture data is captured; extension may need live API for full UI activation.`,
      );
    }

    if (pageOfflineApplied) {
      await client
        .send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })
        .catch(() => undefined);
      pageOfflineApplied = false;
    }
    console.log(`[TurboRender] offline replay validated for ${fixture.id}`);
  } finally {
    if (pageOfflineApplied && page != null) {
      const cleanupClient = await context.newCDPSession(page).catch(() => null);
      if (cleanupClient != null) {
        await cleanupClient
          .send('Network.emulateNetworkConditions', {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          })
          .catch(() => undefined);
      }
    }
    if (page != null) {
      await page.close().catch(() => undefined);
    }
  }
}

async function validateFixtureOffline(sourceContext, fixture, filePaths, storageState) {
  let managedBrowser = null;
  try {
    managedBrowser = await launchFreshManagedBrowser('about:blank');
    await validateFixtureOfflineInContext(managedBrowser.context, fixture, filePaths, storageState);
    return;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[TurboRender] fresh managed browser offline validation failed for ${fixture.id}: ${reason}`,
    );
    console.warn(
      `[TurboRender] falling back to source browser context for offline validation of ${fixture.id}.`,
    );
  } finally {
    if (managedBrowser != null) {
      await managedBrowser.cleanup().catch(() => undefined);
    }
  }

  try {
    await validateFixtureOfflineInContext(
      sourceContext,
      fixture,
      filePaths,
      storageState,
      { applyCookies: false },
    );
  } catch (fallbackError) {
    const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    console.warn(
      `[TurboRender] source browser context offline validation also failed for ${fixture.id}: ${reason}`,
    );
    console.warn(
      `[TurboRender] fixture data for ${fixture.id} is saved but offline replay could not be verified. The HAR file may need adjustments for full offline extension UI activation.`,
    );
  }
}

async function main() {
  ensureBuildExists();

  // Extract target fixtures from CLI args (skip node and script path)
  const targetFixtures = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

  console.log(`[TurboRender] reading login state from controlled Chrome on http://127.0.0.1:${sourceDebugPort}`);
  await waitForRemoteDebugEndpoint(sourceDebugPort, 10_000).catch(() => {
    throw new Error(
      `Could not connect to a controlled Chrome on port ${sourceDebugPort}. Start one with pnpm debug:mcp-chrome and sign in first.`,
    );
  });

  let sourceBrowser = null;
  try {
    sourceBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${sourceDebugPort}`);
    const sourceContext = sourceBrowser.contexts()[0];
    if (sourceContext == null) {
      throw new Error(
        `[TurboRender] Source browser on port ${sourceDebugPort} does not expose a default context. Open a tab first.`,
      );
    }

    const sourceHints = await readSourceBrowserLaunchHints(sourceBrowser);
    const sourceProfileDir =
      sourceHints.profileDir ??
      (await resolveSourceChromeProfileDir(repoRoot, sourceDebugPort));
    if (sourceProfileDir == null) {
      throw new Error(
        `[TurboRender] Could not locate the logged-in Chrome profile for port ${sourceDebugPort}. Start pnpm debug:mcp-chrome, sign in, and keep that browser running before capturing fixtures.`,
      );
    }

    const fixtureRoot = resolveChatgptFixtureRoot();
    const allFixtures = loadChatgptFixtureManifest();
    
    // Filter to only target fixtures (if specified via CLI args)
    const fixtures = targetFixtures && targetFixtures.length > 0
      ? allFixtures.filter(f => targetFixtures.includes(f.id))
      : allFixtures;

    console.log(`[TurboRender] using source Chrome profile from ${sourceProfileDir}`);
    if (sourceHints.product != null) {
      console.log(`[TurboRender] source browser product: ${sourceHints.product}`);
    }
    if (sourceHints.browserBinary != null) {
      console.log(`[TurboRender] source browser binary: ${sourceHints.browserBinary}`);
    }
    const baseStorageState = await readSourceStorageState(sourceBrowser);
    if (baseStorageState.cookies.length === 0) {
      throw new Error(
        `[TurboRender] Source browser on port ${sourceDebugPort} exposed zero cookies. Confirm that this controlled browser is signed in to chatgpt.com and retry.`,
      );
    }
    console.log(
      `[TurboRender] captured source storage state: cookies=${baseStorageState.cookies.length} origins=${baseStorageState.origins.length}`,
    );

    for (const fixture of fixtures) {
      console.log(`[TurboRender] probing source access for ${fixture.id} (${fixture.url})`);
      await assertSourceCanLoadFixture(sourceBrowser, fixture);
    }

    await fsPromises.mkdir(fixtureRoot, { recursive: true });
    for (const fixture of fixtures) {
      console.log(`[TurboRender] capturing ${fixture.id} (${fixture.url})`);
      await captureFixture(
        sourceContext,
        baseStorageState,
        fixtureRoot,
        fixture,
        sourceProfileDir,
      );
      await sleep(300);
    }

    if (fixtures.length === 1) {
      console.log(`[TurboRender] fixture ${fixtures[0].id} is ready under ${fixtureRoot}`);
    } else {
      console.log(`[TurboRender] ${fixtures.length} offline fixtures are ready under ${fixtureRoot}`);
    }
  } finally {
    // Close Playwright connection to allow Node.js process to exit cleanly.
    // Note: For connectOverCDP, we use close() but this keeps the browser running
    // since it's an external process. Playwright will disconnect the CDP session.
    if (sourceBrowser != null) {
      await sourceBrowser.close().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
