import {
  classifyChatgptRouteKind,
  isChatgptHostUrl,
  matchesExactChatTargetUrl,
} from './live-targets-lib.mjs';

const INLINE_HISTORY_SELECTOR = '[data-turbo-render-inline-history-root="true"]';
const UI_ROOT_SELECTOR = '[data-turbo-render-ui-root="true"]';
const BOUNDARY_ROOT_SELECTOR = '.inlineHistoryBoundary';
const BOUNDARY_BUTTON_SELECTOR =
  '[data-turbo-render-action="open-archive-newest"],[data-turbo-render-action="go-archive-older"],[data-turbo-render-action="go-archive-newer"],[data-turbo-render-action="go-archive-recent"],[data-turbo-render-action="toggle-archive-search"]';
const GROUP_SELECTOR = '[data-turbo-render-group-id]';
const TOGGLE_SELECTOR = '[data-turbo-render-action="toggle-archive-group"]';
const BATCH_ANCHOR_SELECTOR = '[data-turbo-render-batch-anchor="true"]';
const MESSAGE_SELECTOR = '[data-message-id]';
const LIVE_PERFORMANCE_NUMERIC_FIELDS = [
  'archivePageCount',
  'liveDescendantCount',
  'spikeCount',
  'parkedGroups',
  'residentParkedGroups',
  'serializedParkedGroups',
];

export function collectChatgptPages(pages) {
  return pages.filter((page) => isChatgptHostUrl(page.url()));
}

export function selectExactChatgptPage(pages, targetUrl) {
  const chatgptPages = collectChatgptPages(pages);
  const exactPages = chatgptPages.filter((page) => matchesExactChatTargetUrl(page.url(), targetUrl));

  return {
    chatgptPages,
    exactPages,
    matchedPage: exactPages[0] ?? null,
  };
}

export function selectExactChatgptExtensionTab(tabs, targetUrl) {
  return tabs.find((tab) => typeof tab?.url === 'string' && matchesExactChatTargetUrl(tab.url, targetUrl)) ?? null;
}

function normalizeRuntimeMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function normalizeRuntimePageIndex(value) {
  if (value == null) {
    return null;
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

export function createLivePerformanceSample(phase, runtime) {
  if (runtime == null) {
    return null;
  }

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

export function validateLivePerformanceSample(sample) {
  if (sample == null) {
    return ['runtime status is unavailable'];
  }

  const errors = [];
  for (const field of LIVE_PERFORMANCE_NUMERIC_FIELDS) {
    const value = sample[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors.push(`${field} must be a finite non-negative number`);
    }
  }

  const pageIndex = sample.currentArchivePageIndex;
  if (pageIndex != null && (typeof pageIndex !== 'number' || !Number.isFinite(pageIndex) || pageIndex < 0)) {
    errors.push('currentArchivePageIndex must be null or a finite non-negative number');
  }

  if (errors.length === 0 && sample.residentParkedGroups + sample.serializedParkedGroups !== sample.parkedGroups) {
    errors.push('residentParkedGroups + serializedParkedGroups must equal parkedGroups');
  }

  return errors;
}

export function formatLivePerformanceSample(sample) {
  if (sample == null) {
    return 'runtime metrics unavailable';
  }

  const pageIndex = sample.currentArchivePageIndex == null ? 'recent' : String(sample.currentArchivePageIndex);
  return [
    `phase=${sample.phase}`,
    `archive-pages=${sample.archivePageCount}`,
    `current-page=${pageIndex}`,
    `live-descendants=${sample.liveDescendantCount}`,
    `spikes=${sample.spikeCount}`,
    `parked=${sample.parkedGroups}`,
    `resident=${sample.residentParkedGroups}`,
    `serialized=${sample.serializedParkedGroups}`,
  ].join(', ');
}

export async function inspectChatgptPage(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
  const routeKind = classifyChatgptRouteKind(page.url());

  return await page.evaluate(
    ({
      inlineHistorySelector,
      uiRootSelector,
      boundaryRootSelector,
      boundaryButtonSelector,
      groupSelector,
      toggleSelector,
      batchAnchorSelector,
      messageSelector,
      routeKind,
    }) => ({
      title: document.title,
      readyState: document.readyState,
      routeKind,
      inlineHistoryRoots: document.querySelectorAll(inlineHistorySelector).length,
      visibleInlineHistoryRoots: Array.from(document.querySelectorAll(inlineHistorySelector)).filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return !element.hidden && rect.width > 0 && rect.height > 0;
      }).length,
      uiRoots: document.querySelectorAll(uiRootSelector).length,
      boundaryRoots: document.querySelectorAll(boundaryRootSelector).length,
      boundaryButtons: document.querySelectorAll(boundaryButtonSelector).length,
      visibleBoundaryRoots: Array.from(document.querySelectorAll(boundaryRootSelector)).filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return !element.hidden && rect.width > 0 && rect.height > 0;
      }).length,
      batchAnchors: document.querySelectorAll(batchAnchorSelector).length,
      groups: document.querySelectorAll(groupSelector).length,
      toggleActions: document.querySelectorAll(toggleSelector).length,
      hostMessages: document.querySelectorAll(messageSelector).length,
    }),
    {
      inlineHistorySelector: INLINE_HISTORY_SELECTOR,
      uiRootSelector: UI_ROOT_SELECTOR,
      boundaryRootSelector: BOUNDARY_ROOT_SELECTOR,
      boundaryButtonSelector: BOUNDARY_BUTTON_SELECTOR,
      groupSelector: GROUP_SELECTOR,
      toggleSelector: TOGGLE_SELECTOR,
      batchAnchorSelector: BATCH_ANCHOR_SELECTOR,
      messageSelector: MESSAGE_SELECTOR,
      routeKind,
    },
  );
}

export function hasTurboRenderInjection(inspection) {
  return (
    inspection.inlineHistoryRoots > 0 ||
    inspection.uiRoots > 0 ||
    inspection.boundaryRoots > 0 ||
    inspection.boundaryButtons > 0 ||
    inspection.batchAnchors > 0 ||
    inspection.groups > 0 ||
    inspection.toggleActions > 0
  );
}

export function hasArchiveAccess(inspection) {
  return (
    inspection.visibleBoundaryRoots > 0 ||
    inspection.batchAnchors > 0 ||
    (inspection.visibleInlineHistoryRoots > 0 && inspection.boundaryButtons > 0)
  );
}

export async function waitForInspection(page, predicate, timeoutMs = 15_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastInspection = null;

  while (Date.now() < deadline) {
    try {
      const inspection = await inspectChatgptPage(page);
      lastInspection = inspection;
      if (predicate(inspection)) {
        return inspection;
      }
    } catch {
      // Keep polling until the page settles.
    }

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, intervalMs);
    });
  }

  return lastInspection;
}
