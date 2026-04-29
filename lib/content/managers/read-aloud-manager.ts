import type { ConversationPayload } from '../../shared/conversation-trim';
import { resolveReadAloudMessageIdFromPayload } from '../../shared/conversation-trim';
import {
  ReadAloudBackendClient,
  buildReadAloudSynthesizeUrl,
  createIncludeCredentialsRequestInit,
  getResolvedConversationReadAloudMessageId,
  isDebugReadAloudBackendEnabled,
  resolveDebugConversationId,
  resolveDebugReadAloudUrl,
  setReadAloudRequestContext,
  shouldAllowLocalReadAloudFallback,
  shouldUseBackendReadAloud,
} from '../read-aloud-backend';
import { findHostReadAloudStopButton } from '../read-aloud-host-controls';
import { tryStreamReadAloudResponse } from '../read-aloud-streaming';
import type { ManagedHistoryEntry } from '../../shared/types';
import type { ReadAloudSnapshotCache } from '../state/read-aloud-snapshot-cache';

const READ_ALOUD_SNAPSHOT_FAILURE_MS = 120_000;

export interface ReadAloudManagerOptions {
  win: Window;
  doc: Document;
  preferHostMorePopover: () => boolean;
  shouldUseHostActionClicks: () => boolean;
  onStateChange: (state: ReadAloudState) => void;
  sharedCache?: ReadAloudSnapshotCache;
}

export interface ReadAloudState {
  speakingEntryKey: string | null;
  mode: 'backend' | 'speech' | null;
  generation: number;
}

export class ReadAloudManager {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly backend: ReadAloudBackendClient;
  private readonly getPreferHostMorePopover: () => boolean;
  private readonly getShouldUseHostActionClicks: () => boolean;
  private readonly onStateChange: (state: ReadAloudState) => void;

  private speakingEntryKey: string | null = null;
  private mode: 'backend' | 'speech' | null = null;
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private abortController: AbortController | null = null;

  // 使用共享缓存（如果提供）或创建私有缓存
  private readonly payloadCache: Map<string, ConversationPayload>;
  private readonly snapshotPrimed: Set<string>;
  private readonly snapshotRequests: Map<string, Promise<void>>;
  private readonly snapshotFailures: Map<string, number>;

  constructor(options: ReadAloudManagerOptions) {
    this.win = options.win;
    this.doc = options.doc;
    this.backend = new ReadAloudBackendClient(options.win);
    this.getPreferHostMorePopover = options.preferHostMorePopover;
    this.getShouldUseHostActionClicks = options.shouldUseHostActionClicks;
    this.onStateChange = options.onStateChange;

    // 从共享缓存获取状态或创建新的
    const state = options.sharedCache?.getState();
    this.payloadCache = state?.payloadCache ?? new Map();
    this.snapshotPrimed = state?.primed ?? new Set();
    this.snapshotRequests = state?.requests ?? new Map();
    this.snapshotFailures = state?.failures ?? new Map();
  }

    reset(): void {
    this.clearPlayback({ incrementStopCount: false });
    this.payloadCache.clear();
    this.snapshotPrimed.clear();
    this.snapshotRequests.clear();
    this.snapshotFailures.clear();
    this.backend.clearAccessToken();
  }

  getState(): ReadAloudState {
    return {
      speakingEntryKey: this.speakingEntryKey,
      mode: this.mode,
      generation: this.generation,
    };
  }

  isSpeaking(entryKey: string | null = null): boolean {
    if (entryKey == null) {
      return this.speakingEntryKey != null;
    }
    return this.speakingEntryKey === entryKey;
  }

  stop(options: { incrementStopCount?: boolean } = {}): void {
    this.clearPlayback({ incrementStopCount: options.incrementStopCount ?? true });
  }

