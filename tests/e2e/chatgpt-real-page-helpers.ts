import { expect, type Locator, type Page } from '@playwright/test';

import { getRouteIdFromRuntimeId } from '../../lib/shared/chat-id';
import { UI_CLASS_NAMES } from '../../lib/shared/constants';
import type { TabRuntimeStatus, TabStatusResponse } from '../../lib/shared/types';
import {
  parseLiveTargetUrl,
  type LiveTestInputs,
  type ResolvedLiveChatTarget,
} from './chatgpt-live-targets';
import { resolveExtensionIdFromProfile, type ControlledBrowserHandle } from './controlled-browser';

type ExtensionTab = {
  id?: number;
  url?: string;
};

type RuntimeChromeApi = {
  tabs?: {
    query(queryInfo: unknown): Promise<ExtensionTab[]>;
  };
  runtime?: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};

export type LivePerformancePhase =
  | 'recent-view'
  | 'newest-archive-page'
  | 'older-archive-page'
  | 'archive-search-jump';

export interface LivePerformanceSample {
  phase: LivePerformancePhase;
  archivePageCount: number;
  currentArchivePageIndex: number | null;
  liveDescendantCount: number;
  spikeCount: number;
  parkedGroups: number;
  residentParkedGroups: number;
  serializedParkedGroups: number;
}

export interface LiveRuntimeStatusClient {
  getTabStatusForActivePage(page: Page, targetUrl: string): Promise<TabStatusResponse>;
  getTabStatusForUrl(targetUrl: string): Promise<TabStatusResponse>;
  close(): Promise<void>;
}

type LiveRuntimeStatusSource = ControlledBrowserHandle | LiveRuntimeStatusClient;

const ownedLiveTargetPages = new WeakSet<Page>();

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

function matchesTargetUrl(candidateUrl: string, targetUrl: string): boolean {
  return candidateUrl === targetUrl || candidateUrl.startsWith(`${targetUrl}?`) || candidateUrl.startsWith(`${targetUrl}#`);
}

function getPrimaryContext(browserHandle: ControlledBrowserHandle) {
  const context = browserHandle.browser.contexts()[0];
  if (context == null) {
    throw new Error('Controlled browser did not expose a default context.');
  }

  return context;
}

function findExistingLiveTargetPage(context: ReturnType<typeof getPrimaryContext>, targetUrl: string): Page | null {
  return (
    context
      .pages()
      .find(
        (page) => !page.isClosed() && !page.url().startsWith('chrome-extension://') && matchesTargetUrl(page.url(), targetUrl),
      ) ?? null
  );
}

async function findLikelyActiveNormalPage(context: ReturnType<typeof getPrimaryContext>): Promise<Page | null> {
  const candidates = context.pages().filter((page) => !page.url().startsWith('chrome-extension://'));
  let visibleFallback: Page | null = null;

  for (const page of candidates) {
    try {
      const visibility = await page.evaluate(() => ({
        hasFocus: document.hasFocus(),
        visibilityState: document.visibilityState,
      }));

      if (visibility.hasFocus) {
        return page;
      }

      if (visibleFallback == null && visibility.visibilityState === 'visible') {
        visibleFallback = page;
      }
    } catch {
      // Ignore pages that are in the middle of navigation or no longer available.
    }
  }

  return visibleFallback ?? candidates.at(-1) ?? null;
}

async function waitForDelay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, timeoutMs);
  });
}

