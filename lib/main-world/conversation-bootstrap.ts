import { DEFAULT_SETTINGS, UI_CLASS_NAMES } from '../shared/constants';
import { resolveConversationRoute } from '../shared/chat-id';
import { shouldReplaceSession } from '../shared/session-precedence';
import {
  extractShareConversationPayload,
  extractConversationIdFromUrl,
  isConversationEndpoint,
  trimConversationPayload,
  resolveActiveNodeId,
  resolveReadAloudMessageIdFromPayload,
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
  __turboRenderReadAloudContext?: ReadAloudContext;
  __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
  __turboRenderNativeFetch__?: typeof fetch;
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

interface ReadAloudContext {
  conversationId: string | null;
  entryRole: 'user' | 'assistant' | null;
  entryText: string | null;
  entryKey: string | null;
  entryMessageId: string | null;
}

interface ConversationSnapshotRecord {
  payload: ConversationPayload;
  activeNodeId: string | null;
}

const SHARE_LOADER_KEY = 'routes/share.$shareId.($action)';
const READ_ALOUD_SNAPSHOT_QUERY = '__turbo_render_read_aloud_snapshot';

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

function getReadAloudContext(doc: Document, win: Window): ReadAloudContext {
  const globalContext = (win as BootstrapWindow).__turboRenderReadAloudContext ?? null;
  const body = doc.body;
  const documentElement = doc.documentElement;
  const read = (key: keyof ReadAloudContext, datasetKey: string): string | null => {
    const globalValue = globalContext?.[key];
    if (typeof globalValue === 'string' && globalValue.trim().length > 0) {
      return globalValue.trim();
    }

    const bodyValue = body?.dataset[datasetKey as keyof DOMStringMap] as string | undefined;
    if (typeof bodyValue === 'string' && bodyValue.trim().length > 0) {
      return bodyValue.trim();
    }

    const docValue = documentElement?.dataset[datasetKey as keyof DOMStringMap] as string | undefined;
    if (typeof docValue === 'string' && docValue.trim().length > 0) {
      return docValue.trim();
    }

    return null;
  };

  const normalizeReadAloudRole = (role: string | null | undefined): ReadAloudContext['entryRole'] => {
    if (role === 'user' || role === 'assistant') {
      return role;
    }
    return null;
  };

  return {
    conversationId: read('conversationId', 'turboRenderReadAloudConversationId'),
    entryRole: normalizeReadAloudRole(read('entryRole', 'turboRenderReadAloudEntryRole')),
    entryText: read('entryText', 'turboRenderReadAloudEntryText'),
    entryKey: read('entryKey', 'turboRenderReadAloudEntryKey'),
    entryMessageId: read('entryMessageId', 'turboRenderReadAloudEntryMessageId'),
  };
}

function resolveReadAloudMessageIdFromConversationSnapshot(
  snapshot: ConversationSnapshotRecord | null | undefined,
  requestUrl: URL,
  context: ReadAloudContext,
): string | null {
  if (snapshot == null) {
    return null;
  }

  const currentMessageId = requestUrl.searchParams.get('message_id')?.trim() ?? '';
  if (currentMessageId.length === 0 || !currentMessageId.startsWith('turn-')) {
    return null;
  }

  return resolveReadAloudMessageIdFromPayload(snapshot.payload, {
    entryRole: context.entryRole,
    entryText: context.entryText,
    entryMessageId: context.entryMessageId,
    syntheticMessageId: currentMessageId,
  });
}

function resolveSyntheticTurnIndex(...candidates: Array<string | null | undefined>): number | null {
  for (const candidate of candidates) {
    const messageId = candidate?.trim() ?? '';
    if (messageId.length === 0 || !messageId.startsWith('turn-')) {
      continue;
    }

    const syntheticBody = messageId.slice('turn-'.length);
    const syntheticParts = syntheticBody.split('-');
    if (syntheticParts.length < 3) {
      continue;
    }

    const turnIndexText = syntheticParts.at(-2) ?? '';
    if (!/^\d+$/.test(turnIndexText)) {
      continue;
    }

    const turnIndex = Number.parseInt(turnIndexText, 10);
    if (Number.isSafeInteger(turnIndex) && turnIndex >= 0) {
      return turnIndex;
    }
  }

  return null;
}

function canCaptureInitialSession(config: TurboRenderPageConfig): boolean {
  return config.enabled && config.initialTrimEnabled && config.mode === 'performance';
}

function resolveReadAloudMessageIdFromDom(doc: Document, requestUrl: URL): string | null {
  const messageId = requestUrl.searchParams.get('message_id')?.trim() ?? '';
  if (messageId.length === 0 || !messageId.startsWith('turn-')) {
    return null;
  }

  const turnIndex = resolveSyntheticTurnIndex(messageId);
  if (turnIndex != null) {
    const turnCandidates = [...doc.querySelectorAll<HTMLElement>(
      '[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn, article',
    )].filter((candidate) => candidate.closest(`[data-turbo-render-ui-root="true"]`) == null);
    const indexedCandidate = turnCandidates[turnIndex] ?? null;
    const directMessageId =
      indexedCandidate?.getAttribute('data-host-message-id')?.trim() ??
      indexedCandidate?.getAttribute('data-message-id')?.trim() ??
      '';
    if (directMessageId.length > 0 && !directMessageId.startsWith('turn-')) {
      return directMessageId;
    }

    const textMessageCandidates = [...doc.querySelectorAll<HTMLElement>(
      'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id]',
    )].filter((candidate) => candidate.closest(`[data-turbo-render-ui-root="true"]`) == null);
    const indexedTextCandidate = textMessageCandidates[turnIndex] ?? null;
    const directTextMessageId =
      indexedTextCandidate?.getAttribute('data-host-message-id')?.trim() ??
      indexedTextCandidate?.getAttribute('data-message-id')?.trim() ??
      '';
    if (directTextMessageId.length > 0 && !directTextMessageId.startsWith('turn-')) {
      return directTextMessageId;
    }
  }

  const groupId = doc.body?.dataset.turboRenderDebugReadAloudRequestGroupId?.trim() ?? '';
  const entryId = doc.body?.dataset.turboRenderDebugReadAloudRequestEntryId?.trim() ?? '';
  const lane = doc.body?.dataset.turboRenderDebugReadAloudRequestLane?.trim() ?? '';
  if (groupId.length === 0 || entryId.length === 0 || (lane !== 'user' && lane !== 'assistant')) {
    return null;
  }

  const escapedGroupId = CSS.escape(groupId);
  const escapedEntryId = CSS.escape(entryId);
  const actionAnchor = doc.querySelector<HTMLElement>(
    `[data-group-id="${escapedGroupId}"][data-entry-id="${escapedEntryId}"]`,
  );
  const entryRoot = actionAnchor?.closest<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`) ?? null;
  const batchRoot = entryRoot?.closest<HTMLElement>(`[data-turbo-render-batch-anchor="true"]`) ?? null;
  if (entryRoot == null || batchRoot == null) {
    return null;
  }

  const pairEntries = [...batchRoot.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`)];
  const pairIndex = pairEntries.indexOf(entryRoot);
  if (pairIndex < 0) {
    return null;
  }

  const hostCandidates = [...doc.querySelectorAll<HTMLElement>(
    `div.text-message[data-message-author-role="${lane}"][data-host-message-id], div.text-message[data-message-author-role="${lane}"][data-message-id]`,
  )].filter((candidate) => candidate.closest(`[data-turbo-render-ui-root="true"]`) == null);

  const candidate = hostCandidates[pairIndex] ?? hostCandidates.find((node) => {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    return text.length > 0;
  }) ?? null;

  const directMessageId =
    candidate?.getAttribute('data-host-message-id')?.trim() ??
    candidate?.getAttribute('data-message-id')?.trim() ??
    '';
  if (directMessageId.length === 0 || directMessageId.startsWith('turn-')) {
    return null;
  }

  return directMessageId;
}

