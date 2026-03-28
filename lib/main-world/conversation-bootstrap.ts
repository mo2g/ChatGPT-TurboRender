import { DEFAULT_SETTINGS } from '../shared/constants';
import { resolveConversationRoute } from '../shared/chat-id';
import { shouldReplaceSession } from '../shared/session-precedence';
import {
  extractShareConversationPayload,
  extractConversationIdFromUrl,
  isConversationEndpoint,
  trimConversationPayload,
  type ConversationMappingNode,
  type ConversationPayload,
} from '../shared/conversation-trim';
import {
  isTurboRenderBridgeMessage,
  postBridgeMessage,
  toPageConfig,
  type TurboRenderPageConfig,
} from '../shared/runtime-bridge';
import type { InitialTrimSession, ResolvedConversationRoute } from '../shared/types';

interface BootstrapWindow extends Window {
  __turboRenderConversationBootstrapInstalled__?: boolean;
  __reactRouterContext?: {
    state?: {
      loaderData?: Record<string, unknown>;
    };
  };
}

interface SessionRecord {
  session: InitialTrimSession;
  coldMapping: Record<string, ConversationMappingNode>;
}

const SHARE_LOADER_KEY = 'routes/share.$shareId.($action)';

function resolveTrimRoute(doc: Document, conversationId: string | null): ResolvedConversationRoute {
  const route = resolveConversationRoute(doc.location?.pathname ?? '/');
  if (route.kind === 'chat' || route.kind === 'share') {
    return route;
  }

  if (conversationId != null) {
    return {
      kind: 'chat',
      routeId: conversationId,
      runtimeId: `chat:${conversationId}`,
    };
  }

  return route;
}

function createTrimSession(
  payload: ConversationPayload,
  requestUrl: string,
  doc: Document,
  config: TurboRenderPageConfig,
  routeOverride?: ResolvedConversationRoute,
) {
  const conversationId =
    routeOverride?.kind === 'share' ? null : extractConversationIdFromUrl(requestUrl);
  const route = routeOverride ?? resolveTrimRoute(doc, conversationId);
  return trimConversationPayload(payload, {
    chatId: route.runtimeId,
    routeKind: route.kind,
    routeId: route.routeId,
    conversationId,
    mode: config.mode,
    initialHotPairs: config.initialHotPairs,
    minVisibleTurns: config.minFinalizedBlocks,
  });
}

