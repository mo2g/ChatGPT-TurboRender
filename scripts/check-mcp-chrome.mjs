#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { waitForRemoteDebugEndpoint } from './debug-mcp-chrome-lib.mjs';
import { DEFAULT_LIVE_CHAT_URL, parseExactChatTargetUrl } from './live-targets-lib.mjs';
import {
  buildExtensionPageUrl,
  resolveChromeProfileDir,
  resolveExtensionIdFromProfile,
} from './reload-mcp-chrome-lib.mjs';
import {
  createLivePerformanceSample,
  formatLivePerformanceSample,
  hasArchiveAccess,
  hasTurboRenderInjection,
  inspectChatgptPage,
  selectExactChatgptPage,
  selectExactChatgptExtensionTab,
  validateLivePerformanceSample,
  waitForInspection,
} from './check-mcp-chrome-lib.mjs';

const DEFAULT_DEBUG_PORT = 9222;
const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function printHelp() {
  console.log(`ChatGPT TurboRender controlled Chrome checker

Usage:
  pnpm check:mcp-chrome
  pnpm check:mcp-chrome -- --port 9333
  pnpm check:mcp-chrome -- --url https://chatgpt.com/c/<conversation-id>

Options:
  --port <number>   Remote debugging port. Default: ${DEFAULT_DEBUG_PORT}
  --url <url>       Exact ChatGPT conversation URL to check. Default: ${DEFAULT_LIVE_CHAT_URL}
  -h, --help        Show this help message

Environment:
  CHROME_DEBUG_PORT  Remote debugging port. Default: ${DEFAULT_DEBUG_PORT}
`);
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (value == null || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return value;
}

function parseArgs(argv) {
  let debugPort = process.env.CHROME_DEBUG_PORT ?? String(DEFAULT_DEBUG_PORT);
  let preferredUrl = DEFAULT_LIVE_CHAT_URL;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }

    if (arg === '--') {
      continue;
    }

    if (arg === '--port') {
      debugPort = readOptionValue(argv, index, '--port');
      index += 1;
      continue;
    }

    if (arg.startsWith('--port=')) {
      debugPort = arg.slice('--port='.length);
      continue;
    }

    if (arg === '--url') {
      preferredUrl = readOptionValue(argv, index, '--url');
      index += 1;
      continue;
    }

    if (arg.startsWith('--url=')) {
      preferredUrl = arg.slice('--url='.length);
      continue;
    }

    if (!arg.startsWith('-') && preferredUrl === DEFAULT_LIVE_CHAT_URL) {
      preferredUrl = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const parsedPort = Number.parseInt(String(debugPort), 10);
  if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
    throw new Error(`Invalid debug port: ${debugPort}`);
  }

  return {
    help: false,
    debugPort: parsedPort,
    preferredUrl: parseExactChatTargetUrl(preferredUrl).url,
  };
}

async function queryExtensionTabs(extensionPage) {
  return await extensionPage.evaluate(async () => {
    const runtimeChrome = globalThis.chrome;
    if (runtimeChrome?.tabs == null) {
      throw new Error('Chrome tabs API is unavailable in the extension context.');
    }

    const tabs = await runtimeChrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
    }));
  });
}

async function requestTabStatus(extensionPage, tabId) {
  return await extensionPage.evaluate(async (targetTabId) => {
    const runtimeChrome = globalThis.chrome;
    if (runtimeChrome?.runtime == null) {
      throw new Error('Chrome runtime API is unavailable in the extension context.');
    }

    return await runtimeChrome.runtime.sendMessage({
      type: 'GET_TAB_STATUS',
      tabId: targetTabId,
    });
  }, tabId);
}

