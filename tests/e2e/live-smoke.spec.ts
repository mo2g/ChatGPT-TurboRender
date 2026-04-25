import { expect, test, type Page } from '@playwright/test';

import { UI_CLASS_NAMES } from '../../lib/shared/constants';
import {
  readConfiguredLiveInputs,
  validateConfiguredLiveInputs,
  type ResolvedLiveChatTarget,
} from './chatgpt-live-targets';
import {
  clickArchiveSearchResult,
  expectArchivedEntryReadAloudMenu,
  expectArchiveBoundaryVisible,
  expectArchiveSearchHighlight,
  expectLiveTargetRuntimeStatusForPage,
  expectTurboRenderReady,
  expandArchiveBatches,
  expandFirstArchiveBatch,
  fillArchiveSearchQuery,
  findFirstAssistantArchiveEntry,
  goOlderArchivePage,
  navigateChatgptLiveTargetPage,
  openChatgptLiveTargetPage,
  openLiveRuntimeStatusClient,
  openNewestArchivePage,
  releaseChatgptLiveTargetPage,
  resetLiveChatSmokeState,
  resolveConfiguredLiveTarget,
  sampleLivePerformance,
  type LiveRuntimeStatusClient,
} from './chatgpt-real-page-helpers';
import { launchControlledBrowser, type ControlledBrowserHandle } from './controlled-browser';

const configuredInputs = validateConfiguredLiveInputs(readConfiguredLiveInputs());

test.skip(process.env.TURBO_RENDER_LIVE_TESTS !== '1', 'Set TURBO_RENDER_LIVE_TESTS=1 to run live ChatGPT regressions.');
test.describe.configure({ mode: 'serial' });

let browserHandle: ControlledBrowserHandle | null = null;
let resolvedTarget: ResolvedLiveChatTarget | null = null;
let livePage: Page | null = null;
let runtimeStatusClient: LiveRuntimeStatusClient | null = null;

test.beforeAll(async () => {
  browserHandle = await launchControlledBrowser('about:blank', { mode: 'require-existing' });
  resolvedTarget = await resolveConfiguredLiveTarget(browserHandle, configuredInputs);
  runtimeStatusClient = await openLiveRuntimeStatusClient(browserHandle);
  livePage = await openChatgptLiveTargetPage(browserHandle, resolvedTarget);
});

test.beforeEach(async () => {
  await navigateChatgptLiveTargetPage(getLivePage(), getResolvedTarget());
  await resetLiveChatSmokeState(getLivePage());
});

test.afterAll(async () => {
  if (livePage != null) {
    await releaseChatgptLiveTargetPage(livePage);
  }
  await runtimeStatusClient?.close().catch(() => undefined);
  await browserHandle?.cleanup();
  livePage = null;
  runtimeStatusClient = null;
  browserHandle = null;
  resolvedTarget = null;
});

function getResolvedTarget(): ResolvedLiveChatTarget {
  if (resolvedTarget == null) {
    throw new Error('Resolved live target is unavailable.');
  }

  return resolvedTarget;
}

function getLivePage(): Page {
  if (livePage == null) {
    throw new Error('Live ChatGPT page is unavailable.');
  }

  return livePage;
}

function getRuntimeStatusClient(): LiveRuntimeStatusClient {
  if (runtimeStatusClient == null) {
    throw new Error('Live runtime status client is unavailable.');
  }

  return runtimeStatusClient;
}

