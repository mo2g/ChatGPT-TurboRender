import {
  SLIDING_WINDOW_SCHEMA_VERSION,
  getLatestWindowRange,
  sliceConversationToWindow,
  type SlidingWindowRange,
} from '../../shared/sliding-window';
import {
  getSlidingWindowCache,
  type SlidingWindowCacheEntry,
} from './idb-cache';
import {
  buildSlidingWindowDomVerificationTarget,
  renderOfficialSlidingWindow,
} from './official-renderer';
import {
  createSlidingWindowRuntimeState,
  emitSlidingWindowState,
  readSlidingWindowRuntimeState,
} from './runtime-status';
import {
  clearSlidingWindowRenderTicket,
  writeSlidingWindowRenderTicket,
} from './render-ticket';
import {
  reloadSlidingWindowWithTicket,
  resolveCurrentSlidingConversationId,
  resolveSlidingConversationId,
  resolveSlidingWindowTargetRange,
  type SlidingWindowNavigationDirection,
} from './reload-command';
import { mwLogger } from '../logger';

function currentRangeFor(
  conversationId: string,
  entry: SlidingWindowCacheEntry,
  windowPairs: number,
  win: Window,
): SlidingWindowRange {
  return readSlidingWindowRuntimeState(conversationId, win)?.range ??
    getLatestWindowRange(entry.pairIndex.totalPairs, windowPairs);
}

function hasUnsafeStreamingState(doc: Document): boolean {
  const selectors = [
    '[data-testid="stop-button"]',
    '[aria-label*="Stop generating" i]',
    '[aria-label*="停止" i]',
    '[data-is-streaming="true"]',
    '[data-message-streaming="true"]',
    '.result-streaming',
  ];
  return selectors.some((selector) => {
    try {
      return doc.querySelector(selector) != null;
    } catch {
      return false;
    }
  });
}

function fallbackReload(input: {
  win: Window;
  conversationId: string;
  targetRange: SlidingWindowRange | null;
  reason: string;
}): void {
  clearSlidingWindowRenderTicket(input.conversationId);
  reloadSlidingWindowWithTicket({
    win: input.win,
    conversationId: input.conversationId,
    targetRange: input.targetRange,
    reason: input.reason,
    useCache: true,
  });
}

function cacheEntryUsable(entry: SlidingWindowCacheEntry, conversationId: string): boolean {
  return (
    !entry.meta.dirty &&
    entry.meta.schemaVersion === SLIDING_WINDOW_SCHEMA_VERSION &&
    entry.meta.conversationId === conversationId
  );
}

export async function navigateSlidingWindowInPlace(input: {
  win: Window;
  doc: Document;
  conversationId: string | null;
  windowPairs: number;
  direction: SlidingWindowNavigationDirection;
  targetPairIndex?: number;
  targetPage?: number;
  enableTimeoutFallback?: boolean;
}): Promise<void> {
  const navigateStartTime = Date.now();
  const conversationId = resolveSlidingConversationId(input.win, input.conversationId);
  mwLogger.debug('navigateSlidingWindowInPlace start:', {
    conversationId,
    direction: input.direction,
    targetPage: input.targetPage,
    targetPairIndex: input.targetPairIndex,
    timestamp: navigateStartTime,
  });
  if (conversationId == null) {
    return;
  }

  const currentRouteConversationId = resolveCurrentSlidingConversationId(input.win);
  if (currentRouteConversationId !== conversationId) {
    fallbackReload({
      win: input.win,
      conversationId,
      targetRange: null,
      reason: 'inplace-route-mismatch',
    });
    return;
  }

  const cache = getSlidingWindowCache(input.win);
  const entry = await cache?.read(conversationId);
  if (entry == null) {
    fallbackReload({
      win: input.win,
      conversationId,
      targetRange: null,
      reason: 'inplace-cache-missing',
    });
    return;
  }

  const currentRange = currentRangeFor(conversationId, entry, input.windowPairs, input.win);
  const targetRange = resolveSlidingWindowTargetRange({
    current: currentRange,
    totalPairs: entry.pairIndex.totalPairs,
    windowPairs: input.windowPairs,
    direction: input.direction,
    targetPairIndex: input.targetPairIndex,
    targetPage: input.targetPage,
  });

  if (!cacheEntryUsable(entry, conversationId)) {
    mwLogger.error('cache entry unusable:', {
      conversationId,
      cacheConversationId: entry.meta.conversationId,
      isDirty: entry.meta.dirty,
      schemaVersion: entry.meta.schemaVersion,
    });
    fallbackReload({
      win: input.win,
      conversationId,
      targetRange,
      reason: 'inplace-cache-unusable',
    });
    return;
  }

  if (hasUnsafeStreamingState(input.doc)) {
    mwLogger.error('unsafe streaming state detected');
    fallbackReload({
      win: input.win,
      conversationId,
      targetRange,
      reason: 'inplace-streaming-unsafe',
    });
    return;
  }

  const slice = sliceConversationToWindow(entry.payload, entry.pairIndex, targetRange);
  if (!slice.ok || slice.payload == null) {
    mwLogger.error('slice failed:', {
      conversationId,
      targetRange,
      reason: slice.reason,
    });
    fallbackReload({
      win: input.win,
      conversationId,
      targetRange,
      reason: slice.reason ?? 'inplace-slice-failed',
    });
    return;
  }

  const previousTarget = buildSlidingWindowDomVerificationTarget(
    entry.payload,
    entry.pairIndex,
    currentRange,
  );
  const target = buildSlidingWindowDomVerificationTarget(
    entry.payload,
    entry.pairIndex,
    slice.range,
  );
  const prepareTicket = (): void => {
    writeSlidingWindowRenderTicket({
      conversationId,
      targetRange: slice.range,
      requestedAt: Date.now(),
      reason: input.direction,
    });
  };

  const logMsg = `navigate start: dir=${input.direction}, target=${JSON.stringify(slice.range)}, current=${JSON.stringify(currentRange)}, time=${Date.now()}`;
  mwLogger.debug(logMsg);

  const rendered = await renderOfficialSlidingWindow({
    win: input.win,
    doc: input.doc,
    conversationId,
    payload: slice.payload,
    target,
    previous: previousTarget,
    prepareTicket,
  });

  const resultMsg = `render result: success=${rendered}, time=${Date.now()}`;
  mwLogger.debug(resultMsg);

  if (!rendered) {
    const fallbackEnabled = input.enableTimeoutFallback ?? false;
    const errorMsg = `FAIL: inplace render failed${fallbackEnabled ? ', falling back to reload' : ' (fallback disabled)'}. dir=${input.direction}, target=${JSON.stringify(slice.range)}, time=${Date.now()}`;
    mwLogger.error(errorMsg);

    // 只有启用了回退时才执行刷新回退
    if (fallbackEnabled) {
      fallbackReload({
        win: input.win,
        conversationId,
        targetRange: slice.range,
        reason: 'inplace-render-failed',
      });
    } else {
      mwLogger.debug('Timeout fallback is disabled. Navigation failed but page kept intact.');
    }
    return;
  }

  clearSlidingWindowRenderTicket(conversationId);
  emitSlidingWindowState(
    input.win,
    createSlidingWindowRuntimeState(
      conversationId,
      entry,
      slice.range,
      null,
      navigateStartTime,
    ),
  );
  mwLogger.debug('navigateSlidingWindowInPlace success:', {
    conversationId,
    range: slice.range,
    duration: Date.now() - navigateStartTime,
  });
}
