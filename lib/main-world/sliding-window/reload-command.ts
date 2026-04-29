import { resolveConversationRoute } from '../../shared/chat-id';
import {
  buildSlidingWindowPairIndex,
  buildSlidingWindowSearchIndex,
  getCenteredWindowRange,
  getFirstWindowRange,
  getLatestWindowRange,
  getNewerWindowRange,
  getOlderWindowRange,
  getWindowPageRange,
  searchSlidingWindowPairs,
  type ConversationPayload,
  type SlidingWindowRange,
  type SlidingWindowSearchEntry,
} from '../../shared/sliding-window';
import {
  getSlidingWindowCache,
  type SlidingWindowCacheEntry,
} from './idb-cache';
import {
  clearSlidingWindowSessionState,
  readSlidingWindowSessionState,
  writeSlidingWindowSessionState,
  type SlidingWindowSessionState,
} from './session-state';
import {
  clearAllSlidingWindowRenderTickets,
  clearSlidingWindowRenderTicket,
} from './render-ticket';
import {
  createSlidingWindowRuntimeState,
  clearAllSlidingWindowRuntimeState,
  clearSlidingWindowRuntimeState,
  emitSlidingWindowState,
  readSlidingWindowRuntimeState,
} from './runtime-status';
import { postBridgeMessage } from '../../shared/runtime-bridge';

export type SlidingWindowNavigationDirection = 'first' | 'older' | 'newer' | 'latest' | 'search' | 'page';

export function resolveCurrentSlidingConversationId(win: Window): string | null {
  const route = resolveConversationRoute(win.location?.pathname ?? '/');
  return route.kind === 'chat' ? route.routeId : null;
}

export function resolveSlidingConversationId(win: Window, candidate: string | null): string | null {
  return candidate?.trim() || resolveCurrentSlidingConversationId(win);
}

function currentRangeFor(
  win: Window,
  conversationId: string,
  entry: SlidingWindowCacheEntry,
  windowPairs: number,
  cacheTicket?: SlidingWindowSessionState | null,
): SlidingWindowRange {
  const runtimeState = readSlidingWindowRuntimeState(conversationId, win);
  if (runtimeState?.range != null) {
    return runtimeState.range;
  }

  const sessionState = cacheTicket ?? readSlidingWindowSessionState(win);
  if (sessionState?.conversationId === conversationId && sessionState.targetRange != null) {
    return sessionState.targetRange;
  }

  return getLatestWindowRange(entry.pairIndex.totalPairs, windowPairs);
}

export async function emitCurrentSlidingWindowState(input: {
  win: Window;
  conversationId: string | null;
  windowPairs: number;
  cacheTicket?: SlidingWindowSessionState | null;
}): Promise<void> {
  const conversationId = resolveSlidingConversationId(input.win, input.conversationId);
  if (conversationId == null) {
    return;
  }

  const entry = await getSlidingWindowCache(input.win)?.read(conversationId);
  if (entry == null) {
    return;
  }

  emitSlidingWindowState(
    input.win,
    createSlidingWindowRuntimeState(
      conversationId,
      entry,
      currentRangeFor(input.win, conversationId, entry, input.windowPairs, input.cacheTicket),
      null,
      input.cacheTicket?.requestedAt ?? Date.now(),
    ),
  );
}

export function resolveSlidingWindowTargetRange(input: {
  current: SlidingWindowRange;
  totalPairs: number;
  windowPairs: number;
  direction: SlidingWindowNavigationDirection;
  targetPairIndex?: number;
  targetPage?: number;
}): SlidingWindowRange {
  return input.direction === 'first'
    ? getFirstWindowRange(input.totalPairs, input.windowPairs)
    : input.direction === 'older'
    ? getOlderWindowRange(input.current, input.totalPairs, input.windowPairs)
    : input.direction === 'newer'
      ? getNewerWindowRange(input.current, input.totalPairs, input.windowPairs)
      : input.direction === 'page' && input.targetPage != null
        ? getWindowPageRange(input.totalPairs, input.windowPairs, input.targetPage)
        : input.direction === 'search' && input.targetPairIndex != null
          ? getCenteredWindowRange(input.targetPairIndex, input.totalPairs, input.windowPairs)
          : getLatestWindowRange(input.totalPairs, input.windowPairs);
}