test('conversation archive smoke', async () => {
  test.setTimeout(120_000);

  const target = getResolvedTarget();
  const page = getLivePage();
  await expect(page).toHaveURL(target.url);
  await expectTurboRenderReady(page);
  await expectArchiveBoundaryVisible(page);

  const status = await expectLiveTargetRuntimeStatusForPage(getRuntimeStatusClient(), target, page);
  expect(status.runtime?.routeKind).toBe('chat');
  expect(status.runtime?.archivePageCount ?? 0).toBeGreaterThan(0);

  const firstBatch = await expandFirstArchiveBatch(page);
  await expect(firstBatch.locator('[data-turbo-render-action="toggle-archive-group"]')).toBeVisible();
  await expect(firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchMeta}`)).toBeVisible();
  await expect(firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchRail}`)).toBeVisible();

  const assistantEntry = await findFirstAssistantArchiveEntry(page, firstBatch);
  await expect(assistantEntry).toHaveAttribute('data-conversation-id', target.conversationId ?? /.+/);
  await expect(assistantEntry.locator('[data-message-author-role="assistant"]').first()).toBeVisible({ timeout: 30_000 });
  const copyButton = assistantEntry.locator('button[data-turbo-render-action="copy"]').first();
  await expect(copyButton).toBeVisible({ timeout: 30_000 });
  await copyButton.click();
  await expect(copyButton).toHaveAttribute('data-copy-state', 'copied', { timeout: 10_000 });
  const moreButton = assistantEntry.locator('button[data-turbo-render-action="more"]').first();
  await expect(moreButton).toBeVisible({ timeout: 30_000 });
  const actionRow = assistantEntry
    .locator('[data-turbo-render-template-wrapper="true"]:has(button[data-turbo-render-action="more"])')
    .first();
  await expect(actionRow).toBeVisible({ timeout: 30_000 });
  const actionRowLayout = await actionRow.evaluate((row) => {
    const style = getComputedStyle(row);
    const buttonRects = [...row.querySelectorAll<HTMLElement>('button[data-turbo-render-action]')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        action: button.dataset.turboRenderAction ?? '',
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
    return {
      buttonRects,
      flexWrap: style.flexWrap,
      maskImage: style.maskImage,
      webkitMaskImage: style.webkitMaskImage,
    };
  });
  expect(actionRowLayout.maskImage).toBe('none');
  expect(actionRowLayout.webkitMaskImage).toBe('none');
  expect(actionRowLayout.flexWrap).toBe('nowrap');
  expect(new Set(actionRowLayout.buttonRects.map((rect) => rect.y)).size).toBe(1);
  expect(actionRowLayout.buttonRects.every((rect) => rect.width > 0 && rect.height > 0)).toBe(true);
  const citationLinks = assistantEntry.locator('[data-turbo-render-citation="true"] a');
  if ((await citationLinks.count()) > 0) {
    await expect(citationLinks.first()).toHaveAttribute('href', /^https?:\/\//);
  }
});

test('long conversation smoke', async () => {
  test.setTimeout(120_000);

  const target = getResolvedTarget();
  const page = getLivePage();
  await expect(page).toHaveURL(target.url);
  await expectTurboRenderReady(page);
  await expectArchiveBoundaryVisible(page);
  await expect(page.locator('[data-turbo-render-batch-anchor="true"]')).toHaveCount(0);

  const status = await expectLiveTargetRuntimeStatusForPage(getRuntimeStatusClient(), target, page);
  expect(status.runtime?.routeKind).toBe('chat');
  expect(status.runtime?.archivePageCount ?? 0).toBeGreaterThan(0);

  await expandArchiveBatches(page, 4);

  const batchAnchors = page.locator('[data-turbo-render-batch-anchor="true"]');
  await expect(batchAnchors.first()).toBeVisible({ timeout: 30_000 });
  expect(await batchAnchors.count()).toBeGreaterThan(0);

  const firstBatch = await expandFirstArchiveBatch(page);
  await expect(firstBatch.locator(`.${UI_CLASS_NAMES.inlineBatchEntry}`).first()).toBeVisible({ timeout: 30_000 });

  const scrollRoot = page.locator('[data-scroll-root]').first();
  await scrollRoot.evaluate((node) => {
    if (node instanceof HTMLElement) {
      node.scrollTop = Math.min(node.scrollHeight - node.clientHeight, Math.round(node.scrollHeight * 0.33));
    }
  });
  await page.waitForTimeout(400);
  await expect(page.locator('[data-turbo-render-inline-history-root="true"]')).toBeVisible();
});

test('read aloud host-linkage smoke', async () => {
  test.setTimeout(120_000);

  const target = getResolvedTarget();
  const page = getLivePage();
  const synthesizeRequests: string[] = [];
  const synthesizeResponses: Array<{ url: string; status: number; contentType: string }> = [];
  const handleRequest = (request: { url(): string }) => {
    const url = request.url();
    if (url.includes('/backend-api/synthesize')) {
      synthesizeRequests.push(url);
    }
  };
  const handleResponse = (response: { url(): string; status(): number; headers(): Record<string, string> }) => {
    const url = response.url();
    if (url.includes('/backend-api/synthesize')) {
      synthesizeResponses.push({
        url,
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
      });
    }
  };
  page.on('request', handleRequest);
  page.on('response', handleResponse);

  try {
    await expectTurboRenderReady(page);
    const [firstExpandedBatch] = await expandArchiveBatches(page, 8);
    if (firstExpandedBatch == null) {
      throw new Error('No archive batch was available for the archived-entry read aloud smoke.');
    }

    const archiveAssistantEntry = await findFirstAssistantArchiveEntry(page, firstExpandedBatch);
    const hostMenuData = await expectArchivedEntryReadAloudMenu(page, archiveAssistantEntry);
    expect(hostMenuData.openLatencyMs).toBeLessThan(4_500);
    await hostMenuData.readAloudButton.evaluate((node) => {
      if (node instanceof HTMLElement) {
        node.click();
      }
    });
    await expect(hostMenuData.menu.getByRole('menuitem', { name: /停止朗读|stop reading/i })).toBeVisible({
      timeout: 10_000,
    });

    await expect.poll(() => synthesizeRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => synthesizeResponses.length, { timeout: 15_000 }).toBeGreaterThan(0);

    const synthesizeResponse = synthesizeResponses[0]!;
    expect(synthesizeResponse.status).toBeGreaterThanOrEqual(200);
    expect(synthesizeResponse.status).toBeLessThan(300);

    const requestUrl = new URL(synthesizeResponse.url || synthesizeRequests[0]!);
    expect(requestUrl.searchParams.get('conversation_id')).toBe(target.conversationId);
    const messageId = requestUrl.searchParams.get('message_id');
    expect(messageId).not.toBeNull();
    expect(messageId).not.toBe('');
    expect(messageId).not.toMatch(/^turn-chat:/);
    expect(requestUrl.searchParams.get('voice')).toBe('cove');
    expect(requestUrl.searchParams.get('format')).toBe('aac');
  } finally {
    page.off('request', handleRequest);
    page.off('response', handleResponse);
  }
});