function normalizeRuntimeMetric(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function normalizeRuntimePageIndex(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  return Number.isFinite(value) ? value : Number.NaN;
}

export function createLivePerformanceSample(
  phase: LivePerformancePhase,
  runtime: TabRuntimeStatus,
): LivePerformanceSample {
  return {
    phase,
    archivePageCount: normalizeRuntimeMetric(runtime.archivePageCount),
    currentArchivePageIndex: normalizeRuntimePageIndex(runtime.currentArchivePageIndex),
    liveDescendantCount: normalizeRuntimeMetric(runtime.liveDescendantCount),
    spikeCount: normalizeRuntimeMetric(runtime.spikeCount),
    parkedGroups: normalizeRuntimeMetric(runtime.parkedGroups),
    residentParkedGroups: normalizeRuntimeMetric(runtime.residentParkedGroups ?? 0),
    serializedParkedGroups: normalizeRuntimeMetric(runtime.serializedParkedGroups ?? 0),
  };
}

export function expectLivePerformanceSampleInvariants(sample: LivePerformanceSample): void {
  const numericFields: Array<keyof Omit<LivePerformanceSample, 'phase' | 'currentArchivePageIndex'>> = [
    'archivePageCount',
    'liveDescendantCount',
    'spikeCount',
    'parkedGroups',
    'residentParkedGroups',
    'serializedParkedGroups',
  ];

  for (const field of numericFields) {
    const value = sample[field];
    expect(Number.isFinite(value), `${sample.phase}.${field} must be finite`).toBe(true);
    expect(value, `${sample.phase}.${field} must be non-negative`).toBeGreaterThanOrEqual(0);
  }

  if (sample.currentArchivePageIndex != null) {
    expect(Number.isFinite(sample.currentArchivePageIndex), `${sample.phase}.currentArchivePageIndex must be finite`).toBe(
      true,
    );
    expect(sample.currentArchivePageIndex, `${sample.phase}.currentArchivePageIndex must be non-negative`).toBeGreaterThanOrEqual(
      0,
    );
  }

  expect(
    sample.residentParkedGroups + sample.serializedParkedGroups,
    `${sample.phase} parking split must equal parkedGroups`,
  ).toBe(sample.parkedGroups);
}

async function withExtensionPopupPage<T>(
  browserHandle: ControlledBrowserHandle,
  callback: (page: Page) => Promise<T>,
  preferredNormalPage?: Page,
): Promise<T> {
  if (browserHandle.userDataDir == null) {
    throw new Error('Controlled browser profile path is unavailable.');
  }

  const context = getPrimaryContext(browserHandle);
  const preservedPage = preferredNormalPage ?? (await findLikelyActiveNormalPage(context));
  const extensionId = await resolveExtensionIdFromProfile(browserHandle.userDataDir);
  const extensionPage = await context.newPage();

  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    if (preservedPage != null) {
      await preservedPage.bringToFront().catch(() => undefined);
      await waitForDelay(200);
    }

    return await callback(extensionPage);
  } finally {
    await extensionPage.close().catch(() => undefined);
  }
}

async function queryTabs(extensionPage: Page, queryInfo: unknown): Promise<ExtensionTab[]> {
  return await extensionPage.evaluate(async (configuredQueryInfo) => {
    const runtimeChrome = (globalThis as typeof globalThis & { chrome?: RuntimeChromeApi }).chrome;
    if (runtimeChrome?.tabs == null) {
      throw new Error('Chrome tabs API is unavailable in the popup context.');
    }

    const tabs = (await runtimeChrome.tabs.query(configuredQueryInfo)) as ExtensionTab[];
    return tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
    }));
  }, queryInfo);
}

async function requestTabStatus(extensionPage: Page, tabId?: number): Promise<TabStatusResponse> {
  return await extensionPage.evaluate(async (configuredTabId) => {
    const runtimeChrome = (globalThis as typeof globalThis & { chrome?: RuntimeChromeApi }).chrome;
    if (runtimeChrome?.runtime == null) {
      throw new Error('Chrome runtime API is unavailable in the popup context.');
    }

    return (await runtimeChrome.runtime.sendMessage({
      type: 'GET_TAB_STATUS',
      tabId: configuredTabId ?? undefined,
    })) as TabStatusResponse;
  }, tabId ?? null);
}

function isLiveRuntimeStatusClient(source: LiveRuntimeStatusSource): source is LiveRuntimeStatusClient {
  return typeof (source as LiveRuntimeStatusClient).getTabStatusForActivePage === 'function';
}

async function getRuntimeStatusForActivePage(
  source: LiveRuntimeStatusSource,
  page: Page,
  targetUrl: string,
): Promise<TabStatusResponse> {
  if (isLiveRuntimeStatusClient(source)) {
    return await source.getTabStatusForActivePage(page, targetUrl);
  }

  return await getTabStatusForActivePage(source, page, targetUrl);
}