function createRewrittenResponse(response: Response, bodyText: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(bodyText, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canRewriteXhrResponse(xhr: XMLHttpRequest): boolean {
  return xhr.responseType === '' || xhr.responseType === 'text' || xhr.responseType === 'json';
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function canCaptureInitialSession(config: TurboRenderPageConfig): boolean {
  return config.enabled && config.initialTrimEnabled && config.mode === 'performance';
}

export function installConversationBootstrap(
  win: Window = window,
  doc: Document = document,
): () => void {
  const bootstrapWindow = win as BootstrapWindow;
  if (bootstrapWindow.__turboRenderConversationBootstrapInstalled__ === true) {
    return () => {};
  }
  bootstrapWindow.__turboRenderConversationBootstrapInstalled__ = true;

  let config = toPageConfig(DEFAULT_SETTINGS);
  const sessions = new Map<string, SessionRecord>();
  const shareSignatures = new Map<string, string>();
  let shareSyncHandle: number | null = null;
  let shareSyncAttempts = 0;

  const emitSession = (session: InitialTrimSession) => {
    postBridgeMessage(win, {
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SESSION_STATE',
      payload: session,
    });
  };

  const replayState = (chatId: string | null) => {
    if (chatId != null && sessions.has(chatId)) {
      emitSession(sessions.get(chatId)!.session);
      return;
    }

    for (const entry of sessions.values()) {
      emitSession(entry.session);
    }
  };

  const storeTrimResult = (
    requestUrl: string,
    payload: ConversationPayload,
    routeOverride?: ResolvedConversationRoute,
  ) => {
    const result = createTrimSession(payload, requestUrl, doc, config, routeOverride);
    if (result.session != null) {
      const current = sessions.get(result.session.chatId)?.session;
      if (shouldReplaceSession(current, result.session)) {
        sessions.set(result.session.chatId, {
          session: result.session,
          coldMapping: result.coldMapping,
        });
        emitSession(result.session);
      }
    }
    return result;
  };

  const rewriteConversationText = (requestUrl: string, bodyText: string): string | null => {
    if (!canCaptureInitialSession(config)) {
      return null;
    }

    let payload: ConversationPayload;
    try {
      payload = JSON.parse(bodyText) as ConversationPayload;
    } catch {
      return null;
    }

    const result = storeTrimResult(requestUrl, payload);
    if (!result.applied) {
      return null;
    }

    return safeJsonStringify(result.payload);
  };

  const readShareSessionCandidate = () => {
    const route = resolveConversationRoute(doc.location?.pathname ?? '/');
    if (route.kind !== 'share' || route.routeId == null) {
      return null;
    }

    const rawLoaderData = bootstrapWindow.__reactRouterContext?.state?.loaderData?.[SHARE_LOADER_KEY];
    const { shareId, payload } = extractShareConversationPayload(rawLoaderData);
    if (payload?.mapping == null) {
      return null;
    }

    const requestUrl = `https://chatgpt.com/share/${shareId ?? route.routeId}`;
    const mappingCount = Object.keys(payload.mapping).length;
    const updateTime =
      typeof (payload as Record<string, unknown>).update_time === 'number'
        ? String((payload as Record<string, unknown>).update_time)
        : '';

    return {
      route,
      requestUrl,
      payload,
      signature: `${shareId ?? route.routeId}:${mappingCount}:${String(payload.current_node ?? '')}:${updateTime}`,
    };
  };

  const syncShareSession = (): boolean => {
    if (!canCaptureInitialSession(config)) {
      return false;
    }

    const candidate = readShareSessionCandidate();
    if (candidate == null) {
      return false;
    }

    if (shareSignatures.get(candidate.route.runtimeId) === candidate.signature) {
      return true;
    }

    const result = storeTrimResult(candidate.requestUrl, candidate.payload, candidate.route);
    if (result.session == null) {
      return false;
    }

    shareSignatures.set(candidate.route.runtimeId, candidate.signature);
    return true;
  };

  const clearShareSync = () => {
    if (shareSyncHandle != null) {
      win.clearTimeout(shareSyncHandle);
      shareSyncHandle = null;
    }
  };

  const scheduleShareSync = (delay = 0) => {
    if (shareSyncHandle != null) {
      return;
    }

    shareSyncHandle = win.setTimeout(() => {
      shareSyncHandle = null;
      if (syncShareSession()) {
        shareSyncAttempts = 0;
        return;
      }

      const route = resolveConversationRoute(doc.location?.pathname ?? '/');
      if (route.kind !== 'share') {
        shareSyncAttempts = 0;
        return;
      }

      if (shareSyncAttempts >= 40) {
        shareSyncAttempts = 0;
        return;
      }

      shareSyncAttempts += 1;
      scheduleShareSync(Math.min(100 + shareSyncAttempts * 25, 500));
    }, delay);
  };

  const handleBridgeMessage = (event: MessageEvent) => {
    if (event.source !== win || !isTurboRenderBridgeMessage(event.data)) {
      return;
    }

    if (event.data.type === 'TURBO_RENDER_CONFIG') {
      config = event.data.payload;
      scheduleShareSync();
      return;
    }

    if (event.data.type === 'TURBO_RENDER_REQUEST_STATE') {
      if (event.data.payload.chatId?.startsWith('share:') && !sessions.has(event.data.payload.chatId)) {
        scheduleShareSync();
      }
      replayState(event.data.payload.chatId);
    }
  };

  win.addEventListener('message', handleBridgeMessage);
  doc.addEventListener('DOMContentLoaded', () => scheduleShareSync(), { once: true });
  win.addEventListener('load', () => scheduleShareSync(), { once: true });
  win.addEventListener('popstate', () => scheduleShareSync());

  const nativePushState = win.History.prototype.pushState;
  const nativeReplaceState = win.History.prototype.replaceState;
  win.History.prototype.pushState = function pushState(this: History, ...args: Parameters<History['pushState']>) {
    const result = nativePushState.apply(this, args);
    scheduleShareSync();
    return result;
  };
  win.History.prototype.replaceState = function replaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ) {
    const result = nativeReplaceState.apply(this, args);
    scheduleShareSync();
    return result;
  };
  scheduleShareSync();

  const nativeFetch = win.fetch.bind(win);
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await nativeFetch(input, init);
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);

    if (!isConversationEndpoint(requestUrl)) {
      return response;
    }

    const rewrittenText = rewriteConversationText(requestUrl, await response.clone().text());
    return rewrittenText == null ? response : createRewrittenResponse(response, rewrittenText);
  }) as typeof win.fetch;

  const xhrOpen = win.XMLHttpRequest.prototype.open;
  const xhrSend = win.XMLHttpRequest.prototype.send;
  const trackedUrls = new WeakMap<XMLHttpRequest, string>();

  win.XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    trackedUrls.set(this, typeof url === 'string' ? url : url.toString());
    xhrOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  win.XMLHttpRequest.prototype.send = function send(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const requestUrl = trackedUrls.get(this);
    if (requestUrl == null || !isConversationEndpoint(requestUrl) || !canRewriteXhrResponse(this)) {
      xhrSend.call(this, body);
      return;
    }

    const handleReadyStateChange = () => {
      if (this.readyState !== win.XMLHttpRequest.DONE || !canRewriteXhrResponse(this)) {
        return;
      }

      this.removeEventListener('readystatechange', handleReadyStateChange);
      const rawText =
        this.responseType === 'json' ? safeJsonStringify(this.response) : this.responseText;

      if (rawText == null || rawText.length === 0) {
        return;
      }

      const rewrittenText = rewriteConversationText(requestUrl, rawText);
      if (rewrittenText == null) {
        return;
      }

      Object.defineProperty(this, 'responseText', {
        configurable: true,
        get: () => rewrittenText,
      });
      Object.defineProperty(this, 'response', {
        configurable: true,
        get: () => (this.responseType === 'json' ? JSON.parse(rewrittenText) : rewrittenText),
      });
    };

    this.addEventListener('readystatechange', handleReadyStateChange);
    xhrSend.call(this, body);
  };

  return () => {
    clearShareSync();
    win.removeEventListener('message', handleBridgeMessage);
    win.fetch = nativeFetch;
    win.XMLHttpRequest.prototype.open = xhrOpen;
    win.XMLHttpRequest.prototype.send = xhrSend;
    win.History.prototype.pushState = nativePushState;
    win.History.prototype.replaceState = nativeReplaceState;
    bootstrapWindow.__turboRenderConversationBootstrapInstalled__ = false;
  };
}