test('archive search jump smoke', async () => {
  test.setTimeout(120_000);

  const target = getResolvedTarget();
  const page = getLivePage();
  await expect(page).toHaveURL(target.url);
  await expectTurboRenderReady(page);
  await expectArchiveBoundaryVisible(page);

  await fillArchiveSearchQuery(page, 'localhost:5000');

  const searchResults = page.locator('[data-turbo-render-action="open-archive-search-result"]');
  await expect(searchResults.first()).toBeVisible({ timeout: 30_000 });

  await clickArchiveSearchResult(page, 0);

  const batchAnchors = page.locator('[data-turbo-render-batch-anchor="true"]');
  await expect(batchAnchors.first()).toBeVisible({ timeout: 30_000 });
  await expectArchiveSearchHighlight(page);
});

test('real-host performance baseline smoke', async () => {
  test.setTimeout(180_000);

  const target = getResolvedTarget();
  const page = getLivePage();
  await expect(page).toHaveURL(target.url);
  await expectTurboRenderReady(page);
  await expectArchiveBoundaryVisible(page);

  const recentView = await sampleLivePerformance(getRuntimeStatusClient(), target, page, 'recent-view');
  expect(recentView.archivePageCount).toBeGreaterThan(0);
  expect(recentView.currentArchivePageIndex).toBeNull();

  await openNewestArchivePage(page);
  const batchAnchors = page.locator('[data-turbo-render-batch-anchor="true"]');
  await expect(batchAnchors.first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(250);

  const newestPage = await sampleLivePerformance(getRuntimeStatusClient(), target, page, 'newest-archive-page');
  expect(newestPage.archivePageCount).toBe(recentView.archivePageCount);
  expect(newestPage.currentArchivePageIndex).toBe(newestPage.archivePageCount - 1);

  const samples = [recentView, newestPage];
  const newestPageIndex = newestPage.currentArchivePageIndex;
  if (newestPageIndex == null) {
    throw new Error('Newest archive page did not report a current archive page index.');
  }

  if (newestPage.archivePageCount > 1) {
    await goOlderArchivePage(page);
    await expect(batchAnchors.first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(250);

    const olderPage = await sampleLivePerformance(getRuntimeStatusClient(), target, page, 'older-archive-page');
    expect(olderPage.archivePageCount).toBe(newestPage.archivePageCount);
    expect(olderPage.currentArchivePageIndex).toBe(newestPageIndex - 1);
    samples.push(olderPage);
  }

  await fillArchiveSearchQuery(page, 'localhost:5000');
  const searchResults = page.locator('[data-turbo-render-action="open-archive-search-result"]');
  await expect(searchResults.first()).toBeVisible({ timeout: 30_000 });
  await clickArchiveSearchResult(page, 0);
  await expect(batchAnchors.first()).toBeVisible({ timeout: 30_000 });
  await expectArchiveSearchHighlight(page);
  await page.waitForTimeout(250);

  const searchJump = await sampleLivePerformance(getRuntimeStatusClient(), target, page, 'archive-search-jump');
  expect(searchJump.archivePageCount).toBe(newestPage.archivePageCount);
  expect(searchJump.currentArchivePageIndex).not.toBeNull();
  expect(searchJump.currentArchivePageIndex ?? -1).toBeGreaterThanOrEqual(0);
  expect(searchJump.currentArchivePageIndex ?? searchJump.archivePageCount).toBeLessThan(searchJump.archivePageCount);
  samples.push(searchJump);

  console.log(
    `[TurboRender][live-metrics-summary] ${JSON.stringify({
      spikeDelta: searchJump.spikeCount - recentView.spikeCount,
      samples,
    })}`,
  );
});