function buildTargetUrlFromRuntime(chatId: string): string | null {
  const routeId = getRouteIdFromRuntimeId(chatId);
  if (routeId == null) {
    return null;
  }

  return new URL(`/c/${routeId}`, 'https://chatgpt.com').href;
}

export async function setLiveDebugConversationId(page: Page, conversationId: string): Promise<void> {
  await page.evaluate((inputConversationId) => {
    const debugConversationId = inputConversationId.trim();
    (window as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId =
      debugConversationId;
    document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
    if (document.body != null) {
      document.body.dataset.turboRenderDebugConversationId = debugConversationId;
    }
  }, conversationId);
}

export async function resolveActiveChatgptLiveTarget(
  browserHandle: ControlledBrowserHandle,
): Promise<ResolvedLiveChatTarget> {
  return await withExtensionPopupPage(browserHandle, async (extensionPage) => {
    const startedAt = Date.now();
    const timeoutMs = 45_000;
    let lastRootStatus: TabStatusResponse | null = null;
    let lastTargetedStatus: TabStatusResponse | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      const rootStatus = await requestTabStatus(extensionPage);
      lastRootStatus = rootStatus;

      const activeTabId = rootStatus.activeTabId ?? rootStatus.targetTabId;
      if (activeTabId == null) {
        await waitForDelay(500);
        continue;
      }

      const targetedStatus = await requestTabStatus(extensionPage, activeTabId);
      lastTargetedStatus = targetedStatus;
      const runtime = targetedStatus.runtime;

      if (runtime?.routeKind != null && runtime.routeKind !== 'chat') {
        throw new Error(`Active tab resolved to a ${runtime.routeKind} route, but chat was requested.`);
      }

      if (runtime?.routeKind === 'chat') {
        const resolvedUrl = buildTargetUrlFromRuntime(runtime.chatId);
        if (resolvedUrl != null) {
          return parseLiveTargetUrl(resolvedUrl);
        }
      }

      if (
        rootStatus.activeTabSupportedHost &&
        rootStatus.activeTabRouteKind != null &&
        rootStatus.activeTabRouteKind !== 'chat'
      ) {
        throw new Error(`Active tab is a ${rootStatus.activeTabRouteKind} route, but chat was requested.`);
      }

      await waitForDelay(500);
    }

    if (lastTargetedStatus?.runtime?.routeKind != null && lastTargetedStatus.runtime.routeKind !== 'chat') {
      throw new Error(`Active tab resolved to a ${lastTargetedStatus.runtime.routeKind} route, but chat was requested.`);
    }

    if (
      lastRootStatus?.activeTabSupportedHost &&
      lastRootStatus.activeTabRouteKind != null &&
      lastRootStatus.activeTabRouteKind !== 'chat'
    ) {
      throw new Error(`Active tab is a ${lastRootStatus.activeTabRouteKind} route, but chat was requested.`);
    }

    throw new Error('Unable to resolve an active chat ChatGPT conversation from the logged-in browser tab.');
  });
}

export async function resolveConfiguredLiveTarget(
  browserHandle: ControlledBrowserHandle,
  inputs: LiveTestInputs,
): Promise<ResolvedLiveChatTarget> {
  if (inputs.useActiveTab) {
    return await resolveActiveChatgptLiveTarget(browserHandle);
  }

  if (inputs.chatUrl == null) {
    throw new Error('The live chat smoke requires --chat-url or --use-active-tab.');
  }

  return {
    ...parseLiveTargetUrl(inputs.chatUrl),
  };
}