export function reloadSlidingWindowWithTicket(input: {
  win: Window;
  conversationId: string;
  targetRange: SlidingWindowRange | null;
  reason: string;
  useCache?: boolean;
}): void {
  if (input.useCache === false) {
    clearSlidingWindowSessionState(input.win);
    input.win.location.reload();
    return;
  }

  writeSlidingWindowSessionState(input.win, {
    conversationId: input.conversationId,
    targetRange: input.targetRange,
    requestedAt: Date.now(),
    reloadReason: input.reason,
    useCache: true,
  });
  input.win.location.reload();
}

export async function navigateSlidingWindow(input: {
  win: Window;
  conversationId: string | null;
  windowPairs: number;
  direction: SlidingWindowNavigationDirection;
  targetPairIndex?: number;
  targetPage?: number;
  useCache?: boolean;
}): Promise<void> {
  const conversationId = resolveSlidingConversationId(input.win, input.conversationId);
  if (conversationId == null) {
    return;
  }

  const entry = await getSlidingWindowCache(input.win)?.read(conversationId);
  if (entry == null) {
    return;
  }

  const current = currentRangeFor(input.win, conversationId, entry, input.windowPairs);
  const targetRange = resolveSlidingWindowTargetRange({
    current,
    totalPairs: entry.pairIndex.totalPairs,
    windowPairs: input.windowPairs,
    direction: input.direction,
    targetPairIndex: input.targetPairIndex,
    targetPage: input.targetPage,
  });

  reloadSlidingWindowWithTicket({
    win: input.win,
    conversationId,
    targetRange,
    reason: input.direction,
    useCache: input.useCache,
  });
}

interface PayloadCacheWindow extends Window {
  __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
}

function resolveSearchIndexFromPayloadCache(
  win: Window,
  conversationId: string,
): SlidingWindowSearchEntry[] | null {
  const payload = (win as PayloadCacheWindow).__turboRenderConversationPayloadCache?.[conversationId];
  if (payload == null) {
    return null;
  }
  const pairIndex = buildSlidingWindowPairIndex(payload);
  if (pairIndex.totalPairs <= 0) {
    return null;
  }
  return buildSlidingWindowSearchIndex(pairIndex);
}

export async function searchSlidingWindowCache(input: {
  win: Window;
  conversationId: string | null;
  requestId: string;
  query: string;
}): Promise<void> {
  const conversationId = resolveSlidingConversationId(input.win, input.conversationId);
  const entry = conversationId != null ? await getSlidingWindowCache(input.win)?.read(conversationId) : null;

  // 优先使用 IndexedDB 缓存的搜索索引，如果没有则尝试从 payload 缓存构建
  const searchIndex = entry?.searchIndex ?? (conversationId != null ? resolveSearchIndexFromPayloadCache(input.win, conversationId) : null);

  postBridgeMessage(input.win, {
    namespace: 'chatgpt-turborender',
    type: 'TURBO_RENDER_SLIDING_WINDOW_SEARCH_RESULTS',
    payload: {
      requestId: input.requestId,
      conversationId,
      query: input.query,
      results: searchIndex == null ? [] : searchSlidingWindowPairs(searchIndex, input.query, 20),
    },
  });
}

export async function clearSlidingWindowCache(input: {
  win: Window;
  conversationId: string | null;
  scope: 'conversation' | 'all';
}): Promise<void> {
  const cache = getSlidingWindowCache(input.win);
  if (cache == null) {
    return;
  }

  if (input.scope === 'all') {
    await cache.clearAll?.();
    clearAllSlidingWindowRuntimeState();
    clearAllSlidingWindowRenderTickets();
    clearSlidingWindowSessionState(input.win);
    return;
  }

  const conversationId = resolveSlidingConversationId(input.win, input.conversationId);
  if (conversationId != null) {
    await cache.clearConversation?.(conversationId);
    clearSlidingWindowRuntimeState(conversationId);
    clearSlidingWindowRenderTicket(conversationId);
    clearSlidingWindowSessionState(input.win);
  }
}
