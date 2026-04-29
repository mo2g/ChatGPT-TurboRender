import type { ConversationPayload } from '../shared/conversation-trim';
import { resolveReadAloudMessageIdFromPayload } from '../shared/conversation-trim';
import type { ManagedHistoryEntry } from '../shared/types';

import { resolveArchiveCopyText, type EntryMoreMenuAction } from './core/message-actions';

const BACKEND_SESSION_TIMEOUT_MS = 3_000;
const READ_ALOUD_VOICE = 'cove';
const READ_ALOUD_FORMAT = 'aac';

type AccessTokenCache = {
  value: string;
  expiresAt: number;
};

export class ReadAloudBackendClient {
  private accessToken: AccessTokenCache | null = null;
  private accessTokenRequest: Promise<string | null> | null = null;

  constructor(private readonly win: Window) {}

  clearAccessToken(): void {
    this.accessToken = null;
    this.accessTokenRequest = null;
  }

  async buildAuthorizationHeaders(): Promise<HeadersInit | undefined> {
    const accessToken = await this.resolveAccessToken();
    return accessToken == null ? undefined : { Authorization: `Bearer ${accessToken}` };
  }

  async buildJsonHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const accessToken = await this.resolveAccessToken();
    if (accessToken != null) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    return headers;
  }

  private async resolveAccessToken(): Promise<string | null> {
    const cached = this.accessToken;
    if (cached != null && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (this.accessTokenRequest != null) {
      return this.accessTokenRequest;
    }

    const request = this.requestAccessToken();
    this.accessTokenRequest = request;
    try {
      return await request;
    } finally {
      if (this.accessTokenRequest === request) {
        this.accessTokenRequest = null;
      }
    }
  }

  private async requestAccessToken(): Promise<string | null> {
    const abortController = new AbortController();
    const timeoutHandle = this.win.setTimeout(() => {
      abortController.abort();
    }, BACKEND_SESSION_TIMEOUT_MS);
    try {
      const sessionUrl = new URL('/api/auth/session', this.win.location.origin);
      const response = await this.win.fetch(sessionUrl.toString(), {
        credentials: 'include',
        signal: abortController.signal,
      });
      if (!response.ok) {
        this.clearAccessToken();
        return null;
      }

      const payload = (await response.json()) as {
        accessToken?: unknown;
        expires?: unknown;
      };
      const accessToken = typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';
      if (accessToken.length === 0) {
        this.clearAccessToken();
        return null;
      }

      const expiresAt =
        typeof payload.expires === 'string'
          ? Math.min(Date.parse(payload.expires) - 60_000, Date.now() + 10 * 60_000)
          : Date.now() + 10 * 60_000;
      this.accessToken = {
        value: accessToken,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + 60_000,
      };
      return accessToken;
    } catch {
      this.clearAccessToken();
      return null;
    } finally {
      this.win.clearTimeout(timeoutHandle);
    }
  }
}

export function buildReadAloudSynthesizeUrl(origin: string, conversationId: string, messageId: string): string {
  const url = new URL('/backend-api/synthesize', origin);
  url.searchParams.set('message_id', messageId);
  url.searchParams.set('conversation_id', conversationId);
  url.searchParams.set('voice', READ_ALOUD_VOICE);
  url.searchParams.set('format', READ_ALOUD_FORMAT);
  return url.toString();
}

export function createIncludeCredentialsRequestInit(
  headers: HeadersInit | undefined,
  signal?: AbortSignal,
): RequestInit {
  const init: RequestInit = {
    credentials: 'include',
  };
  if (headers != null) {
    init.headers = headers;
  }
  if (signal != null) {
    init.signal = signal;
  }
  return init;
}

export function shouldAllowLocalReadAloudFallback(hostname: string): boolean {
  return (
    !(hostname === 'chatgpt.com' ||
    hostname.endsWith('.chatgpt.com') ||
    hostname === 'chat.openai.com' ||
    hostname.endsWith('.chat.openai.com'))
  );
}

export function isDebugReadAloudBackendEnabled(win: Window, doc: Document): boolean {
  return (
    (win as Window & { __turboRenderDebugReadAloudBackend?: boolean }).__turboRenderDebugReadAloudBackend === true ||
    doc.documentElement.getAttribute('data-turbo-render-debug-read-aloud-backend') === '1' ||
    doc.body?.getAttribute('data-turbo-render-debug-read-aloud-backend') === '1' ||
    doc.documentElement.dataset.turboRenderDebugReadAloudBackend === '1' ||
    doc.body?.dataset.turboRenderDebugReadAloudBackend === '1'
  );
}

