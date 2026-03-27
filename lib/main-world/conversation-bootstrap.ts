import { DEFAULT_SETTINGS } from '../shared/constants';
import { getChatIdFromPathname } from '../shared/chat-id';
import {
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
import type { InitialTrimSession } from '../shared/types';

interface BootstrapWindow extends Window {
  __turboRenderConversationBootstrapInstalled__?: boolean;
}

interface SessionRecord {
  session: InitialTrimSession;
  coldMapping: Record<string, ConversationMappingNode>;
}

function resolveChatId(doc: Document, conversationId: string | null): string {
  const pathnameChatId = getChatIdFromPathname(doc.location?.pathname ?? '/');
  if (pathnameChatId !== 'chat:home' && pathnameChatId !== 'chat:unknown') {
    return pathnameChatId;
  }

  return conversationId != null ? `chat:${conversationId}` : pathnameChatId;
}

function createTrimSession(
  payload: ConversationPayload,
  requestUrl: string,
  doc: Document,
  config: TurboRenderPageConfig,
) {
  const conversationId = extractConversationIdFromUrl(requestUrl);
  const chatId = resolveChatId(doc, conversationId);
  return trimConversationPayload(payload, {
    chatId,
    conversationId,
    mode: config.mode,
    initialHotTurns: config.initialHotTurns,
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

  const storeTrimResult = (requestUrl: string, payload: ConversationPayload) => {
    const result = createTrimSession(payload, requestUrl, doc, config);
    if (result.session != null) {
      sessions.set(result.session.chatId, {
        session: result.session,
        coldMapping: result.coldMapping,
      });
      emitSession(result.session);
    }
    return result;
  };

  const rewriteConversationText = (requestUrl: string, bodyText: string): string | null => {
    if (!config.enabled || !config.initialTrimEnabled || config.mode !== 'performance') {
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

  const handleBridgeMessage = (event: MessageEvent) => {
    if (event.source !== win || !isTurboRenderBridgeMessage(event.data)) {
      return;
    }

    if (event.data.type === 'TURBO_RENDER_CONFIG') {
      config = event.data.payload;
      return;
    }

    if (event.data.type === 'TURBO_RENDER_REQUEST_STATE') {
      replayState(event.data.payload.chatId);
    }
  };

  win.addEventListener('message', handleBridgeMessage);

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
    win.removeEventListener('message', handleBridgeMessage);
    win.fetch = nativeFetch;
    win.XMLHttpRequest.prototype.open = xhrOpen;
    win.XMLHttpRequest.prototype.send = xhrSend;
    bootstrapWindow.__turboRenderConversationBootstrapInstalled__ = false;
  };
}