function maybeRewriteReadAloudUrl(
  doc: Document,
  requestUrl: string,
  conversationSnapshots: Map<string, ConversationSnapshotRecord>,
  conversationPayloadCache: Record<string, ConversationPayload>,
  context: ReadAloudContext,
): string | null {
  const url = new URL(requestUrl, doc.location.origin);
  if (!url.pathname.endsWith('/backend-api/synthesize')) {
    return null;
  }

  const currentMessageId = url.searchParams.get('message_id')?.trim() ?? '';
  if (currentMessageId.length === 0 || !currentMessageId.startsWith('turn-')) {
    return null;
  }

  const conversationId =
    url.searchParams.get('conversation_id')?.trim() ||
    context.conversationId ||
    extractConversationIdFromUrl(requestUrl) ||
    null;
  const cachedConversationPayload =
    conversationId != null ? conversationPayloadCache[conversationId] ?? null : null;
  const snapshot = conversationId != null ? conversationSnapshots.get(conversationId) ?? null : null;
  const rewrittenMessageId =
    (snapshot != null
      ? resolveReadAloudMessageIdFromConversationSnapshot(snapshot, url, context)
      : null) ??
    (cachedConversationPayload != null
      ? resolveReadAloudMessageIdFromPayload(cachedConversationPayload, {
          entryRole: context.entryRole,
          entryText: context.entryText,
          entryMessageId: context.entryMessageId,
          syntheticMessageId: context.entryMessageId,
        })
      : null) ??
    resolveReadAloudMessageIdFromDom(doc, url);
  if (rewrittenMessageId == null || rewrittenMessageId === currentMessageId) {
    return null;
  }

  url.searchParams.set('message_id', rewrittenMessageId);
  return url.toString();
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
  const conversationSnapshots = new Map<string, ConversationSnapshotRecord>();
  const conversationPayloadCache = ((bootstrapWindow as BootstrapWindow).__turboRenderConversationPayloadCache ??= {});
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
    let payload: ConversationPayload;
    try {
      payload = JSON.parse(bodyText) as ConversationPayload;
    } catch {
      return null;
    }

    const parsedUrl = new URL(requestUrl, doc.location.origin);
    const conversationId = extractConversationIdFromUrl(requestUrl);
    const readAloudSnapshotRequest = parsedUrl.searchParams.get(READ_ALOUD_SNAPSHOT_QUERY) === '1';
    if (conversationId != null) {
      conversationPayloadCache[conversationId] = payload;
      const readAloudContext = getReadAloudContext(doc, bootstrapWindow);
      const resolvedReadAloudMessageId = resolveReadAloudMessageIdFromPayload(payload, {
        entryRole: readAloudContext.entryRole,
        entryText: readAloudContext.entryText,
        entryMessageId: readAloudContext.entryMessageId,
        syntheticMessageId: readAloudContext.entryMessageId,
      });
      if (resolvedReadAloudMessageId != null) {
        if (doc.body != null) {
          doc.body.dataset.turboRenderReadAloudResolvedMessageId = resolvedReadAloudMessageId;
        }
        if (doc.documentElement != null) {
          doc.documentElement.dataset.turboRenderReadAloudResolvedMessageId = resolvedReadAloudMessageId;
        }
      }
      conversationSnapshots.set(conversationId, {
        payload,
        activeNodeId: resolveActiveNodeId(payload),
      });
    }

    if (readAloudSnapshotRequest || !canCaptureInitialSession(config)) {
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

    const origin = doc.location?.origin ?? 'https://chatgpt.com';
    const requestUrl = `${origin}/share/${shareId ?? route.routeId}`;
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
  bootstrapWindow.__turboRenderNativeFetch__ = nativeFetch;
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);
    const rewrittenUrl = maybeRewriteReadAloudUrl(
      doc,
      requestUrl,
      conversationSnapshots,
      conversationPayloadCache,
      getReadAloudContext(doc, win),
    );
    if (rewrittenUrl != null) {
      if (typeof input === 'string' || input instanceof URL) {
        input = rewrittenUrl;
      } else if (input instanceof Request) {
        input = new Request(rewrittenUrl, input);
      }
    }

    const response = await nativeFetch(input, init);

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

  const nativeAudioSrcDescriptor = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'src');
  if (nativeAudioSrcDescriptor?.configurable === true && nativeAudioSrcDescriptor.get != null && nativeAudioSrcDescriptor.set != null) {
    Object.defineProperty(win.HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: nativeAudioSrcDescriptor.enumerable ?? false,
      get(this: HTMLMediaElement): string {
        return nativeAudioSrcDescriptor.get!.call(this) as string;
      },
      set(this: HTMLMediaElement, value: string) {
        const rewritten = maybeRewriteReadAloudUrl(
          doc,
          value,
          conversationSnapshots,
          conversationPayloadCache,
          getReadAloudContext(doc, win),
        );
        nativeAudioSrcDescriptor.set!.call(this, rewritten ?? value);
      },
    });
  }

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