export function shouldUseBackendReadAloud(input: {
  preferHostMorePopover: boolean;
  debugBackendEnabled: boolean;
  conversationId: string | null;
}): boolean {
  if (input.preferHostMorePopover && !input.debugBackendEnabled) {
    return false;
  }

  return input.debugBackendEnabled || input.conversationId != null;
}

export function getResolvedConversationReadAloudMessageId(doc: Document): string | null {
  const bodyValue = doc.body?.dataset.turboRenderReadAloudResolvedMessageId?.trim() ?? '';
  if (bodyValue.length > 0) {
    return bodyValue;
  }

  const documentValue = doc.documentElement.dataset.turboRenderReadAloudResolvedMessageId?.trim() ?? '';
  if (documentValue.length > 0) {
    return documentValue;
  }

  return null;
}

export function setReadAloudRequestContext(
  win: Window,
  doc: Document,
  context: {
    conversationId: string | null;
    entryRole: 'user' | 'assistant';
    entryText: string;
    entryKey: string;
    entryMessageId: string;
    groupId: string;
    entryId: string;
    action: EntryMoreMenuAction;
  },
): void {
  const serialized = {
    conversationId: context.conversationId ?? '',
    entryRole: context.entryRole,
    entryText: context.entryText,
    entryKey: context.entryKey,
    entryMessageId: context.entryMessageId,
    groupId: context.groupId,
    entryId: context.entryId,
    action: context.action,
  };
  (win as Window & { __turboRenderReadAloudContext?: typeof serialized }).__turboRenderReadAloudContext = serialized;

  const fields: Array<[string, string]> = [
    ['turboRenderReadAloudConversationId', context.conversationId ?? ''],
    ['turboRenderReadAloudEntryRole', context.entryRole],
    ['turboRenderReadAloudEntryText', context.entryText],
    ['turboRenderReadAloudEntryKey', context.entryKey],
    ['turboRenderReadAloudEntryMessageId', context.entryMessageId],
    ['turboRenderReadAloudResolvedMessageId', ''],
    ['turboRenderDebugReadAloudRequestGroupId', context.groupId],
    ['turboRenderDebugReadAloudRequestEntryId', context.entryId],
    ['turboRenderDebugReadAloudRequestAction', context.action],
    ['turboRenderDebugReadAloudRequestEntryKey', context.entryKey],
    ['turboRenderDebugReadAloudRequestLane', context.entryRole],
  ];

  if (doc.body != null) {
    for (const [key, value] of fields) {
      doc.body.dataset[key] = value;
    }
  }
  if (doc.documentElement != null) {
    for (const [key, value] of fields) {
      doc.documentElement.dataset[key] = value;
    }
  }
}

export function resolveDebugConversationId(win: Window, doc: Document): string | null {
  const debugConversationId =
    (win as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId ??
    doc.body?.dataset.turboRenderDebugConversationId ??
    doc.documentElement.dataset.turboRenderDebugConversationId ??
    null;
  return debugConversationId != null && debugConversationId.trim().length > 0
    ? debugConversationId.trim()
    : null;
}

export function resolveDebugReadAloudUrl(win: Window, doc: Document): string | null {
  const debugUrl =
    (win as Window & { __turboRenderDebugReadAloudUrl?: string }).__turboRenderDebugReadAloudUrl ??
    doc.documentElement.getAttribute('data-turbo-render-debug-read-aloud-url') ??
    doc.body?.getAttribute('data-turbo-render-debug-read-aloud-url') ??
    doc.body?.dataset.turboRenderDebugReadAloudUrl ??
    doc.documentElement.dataset.turboRenderDebugReadAloudUrl ??
    null;
  return debugUrl != null && debugUrl.trim().length > 0 ? debugUrl.trim() : null;
}

export function resolveEntryHostMessageIdFromConversationPayload(
  entry: ManagedHistoryEntry,
  conversationPayload: ConversationPayload | null,
): string | null {
  return resolveReadAloudMessageIdFromPayload(conversationPayload, {
    entryRole: entry.role === 'user' ? 'user' : entry.role === 'assistant' ? 'assistant' : null,
    entryText: resolveArchiveCopyText(entry),
    entryMessageId: entry.messageId ?? entry.liveTurnId ?? entry.turnId ?? null,
    syntheticMessageId: entry.messageId ?? entry.liveTurnId ?? entry.turnId ?? null,
  });
}