  async start(
    groupId: string | null,
    entry: ManagedHistoryEntry,
    entryKey: string,
    entryText: string,
    entryRole: 'user' | 'assistant',
  ): Promise<boolean> {
    this.clearPlayback({ incrementStopCount: true });

    const generation = ++this.generation;

    if (!this.shouldUseBackendReadAloud()) {
      return false;
    }

    const url = this.buildUrl(entry);
    if (url == null) {
      return false;
    }

    setReadAloudRequestContext(this.win, this.doc, {
      conversationId: this.getConversationId(),
      entryRole,
      entryText,
      entryKey,
      entryMessageId: entry.messageId ?? entry.liveTurnId ?? entry.turnId ?? '',
      groupId: groupId ?? '',
      entryId: entry.id,
      action: 'read-aloud',
    });

    const headers = await this.backend.buildAuthorizationHeaders();
    const init = createIncludeCredentialsRequestInit(headers);

    let response: Response;
    try {
      response = await this.win.fetch(url, init);
    } catch {
      return false;
    }

    if (!response.ok) {
      return false;
    }

    const audio = this.ensureAudio();

    try {
      const success = await tryStreamReadAloudResponse({
        win: this.win,
        response,
        audio,
        entryKey,
        generation,
        isCurrent: (key, gen) => this.speakingEntryKey === key && this.generation === gen,
        onObjectUrlCreated: (url) => { this.objectUrl = url; },
        onObjectUrlUnused: (url) => {
          if (this.objectUrl === url) {
            URL.revokeObjectURL(url);
            this.objectUrl = null;
          }
        },
        setStreamingDebug: (value) => this.setStreamingDebug(value),
        clearPlayback: () => this.clearPlayback({ incrementStopCount: false }),
      });

      if (!success) {
        return false;
      }

      this.activateBackend(audio, entryKey, generation);
      return true;
    } catch {
      return false;
    }
  }

    primeConversationMetadata(archiveState: { currentPageGroups: Array<{ entries: ManagedHistoryEntry[] }> }): void {
    if (!this.shouldUseBackendReadAloud() || archiveState.currentPageGroups.length === 0) {
      return;
    }

    const conversationId = this.getConversationId();
    if (conversationId == null) {
      return;
    }

    const firstGroup = archiveState.currentPageGroups[0];
    const firstEntry = firstGroup?.entries[0];
    if (firstEntry == null) {
      return;
    }

    void this.ensureConversationSnapshot(conversationId);
  }

  setConversationPayload(conversationId: string | null, payload: ConversationPayload | null): void {
    if (conversationId == null || conversationId.trim().length === 0 || payload == null) {
      return;
    }

    const normalizedId = conversationId.trim();
    this.payloadCache.set(normalizedId, payload);

    const win = this.win as Window & {
      __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
    };
    win.__turboRenderConversationPayloadCache ??= {};
    win.__turboRenderConversationPayloadCache[normalizedId] = payload;
  }

  getConversationPayload(conversationId: string | null): ConversationPayload | null {
    if (conversationId == null || conversationId.trim().length === 0) {
      return null;
    }

    const normalizedId = conversationId.trim();
    const cached = this.payloadCache.get(normalizedId);
    if (cached != null) {
      return cached;
    }

    const win = this.win as Window & {
      __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
    };
    return win.__turboRenderConversationPayloadCache?.[normalizedId] ?? null;
  }

  private clearPlayback(options: { incrementStopCount?: boolean } = {}): void {
    const wasSpeaking = this.speakingEntryKey != null;

    if (this.audio != null) {
      this.audio.pause();
      this.audio.src = '';
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }

    if (this.objectUrl != null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    this.abortController?.abort();
    this.abortController = null;
    this.speakingEntryKey = null;
    this.mode = null;

    if (options.incrementStopCount && wasSpeaking) {
      this.incrementStopCount();
    }

    this.onStateChange(this.getState());
  }

  private incrementStopCount(): void {
    const key = 'hostActionStopReadAloudCount';
    const current = Number(this.doc.body?.dataset[key] ?? 0);
    if (this.doc.body != null) {
      this.doc.body.dataset[key] = String(current + 1);
    }
  }

  private activateBackend(audio: HTMLAudioElement, entryKey: string, generation: number): void {
    audio.dataset.turboRenderReadAloudMode = 'backend';
    audio.onended = () => {
      if (this.speakingEntryKey === entryKey && this.generation === generation) {
        this.clearPlayback({ incrementStopCount: false });
      }
    };
    audio.onerror = () => {
      if (this.speakingEntryKey === entryKey && this.generation === generation) {
        this.clearPlayback({ incrementStopCount: false });
      }
    };

    this.speakingEntryKey = entryKey;
    this.mode = 'backend';
    this.audio = audio;
    this.onStateChange(this.getState());
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio != null) {
      return this.audio;
    }

    const audio = this.doc.createElement('audio');
    audio.style.display = 'none';
    this.doc.body?.append(audio);
    this.audio = audio;
    return audio;
  }

