import { DEFAULT_SETTINGS } from '../../shared/constants';
import {
  extractConversationIdFromUrl,
  isConversationEndpoint,
  type ConversationPayload,
} from '../../shared/conversation-trim';
import type { TurboRenderPageConfig } from '../../shared/runtime-bridge';
import { isSlidingWindowMode } from '../../shared/types';
import {
  SLIDING_WINDOW_SCHEMA_VERSION,
  getLatestWindowRange,
  sliceConversationToWindow,
  type SlidingWindowRange,
} from '../../shared/sliding-window';
import {
  createSlidingWindowCacheEntry,
  getSlidingWindowCache,
  type SlidingWindowCacheEntry,
} from './idb-cache';
import {
  createSlidingWindowRuntimeState,
  emitSlidingWindowState,
} from './runtime-status';
import {
  clearSlidingWindowSessionState,
  readSlidingWindowSessionState,
  type SlidingWindowSessionState,
} from './session-state';
import {
  clearSlidingWindowRenderTicket,
  consumeSlidingWindowRenderTicket,
  readSlidingWindowRenderTicket,
} from './render-ticket';
import { createSyntheticConversationResponse } from './synthetic-response';

const READ_ALOUD_SNAPSHOT_QUERY = '__turbo_render_read_aloud_snapshot';

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof init?.method === 'string' && init.method.length > 0) {
    return init.method.toUpperCase();
  }

  if (input instanceof Request) {
    return input.method.toUpperCase();
  }

  return 'GET';
}

function shouldHandleSlidingWindowRequest(
  config: TurboRenderPageConfig,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  requestUrl: string,
  doc: Document,
): boolean {
  if (!config.enabled || !isSlidingWindowMode(config.mode)) {
    return false;
  }

  if (getRequestMethod(input, init) !== 'GET' || !isConversationEndpoint(requestUrl)) {
    return false;
  }

  try {
    const parsedUrl = new URL(requestUrl, doc.location.origin);
    return parsedUrl.searchParams.get(READ_ALOUD_SNAPSHOT_QUERY) !== '1';
  } catch {
    return true;
  }
}

function resolveTargetRange(
  win: Window,
  conversationId: string,
  totalPairs: number,
  windowPairs: number,
  cacheTicket?: SlidingWindowSessionState | null,
): SlidingWindowRange {
  if (cacheTicket?.conversationId === conversationId && cacheTicket.targetRange != null) {
    return cacheTicket.targetRange;
  }

  const state = readSlidingWindowSessionState(win);
  if (state?.conversationId === conversationId && state.targetRange != null) {
    return state.targetRange;
  }

  return getLatestWindowRange(totalPairs, windowPairs);
}

function createResponseFromCacheEntry(
  win: Window,
  conversationId: string,
  config: TurboRenderPageConfig,
  entry: SlidingWindowCacheEntry,
  options: {
    cacheTicket?: SlidingWindowSessionState | null;
    targetRange?: SlidingWindowRange | null;
    timestamp?: number;
  } = {},
): Response | null {
  if (
    entry.meta.dirty ||
    entry.meta.schemaVersion !== SLIDING_WINDOW_SCHEMA_VERSION ||
    entry.meta.conversationId !== conversationId
  ) {
    return null;
  }

  const windowPairs = config.slidingWindowPairs ?? DEFAULT_SETTINGS.slidingWindowPairs;
  const range = options.targetRange ??
    resolveTargetRange(win, conversationId, entry.pairIndex.totalPairs, windowPairs, options.cacheTicket);
  const slice = sliceConversationToWindow(entry.payload, entry.pairIndex, range);
  if (!slice.ok || slice.payload == null) {
    return null;
  }

  emitSlidingWindowState(win, createSlidingWindowRuntimeState(conversationId, entry, slice.range, null, options.timestamp));
  return createSyntheticConversationResponse(slice.payload);
}