export async function openChatgptLiveTargetPage(
  browserHandle: ControlledBrowserHandle,
  target: ResolvedLiveChatTarget,
): Promise<Page> {
  const context = getPrimaryContext(browserHandle);
  const existingPage = findExistingLiveTargetPage(context, target.url);
  if (existingPage != null) {
    await navigateChatgptLiveTargetPage(existingPage, target);
    return existingPage;
  }

  const page = await context.newPage();
  ownedLiveTargetPages.add(page);

  try {
    if (target.routeKind === 'chat' && target.conversationId != null) {
      await page.addInitScript(
        ({ conversationId }) => {
          const debugConversationId = conversationId.trim();
          (window as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId =
            debugConversationId;
          document.documentElement.dataset.turboRenderDebugConversationId = debugConversationId;
        },
        { conversationId: target.conversationId },
      );
    }

    await navigateChatgptLiveTargetPage(page, target);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

export async function releaseChatgptLiveTargetPage(page: Page): Promise<void> {
  if (!ownedLiveTargetPages.has(page)) {
    return;
  }

  await page.close().catch(() => undefined);
}

export async function navigateChatgptLiveTargetPage(page: Page, target: ResolvedLiveChatTarget): Promise<void> {
  await page.bringToFront().catch(() => undefined);
  if (page.url() !== target.url) {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } else {
    await page.waitForLoadState('domcontentloaded', { timeout: 60_000 }).catch(() => undefined);
  }

  if (target.routeKind === 'chat' && target.conversationId != null) {
    await setLiveDebugConversationId(page, target.conversationId);
  }

  await page.bringToFront().catch(() => undefined);
}

export async function resetLiveChatSmokeState(page: Page): Promise<void> {
  await expectTurboRenderReady(page);

  const batchAnchors = page.locator('[data-turbo-render-batch-anchor="true"]');
  if ((await batchAnchors.count()) > 0) {
    await goToRecentArchiveView(page);
  }

  const searchInput = page.locator('[data-turbo-render-action="archive-search-input"]').first();
  if ((await searchInput.count()) > 0 && (await searchInput.isVisible().catch(() => false))) {
    await searchInput.fill('');
  }

  await expect(batchAnchors).toHaveCount(0, { timeout: 30_000 });
}

export async function expectTurboRenderReady(page: Page): Promise<void> {
  await expectTurboRenderInjected(page);
  await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toBeVisible({ timeout: 60_000 });
}

export async function expectTurboRenderInjected(page: Page): Promise<void> {
  await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('[data-turbo-render-ui-root="true"]')).toHaveCount(1, { timeout: 60_000 });
}

export type ArchiveBoundaryAction =
  | 'open-archive-newest'
  | 'go-archive-older'
  | 'go-archive-newer'
  | 'go-archive-recent';

function getArchiveBoundaryButton(page: Page, action: ArchiveBoundaryAction): Locator {
  return page.locator(`[data-turbo-render-action="${action}"]`).first();
}

export async function expectArchiveBoundaryVisible(page: Page): Promise<void> {
  await expectTurboRenderReady(page);
  await expect(page.locator(`.${UI_CLASS_NAMES.inlineHistoryBoundary}`)).toBeVisible({ timeout: 30_000 });
  await expect(getArchiveBoundaryButton(page, 'open-archive-newest')).toBeVisible({ timeout: 30_000 });
}

export async function clickArchiveBoundaryAction(page: Page, action: ArchiveBoundaryAction): Promise<void> {
  await expectTurboRenderReady(page);
  const button = getArchiveBoundaryButton(page, action);
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
}

export async function openNewestArchivePage(page: Page): Promise<void> {
  await clickArchiveBoundaryAction(page, 'open-archive-newest');
}

export async function goOlderArchivePage(page: Page): Promise<void> {
  await clickArchiveBoundaryAction(page, 'go-archive-older');
}

export async function goToRecentArchiveView(page: Page): Promise<void> {
  await clickArchiveBoundaryAction(page, 'go-archive-recent');
  await expect(page.locator('[data-turbo-render-batch-anchor="true"]')).toHaveCount(0, { timeout: 30_000 });
}

export async function openArchiveSearch(page: Page): Promise<void> {
  await expectArchiveBoundaryVisible(page);
  const toggle = page.locator('[data-turbo-render-action="toggle-archive-search"]').first();
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  const expanded = await toggle.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await toggle.click();
  }

  await expect(page.locator('[data-turbo-render-action="archive-search-input"]').first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function fillArchiveSearchQuery(page: Page, query: string): Promise<void> {
  await openArchiveSearch(page);
  const input = page.locator('[data-turbo-render-action="archive-search-input"]').first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(query);
}

export async function clickArchiveSearchResult(page: Page, index = 0): Promise<void> {
  const results = page.locator('[data-turbo-render-action="open-archive-search-result"]');
  await expect(results.nth(index)).toBeVisible({ timeout: 30_000 });
  await results.nth(index).click();
}

export async function expectArchiveSearchHighlight(page: Page): Promise<Locator> {
  const highlight = page.locator(`.${UI_CLASS_NAMES.inlineBatchSearchHighlight}`).first();
  await expect(highlight).toBeVisible({ timeout: 30_000 });
  return highlight;
}

export async function expandArchiveBatches(page: Page, requestedCount: number): Promise<Locator[]> {
  await expectTurboRenderReady(page);
  const batches = page.locator('[data-turbo-render-batch-anchor="true"]');
  let total = await batches.count();
  if (requestedCount > 0 && total === 0) {
    await openNewestArchivePage(page);
    await expect(batches.first()).toBeVisible({ timeout: 30_000 });
    total = await batches.count();
  }
  const resolvedCount = Math.min(requestedCount, total);
  const expanded: Locator[] = [];

  for (let index = 0; index < resolvedCount; index += 1) {
    const batch = batches.nth(index);
    const toggle = batch.locator('[data-turbo-render-action="toggle-archive-group"]');
    await expect(batch).toBeVisible({ timeout: 30_000 });
    await expect(toggle).toBeVisible({ timeout: 30_000 });

    if ((await batch.getAttribute('data-state')) !== 'expanded') {
      await toggle.click();
    }

    await expect(batch).toHaveAttribute('data-state', 'expanded');
    expanded.push(batch);
  }

  return expanded;
}

export async function expandFirstArchiveBatch(page: Page): Promise<Locator> {
  const [firstBatch] = await expandArchiveBatches(page, 1);
  if (firstBatch == null) {
    throw new Error('No archive batches were available on the current ChatGPT page.');
  }

  return firstBatch;
}

export async function findFirstAssistantArchiveEntry(page: Page, scope?: Locator): Promise<Locator> {
  if (scope == null) {
    await openNewestArchivePage(page);
    await expandArchiveBatches(page, 8);
  }

  const assistantSelector = '[data-message-author-role="assistant"]';
  const batch = scope ?? page.locator('[data-turbo-render-batch-anchor="true"]');
  const timeoutMs = 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const assistantEntry = batch
      .locator(`.${UI_CLASS_NAMES.inlineBatchEntry}`)
      .filter({ has: page.locator(assistantSelector) })
      .first();

    try {
      await expect(assistantEntry).toBeAttached({ timeout: 5_000 });
      await assistantEntry.scrollIntoViewIfNeeded();
      await expect(assistantEntry).toBeVisible({ timeout: 30_000 });
      return assistantEntry;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(200);
    }
  }

  throw lastError ?? new Error('Unable to locate the first assistant archive entry.');
}

export async function expectLiveTargetRuntimeStatusForPage(
  source: LiveRuntimeStatusSource,
  target: ResolvedLiveChatTarget,
  page: Page,
): Promise<TabStatusResponse> {
  const startedAt = Date.now();
  const timeoutMs = 45_000;
  let lastStatus: TabStatusResponse | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getRuntimeStatusForActivePage(source, page, target.url);
    lastStatus = status;

    const runtime = status.runtime;
    const routeMatches = runtime?.routeKind === target.routeKind;
    const chatMatches = target.conversationId == null || (runtime?.chatId ?? '').includes(target.conversationId);

    if (runtime != null && routeMatches && chatMatches) {
      return status;
    }

    await waitForDelay(500);
  }

  expect(lastStatus?.runtime).not.toBeNull();
  expect(lastStatus?.runtime?.routeKind).toBe(target.routeKind);

  if (target.conversationId != null) {
    expect(lastStatus?.runtime?.chatId ?? '').toContain(target.conversationId);
  }

  return lastStatus!;
}

export async function sampleLivePerformance(
  source: LiveRuntimeStatusSource,
  target: ResolvedLiveChatTarget,
  page: Page,
  phase: LivePerformancePhase,
): Promise<LivePerformanceSample> {
  const status = await expectLiveTargetRuntimeStatusForPage(source, target, page);
  const runtime = status.runtime;
  expect(runtime, `${phase} runtime status`).not.toBeNull();

  const sample = createLivePerformanceSample(phase, runtime!);
  expectLivePerformanceSampleInvariants(sample);
  console.log(`[TurboRender][live-metrics] ${JSON.stringify(sample)}`);
  return sample;
}

export async function expectArchivedEntryReadAloudMenu(
  page: Page,
  assistantEntry?: Locator,
): Promise<{
  archiveEntry: Locator;
  moreButton: Locator;
  menu: ReturnType<Page['locator']>;
  readAloudButton: Locator;
  moreButtonBox: { x: number; y: number; width: number; height: number };
  menuBox: { x: number; y: number; width: number; height: number } | null;
  openLatencyMs: number;
}> {
  const archiveEntry = assistantEntry ?? (await findFirstAssistantArchiveEntry(page));
  await expect(archiveEntry).toBeVisible({ timeout: 30_000 });

  const isArchiveEntry = await archiveEntry.evaluate((element, inlineBatchEntryClassName) => {
    return (
      element.closest('[data-turbo-render-batch-anchor="true"]') != null &&
      element.closest(`.${inlineBatchEntryClassName}`) != null
    );
  }, UI_CLASS_NAMES.inlineBatchEntry);
  expect(isArchiveEntry, 'read aloud source must be a TurboRender archive entry').toBe(true);

  const assistantMoreButtons = archiveEntry.locator('button[data-turbo-render-action="more"]:visible');
  await expect(assistantMoreButtons.first()).toBeVisible({ timeout: 30_000 });
  const hostMenuData = await openReadAloudMenuFromMoreButtons(page, assistantMoreButtons, {
    requireReadAloud: true,
    requireTurboRenderMenu: true,
  });
  expect(hostMenuData, 'expected an archived-entry read-aloud popover').not.toBeNull();

  const resolvedMenuData = hostMenuData!;
  const isTurboRenderArchiveMenu = await resolvedMenuData.menu.evaluate((menu, inlineBatchEntryClassName) => {
    return (
      (menu as HTMLElement).dataset.turboRenderEntryMenu === 'true' &&
      menu.closest('[data-turbo-render-batch-anchor="true"]') != null &&
      menu.closest(`.${inlineBatchEntryClassName}`) != null
    );
  }, UI_CLASS_NAMES.inlineBatchEntry);
  expect(isTurboRenderArchiveMenu, 'read-aloud menu must be TurboRender-owned and inside the archive entry').toBe(true);

  const clickedArchiveButton = await resolvedMenuData.moreButton.evaluate((button, inlineBatchEntryClassName) => {
    return (
      button.closest('[data-turbo-render-batch-anchor="true"]') != null &&
      button.closest(`.${inlineBatchEntryClassName}`) != null
    );
  }, UI_CLASS_NAMES.inlineBatchEntry);
  expect(clickedArchiveButton, 'clicked read-aloud More button must stay inside TurboRender archive').toBe(true);

  await expect(resolvedMenuData.menu).toBeVisible({ timeout: 10_000 });
  const readAloudButton = resolvedMenuData.menu.getByRole('menuitem', { name: /朗读|read aloud/i });
  await expect(readAloudButton).toBeVisible({ timeout: 10_000 });

  return {
    archiveEntry,
    ...resolvedMenuData,
    readAloudButton,
  };
}

export async function openReadAloudMenuFromMoreButtons(
  page: Page,
  moreButtons: Locator,
  options?: {
    requireReadAloud?: boolean;
    requireTurboRenderMenu?: boolean;
  },
): Promise<{
  moreButton: Locator;
  menu: ReturnType<Page['locator']>;
  moreButtonBox: { x: number; y: number; width: number; height: number };
  menuBox: { x: number; y: number; width: number; height: number } | null;
  openLatencyMs: number;
} | null> {
  const resolveVisibleMenu = async (): Promise<Locator | null> => {
    const inlineMenu = page.locator('[data-turbo-render-entry-menu="true"]:visible');
    if ((await inlineMenu.count()) > 0) {
      return inlineMenu.last();
    }

    if (options?.requireTurboRenderMenu === true) {
      return null;
    }

    const hostMenu = page.locator('[role="menu"]:visible');
    if ((await hostMenu.count()) > 0) {
      return hostMenu.last();
    }

    return null;
  };

  const count = await moreButtons.count();
  const visibleIndices = await moreButtons.evaluateAll((buttons) =>
    buttons
      .map((button, index) => {
        const rect = (button as HTMLElement).getBoundingClientRect();
        return {
          index,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((candidate) => candidate.visible)
      .map((candidate) => candidate.index),
  );

  const candidateIndices = visibleIndices.length > 0 ? visibleIndices : Array.from({ length: count }, (_, index) => index);
  for (const index of candidateIndices) {
    const moreButton = moreButtons.nth(index);
    await moreButton.scrollIntoViewIfNeeded();
    const anchorBox = await readClientRect(moreButton);
    if (anchorBox == null) {
      continue;
    }

    const openedAt = Date.now();
    await moreButton.click();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await page.waitForTimeout(100);
      const menu = await resolveVisibleMenu();
      if (menu != null) {
        const menuBox = await readClientRect(menu);
        if (options?.requireReadAloud === true) {
          await page.waitForTimeout(150);
          const menuTexts = await menu
            .getByRole('menuitem')
            .evaluateAll((items) =>
              items
                .flatMap((item) => [item.textContent?.trim() ?? '', item.getAttribute('aria-label')?.trim() ?? ''])
                .filter(Boolean),
            );
          const hasReadAloud = menuTexts.some((text) => /朗读|read aloud/i.test(text));
          if (!hasReadAloud) {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(100);
            continue;
          }
        }

        return {
          moreButton,
          menu,
          moreButtonBox: anchorBox,
          menuBox,
          openLatencyMs: Date.now() - openedAt,
        };
      }
    }

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(100);
  }

  return null;
}

export async function getTabStatusForActivePage(
  browserHandle: ControlledBrowserHandle,
  page: Page,
  targetUrl: string,
): Promise<TabStatusResponse> {
  await page.bringToFront();

  return await withExtensionPopupPage(
    browserHandle,
    async (extensionPage) => {
      await page.bringToFront();
      await waitForDelay(200);

      const tabs = await queryTabs(extensionPage, { active: true, currentWindow: true });
      const target = tabs.find((tab) => matchesTargetUrl(tab.url ?? '', targetUrl)) ?? null;
      if (target?.id == null) {
        const activeUrls = tabs.map((tab) => tab.url ?? '(missing url)').join(', ');
        throw new Error(`Active tab did not match ${targetUrl}. Active tab(s): ${activeUrls}`);
      }

      return await requestTabStatus(extensionPage, target.id);
    },
    page,
  );
}

export async function openLiveRuntimeStatusClient(browserHandle: ControlledBrowserHandle): Promise<LiveRuntimeStatusClient> {
  if (browserHandle.userDataDir == null) {
    throw new Error('Controlled browser profile path is unavailable.');
  }

  const context = getPrimaryContext(browserHandle);
  const extensionId = await resolveExtensionIdFromProfile(browserHandle.userDataDir);
  const extensionPage = await context.newPage();
  let closed = false;

  await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return {
    async getTabStatusForActivePage(page: Page, targetUrl: string): Promise<TabStatusResponse> {
      if (closed) {
        throw new Error('Live runtime status client is already closed.');
      }

      await page.bringToFront();
      await waitForDelay(200);

      const tabs = await queryTabs(extensionPage, { active: true, currentWindow: true });
      const target = tabs.find((tab) => matchesTargetUrl(tab.url ?? '', targetUrl)) ?? null;
      if (target?.id == null) {
        const activeUrls = tabs.map((tab) => tab.url ?? '(missing url)').join(', ');
        throw new Error(`Active tab did not match ${targetUrl}. Active tab(s): ${activeUrls}`);
      }

      return await requestTabStatus(extensionPage, target.id);
    },

    async getTabStatusForUrl(targetUrl: string): Promise<TabStatusResponse> {
      if (closed) {
        throw new Error('Live runtime status client is already closed.');
      }

      const tabs = await queryTabs(extensionPage, {});
      const target = tabs.find((tab) => matchesTargetUrl(tab.url ?? '', targetUrl)) ?? null;
      return await requestTabStatus(extensionPage, target?.id);
    },

    async close(): Promise<void> {
      closed = true;
      await extensionPage.close().catch(() => undefined);
    },
  };
}