  private setStreamingDebug(value: '0' | '1' | 'unsupported' | 'error'): void {
    if (this.doc.body != null) {
      this.doc.body.dataset.turboRenderReadAloudStreaming = value;
    }
  }

  shouldUseBackendReadAloud(): boolean {
    return shouldUseBackendReadAloud({
      preferHostMorePopover: this.getPreferHostMorePopover(),
      debugBackendEnabled: this.isDebugBackendEnabled(),
      conversationId: this.getConversationId(),
    });
  }

  isDebugBackendEnabled(): boolean {
    return isDebugReadAloudBackendEnabled(this.win, this.doc);
  }

    getConversationId(): string | null {
    const debugId = resolveDebugConversationId(this.win, this.doc);
    if (debugId != null) {
      return debugId;
    }

    const match = this.win.location.pathname.match(/\/c\/([a-f0-9-]+)/i);
    return match?.[1] ?? null;
  }

  setRequestContext(context: Parameters<typeof setReadAloudRequestContext>[2]): void {
    setReadAloudRequestContext(this.win, this.doc, context);
  }

    buildUrl(entry: ManagedHistoryEntry): string | null {
    const debugUrl = resolveDebugReadAloudUrl(this.win, this.doc);
    if (debugUrl != null) {
      return debugUrl;
    }

    const conversationId = this.getConversationId();
    if (conversationId == null) {
      return null;
    }

    const payload = this.getConversationPayload(conversationId);
    const messageId = payload != null
      ? resolveReadAloudMessageIdFromPayload(payload, {
          entryRole: entry.role === 'user' ? 'user' : 'assistant',
          entryText: entry.text ?? '',
          entryMessageId: entry.messageId ?? entry.liveTurnId ?? entry.turnId ?? null,
        })
      : getResolvedConversationReadAloudMessageId(this.doc);

    if (messageId == null) {
      return null;
    }

    return buildReadAloudSynthesizeUrl(this.win.location.origin, conversationId, messageId);
  }

  async ensureConversationSnapshot(conversationId: string | null): Promise<void> {
    if (conversationId == null || conversationId.trim().length === 0) {
      return;
    }

    const normalizedId = conversationId.trim();

    if (this.snapshotPrimed.has(normalizedId)) {
      return;
    }

    if (this.isSnapshotFailureActive(normalizedId)) {
      return;
    }

    const pending = this.snapshotRequests.get(normalizedId);
    if (pending != null) {
      return pending;
    }

    const request = this.fetchConversationSnapshot(normalizedId);
    this.snapshotRequests.set(normalizedId, request);

    try {
      await request;
    } finally {
      this.snapshotRequests.delete(normalizedId);
    }
  }

  private async fetchConversationSnapshot(conversationId: string): Promise<void> {
    try {
      const url = new URL(
        `/backend-api/conversation/${conversationId}`,
        this.win.location.origin,
      );
      url.searchParams.set('__turbo_render_read_aloud_snapshot', '1');

      const headers = await this.backend.buildAuthorizationHeaders();
      const init = createIncludeCredentialsRequestInit(headers);
      const response = await this.win.fetch(url.toString(), init);

      if (!response.ok) {
        this.markSnapshotFailure(conversationId);
        return;
      }

      if (this.getConversationPayload(conversationId) == null) {
        try {
          const payload = (await response.clone().json()) as ConversationPayload;
          if (payload?.mapping != null) {
            this.setConversationPayload(conversationId, payload);
          } else {
            this.markSnapshotFailure(conversationId);
          }
        } catch {
          this.markSnapshotFailure(conversationId);
        }
      }

      this.snapshotPrimed.add(conversationId);
      this.snapshotFailures.delete(conversationId);
    } catch {
      this.markSnapshotFailure(conversationId);
    }
  }

  isSnapshotFailureActive(conversationId: string): boolean {
    const blockedUntil = this.snapshotFailures.get(conversationId);
    if (blockedUntil == null) {
      return false;
    }
    if (this.win.performance.now() < blockedUntil) {
      return true;
    }
    this.snapshotFailures.delete(conversationId);
    return false;
  }

  private markSnapshotFailure(conversationId: string): void {
    this.snapshotFailures.set(
      conversationId,
      this.win.performance.now() + READ_ALOUD_SNAPSHOT_FAILURE_MS,
    );
  }
}