function parseConversationPayload(bodyText: string): ConversationPayload | null {
  try {
    const parsed = JSON.parse(bodyText) as ConversationPayload;
    return typeof parsed === 'object' && parsed != null ? parsed : null;
  } catch {
    return null;
  }
}

export async function tryCreateSlidingWindowResponseBeforeNativeFetch(input: {
  win: Window;
  doc: Document;
  config: TurboRenderPageConfig;
  requestUrl: string;
  requestInput: RequestInfo | URL;
  init: RequestInit | undefined;
  cacheTicket?: SlidingWindowSessionState | null;
}): Promise<Response | null> {
  if (!shouldHandleSlidingWindowRequest(input.config, input.requestInput, input.init, input.requestUrl, input.doc)) {
    return null;
  }

  const conversationId = extractConversationIdFromUrl(input.requestUrl);
  if (conversationId == null) {
    return null;
  }

  const cache = getSlidingWindowCache(input.win);
  if (cache == null) {
    return null;
  }

  const renderTicket = readSlidingWindowRenderTicket(conversationId);
  if (renderTicket != null) {
    const entry = await cache.read(conversationId);
    if (entry == null) {
      clearSlidingWindowRenderTicket(conversationId);
      return null;
    }

    const response = createResponseFromCacheEntry(input.win, conversationId, input.config, entry, {
      targetRange: renderTicket.targetRange,
      timestamp: renderTicket.requestedAt,
    });
    if (response != null) {
      consumeSlidingWindowRenderTicket(conversationId);
    } else {
      clearSlidingWindowRenderTicket(conversationId);
    }
    return response;
  }

  const sessionState = input.cacheTicket ?? readSlidingWindowSessionState(input.win);
  if (sessionState == null) {
    return null;
  }

  if (sessionState.conversationId !== conversationId || sessionState.targetRange == null) {
    clearSlidingWindowSessionState(input.win);
    return null;
  }

  if (sessionState.useCache !== true) {
    clearSlidingWindowSessionState(input.win);
    return null;
  }

  const entry = await cache.read(conversationId);
  if (entry == null) {
    return null;
  }

  return createResponseFromCacheEntry(input.win, conversationId, input.config, entry, {
    cacheTicket: sessionState,
  });
}

export async function tryCreateSlidingWindowResponseAfterNativeFetch(input: {
  win: Window;
  doc: Document;
  config: TurboRenderPageConfig;
  requestUrl: string;
  requestInput: RequestInfo | URL;
  init: RequestInit | undefined;
  response: Response;
  cacheTicket?: SlidingWindowSessionState | null;
}): Promise<Response | null> {
  if (!shouldHandleSlidingWindowRequest(input.config, input.requestInput, input.init, input.requestUrl, input.doc)) {
    return null;
  }

  const conversationId = extractConversationIdFromUrl(input.requestUrl);
  if (conversationId == null) {
    return null;
  }

  try {
    if (!input.response.ok) {
      return null;
    }

    const bodyText = await input.response.clone().text();
    const payload = parseConversationPayload(bodyText);
    if (payload == null) {
      return null;
    }

    const entry = createSlidingWindowCacheEntry(conversationId, payload);
    if (entry == null) {
      return null;
    }

    const cache = getSlidingWindowCache(input.win);
    if (cache != null) {
      await cache.write(entry);
    }

    const windowPairs = input.config.slidingWindowPairs ?? DEFAULT_SETTINGS.slidingWindowPairs;
    const range = resolveTargetRange(
      input.win,
      conversationId,
      entry.pairIndex.totalPairs,
      windowPairs,
      input.cacheTicket?.useCache === true ? input.cacheTicket : null,
    );
    const slice = sliceConversationToWindow(payload, entry.pairIndex, range);
    if (!slice.ok || slice.payload == null) {
      return null;
    }

    emitSlidingWindowState(input.win, createSlidingWindowRuntimeState(conversationId, entry, slice.range, null, input.cacheTicket?.requestedAt));
    return createSyntheticConversationResponse(slice.payload, input.response);
  } finally {
    clearSlidingWindowSessionState(input.win);
  }
}