async function requestTargetRuntimeStatus(context, profileDir, targetUrl) {
  if (profileDir == null) {
    throw new Error('Controlled Chrome profile path is unresolved; cannot query extension runtime status.');
  }

  const extensionId = await resolveExtensionIdFromProfile(profileDir);
  const extensionPage = await context.newPage();
  try {
    await extensionPage.goto(buildExtensionPageUrl(extensionId, 'popup.html'), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const tabs = await queryExtensionTabs(extensionPage);
    const targetTab = selectExactChatgptExtensionTab(tabs, targetUrl);
    if (targetTab?.id == null) {
      throw new Error(`Extension tabs API could not resolve the exact target tab ${targetUrl}.`);
    }

    return await requestTabStatus(extensionPage, targetTab.id);
  } finally {
    await extensionPage.close().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const endpoint = `http://127.0.0.1:${options.debugPort}`;
  console.log(`[TurboRender] checking controlled Chrome at ${endpoint}`);
  await waitForRemoteDebugEndpoint(options.debugPort, 5_000);

  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const profileDir = await resolveChromeProfileDir(repoRoot, options.debugPort);
    console.log(`[TurboRender] debug endpoint: reachable`);
    console.log(`[TurboRender] profile path: ${profileDir ?? 'unresolved'}`);

    const pages = browser.contexts().flatMap((context) => context.pages());
    const { chatgptPages, exactPages, matchedPage } = selectExactChatgptPage(pages, options.preferredUrl);
    const page = matchedPage;
    if (page == null) {
      if (chatgptPages.length === 0) {
        console.error('[TurboRender] No ChatGPT tabs were found on the controlled browser.');
      } else {
        console.error(`[TurboRender] No ChatGPT tab matched the exact target ${options.preferredUrl}.`);
        console.error('[TurboRender] Available ChatGPT tabs:');
        for (const candidate of chatgptPages) {
          console.error(`  - ${candidate.url()}`);
        }
      }

      console.error(`[TurboRender] Open ${options.preferredUrl} in the controlled browser and rerun.`);
      process.exitCode = 1;
      return;
    }

    const pageUrl = page.url();
    let inspection =
      (await waitForInspection(page, hasTurboRenderInjection, 15_000, 500)) ?? (await inspectChatgptPage(page));
    if (inspection.routeKind === 'chat' && !hasArchiveAccess(inspection)) {
      inspection = (await waitForInspection(page, hasArchiveAccess, 15_000, 500)) ?? inspection;
    }
    const archiveReady = hasArchiveAccess(inspection);
    const injected = hasTurboRenderInjection(inspection);

    console.log(`[TurboRender] matched page: ${pageUrl}`);
    console.log(`[TurboRender] target exact match: ${exactPages.length > 0 ? 'yes' : 'no'} (${exactPages.length} tab(s))`);
    console.log(`[TurboRender] route kind: ${inspection.routeKind}`);
    console.log(`[TurboRender] archive ready: ${archiveReady ? 'yes' : 'no'}`);
    console.log(`[TurboRender] document: ${inspection.title || '(untitled)'} [${inspection.readyState}]`);
    console.log(
      `[TurboRender] markers: inline-history=${inspection.inlineHistoryRoots}, inline-history-visible=${inspection.visibleInlineHistoryRoots}, ui-root=${inspection.uiRoots}, boundary-roots=${inspection.boundaryRoots}, boundary-buttons=${inspection.boundaryButtons}, boundary-visible=${inspection.visibleBoundaryRoots}, batch-anchors=${inspection.batchAnchors}, groups=${inspection.groups}, toggles=${inspection.toggleActions}, host-messages=${inspection.hostMessages}`,
    );

    if (!injected) {
      console.error('[TurboRender] TurboRender markers were not detected on the matched page.');
      console.error('[TurboRender] Try `pnpm build` and `pnpm reload:mcp-chrome`, then reload the conversation page.');
      process.exitCode = 1;
      return;
    }

    if (!archiveReady) {
      console.error('[TurboRender] The matched conversation does not expose archive content yet.');
      console.error('[TurboRender] Use the default long conversation target or another `/c/...` thread with folded history.');
      process.exitCode = 1;
      return;
    }

    let tabStatus = null;
    try {
      const context = browser.contexts()[0];
      if (context == null) {
        throw new Error('Controlled Chrome did not expose a default browser context.');
      }
      tabStatus = await requestTargetRuntimeStatus(context, profileDir, options.preferredUrl);
    } catch (error) {
      console.error(
        error instanceof Error
          ? `[TurboRender] Could not query extension runtime status: ${error.message}`
          : '[TurboRender] Could not query extension runtime status.',
      );
      console.error('[TurboRender] Try `pnpm build` and `pnpm reload:mcp-chrome`, then refresh the target tab.');
      process.exitCode = 1;
      return;
    }

    const runtime = tabStatus?.runtime ?? null;
    if (runtime == null) {
      console.error('[TurboRender] Extension runtime status is unavailable for the exact target tab.');
      console.error('[TurboRender] Try `pnpm reload:mcp-chrome`, then refresh the target tab.');
      process.exitCode = 1;
      return;
    }

    if (runtime.routeKind !== 'chat') {
      console.error(`[TurboRender] Extension runtime resolved route kind ${runtime.routeKind}, expected chat.`);
      process.exitCode = 1;
      return;
    }

    const performanceSample = createLivePerformanceSample('check', runtime);
    const performanceErrors = validateLivePerformanceSample(performanceSample);
    if (performanceErrors.length > 0) {
      console.error('[TurboRender] Runtime metrics failed baseline invariants:');
      for (const error of performanceErrors) {
        console.error(`  - ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`[TurboRender] runtime metrics: ${formatLivePerformanceSample(performanceSample)}`);
    console.log('[TurboRender] TurboRender injection markers are present.');
  } finally {
    // For connectOverCDP, close() disconnects Playwright without shutting down the external browser.
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `[TurboRender] ${error.message}` : String(error));
  process.exit(1);
});
