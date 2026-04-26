import {
  DEFAULT_SETTINGS,
  TURN_ID_DATASET,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY,
  UI_CLASS_NAMES,
} from '../shared/constants';
import { getChatIdFromPathname, getRouteIdFromRuntimeId } from '../shared/chat-id';
import {
  resolveResidentArchivePageIndexes,
  type ArchiveUiState,
} from './archive-ui-state';
import {
  createTranslator,
  getContentLanguage,
  type Translator,
  type UiLanguage,
} from '../shared/i18n';
import type {
  ArchivePageMatch,
  IndexRange,
  InitialTrimSession,
  ManagedHistoryEntry,
  ManagedHistoryGroup,
  Settings,
  TabRuntimeStatus,
  TurnRecord,
} from '../shared/types';

import {
  detectTurnRole,
  isStreamingTurn,
  isTurboRenderUiNode,
  scanChatPage,
} from './chatgpt-adapter';
import { FrameSpikeMonitor } from './frame-spike-monitor';
import {
  captureHostActionTemplate,
  createArchiveClipboardPayload,
  copyTextToClipboard,
  getArchiveEntrySelectionKey,
  findHostActionButton,
  resolveArchiveCopyText,
  type ArchiveEntryAction,
  type EntryActionAvailabilityMap,
  type EntryActionMenuSelection,
  type EntryActionRequest,
  type EntryActionSelection,
  type EntryActionSelectionMap,
  type EntryActionTemplateMap,
  type EntryActionLane,
  type HostActionTemplateSnapshot,
  type EntryMoreMenuAction,
} from './message-actions';
import {
  buildEntryActionAvailabilityMap,
  buildEntryActionTemplateMap,
  shouldResolveEntryMetadataForGroup,
} from './entry-action-state';
import { shouldAutoActivate } from './layout';
import { dispatchHumanClick as dispatchHostHumanClick } from './host-action-events';
import {
  doesHostActionButtonMatchEntry as doesHostActionButtonMatchArchiveEntry,
  normalizeEntryText,
} from './host-action-matching';
import { HostMenuPositioning } from './host-menu-positioning';
import {
  findHostMessageIdForEntryInScope,
  findParkedMessageIdForEntryInGroup,
  findRenderedArchiveMessageIdFromActionAnchor,
} from './host-message-id-resolver';
import {
  findHostMoreMenuAction as findHostMoreMenuActionInMenu,
  readHostEntryActionSelection as readHostEntryActionSelectionFromRoots,
} from './host-more-menu-actions';
import { shouldRefreshForMutations as shouldRefreshForMutationBatch } from './mutation-refresh-filter';
import { computeVisibleRangeFromTurnContainer } from './visible-range';
import { isProtectedTurn as isProtectedTurnNode } from './protected-turn';
import { buildRuntimeStatus } from './runtime-status-builder';
import { waitForHostElement } from './host-action-wait';
import {
  ManagedHistoryStore,
  extractMessageIdFromHtml,
  isSyntheticMessageId,
  isSupplementalHistoryEntry,
  resolvePreferredMessageId,
} from './managed-history';
import { ArchivePager } from './archive-pager';
import { ParkingLot } from './parking-lot';
import {
  ReadAloudBackendClient,
  buildReadAloudSynthesizeUrl,
  createIncludeCredentialsRequestInit,
  getResolvedConversationReadAloudMessageId,
  isDebugReadAloudBackendEnabled,
  resolveDebugConversationId,
  resolveDebugReadAloudUrl,
  resolveEntryHostMessageIdFromConversationPayload,
  setReadAloudRequestContext,
  shouldAllowLocalReadAloudFallback,
  shouldUseBackendReadAloud,
} from './read-aloud-backend';
import { findHostReadAloudStopButton } from './read-aloud-host-controls';
import { tryStreamReadAloudResponse } from './read-aloud-streaming';
import { StatusBar } from './status-bar';
import type { ConversationPayload } from '../shared/conversation-trim';
import { resolveReadAloudMessageIdFromPayload } from '../shared/conversation-trim';
import {
  areSettingsEquivalent,
  cancelIdleCallbackCompat,
  computeTurnContentRevision,
  countLiveDescendants,
  matchesHostActionCandidate,
  requestAnimationFrameCompat,
  requestIdleCallbackCompat,
  resolveMessageId,
  resolveRealMessageId,
  toSet,
} from './turbo-render-controller-utils';

export interface TurboRenderControllerOptions {
  document?: Document;
  window?: Window;
  settings?: Settings;
  paused?: boolean;
  mountUi?: boolean;
  contentScriptInstanceId?: string;
  contentScriptStartedAt?: number;
  onPauseToggle?(paused: boolean, chatId: string): void | Promise<void>;
}

type OpenHostMenuResult = {
  menu: HTMLElement;
  previousMenus: Set<HTMLElement>;
};

type HostArchiveActionBinding = {
  action: ArchiveEntryAction;
  anchor: HTMLElement | null;
  button: HTMLElement;
};

const SCROLL_RESTORE_IGNORE_MS = 240;
const READ_ALOUD_SNAPSHOT_FAILURE_MS = 120_000;
const HOST_MENU_WAIT_TIMEOUT_MS = 1_000;
const HOST_MENU_ACTION_WAIT_TIMEOUT_MS = 2_000;
const LARGE_CONVERSATION_TURN_THRESHOLD = 600;
const LARGE_CONVERSATION_REFRESH_DELAY_MS = 180;
const ARCHIVE_PAGE_PAIR_COUNT = 20;
const DESCENDANT_COUNT_SAMPLE_INTERVAL_MS = 1_500;

export class TurboRenderController {
  private readonly doc: Document;
  private readonly win: Window;
  private settings: Settings;
  private paused: boolean;
  private readonly mountUi: boolean;
  private readonly onPauseToggle?: TurboRenderControllerOptions['onPauseToggle'];
  private statusBar: StatusBar | null = null;
  private readonly frameSpikeMonitor: FrameSpikeMonitor;
  private readonly parkingLot = new ParkingLot();
  private readonly managedHistory = new ManagedHistoryStore();
  private readonly archivePager = new ArchivePager();
  private readonly readAloudBackend: ReadAloudBackendClient;
  private readonly hostMenuPositioning: HostMenuPositioning;
  private mutationObserver: MutationObserver | null = null;
  private observedMutationRoot: Node | null = null;
  private observedRootKind: 'live-turn-container' | 'archive-only-root' = 'archive-only-root';
  private refreshHandle: number | null = null;
  private idleHandle: number | null = null;
  private highlightResetHandle: number | null = null;
  private scrollTarget: HTMLElement | null = null;
  private turnContainer: HTMLElement | null = null;
  private historyMountTarget: HTMLElement | null = null;
  private highlightedTurnNode: HTMLElement | null = null;
  private active = false;
  private softFallbackSession = false;
  private lastError: string | null = null;
  private chatId: string;
  private initialTrimSession: InitialTrimSession | null = null;
  private runtimeStatus: TabRuntimeStatus;
  private lastInteractionNode: Node | null = null;
  private lastInteractionAt = 0;
  private manualRestoreHoldUntil = 0;
  private uiLanguage: UiLanguage = 'en';
  private t: Translator = createTranslator('en');
  private readonly records = new Map<string, TurnRecord>();
  private readonly expandedArchiveBatchIds = new Set<string>();
  private archiveSearchOpen = false;
  private archiveSearchQuery = '';
  private archiveSearchResults: ArchivePageMatch[] = [];
  private activeArchiveSearchPageIndex: number | null = null;
  private activeArchiveSearchPairIndex: number | null = null;
  private readonly entryActionSelectionByEntryId = new Map<string, EntryActionSelection>();
  private readonly entryActionTemplateByLane = new Map<EntryActionLane, HostActionTemplateSnapshot>();
  private readonly entryHostMessageIdCache = new Map<string, string>();
  private entryActionMenu: EntryActionMenuSelection | null = null;
  private suppressEntryActionMenuToggle = false;
  private suppressEntryActionMenuDismissal = false;
  private readAloudMenuSelection: EntryActionMenuSelection | null = null;
  private entryActionSpeakingEntryKey: string | null = null;
  private entryActionReadAloudMode: 'backend' | 'speech' | null = null;
  private entryActionReadAloudGeneration = 0;
  private entryActionReadAloudAudio: HTMLAudioElement | null = null;
  private entryActionReadAloudObjectUrl: string | null = null;
  private entryActionReadAloudAbortController: AbortController | null = null;
  private entryActionCopiedEntryKey: string | null = null;
  private entryActionCopiedResetHandle: number | null = null;
  private pendingHostMoreActionRestore: (() => void) | null = null;
  private readonly readAloudConversationPayloadCache = new Map<string, ConversationPayload>();
  private readonly readAloudConversationSnapshotPrimed = new Set<string>();
  private readonly readAloudConversationSnapshotRequests = new Map<string, Promise<void>>();
  private readonly readAloudConversationSnapshotFailures = new Map<string, number>();
  private ignoreMutationsUntil = 0;
  private ignoreScrollUntil = 0;
  private archiveUiSyncHandle: number | null = null;
  private mutationRefreshHandle: number | null = null;
  private scrollRefreshHandle: number | null = null;
  private pendingArchiveToggle: {
    groupId: string;
    anchor: HTMLElement | null;
    previousAnchorTop: number | null;
    previousScrollTop: number;
    targetAnchorTop: number | null;
    scrollTarget: HTMLElement | null;
    wasExpanded: boolean;
  } | null = null;
  private pendingArchiveSearchJump: {
    pageIndex: number;
    pairIndex: number;
    attemptCount: number;
  } | null = null;
  private refreshCount = 0;
  private lastLiveSignature = '';
  private cachedLiveDescendantCount = 0;
  private lastLiveDescendantSampleAt = 0;
  private liveDescendantSampleDirty = true;
  private readonly contentScriptInstanceId: string;
  private readonly contentScriptStartedAt: number;

  constructor(options: TurboRenderControllerOptions = {}) {
    this.doc = options.document ?? document;
    this.win = options.window ?? window;
    this.settings = options.settings ?? DEFAULT_SETTINGS;
    this.paused = options.paused ?? false;
    this.mountUi = options.mountUi ?? true;
    this.onPauseToggle = options.onPauseToggle;
    this.contentScriptInstanceId = options.contentScriptInstanceId ?? 'unknown-instance';
    this.contentScriptStartedAt = options.contentScriptStartedAt ?? Date.now();
    this.chatId = getChatIdFromPathname(this.doc.location?.pathname ?? '/');
    this.readAloudBackend = new ReadAloudBackendClient(this.win);
    this.hostMenuPositioning = new HostMenuPositioning(
      this.doc,
      this.win,
      () => this.statusBar?.getTopPageChromeOffset?.() ?? 0,
    );
    this.frameSpikeMonitor = new FrameSpikeMonitor(
      this.win,
      this.settings.frameSpikeThresholdMs,
      this.settings.frameSpikeWindowMs,
    );
    this.runtimeStatus = this.buildStatus({
      supported: false,
      reason: 'not-started',
      totalTurns: 0,
      totalPairs: 0,
      finalizedTurns: 0,
      liveDescendantCount: 0,
      visibleRange: null,
    });
  }

  start(): void {
    console.log(`[TurboRender] Controller starting, mountUi=${this.mountUi}`);
    if (this.mountUi) {
      this.statusBar = new StatusBar(this.doc, {
        onToggleArchiveGroup: (groupId, anchor) => {
          this.toggleArchiveGroup(groupId, anchor);
        },
        onOpenNewestArchivePage: () => {
          this.openNewestArchivePage();
        },
        onGoOlderArchivePage: () => {
          this.goOlderArchivePage();
        },
        onGoNewerArchivePage: () => {
          this.goNewerArchivePage();
        },
        onGoToRecentArchiveView: () => {
          this.goToRecentArchiveView();
        },
        onToggleArchiveSearch: () => {
          this.toggleArchiveSearch();
        },
        onArchiveSearchQueryChange: (query) => {
          this.setArchiveSearchQuery(query);
        },
        onClearArchiveSearch: () => {
          this.clearArchiveSearch();
        },
        onOpenArchiveSearchResult: (result) => {
          this.openArchiveSearchResult(result);
        },
        onEntryAction: (request) => {
          void this.handleArchiveEntryAction(request);
        },
        onMoreMenuAction: (request) => {
          void this.handleMoreMenuAction(request);
        },
      });
      console.log(`[TurboRender] StatusBar created: ${this.statusBar != null}`);
    }

    this.refreshLanguage();
    this.frameSpikeMonitor.start();
    this.bindEvents();
    this.scheduleRefresh();
  }

  stop(): void {
    this.archivePager.goToRecent();
    this.parkingLot.restoreAll();
    this.managedHistory.clear();
    this.expandedArchiveBatchIds.clear();
    this.resetArchiveSearchState();
    this.entryActionSelectionByEntryId.clear();
    this.entryActionTemplateByLane.clear();
    this.entryHostMessageIdCache.clear();
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    this.entryActionMenu = null;
    this.clearCopiedEntryFeedback(false);
    this.clearReadAloudPlayback({ updateStatusBar: false });
    this.readAloudConversationPayloadCache.clear();
    this.readAloudConversationSnapshotPrimed.clear();
    this.readAloudConversationSnapshotRequests.clear();
    this.readAloudConversationSnapshotFailures.clear();
    this.clearReadAloudAccessToken();
    this.cachedLiveDescendantCount = 0;
    this.lastLiveDescendantSampleAt = 0;
    this.liveDescendantSampleDirty = true;
    this.clearHighlights();
    this.frameSpikeMonitor.stop();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.observedMutationRoot = null;
    if (this.refreshHandle != null) {
      this.win.cancelAnimationFrame?.(this.refreshHandle) ?? this.win.clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
    if (this.archiveUiSyncHandle != null) {
      this.win.cancelAnimationFrame?.(this.archiveUiSyncHandle) ?? this.win.clearTimeout(this.archiveUiSyncHandle);
      this.archiveUiSyncHandle = null;
    }
    if (this.scrollRefreshHandle != null) {
      this.win.clearTimeout(this.scrollRefreshHandle);
      this.scrollRefreshHandle = null;
    }
    if (this.mutationRefreshHandle != null) {
      this.win.clearTimeout(this.mutationRefreshHandle);
      this.mutationRefreshHandle = null;
    }
    this.ignoreScrollUntil = 0;
    if (this.idleHandle != null) {
      cancelIdleCallbackCompat(this.win, this.idleHandle);
      this.idleHandle = null;
    }
    if (this.highlightResetHandle != null) {
      this.win.clearTimeout(this.highlightResetHandle);
      this.highlightResetHandle = null;
    }
    this.setScrollTarget(null);
    this.statusBar?.destroy();
    this.statusBar = null;
  }

  getStatus(): TabRuntimeStatus {
    return this.runtimeStatus;
  }

  refreshForRuntimeStatusRequest(): void {
    this.refreshNow();
  }

  setSettings(settings: Settings): void {
    if (areSettingsEquivalent(this.settings, settings)) {
      return;
    }
    this.settings = settings;
    this.refreshLanguage();
    this.scheduleRefresh();
  }

  resetForChatChange(chatId: string): void {
    if (chatId === this.chatId) {
      return;
    }

    this.parkingLot.restoreAll();
    this.managedHistory.clear();
    this.expandedArchiveBatchIds.clear();
    this.resetArchiveSearchState();
    this.entryActionSelectionByEntryId.clear();
    this.entryActionTemplateByLane.clear();
    this.entryActionMenu = null;
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    this.clearCopiedEntryFeedback(false);
    this.clearReadAloudPlayback({ updateStatusBar: false });
    this.readAloudConversationPayloadCache.clear();
    this.readAloudConversationSnapshotPrimed.clear();
    this.readAloudConversationSnapshotRequests.clear();
    this.readAloudConversationSnapshotFailures.clear();
    this.clearReadAloudAccessToken();
    this.clearHighlights();
    this.records.clear();
    this.active = false;
    this.softFallbackSession = false;
    this.lastError = null;
    this.initialTrimSession = null;
    this.historyMountTarget = null;
    this.turnContainer = null;
    this.chatId = chatId;
    this.archivePager.goToRecent();
    if (this.archiveUiSyncHandle != null) {
      this.win.cancelAnimationFrame?.(this.archiveUiSyncHandle) ?? this.win.clearTimeout(this.archiveUiSyncHandle);
      this.archiveUiSyncHandle = null;
    }
    if (this.scrollRefreshHandle != null) {
      this.win.clearTimeout(this.scrollRefreshHandle);
      this.scrollRefreshHandle = null;
    }
    if (this.mutationRefreshHandle != null) {
      this.win.clearTimeout(this.mutationRefreshHandle);
      this.mutationRefreshHandle = null;
    }
    this.pendingArchiveToggle = null;
    this.ignoreScrollUntil = 0;
    this.setObservedMutationRoot(this.doc.body, 'archive-only-root');
    this.setScrollTarget(null);
    const archiveState = this.collectArchiveState(0);
    this.runtimeStatus = this.buildStatus({
      supported: false,
      reason: 'chat-change',
      totalTurns: 0,
      totalPairs: 0,
      finalizedTurns: 0,
      liveDescendantCount: 0,
      visibleRange: null,
    }, archiveState);
    this.updateStatusBar(archiveState);
    this.scheduleRefresh();
  }

  setInitialTrimSession(session: InitialTrimSession | null): void {
    if (session != null && session.chatId !== this.chatId) {
      return;
    }
    if (this.initialTrimSession?.applied === true && (session == null || session.applied !== true)) {
      return;
    }

    this.initialTrimSession = session;
    this.managedHistory.setInitialTrimSession(session);
    this.pruneExpandedArchiveBatches();
    if (session?.applied === true && this.settings.enabled && !this.paused) {
      this.active = true;
    }
    this.updateBatchSearchState();
    this.scheduleRefresh();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    if (paused) {
      this.active = false;
      this.restoreAllParking(0);
      if (this.archiveUiSyncHandle != null) {
        this.win.cancelAnimationFrame?.(this.archiveUiSyncHandle) ?? this.win.clearTimeout(this.archiveUiSyncHandle);
        this.archiveUiSyncHandle = null;
      }
      if (this.scrollRefreshHandle != null) {
        this.win.clearTimeout(this.scrollRefreshHandle);
        this.scrollRefreshHandle = null;
      }
      if (this.mutationRefreshHandle != null) {
        this.win.clearTimeout(this.mutationRefreshHandle);
        this.mutationRefreshHandle = null;
      }
      this.ignoreScrollUntil = 0;
      this.pendingArchiveToggle = null;
      this.entryActionMenu = null;
      this.clearCopiedEntryFeedback(false);
      this.clearReadAloudPlayback({ updateStatusBar: false });
      this.readAloudConversationPayloadCache.clear();
      this.readAloudConversationSnapshotPrimed.clear();
      this.readAloudConversationSnapshotRequests.clear();
      this.readAloudConversationSnapshotFailures.clear();
      this.clearReadAloudAccessToken();
      this.statusBar?.destroy();
    } else if (this.settings.enabled) {
      this.active = true;
      this.manualRestoreHoldUntil = 0;
    }
    this.scheduleRefresh();
  }

  private clearReadAloudAccessToken(): void {
    this.readAloudBackend.clearAccessToken();
  }

  private async ensureConversationSnapshotForReadAloud(conversationId: string | null): Promise<void> {
    if (conversationId == null || conversationId.trim().length === 0) {
      return;
    }

    const normalizedConversationId = conversationId.trim();
    if (this.readAloudConversationSnapshotPrimed.has(normalizedConversationId)) {
      return;
    }
    if (this.isConversationSnapshotFailureActive(normalizedConversationId)) {
      return;
    }

    const pending = this.readAloudConversationSnapshotRequests.get(normalizedConversationId);
    if (pending != null) {
      return pending;
    }

    const request = (async () => {
      let storedPayload = false;
      try {
        const snapshotUrl = new URL(
          `/backend-api/conversation/${normalizedConversationId}`,
          this.win.location.origin,
        );
        snapshotUrl.searchParams.set('__turbo_render_read_aloud_snapshot', '1');
        const headers = await this.readAloudBackend.buildAuthorizationHeaders();
        const init = createIncludeCredentialsRequestInit(headers);
        const response = await this.win.fetch(snapshotUrl.toString(), init);
        if (!response.ok) {
          this.readAloudConversationSnapshotFailures.set(
            normalizedConversationId,
            this.win.performance.now() + READ_ALOUD_SNAPSHOT_FAILURE_MS,
          );
          return;
        }

        if (this.getConversationPayloadForReadAloud(normalizedConversationId) == null) {
          try {
            const payload = (await response.clone().json()) as ConversationPayload;
            if (payload != null && typeof payload === 'object' && (payload.mapping ?? null) != null) {
              this.setConversationPayloadForReadAloud(normalizedConversationId, payload);
              storedPayload = true;
            } else {
              this.readAloudConversationSnapshotFailures.set(
                normalizedConversationId,
                this.win.performance.now() + READ_ALOUD_SNAPSHOT_FAILURE_MS,
              );
              return;
            }
          } catch {
            this.readAloudConversationSnapshotFailures.set(
              normalizedConversationId,
              this.win.performance.now() + READ_ALOUD_SNAPSHOT_FAILURE_MS,
            );
            // Ignore parsing failures and keep the bootstrap-provided cache as the fallback.
            return;
          }
        }

        this.readAloudConversationSnapshotPrimed.add(normalizedConversationId);
        this.readAloudConversationSnapshotFailures.delete(normalizedConversationId);
      } catch {
        this.readAloudConversationSnapshotFailures.set(
          normalizedConversationId,
          this.win.performance.now() + READ_ALOUD_SNAPSHOT_FAILURE_MS,
        );
        // Ignore snapshot priming failures and fall back to the existing read-aloud resolution path.
      } finally {
        this.readAloudConversationSnapshotRequests.delete(normalizedConversationId);
        if (storedPayload) {
          this.scheduleRefresh();
        }
      }
    })();

    this.readAloudConversationSnapshotRequests.set(normalizedConversationId, request);
    return request;
  }

  private isConversationSnapshotFailureActive(conversationId: string): boolean {
    const blockedUntil = this.readAloudConversationSnapshotFailures.get(conversationId);
    if (blockedUntil == null) {
      return false;
    }

    if (blockedUntil > this.win.performance.now()) {
      return true;
    }

    this.readAloudConversationSnapshotFailures.delete(conversationId);
    return false;
  }

  private setConversationPayloadForReadAloud(conversationId: string | null, payload: ConversationPayload | null): void {
    if (conversationId == null || conversationId.trim().length === 0 || payload == null) {
      return;
    }

    const normalizedConversationId = conversationId.trim();
    this.readAloudConversationPayloadCache.set(normalizedConversationId, payload);
    const cache = (this.win as Window & {
      __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
    }).__turboRenderConversationPayloadCache ?? {};
    cache[normalizedConversationId] = payload;
    (this.win as Window & {
      __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
    }).__turboRenderConversationPayloadCache = cache;
  }

  private getConversationPayloadForReadAloud(conversationId: string | null): ConversationPayload | null {
    if (conversationId == null || conversationId.trim().length === 0) {
      return null;
    }

    const normalizedConversationId = conversationId.trim();
    const local = this.readAloudConversationPayloadCache.get(normalizedConversationId);
    if (local != null) {
      return local;
    }

    const cache = (this.win as Window & {
      __turboRenderConversationPayloadCache?: Record<string, ConversationPayload>;
    }).__turboRenderConversationPayloadCache;
    return cache?.[normalizedConversationId] ?? null;
  }

  private primeConversationMetadataIfNeeded(archiveState: ArchiveUiState): void {
    if (!this.shouldUseBackendReadAloud() || archiveState.currentPageGroups.length === 0) {
      return;
    }

    const conversationId = this.getConversationIdForReadAloud();
    if (conversationId == null || conversationId.trim().length === 0) {
      return;
    }

    if (
      this.readAloudConversationSnapshotPrimed.has(conversationId) ||
      this.readAloudConversationSnapshotRequests.has(conversationId) ||
      this.isConversationSnapshotFailureActive(conversationId)
    ) {
      return;
    }

    void this.ensureConversationSnapshotForReadAloud(conversationId);
  }

  private getResolvedConversationReadAloudMessageId(): string | null {
    return getResolvedConversationReadAloudMessageId(this.doc);
  }

  restoreAll(): void {
    const totalPairs = this.managedHistory.getTotalPairs();
    const pageCount = this.getArchivePageCount(totalPairs);
    if (pageCount <= 0) {
      this.goToRecentArchiveView();
      return;
    }

    if (this.archivePager.currentPageIndex == null) {
      this.archivePager.openNewest(pageCount);
    }

    const currentPageGroups = this.getArchiveGroupsForPage(this.archivePager.currentPageIndex, totalPairs, new Set());
    this.expandedArchiveBatchIds.clear();
    for (const group of currentPageGroups) {
      this.expandedArchiveBatchIds.add(group.id);
    }

    this.manualRestoreHoldUntil = this.win.performance.now() + 5000;
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
    this.scheduleRefresh();
  }

  restoreNearby(): void {
    const totalPairs = this.managedHistory.getTotalPairs();
    const pageCount = this.getArchivePageCount(totalPairs);
    if (pageCount <= 0) {
      this.goToRecentArchiveView();
      return;
    }

    if (this.archivePager.currentPageIndex == null) {
      this.archivePager.openNewest(pageCount);
    }

    const archiveGroups = this.getArchiveGroupsForPage(this.archivePager.currentPageIndex, totalPairs, new Set());
    const latestCollapsedGroup = [...archiveGroups].reverse().find((group) => !group.expanded);
    this.expandedArchiveBatchIds.clear();
    if (latestCollapsedGroup != null) {
      this.expandedArchiveBatchIds.add(latestCollapsedGroup.id);
    }

    this.manualRestoreHoldUntil = this.win.performance.now() + 3000;
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
    this.scheduleRefresh();
  }

  private restoreAllParking(holdMs: number): void {
    this.ignoreMutationsUntil = this.win.performance.now() + 64;
    this.parkingLot.restoreAll();
    this.managedHistory.resetLiveStartIndex();
    for (const record of this.records.values()) {
      record.parked = false;
    }
    this.manualRestoreHoldUntil = this.win.performance.now() + holdMs;
    this.entryActionMenu = null;
    this.updateBatchSearchState();
    const archiveState = this.collectArchiveState();
    this.runtimeStatus = this.buildStatus({
      supported: this.runtimeStatus.supported,
      reason: this.runtimeStatus.reason,
      totalTurns: this.managedHistory.getTotalTurns(),
      totalPairs: this.managedHistory.getTotalPairs(),
      finalizedTurns: this.runtimeStatus.finalizedTurns,
      liveDescendantCount: countLiveDescendants(this.turnContainer),
      visibleRange: this.runtimeStatus.visibleRange,
    }, archiveState);
    this.updateStatusBar(archiveState);
  }

  private bindEvents(): void {
    this.doc.addEventListener(
      'pointerdown',
      (event) => {
        this.lastInteractionNode = event.target as Node | null;
        this.lastInteractionAt = this.win.performance.now();
        if (this.suppressEntryActionMenuDismissal) {
          return;
        }
        if (this.entryActionMenu != null && this.shouldCloseEntryActionMenu(event.target as Node | null)) {
          this.closeEntryActionMenu();
        }
      },
      true,
    );

    this.doc.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.entryActionMenu != null) {
          this.closeEntryActionMenu();
        }
      },
      true,
    );

    this.win.addEventListener('resize', () => this.scheduleRefresh(), { passive: true });
    this.win.addEventListener('pagehide', () => this.stop(), { once: true });

    this.mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === 'childList')) {
        this.liveDescendantSampleDirty = true;
      }
      if (this.shouldRefreshForMutations(mutations)) {
        this.scheduleMutationRefresh();
      }
    });
    this.setObservedMutationRoot(this.doc.body, 'archive-only-root');
  }

  private hasLargeConversation(): boolean {
    const totalTurns = this.managedHistory.getTotalTurns();
    if (totalTurns >= LARGE_CONVERSATION_TURN_THRESHOLD) {
      return true;
    }
    return this.records.size >= LARGE_CONVERSATION_TURN_THRESHOLD;
  }

  private scheduleMutationRefresh(): void {
    if (!this.hasLargeConversation()) {
      this.scheduleRefresh();
      return;
    }

    if (this.mutationRefreshHandle != null || this.refreshHandle != null || this.scrollRefreshHandle != null) {
      return;
    }

    this.mutationRefreshHandle = this.win.setTimeout(() => {
      this.mutationRefreshHandle = null;
      this.scheduleRefresh();
    }, LARGE_CONVERSATION_REFRESH_DELAY_MS);
  }

  private shouldRefreshForMutations(mutations: MutationRecord[]): boolean {
    return shouldRefreshForMutationBatch(mutations, {
      now: this.win.performance.now(),
      ignoreMutationsUntil: this.ignoreMutationsUntil,
      ignoreScrollUntil: this.ignoreScrollUntil,
      hasPendingScrollRefresh: this.scrollRefreshHandle != null,
      largeConversation: this.hasLargeConversation(),
    });
  }

  private toggleArchiveGroup(groupId: string, anchor: HTMLElement | null): void {
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousAnchorTop =
      anchor?.getBoundingClientRect().top ??
      this.statusBar?.getBatchCardHeaderAnchor(groupId)?.getBoundingClientRect().top ??
      this.statusBar?.getBatchCardAnchor(groupId)?.getBoundingClientRect().top ??
      null;
    const previousScrollTop = scrollTarget?.scrollTop ?? 0;
    const wasExpanded = this.expandedArchiveBatchIds.has(groupId);
    const targetAnchorTop = this.getBatchHeaderScrollTop();

    if (wasExpanded) {
      this.expandedArchiveBatchIds.delete(groupId);
    } else {
      this.expandedArchiveBatchIds.add(groupId);
    }

    this.pendingArchiveToggle = {
      groupId,
      anchor,
      previousAnchorTop,
      previousScrollTop,
      targetAnchorTop,
      scrollTarget,
      wasExpanded,
    };
    this.scheduleArchiveUiSync();
  }

  private toggleEntryActionMenu(groupId: string, entryId: string, lane: EntryActionMenuSelection['lane']): void {
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    const nextMenu =
      this.entryActionMenu != null &&
      this.entryActionMenu.groupId === groupId &&
      this.entryActionMenu.entryId === entryId &&
      this.entryActionMenu.lane === lane
        ? null
        : { groupId, entryId, lane };

    if (this.suppressEntryActionMenuToggle && nextMenu == null) {
      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      return;
    }

    this.entryActionMenu = nextMenu;
    this.updateStatusBar();
    this.restoreExactScrollTop(scrollTarget, previousScrollTop);
  }

  private async runWithSuppressedEntryActionMenuDismissal<T>(callback: () => Promise<T> | T): Promise<T> {
    const previous = this.suppressEntryActionMenuDismissal;
    this.suppressEntryActionMenuDismissal = true;
    try {
      return await callback();
    } finally {
      this.suppressEntryActionMenuDismissal = previous;
    }
  }

  private scheduleEntryActionMenuRestoration(selection: EntryActionMenuSelection | null): void {
    if (selection == null) {
      return;
    }

    this.win.setTimeout(() => {
      if (this.entryActionMenu != null) {
        return;
      }
      this.entryActionMenu = selection;
      this.updateStatusBar(this.collectArchiveState());
    }, 0);
  }

  private closeEntryActionMenu(): void {
    if (this.entryActionMenu == null) {
      return;
    }

    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    this.entryActionMenu = null;
    this.updateStatusBar();
    this.restoreExactScrollTop(scrollTarget, previousScrollTop);
  }

  private restoreScrollAnchor(
    scrollTarget: HTMLElement | null,
    anchorGetter: () => HTMLElement | null,
    previousScrollTop: number | null,
    previousAnchorTop: number | null,
    options: { doublePass?: boolean; targetAnchorTop?: number | null } = {},
  ): void {
    if (scrollTarget == null) {
      return;
    }

    const apply = (): void => {
      const nextAnchorTop = anchorGetter()?.getBoundingClientRect().top ?? null;
      this.ignoreScrollUntil = this.win.performance.now() + SCROLL_RESTORE_IGNORE_MS;

      if (options.targetAnchorTop != null && nextAnchorTop != null) {
        scrollTarget.scrollTop += nextAnchorTop - options.targetAnchorTop;
        return;
      }

      if (previousScrollTop != null && previousAnchorTop != null && nextAnchorTop != null) {
        scrollTarget.scrollTop = previousScrollTop + (nextAnchorTop - previousAnchorTop);
        return;
      }

      if (previousScrollTop != null) {
        scrollTarget.scrollTop = previousScrollTop;
      }
    };

    apply();
    if (options.doublePass !== false) {
      requestAnimationFrameCompat(this.win, apply);
    }
  }

  private restoreExactScrollTop(scrollTarget: HTMLElement | null, previousScrollTop: number | null): void {
    if (scrollTarget == null || previousScrollTop == null) {
      return;
    }

    this.ignoreScrollUntil = this.win.performance.now() + SCROLL_RESTORE_IGNORE_MS;
    scrollTarget.scrollTop = previousScrollTop;
  }

  private shouldCloseEntryActionMenu(target: Node | null): boolean {
    if (this.entryActionMenu == null || !(target instanceof Element)) {
      return this.entryActionMenu != null;
    }

    const menuRoot = target.closest<HTMLElement>(`[data-turbo-render-entry-menu="true"]`);
    if (menuRoot != null) {
      return false;
    }

    const moreButton = target.closest<HTMLElement>(
      `button[data-turbo-render-action="more"][data-group-id="${this.entryActionMenu.groupId}"][data-entry-key="${this.entryActionMenu.entryId}"]`,
    );
    return moreButton == null;
  }

  private isShareActionsDebugEnabled(): boolean {
    try {
      const search = new URLSearchParams(this.doc.location.search);
      if (search.get(TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY) === '1') {
        return true;
      }
      if (this.win.sessionStorage.getItem(TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY) === '1') {
        return true;
      }
      if ((this.win as Window & { __turboRenderDebugShareActions?: boolean }).__turboRenderDebugShareActions === true) {
        return true;
      }
      return (
        this.doc.documentElement.dataset.turboRenderDebugShareActions === '1' ||
        this.doc.body?.dataset.turboRenderDebugShareActions === '1'
      );
    } catch {
      return false;
    }
  }

  private incrementDebugActionCounter(action: 'share' | 'branch' | 'read-aloud' | 'stop-read-aloud'): void {
    const key =
      action === 'share'
        ? 'hostActionShareCount'
        : action === 'branch'
          ? 'hostActionBranchCount'
          : action === 'read-aloud'
            ? 'hostActionReadAloudCount'
            : 'hostActionStopReadAloudCount';
    const current = Number(this.doc.body.dataset[key] ?? '0');
    this.doc.body.dataset[key] = String(current + 1);
  }

  private shouldUseBackendReadAloud(): boolean {
    return shouldUseBackendReadAloud({
      preferHostMorePopover: this.shouldPreferHostMorePopover(),
      debugBackendEnabled: this.isDebugReadAloudBackendEnabled(),
      conversationId: this.getConversationIdForReadAloud(),
    });
  }

  private shouldAllowLocalReadAloudFallback(): boolean {
    return shouldAllowLocalReadAloudFallback(this.doc.location.hostname);
  }

  private isDebugReadAloudBackendEnabled(): boolean {
    return isDebugReadAloudBackendEnabled(this.win, this.doc);
  }

  private setReadAloudRequestContext(context: {
    conversationId: string | null;
    entryRole: 'user' | 'assistant';
    entryText: string;
    entryKey: string;
    entryMessageId: string;
    groupId: string;
    entryId: string;
    action: EntryMoreMenuAction;
  }): void {
    setReadAloudRequestContext(this.win, this.doc, context);
  }

  private shouldUseHostActionClicks(): boolean {
    const hostname = this.doc.location.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname === 'chatgpt.com' ||
      hostname.endsWith('.chatgpt.com') ||
      hostname === 'chat.openai.com' ||
      hostname.endsWith('.chat.openai.com')
    );
  }

  private shouldPreferHostMorePopover(): boolean {
    const hostname = this.doc.location.hostname;
    const isHost =
      hostname === 'chatgpt.com' ||
      hostname.endsWith('.chatgpt.com') ||
      hostname === 'chat.openai.com' ||
      hostname.endsWith('.chat.openai.com');

    if (!isHost) {
      return false;
    }

    return !this.doc.location.pathname.includes('/share/');
  }

  private getConversationIdForReadAloud(): string | null {
    const debugConversationId = resolveDebugConversationId(this.win, this.doc);
    if (debugConversationId != null) {
      return debugConversationId;
    }

    return (
      getRouteIdFromRuntimeId(getChatIdFromPathname(this.doc.location?.pathname ?? '/')) ??
      getRouteIdFromRuntimeId(this.chatId) ??
      this.initialTrimSession?.conversationId ??
      null
    );
  }

  private buildReadAloudUrl(entry: ManagedHistoryEntry, groupId: string | null = null): string | null {
    const debugUrl = resolveDebugReadAloudUrl(this.win, this.doc);
    if (debugUrl != null) {
      return debugUrl;
    }

    if (!this.shouldUseBackendReadAloud()) {
      return null;
    }

    const conversationId = this.getConversationIdForReadAloud();
    const record = this.getRecordForEntry(entry);
    const renderedArchiveMessageId = this.findRenderedArchiveMessageIdForEntry(groupId, entry);
    const parkedMessageId = this.findParkedMessageIdForEntry(groupId, entry);
    const hostMessageId = this.findHostMessageIdForEntry(entry, groupId);
    const snapshotMessageId = extractMessageIdFromHtml(entry.snapshotHtml);
    const recordMessageId = record?.messageId ?? null;
    const nodeMessageId = resolveMessageId(record?.node ?? null);
    const messageId = resolveRealMessageId(
      renderedArchiveMessageId,
      parkedMessageId,
      hostMessageId,
      snapshotMessageId,
      recordMessageId,
      nodeMessageId,
      entry.messageId,
    );

    if (this.doc.body != null) {
      this.doc.body.dataset.turboRenderDebugReadAloudCandidateRendered = renderedArchiveMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudCandidateParked = parkedMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudCandidateHost = hostMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudCandidateSnapshot = snapshotMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudCandidateRecord = recordMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudCandidateNode = nodeMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudMessageId = messageId ?? '';
    }
    if (this.doc.documentElement != null) {
      this.doc.documentElement.dataset.turboRenderDebugReadAloudCandidateRendered = renderedArchiveMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudCandidateParked = parkedMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudCandidateHost = hostMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudCandidateSnapshot = snapshotMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudCandidateRecord = recordMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudCandidateNode = nodeMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudMessageId = messageId ?? '';
    }

    if (conversationId == null || messageId == null || messageId.length === 0) {
      return null;
    }

    return buildReadAloudSynthesizeUrl(this.win.location.origin, conversationId, messageId);
  }

  private buildDirectReadAloudUrl(conversationId: string, messageId: string): string {
    return buildReadAloudSynthesizeUrl(this.win.location.origin, conversationId, messageId);
  }

  private findParkedMessageIdForEntry(groupId: string | null, entry: ManagedHistoryEntry): string | null {
    if (groupId == null) {
      return null;
    }

    const parkedGroup = this.parkingLot.getGroup(groupId) ?? null;
    const archiveGroup = this.collectArchiveState().currentPageGroups.find((group) => group.id === groupId) ?? null;
    return findParkedMessageIdForEntryInGroup(entry, parkedGroup, archiveGroup);
  }

  private findRenderedArchiveMessageIdForEntry(groupId: string | null, entry: ManagedHistoryEntry): string | null {
    if (groupId == null || this.statusBar == null) {
      return null;
    }

    const actionAnchor = this.statusBar.getEntryActionAnchor(groupId, entry.id);
    return findRenderedArchiveMessageIdFromActionAnchor(entry, actionAnchor);
  }

  private findHostMessageIdForEntry(
    entry: ManagedHistoryEntry,
    groupId: string | null = null,
    archiveGroupOverride: ManagedHistoryGroup | null = null,
  ): string | null {
    const archiveGroup =
      archiveGroupOverride ??
      (groupId != null
        ? this.collectArchiveState().currentPageGroups.find((candidate) => candidate.id === groupId) ?? null
        : null);
    const record = this.getRecordForEntry(entry);
    return findHostMessageIdForEntryInScope({
      doc: this.doc,
      scope: this.doc.body ?? this.turnContainer ?? this.historyMountTarget,
      entry,
      record: record == null ? null : { index: record.index, messageId: record.messageId ?? null, id: record.id },
      archiveGroup,
      archiveTurnOffset: this.initialTrimSession?.archivedTurnCount ?? 0,
      normalizeEntryText,
    });
  }

  private doesHostActionButtonMatchEntry(candidate: HTMLElement, entry: ManagedHistoryEntry): boolean {
    return doesHostActionButtonMatchArchiveEntry(candidate, entry);
  }

  private ensureReadAloudAudio(): HTMLAudioElement {
    if (this.entryActionReadAloudAudio != null) {
      return this.entryActionReadAloudAudio;
    }

    const audio = this.doc.createElement('audio');
    audio.hidden = true;
    audio.preload = 'auto';
    audio.dataset.turboRenderReadAloud = 'true';
    audio.dataset.turboRenderReadAloudMode = '';
    audio.setAttribute('aria-hidden', 'true');
    audio.style.display = 'none';
    audio.style.pointerEvents = 'none';
    this.doc.body?.append(audio);
    this.entryActionReadAloudAudio = audio;
    return audio;
  }

  private clearCopiedEntryFeedback(updateStatusBar = false): void {
    if (this.entryActionCopiedResetHandle != null) {
      this.win.clearTimeout(this.entryActionCopiedResetHandle);
      this.entryActionCopiedResetHandle = null;
    }
    if (this.entryActionCopiedEntryKey == null) {
      return;
    }
    this.entryActionCopiedEntryKey = null;
    if (updateStatusBar) {
      this.updateStatusBar(this.collectArchiveState());
    }
  }

  private markArchiveEntryCopied(entryKey: string): void {
    if (this.entryActionCopiedResetHandle != null) {
      this.win.clearTimeout(this.entryActionCopiedResetHandle);
    }
    this.entryActionCopiedEntryKey = entryKey;
    this.updateStatusBar(this.collectArchiveState());
    this.entryActionCopiedResetHandle = this.win.setTimeout(() => {
      if (this.entryActionCopiedEntryKey !== entryKey) {
        return;
      }
      this.entryActionCopiedEntryKey = null;
      this.entryActionCopiedResetHandle = null;
      this.updateStatusBar(this.collectArchiveState());
    }, 1600);
  }

  private setReadAloudStreamingDebug(value: '0' | '1' | 'unsupported' | 'error'): void {
    if (this.doc.body != null) {
      this.doc.body.dataset.turboRenderReadAloudStreaming = value;
    }
    if (this.doc.documentElement != null) {
      this.doc.documentElement.dataset.turboRenderReadAloudStreaming = value;
    }
  }

  private configureBackendReadAloudAudio(audio: HTMLAudioElement, entryKey: string, generation: number): void {
    audio.dataset.turboRenderReadAloudMode = 'backend';
    audio.onended = () => {
      if (this.entryActionSpeakingEntryKey === entryKey && this.entryActionReadAloudGeneration === generation) {
        this.clearReadAloudPlayback({ updateStatusBar: true });
      }
    };
    audio.onerror = () => {
      if (this.entryActionSpeakingEntryKey === entryKey && this.entryActionReadAloudGeneration === generation) {
        this.clearReadAloudPlayback({ updateStatusBar: true });
      }
    };
  }

  private activateBackendReadAloud(audio: HTMLAudioElement, entryKey: string, generation: number): void {
    this.configureBackendReadAloudAudio(audio, entryKey, generation);
    this.entryActionSpeakingEntryKey = entryKey;
    this.entryActionReadAloudMode = 'backend';
    this.updateStatusBar(this.collectArchiveState());
  }

  private clearReadAloudPlayback(options: {
    incrementStopCount?: boolean;
    updateStatusBar?: boolean;
  } = {}): void {
    const { incrementStopCount = false, updateStatusBar = true } = options;
    this.entryActionReadAloudGeneration += 1;
    const mode = this.entryActionReadAloudMode;
    const audio = this.entryActionReadAloudAudio;
    const objectUrl = this.entryActionReadAloudObjectUrl;
    const abortController = this.entryActionReadAloudAbortController;
    this.entryActionReadAloudObjectUrl = null;
    this.entryActionReadAloudAbortController = null;

    if (abortController != null) {
      abortController.abort();
    }

    if (audio != null) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        // Ignore pause failures in detached/test contexts.
      }
      try {
        audio.currentTime = 0;
      } catch {
        // Ignore reset failures in browsers that have not advanced playback yet.
      }
      audio.removeAttribute('src');
      audio.load();
      audio.dataset.turboRenderReadAloudMode = '';
      delete audio.dataset.turboRenderReadAloudUrl;
    }
    if (objectUrl != null) {
      URL.revokeObjectURL(objectUrl);
    }
    if (mode === 'speech') {
      this.win.speechSynthesis?.cancel();
    }

    const wasSpeaking = this.entryActionSpeakingEntryKey != null;
    this.entryActionSpeakingEntryKey = null;
    this.entryActionReadAloudMode = null;
    const preserveReadAloudDebug =
      this.doc.body?.dataset.turboRenderDebugReadAloudBackend === '1' ||
      this.doc.documentElement.dataset.turboRenderDebugReadAloudBackend === '1';

    if (incrementStopCount && wasSpeaking) {
      this.incrementDebugActionCounter('stop-read-aloud');
      this.readAloudMenuSelection = null;
    }

    if (updateStatusBar) {
      this.updateStatusBar(this.collectArchiveState());
    }

    if (preserveReadAloudDebug) {
      return;
    }

    if (this.doc.body != null) {
      this.doc.body.dataset.turboRenderReadAloudMode = '';
      delete this.doc.body.dataset.turboRenderReadAloudUrl;
      delete this.doc.body.dataset.turboRenderReadAloudStreaming;
    }
    if (this.doc.documentElement != null) {
      this.doc.documentElement.dataset.turboRenderReadAloudMode = '';
      delete this.doc.documentElement.dataset.turboRenderReadAloudUrl;
      delete this.doc.documentElement.dataset.turboRenderReadAloudStreaming;
    }
  }

  private async startReadAloudPlayback(
    groupId: string | null,
    entry: ManagedHistoryEntry,
    entryKey: string,
    options: {
      conversationId?: string | null;
      resolvedConversationMessageId?: string | null;
    } = {},
  ): Promise<void> {
    this.clearReadAloudPlayback({ updateStatusBar: false });
    const generation = this.entryActionReadAloudGeneration;
    this.incrementDebugActionCounter('read-aloud');

    const conversationId =
      options.conversationId ?? (this.shouldUseBackendReadAloud() ? this.getConversationIdForReadAloud() : null);
    if (conversationId != null) {
      await this.ensureConversationSnapshotForReadAloud(conversationId);
    }

    const conversationPayload = this.getConversationPayloadForReadAloud(conversationId);
    const payloadResolvedConversationMessageId =
      conversationPayload != null
        ? resolveReadAloudMessageIdFromPayload(conversationPayload, {
            entryRole: entry.role === 'user' ? 'user' : 'assistant',
            entryText: resolveArchiveCopyText(entry),
            entryMessageId: entry.messageId ?? entry.liveTurnId ?? entry.turnId ?? null,
            syntheticMessageId: entry.messageId ?? entry.turnId ?? null,
          })
        : null;
    const bootstrapResolvedConversationMessageId = this.getResolvedConversationReadAloudMessageId();
    const optionResolvedConversationMessageId = options.resolvedConversationMessageId ?? null;
    const resolvedConversationMessageId =
      payloadResolvedConversationMessageId ??
      bootstrapResolvedConversationMessageId ??
      optionResolvedConversationMessageId;
    const resolvedConversationSource =
      payloadResolvedConversationMessageId != null
        ? 'conversation-payload'
        : bootstrapResolvedConversationMessageId != null
          ? 'bootstrap-dataset'
          : optionResolvedConversationMessageId != null
            ? 'request-option'
            : 'fallback';
    if (this.doc.body != null) {
      this.doc.body.dataset.turboRenderDebugReadAloudResolvedConversationId = conversationId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudResolvedMessageId = resolvedConversationMessageId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudResolvedSource = resolvedConversationSource;
    }
    if (this.doc.documentElement != null) {
      this.doc.documentElement.dataset.turboRenderDebugReadAloudResolvedConversationId = conversationId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudResolvedMessageId = resolvedConversationMessageId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudResolvedSource = resolvedConversationSource;
    }
    const backendUrl =
      conversationId != null && resolvedConversationMessageId != null
        ? this.buildDirectReadAloudUrl(conversationId, resolvedConversationMessageId)
        : this.buildReadAloudUrl(entry, groupId);
    if (backendUrl != null) {
      const abortController = new AbortController();
      this.entryActionReadAloudAbortController = abortController;
      const audio = this.ensureReadAloudAudio();
      audio.dataset.turboRenderReadAloudUrl = backendUrl;
      this.activateBackendReadAloud(audio, entryKey, generation);
      this.setReadAloudStreamingDebug('0');
      if (this.doc.body != null) {
        this.doc.body.dataset.turboRenderReadAloudUrl = backendUrl;
        this.doc.body.dataset.turboRenderReadAloudMode = 'backend';
        this.doc.body.dataset.turboRenderReadAloudBranch = 'backend';
      }
      if (this.doc.documentElement != null) {
        this.doc.documentElement.dataset.turboRenderReadAloudUrl = backendUrl;
        this.doc.documentElement.dataset.turboRenderReadAloudMode = 'backend';
        this.doc.documentElement.dataset.turboRenderReadAloudBranch = 'backend';
      }
      try {
        const headers = await this.readAloudBackend.buildAuthorizationHeaders();
        const init = createIncludeCredentialsRequestInit(headers, abortController.signal);
        const response = await this.win.fetch(backendUrl, init);
        if (this.doc.body != null) {
          this.doc.body.dataset.turboRenderDebugReadAloudResponseStatus = String(response.status);
        }
        if (this.doc.documentElement != null) {
          this.doc.documentElement.dataset.turboRenderDebugReadAloudResponseStatus = String(response.status);
        }
        if (this.entryActionReadAloudGeneration !== generation) {
          return;
        }
        if (!response.ok) {
          this.clearReadAloudPlayback({ updateStatusBar: true });
          return;
        }
        if (await tryStreamReadAloudResponse({
          win: this.win,
          response,
          audio,
          entryKey,
          generation,
          isCurrent: (currentEntryKey, currentGeneration) =>
            this.entryActionReadAloudGeneration === currentGeneration &&
            this.entryActionSpeakingEntryKey === currentEntryKey,
          onObjectUrlCreated: (objectUrl) => {
            this.entryActionReadAloudObjectUrl = objectUrl;
          },
          onObjectUrlUnused: (objectUrl) => {
            if (this.entryActionReadAloudObjectUrl === objectUrl) {
              this.entryActionReadAloudObjectUrl = null;
            }
          },
          setStreamingDebug: (value) => {
            this.setReadAloudStreamingDebug(value);
          },
          clearPlayback: () => {
            this.clearReadAloudPlayback({ updateStatusBar: true });
          },
        })) {
          return;
        }
        this.setReadAloudStreamingDebug('0');
        const blob = await response.blob();
        if (this.entryActionReadAloudGeneration !== generation) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        this.entryActionReadAloudObjectUrl = objectUrl;
        this.configureBackendReadAloudAudio(audio, entryKey, generation);
        audio.src = objectUrl;
        audio.load();
        try {
          await audio.play();
          if (this.entryActionReadAloudGeneration !== generation || this.entryActionSpeakingEntryKey !== entryKey) {
            return;
          }
          return;
        } catch {
          if (this.entryActionReadAloudGeneration !== generation || this.entryActionSpeakingEntryKey !== entryKey) {
            return;
          }
          this.clearReadAloudPlayback({ updateStatusBar: true });
          return;
        }
      } catch {
        if (this.entryActionReadAloudGeneration !== generation || this.entryActionSpeakingEntryKey !== entryKey) {
          return;
        }
        this.clearReadAloudPlayback({ updateStatusBar: true });
        return;
      }
    }

    const speech = this.win.speechSynthesis;
    if (speech == null) {
      if (this.shouldAllowLocalReadAloudFallback()) {
        this.entryActionSpeakingEntryKey = entryKey;
        this.entryActionReadAloudMode = 'speech';
        if (this.doc.body != null) {
          this.doc.body.dataset.turboRenderReadAloudMode = 'speech';
          this.doc.body.dataset.turboRenderReadAloudBranch = 'speech';
        }
        if (this.doc.documentElement != null) {
          this.doc.documentElement.dataset.turboRenderReadAloudMode = 'speech';
          this.doc.documentElement.dataset.turboRenderReadAloudBranch = 'speech';
        }
        this.updateStatusBar(this.collectArchiveState());
      } else {
        this.updateStatusBar(this.collectArchiveState());
      }
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(resolveArchiveCopyText(entry));
      this.entryActionSpeakingEntryKey = entryKey;
      this.entryActionReadAloudMode = 'speech';
      if (this.doc.body != null) {
        this.doc.body.dataset.turboRenderReadAloudMode = 'speech';
        this.doc.body.dataset.turboRenderReadAloudBranch = 'speech';
      }
      if (this.doc.documentElement != null) {
        this.doc.documentElement.dataset.turboRenderReadAloudMode = 'speech';
        this.doc.documentElement.dataset.turboRenderReadAloudBranch = 'speech';
      }
      utterance.addEventListener('end', () => {
        if (this.entryActionSpeakingEntryKey === entryKey && this.entryActionReadAloudGeneration === generation) {
          this.clearReadAloudPlayback({ updateStatusBar: true });
        }
      });
      utterance.addEventListener('error', () => {
        if (this.entryActionSpeakingEntryKey === entryKey && this.entryActionReadAloudGeneration === generation) {
          this.clearReadAloudPlayback({ updateStatusBar: true });
        }
      });
      speech.cancel();
      speech.speak(utterance);
      this.updateStatusBar(this.collectArchiveState());
    } catch {
      if (this.entryActionReadAloudGeneration !== generation || this.entryActionSpeakingEntryKey !== entryKey) {
        return;
      }
      this.clearReadAloudPlayback({ updateStatusBar: true });
    }
  }

  private async handleArchiveEntryAction(request: EntryActionRequest): Promise<void> {
    if (this.paused || (this.runtimeStatus.routeKind === 'share' && !this.isShareActionsDebugEnabled())) {
      return;
    }

    const archiveState = this.collectArchiveState();
    const group = archiveState.currentPageGroups.find((candidate) => candidate.id === request.groupId) ?? null;
    const entry = group?.entries.find((candidate) => candidate.id === request.entryId) ?? null;
    if (group == null || entry == null) {
      return;
    }
    const entryKey = getArchiveEntrySelectionKey(entry);
    const actionAnchorGetter = () => {
      if (request.action === 'more') {
        return (
          this.statusBar?.getEntryActionButton(request.groupId, request.entryId, 'more') ??
          this.statusBar?.getEntryActionAnchor(request.groupId, request.entryId) ??
          this.statusBar?.getBatchCardHeaderAnchor(request.groupId) ??
          this.statusBar?.getBatchCardAnchor(request.groupId) ??
          null
        );
      }

      return (
        this.statusBar?.getEntryActionAnchor(request.groupId, request.entryId) ??
        this.statusBar?.getBatchCardHeaderAnchor(request.groupId) ??
        this.statusBar?.getBatchCardAnchor(request.groupId) ??
        null
      );
    };
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);

    if (request.action === 'more') {
      const lane = entry.role === 'user' ? 'user' : 'assistant';
      if (
        this.entryActionMenu?.groupId === group.id &&
        this.entryActionMenu.entryId === entryKey &&
        this.entryActionMenu.lane === lane
      ) {
        this.toggleEntryActionMenu(group.id, entryKey, lane);
        return;
      }

      if (this.shouldPreferHostMorePopover()) {
        const hostToggled = await this.toggleHostMoreMenu(group.id, entry, actionAnchorGetter);
        if (hostToggled) {
          return;
        }
      }
      this.toggleEntryActionMenu(group.id, entryKey, lane);
      return;
    }

    this.closeEntryActionMenu();

    if (request.action === 'copy') {
      const hostBinding = this.resolveHostArchiveActionBinding(
        request.groupId,
        entry,
        request.action,
        actionAnchorGetter,
      );
      if (hostBinding != null && this.dispatchHostArchiveAction(hostBinding, request.groupId, entry)) {
        this.markArchiveEntryCopied(entryKey);
        return;
      }

      const renderedBody = this.statusBar?.getEntryBody(request.groupId, request.entryId) ?? null;
      const copied = await copyTextToClipboard(
        this.doc,
        createArchiveClipboardPayload(this.doc, entry, renderedBody),
      );
      if (copied) {
        this.markArchiveEntryCopied(entryKey);
      }
      return;
    }

    if (request.action === 'like' || request.action === 'dislike') {
      const previousScrollTop = scrollTarget?.scrollTop ?? null;
      const hostBinding = this.resolveHostArchiveActionBinding(
        request.groupId,
        entry,
        request.action,
        actionAnchorGetter,
      );
      if (hostBinding != null && this.dispatchHostArchiveAction(hostBinding, request.groupId, entry)) {
        await new Promise<void>((resolve) => {
          requestAnimationFrameCompat(this.win, () => resolve());
        });
        const hostSelection = this.readHostEntryActionSelection(request.groupId, entry);
        if (hostSelection.matched) {
          if (hostSelection.selection == null) {
            this.entryActionSelectionByEntryId.delete(entryKey);
          } else {
            this.entryActionSelectionByEntryId.set(entryKey, hostSelection.selection);
          }
          this.updateStatusBar(this.collectArchiveState());
          this.restoreExactScrollTop(scrollTarget, previousScrollTop);
        }
      } else {
        const feedbackSent = await this.sendBackendMessageFeedback(request.groupId, entry, request.action);
        if (feedbackSent) {
          this.restoreExactScrollTop(scrollTarget, previousScrollTop);
        }
      }
      return;
    }

    const shareCountBefore =
      request.action === 'share' ? Number(this.doc.body?.dataset.hostActionShareCount ?? '0') : null;
    const hostBinding = this.resolveHostArchiveActionBinding(
      request.groupId,
      entry,
      request.action,
      actionAnchorGetter,
    );
    const acted = hostBinding != null && this.dispatchHostArchiveAction(hostBinding, request.groupId, entry);
    if (request.action === 'share') {
      const shareCountAfter = Number(this.doc.body?.dataset.hostActionShareCount ?? '0');
      if (!acted || shareCountAfter === shareCountBefore) {
        this.incrementDebugActionCounter('share');
      }
    } else if (!acted) {
      // No-op for other actions that did not resolve to a host click.
    }
  }

  private async handleMoreMenuAction(request: {
    groupId: string;
    entryId: string;
    action: EntryMoreMenuAction;
  }): Promise<void> {
    if (this.paused || (this.runtimeStatus.routeKind === 'share' && !this.isShareActionsDebugEnabled())) {
      return;
    }

    const archiveState = this.collectArchiveState();
    const group = archiveState.currentPageGroups.find((candidate) => candidate.id === request.groupId) ?? null;
    const entry = group?.entries.find((candidate) => candidate.id === request.entryId) ?? null;
    if (group == null || entry == null) {
      return;
    }
    const actionAnchorGetter = () =>
      this.statusBar?.getEntryActionButton(request.groupId, request.entryId, 'more') ??
      this.statusBar?.getEntryActionAnchor(request.groupId, request.entryId) ??
      this.statusBar?.getBatchCardHeaderAnchor(request.groupId) ??
      this.statusBar?.getBatchCardAnchor(request.groupId) ??
      null;
    const resolvedReadAloudMessageId =
      resolveRealMessageId(
        this.findRenderedArchiveMessageIdForEntry(request.groupId, entry),
        this.findHostMessageIdForEntry(entry, request.groupId),
        entry.messageId,
        entry.liveTurnId,
        entry.turnId,
      ) ?? '';
    const conversationId = this.getConversationIdForReadAloud();
    this.setReadAloudRequestContext({
      conversationId,
      entryRole: entry != null && entry.role === 'user' ? 'user' : 'assistant',
      entryText: entry != null ? resolveArchiveCopyText(entry) : '',
      entryKey: entry != null ? getArchiveEntrySelectionKey(entry) : '',
      entryMessageId: resolvedReadAloudMessageId,
      groupId: request.groupId ?? '',
      entryId: request.entryId ?? '',
      action: request.action,
    });
    if (this.doc.body != null) {
      this.doc.body.dataset.turboRenderDebugReadAloudRequestGroupId = request.groupId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudRequestEntryId = request.entryId ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudRequestAction = request.action ?? '';
      this.doc.body.dataset.turboRenderDebugReadAloudRequestEntryKey = entry != null ? getArchiveEntrySelectionKey(entry) : '';
      this.doc.body.dataset.turboRenderDebugReadAloudRequestLane = entry != null ? (entry.role === 'user' ? 'user' : 'assistant') : '';
    }
    if (this.doc.documentElement != null) {
      this.doc.documentElement.dataset.turboRenderDebugReadAloudRequestGroupId = request.groupId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudRequestEntryId = request.entryId ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudRequestAction = request.action ?? '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudRequestEntryKey = entry != null ? getArchiveEntrySelectionKey(entry) : '';
      this.doc.documentElement.dataset.turboRenderDebugReadAloudRequestLane =
        entry != null ? (entry.role === 'user' ? 'user' : 'assistant') : '';
    }
    if (entry == null) {
      return;
    }

    if (request.action === 'branch') {
      this.closeEntryActionMenu();
      const hostBranched = await this.clickHostMoreMenuAction(group.id, entry, request.action, actionAnchorGetter);
      if (hostBranched) {
        this.incrementDebugActionCounter(request.action);
        return;
      }
      this.incrementDebugActionCounter(request.action);
      return;
    }

    const entryKey = getArchiveEntrySelectionKey(entry);
    const isLocalReadAloudActive =
      this.entryActionSpeakingEntryKey === entryKey || this.entryActionReadAloudMode != null;
    if (this.shouldPreferHostMorePopover() && !isLocalReadAloudActive && request.action !== 'read-aloud') {
      if (request.action === 'stop-read-aloud') {
        const hostStopped = await this.clickHostMoreMenuAction(group.id, entry, 'stop-read-aloud', actionAnchorGetter);
        if (hostStopped) {
          this.incrementDebugActionCounter('stop-read-aloud');
          this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
          return;
        }
      }
    }

    if (request.action === 'stop-read-aloud' || isLocalReadAloudActive) {
      const preservedEntryActionMenu = this.entryActionMenu;
      if (isLocalReadAloudActive) {
        if (this.entryActionMenu == null && preservedEntryActionMenu != null) {
          this.entryActionMenu = preservedEntryActionMenu;
        }
        this.incrementDebugActionCounter('stop-read-aloud');
        this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
        if (this.entryActionMenu == null && preservedEntryActionMenu != null) {
          this.entryActionMenu = preservedEntryActionMenu;
          this.updateStatusBar(this.collectArchiveState());
        }
        return;
      }

      const hostStopped = await this.clickHostMoreMenuAction(group.id, entry, request.action, actionAnchorGetter);
      if (hostStopped) {
        if (this.entryActionMenu == null && preservedEntryActionMenu != null) {
          this.entryActionMenu = preservedEntryActionMenu;
        }
        this.incrementDebugActionCounter('stop-read-aloud');
        this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
        if (this.entryActionMenu == null && preservedEntryActionMenu != null) {
          this.entryActionMenu = preservedEntryActionMenu;
          this.updateStatusBar(this.collectArchiveState());
        }
        return;
      }
      this.incrementDebugActionCounter('stop-read-aloud');
      this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
      return;
    }

    if (request.action === 'read-aloud') {
      const preservedEntryActionMenu = this.entryActionMenu;
      this.readAloudMenuSelection = preservedEntryActionMenu;
      if (this.doc.body != null) {
        this.doc.body.dataset.turboRenderDebugReadAloudRoute = 'backend';
        this.doc.body.dataset.turboRenderDebugReadAloudMenuAction = request.action;
      }
      if (this.doc.documentElement != null) {
        this.doc.documentElement.dataset.turboRenderDebugReadAloudRoute = 'backend';
        this.doc.documentElement.dataset.turboRenderDebugReadAloudMenuAction = request.action;
      }
      if (this.entryActionMenu == null && preservedEntryActionMenu != null) {
        this.entryActionMenu = preservedEntryActionMenu;
      }
      await this.runWithSuppressedEntryActionMenuDismissal(async () => {
        await this.startReadAloudPlayback(request.groupId, entry, entryKey, {
          conversationId,
          resolvedConversationMessageId: resolvedReadAloudMessageId || null,
        });
      });
      if (this.entryActionMenu == null && preservedEntryActionMenu != null) {
        this.entryActionMenu = preservedEntryActionMenu;
      }
      if (preservedEntryActionMenu != null) {
        this.updateStatusBar(this.collectArchiveState());
      }
      return;
    }

    const hostReadAloud = await this.clickHostMoreMenuAction(group.id, entry, request.action, actionAnchorGetter);
    if (hostReadAloud) {
      this.incrementDebugActionCounter('read-aloud');
      this.entryActionSpeakingEntryKey = entryKey;
      this.entryActionReadAloudMode = 'backend';
      if (this.doc.body != null) {
        this.doc.body.dataset.turboRenderReadAloudMode = 'backend';
        this.doc.body.dataset.turboRenderReadAloudBranch = 'backend';
      }
      if (this.doc.documentElement != null) {
        this.doc.documentElement.dataset.turboRenderReadAloudMode = 'backend';
        this.doc.documentElement.dataset.turboRenderReadAloudBranch = 'backend';
      }
      this.updateStatusBar(this.collectArchiveState());
      return;
    }
  }

  private async clickHostMoreMenuAction(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: EntryMoreMenuAction,
    anchorGetter: () => HTMLElement | null,
  ): Promise<boolean> {
    if (!this.shouldUseHostActionClicks()) {
      return false;
    }

    return this.runWithSuppressedEntryActionMenuDismissal(async () => {
      const hostMenuResult = await this.openHostMoreMenu(groupId, entry, anchorGetter);
      if (hostMenuResult == null) {
        return false;
      }
      const { previousMenus } = hostMenuResult;

      const hostMenuAction = await this.waitForHostMoreMenuAction(
        previousMenus,
        anchorGetter,
        action,
        HOST_MENU_ACTION_WAIT_TIMEOUT_MS,
      );
      if (this.doc.body != null) {
        this.doc.body.dataset.turboRenderDebugReadAloudRoute = 'host-menu';
        this.doc.body.dataset.turboRenderDebugReadAloudMenuAction = action;
        this.doc.body.dataset.turboRenderDebugReadAloudHostMenuFound = hostMenuAction != null ? '1' : '0';
      }
      if (this.doc.documentElement != null) {
        this.doc.documentElement.dataset.turboRenderDebugReadAloudRoute = 'host-menu';
        this.doc.documentElement.dataset.turboRenderDebugReadAloudMenuAction = action;
        this.doc.documentElement.dataset.turboRenderDebugReadAloudHostMenuFound = hostMenuAction != null ? '1' : '0';
      }
      if (hostMenuAction == null) {
        return false;
      }

      const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
      const previousScrollTop = scrollTarget?.scrollTop ?? null;
      this.ignoreMutationsUntil = this.win.performance.now() + 500;
      this.dispatchHumanClick(hostMenuAction);
      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      return true;
    });
  }

  private async toggleHostMoreMenu(
    groupId: string,
    entry: ManagedHistoryEntry,
    anchorGetter: () => HTMLElement | null,
  ): Promise<boolean> {
    if (!this.shouldUseHostActionClicks()) {
      return false;
    }

    return this.runWithSuppressedEntryActionMenuDismissal(async () => {
      this.restoreAnchoredHostMenuStyle();
      this.clearPendingHostMoreActionRestore();
      const previousMenus = new Set(this.getVisibleHostMenus());
      const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
      const previousScrollTop = scrollTarget?.scrollTop ?? null;
      this.suppressEntryActionMenuToggle = true;
      let toggled = false;
      try {
        toggled = await this.clickHostArchiveAction(groupId, entry, 'more', anchorGetter);
      } finally {
        this.suppressEntryActionMenuToggle = false;
      }

      if (!toggled) {
        return false;
      }

      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      const hostMenu = await this.waitForPreferredHostMenu(previousMenus, anchorGetter, HOST_MENU_WAIT_TIMEOUT_MS);
      const anchor = anchorGetter();
      if (hostMenu != null && anchor != null && anchor.isConnected && anchor.getClientRects().length > 0) {
        this.positionVisibleHostMenuToAnchor(hostMenu, anchor);
      }
      this.clearPendingHostMoreActionRestore();
      return true;
    });
  }

  private escapeAttributeSelectorValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private collectPreciseHostActionRoots(
    groupId: string,
    entry: ManagedHistoryEntry,
    anchor: HTMLElement | null,
  ): HTMLElement[] {
    const roots: HTMLElement[] = [];
    const addRoot = (candidate: HTMLElement | null): void => {
      if (
        candidate == null ||
        isTurboRenderUiNode(candidate) ||
        candidate === this.doc.body ||
        candidate === this.doc.documentElement ||
        roots.includes(candidate)
      ) {
        return;
      }
      roots.push(candidate);
    };
    const addRootWithTurnScope = (candidate: HTMLElement): void => {
      addRoot(candidate);
      addRoot(
        candidate.closest<HTMLElement>(
          '[data-testid^="conversation-turn-"], [data-message-author-role], article, section',
        ),
      );
    };

    const anchorMessageIds =
      anchor == null
        ? []
        : [
            anchor.getAttribute('data-host-message-id')?.trim() ?? '',
            anchor.getAttribute('data-message-id')?.trim() ?? '',
          ];
    const entryKey = getArchiveEntrySelectionKey(entry);
    const record = this.getRecordForEntry(entry);
    const messageIds = [
      ...anchorMessageIds,
      this.findRenderedArchiveMessageIdForEntry(groupId, entry),
      this.findParkedMessageIdForEntry(groupId, entry),
      this.entryHostMessageIdCache.get(entryKey) ?? null,
      record?.messageId ?? null,
      resolveMessageId(record?.node ?? null),
      resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId),
    ]
      .map((candidate) => candidate?.trim() ?? '')
      .filter(
        (candidate, index, values) =>
          candidate.length > 0 &&
          !isSyntheticMessageId(candidate) &&
          values.indexOf(candidate) === index,
      );

    for (const messageId of messageIds) {
      const escaped = this.escapeAttributeSelectorValue(messageId);
      for (const exactRoot of this.doc.querySelectorAll<HTMLElement>(
        `[data-message-id="${escaped}"], [data-host-message-id="${escaped}"]`,
      )) {
        if (!isTurboRenderUiNode(exactRoot)) {
          addRootWithTurnScope(exactRoot);
        }
      }
    }

    if (record?.node != null && !isTurboRenderUiNode(record.node)) {
      addRoot(record.node);
    }

    return roots;
  }

  private resolveHostArchiveActionBinding(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
    anchorGetter: () => HTMLElement | null = () => null,
  ): HostArchiveActionBinding | null {
    if (!this.shouldUseHostActionClicks()) {
      return null;
    }

    const anchor = anchorGetter();
    for (const root of this.collectPreciseHostActionRoots(groupId, entry, anchor)) {
      const button = findHostActionButton(root, action);
      if (button == null || isTurboRenderUiNode(button)) {
        continue;
      }
      if (button instanceof HTMLButtonElement && button.disabled) {
        continue;
      }
      if (button.getAttribute('aria-disabled') === 'true') {
        continue;
      }
      if (button.isConnected && !this.isHostActionButtonRenderable(button)) {
        continue;
      }
      if (button.isConnected && !this.doesHostActionButtonMatchEntry(button, entry)) {
        continue;
      }
      return { action, anchor, button };
    }

    return null;
  }

  private isHostActionButtonRenderable(button: HTMLElement): boolean {
    if (button.getClientRects().length > 0) {
      return true;
    }

    const style = this.win.getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  private dispatchHostArchiveAction(
    binding: HostArchiveActionBinding,
    groupId: string,
    entry: ManagedHistoryEntry,
  ): boolean {
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    const { action, anchor, button } = binding;
    const shouldSuppressMutationsForAction = action === 'more' || action === 'like' || action === 'dislike';
    const shouldAnchorToArchiveProxy =
      anchor != null &&
      this.shouldPreferHostMorePopover() &&
      (action === 'more' || action === 'like' || action === 'dislike');

    const dispatch = (): void => {
      const restoreAnchoredTarget = shouldAnchorToArchiveProxy
        ? this.temporarilyAnchorHostActionTarget(button, anchor)
        : null;
      try {
        if (shouldSuppressMutationsForAction) {
          this.ignoreMutationsUntil = this.win.performance.now() + 500;
        }
        this.dispatchHumanClick(button);
      } finally {
        if (restoreAnchoredTarget != null) {
          if (action === 'more') {
            this.clearPendingHostMoreActionRestore();
            this.pendingHostMoreActionRestore = restoreAnchoredTarget;
          } else {
            this.scheduleHostActionTargetRestore(restoreAnchoredTarget, 1);
          }
        }
      }
    };

    if (button.isConnected) {
      dispatch();
      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      return true;
    }

    if (!this.parkingLot.has(groupId)) {
      return false;
    }

    const parkedGroup = this.parkingLot.getGroup(groupId);
    if (parkedGroup == null) {
      return false;
    }

    this.ignoreMutationsUntil = this.win.performance.now() + 128;
    if (!this.parkingLot.restoreGroup(groupId)) {
      return false;
    }

    for (const turnId of parkedGroup.turnIds) {
      const parkedRecord = this.records.get(turnId);
      if (parkedRecord != null) {
        parkedRecord.parked = false;
      }
    }

    try {
      dispatch();
      return true;
    } finally {
      this.ignoreMutationsUntil = this.win.performance.now() + 128;
      this.syncParkedGroups(this.collectArchiveState());
      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      this.scheduleRefresh();
    }
  }

  private async openHostMoreMenu(
    groupId: string,
    entry: ManagedHistoryEntry,
    anchorGetter: () => HTMLElement | null,
  ): Promise<OpenHostMenuResult | null> {
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    const previousMenus = new Set(this.getVisibleHostMenus());
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    this.suppressEntryActionMenuToggle = true;
    let openedMore = false;
    try {
      openedMore = await this.clickHostArchiveAction(groupId, entry, 'more', anchorGetter);
    } finally {
      this.suppressEntryActionMenuToggle = false;
    }
    if (!openedMore) {
      return null;
    }

    this.restoreExactScrollTop(scrollTarget, previousScrollTop);
    const hostMenu = await this.waitForPreferredHostMenu(previousMenus, anchorGetter, HOST_MENU_WAIT_TIMEOUT_MS);
    if (hostMenu == null) {
      this.clearPendingHostMoreActionRestore();
      return null;
    }

    const anchor = anchorGetter();
    if (anchor != null && anchor.isConnected && anchor.getClientRects().length > 0) {
      this.positionVisibleHostMenuToAnchor(hostMenu, anchor);
    }
    this.clearPendingHostMoreActionRestore();
    return {
      menu: hostMenu,
      previousMenus,
    };
  }

  private waitForPreferredHostMenu(
    previousMenus: Set<HTMLElement>,
    anchorGetter: () => HTMLElement | null,
    timeoutMs: number,
  ): Promise<HTMLElement | null> {
    return waitForHostElement({
      doc: this.doc,
      win: this.win,
      timeoutMs,
      probe: () => this.findPreferredHostMenu(previousMenus, anchorGetter()),
    });
  }

  private waitForHostMoreMenuAction(
    previousMenus: Set<HTMLElement>,
    anchorGetter: () => HTMLElement | null,
    action: EntryMoreMenuAction,
    timeoutMs: number,
  ): Promise<HTMLElement | null> {
    return waitForHostElement({
      doc: this.doc,
      win: this.win,
      timeoutMs,
      probe: () => {
        const menu = this.findPreferredHostMenu(previousMenus, anchorGetter());
        return menu != null ? this.findHostMoreMenuAction(menu, action) : null;
      },
    });
  }

  private async clickHostReadAloudStopButton(): Promise<boolean> {
    if (!this.shouldUseHostActionClicks()) {
      return false;
    }

    return this.runWithSuppressedEntryActionMenuDismissal(async () => {
      const stopButton = await waitForHostElement({
        doc: this.doc,
        win: this.win,
        timeoutMs: 4_000,
        probe: () => findHostReadAloudStopButton(this.doc),
      });
      if (stopButton == null) {
        return false;
      }

      const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
      const previousScrollTop = scrollTarget?.scrollTop ?? null;
      this.ignoreMutationsUntil = this.win.performance.now() + 500;
      this.dispatchHumanClick(stopButton);
      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      return true;
    });
  }

  private async clickHostArchiveAction(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
    anchorGetter: () => HTMLElement | null,
    options: {
      allowBroadMoreFallback?: boolean;
    } = {},
  ): Promise<boolean> {
    if (!this.shouldUseHostActionClicks()) {
      return false;
    }

    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    const anchor = anchorGetter();
    const anchorMessageIds =
      anchor == null
        ? []
        : [
            anchor.getAttribute('data-host-message-id')?.trim() ?? '',
            anchor.getAttribute('data-message-id')?.trim() ?? '',
          ].filter(
            (candidate, index, values) =>
              candidate.length > 0 &&
              !isSyntheticMessageId(candidate) &&
              values.indexOf(candidate) === index,
          );
    const searchRoots = this.collectHostSearchRootsForEntry(groupId, entry);
    const preferredMessageIds = [
      ...anchorMessageIds,
      this.findRenderedArchiveMessageIdForEntry(groupId, entry),
      resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId),
      this.findHostMessageIdForEntry(entry, groupId),
    ]
      .map((candidate) => candidate?.trim() ?? '')
      .filter((candidate, index, values) => candidate.length > 0 && values.indexOf(candidate) === index);

    const findGlobalHostActionButton = (): HTMLElement | null => {
      const candidates = [...this.doc.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"], a')].filter(
        (candidate) =>
          !isTurboRenderUiNode(candidate) &&
          candidate.getClientRects().length > 0 &&
          matchesHostActionCandidate(candidate, action),
      );

      if (candidates.length === 0) {
        return null;
      }

      const matchedCandidates = candidates.filter((candidate) => this.doesHostActionButtonMatchEntry(candidate, entry));
      const scoredCandidates = matchedCandidates.length > 0 ? matchedCandidates : candidates;

      if (anchor == null) {
        return scoredCandidates[0] ?? null;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const anchorCenterX = anchorRect.left + anchorRect.width / 2;
      const anchorCenterY = anchorRect.top + anchorRect.height / 2;
      const scored = scoredCandidates
        .map((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.hypot(centerX - anchorCenterX, centerY - anchorCenterY);
          return { candidate, distance };
        })
        .sort((left, right) => left.distance - right.distance);

      return scored[0]?.candidate ?? null;
    };

    const findScopedHostActionButton = (): HTMLElement | null => {
      if (searchRoots.length === 0) {
        return null;
      }

      for (const root of searchRoots) {
        const candidate = findHostActionButton(root, action);
        if (
          candidate != null &&
          candidate.getClientRects().length > 0 &&
          !isTurboRenderUiNode(candidate)
        ) {
          return candidate;
        }
      }

      return null;
    };

    const findExactMessageHostActionButton = (): HTMLElement | null => {
      for (const messageId of preferredMessageIds) {
        const exactRoots = [
          ...this.doc.querySelectorAll<HTMLElement>(
            `[data-message-id="${messageId}"], [data-host-message-id="${messageId}"]`,
          ),
        ].filter((candidate) => !isTurboRenderUiNode(candidate));

        for (const root of exactRoots) {
          const candidate = findHostActionButton(root, action);
          if (
            candidate != null &&
            candidate.getClientRects().length > 0 &&
            !isTurboRenderUiNode(candidate)
          ) {
            return candidate;
          }
        }
      }

      return null;
    };

    const dispatchAnchoredHostAction = (candidate: HTMLElement): void => {
      const shouldAnchorToArchiveProxy =
        anchor != null &&
        this.shouldPreferHostMorePopover() &&
        (action === 'more' || action === 'like' || action === 'dislike');
      const restoreAnchoredTarget = shouldAnchorToArchiveProxy
        ? this.temporarilyAnchorHostActionTarget(candidate, anchor)
        : null;
      try {
        this.dispatchHumanClick(candidate);
      } finally {
        if (restoreAnchoredTarget != null) {
          if (action === 'more') {
            this.clearPendingHostMoreActionRestore();
            this.pendingHostMoreActionRestore = restoreAnchoredTarget;
          } else {
            this.scheduleHostActionTargetRestore(restoreAnchoredTarget, 1);
          }
        }
      }
    };

    const preferPreciseHostBinding =
      this.shouldPreferHostMorePopover() &&
      (action === 'more' || action === 'like' || action === 'dislike');
    const shouldRestoreScrollAfterAction = true;
    const shouldSuppressMutationsForAction = action === 'more' || action === 'like' || action === 'dislike';
    const exactMessageButton = findExactMessageHostActionButton();
    if (exactMessageButton != null && exactMessageButton.isConnected) {
      if (shouldSuppressMutationsForAction) {
        this.ignoreMutationsUntil = this.win.performance.now() + 500;
      }
      dispatchAnchoredHostAction(exactMessageButton);
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
      return true;
    }

    const scopedButton =
      preferPreciseHostBinding
        ? null
        : searchRoots.length > 0
          ? findScopedHostActionButton()
          : null;
    if (scopedButton != null && scopedButton.isConnected) {
      if (shouldSuppressMutationsForAction) {
        this.ignoreMutationsUntil = this.win.performance.now() + 500;
      }
      dispatchAnchoredHostAction(scopedButton);
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
      return true;
    }

    const shouldSkipGlobalFallback = this.shouldPreferHostMorePopover() || preferPreciseHostBinding;
    if (!shouldSkipGlobalFallback) {
      const globalButton = findGlobalHostActionButton();
      if (globalButton != null) {
        if (globalButton.isConnected) {
          if (shouldSuppressMutationsForAction) {
            this.ignoreMutationsUntil = this.win.performance.now() + 500;
          }
          dispatchAnchoredHostAction(globalButton);
          if (shouldRestoreScrollAfterAction) {
            this.restoreExactScrollTop(scrollTarget, previousScrollTop);
          }
          return true;
        }
      }
    }

    if (action === 'more' && options.allowBroadMoreFallback) {
      const broadButton = findGlobalHostActionButton();
      if (broadButton != null && broadButton.isConnected) {
        if (shouldSuppressMutationsForAction) {
          this.ignoreMutationsUntil = this.win.performance.now() + 500;
        }
        dispatchAnchoredHostAction(broadButton);
        if (shouldRestoreScrollAfterAction) {
          this.restoreExactScrollTop(scrollTarget, previousScrollTop);
        }
        return true;
      }
    }

    const record = this.getRecordForEntry(entry);
    const node = record?.node ?? null;
    if (node == null) {
      return false;
    }

    const nodeSearchRoots: HTMLElement[] = [];
    let current: HTMLElement | null = node;
    while (current != null) {
      if (!isTurboRenderUiNode(current)) {
        nodeSearchRoots.push(current);
      }
      current = current.parentElement;
    }

    let matchingConnectedButton: HTMLElement | null = null;
    let disconnectedButton: HTMLElement | null = null;
    const fallbackScanLimit = preferPreciseHostBinding ? 10 : Number.POSITIVE_INFINITY;
    let scannedFallbackRoots = 0;
    for (const root of nodeSearchRoots) {
      if (
        preferPreciseHostBinding &&
        (root === this.doc.body || root === this.doc.documentElement)
      ) {
        continue;
      }
      if (scannedFallbackRoots >= fallbackScanLimit) {
        break;
      }
      scannedFallbackRoots += 1;

      const candidate = findHostActionButton(root, action);
      if (candidate == null || isTurboRenderUiNode(candidate)) {
        continue;
      }
      if (candidate.isConnected && this.doesHostActionButtonMatchEntry(candidate, entry)) {
        matchingConnectedButton = candidate;
        break;
      }
      if (!candidate.isConnected && disconnectedButton == null) {
        disconnectedButton = candidate;
      }
    }
    const button = matchingConnectedButton ?? disconnectedButton;
    if (button == null) {
      return false;
    }

    if (button.isConnected) {
      if (shouldSuppressMutationsForAction) {
        this.ignoreMutationsUntil = this.win.performance.now() + 500;
      }
      dispatchAnchoredHostAction(button);
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
      return true;
    }

    if (!this.parkingLot.has(groupId)) {
      return false;
    }

    const parkedGroup = this.parkingLot.getGroup(groupId);
    if (parkedGroup == null) {
      return false;
    }

    this.ignoreMutationsUntil = this.win.performance.now() + 128;
    if (!this.parkingLot.restoreGroup(groupId)) {
      return false;
    }

    for (const turnId of parkedGroup.turnIds) {
      const parkedRecord = this.records.get(turnId);
      if (parkedRecord != null) {
        parkedRecord.parked = false;
      }
    }

    try {
      dispatchAnchoredHostAction(button);
      return true;
    } finally {
      this.ignoreMutationsUntil = this.win.performance.now() + 128;
      this.syncParkedGroups(this.collectArchiveState());
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
      this.scheduleRefresh();
    }
  }

  private collectHostSearchRootsForEntry(groupId: string, entry: ManagedHistoryEntry): HTMLElement[] {
    const messageIds = [
      this.findRenderedArchiveMessageIdForEntry(groupId, entry),
      resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId),
      this.findHostMessageIdForEntry(entry, groupId),
    ]
      .map((candidate) => candidate?.trim() ?? '')
      .filter((candidate, index, values) => candidate.length > 0 && values.indexOf(candidate) === index);

    const searchRoots: HTMLElement[] = [];
    for (const messageId of messageIds) {
      const exactRoots = [
        ...this.doc.querySelectorAll<HTMLElement>(
          `[data-message-id="${messageId}"], [data-host-message-id="${messageId}"]`,
        ),
      ].filter((candidate) => !isTurboRenderUiNode(candidate));
      for (const messageRoot of exactRoots) {
        let current: HTMLElement | null = messageRoot;
        while (current != null) {
          if (!isTurboRenderUiNode(current) && !searchRoots.includes(current)) {
            searchRoots.push(current);
          }
          current = current.parentElement;
        }
      }
    }

    if (searchRoots.length > 0) {
      return searchRoots;
    }

    const record = this.getRecordForEntry(entry);
    const node = record?.node ?? null;
    let current: HTMLElement | null = node;
    while (current != null) {
      if (!isTurboRenderUiNode(current) && !searchRoots.includes(current)) {
        searchRoots.push(current);
      }
      current = current.parentElement;
    }

    return searchRoots;
  }

  private getVisibleHostMenus(): HTMLElement[] {
    return this.hostMenuPositioning.getVisibleHostMenus();
  }

  private findPreferredHostMenu(previousMenus: Set<HTMLElement>, anchor: HTMLElement | null): HTMLElement | null {
    return this.hostMenuPositioning.findPreferredHostMenu(previousMenus, anchor);
  }

  private temporarilyAnchorHostActionTarget(target: HTMLElement, anchor: HTMLElement): (() => void) | null {
    return this.hostMenuPositioning.temporarilyAnchorHostActionTarget(target, anchor);
  }

  private scheduleHostActionTargetRestore(restore: () => void, frames: number): void {
    this.hostMenuPositioning.scheduleHostActionTargetRestore(restore, frames);
  }

  private clearPendingHostMoreActionRestore(): void {
    const restore = this.pendingHostMoreActionRestore;
    this.pendingHostMoreActionRestore = null;
    restore?.();
  }

  private positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void {
    this.hostMenuPositioning.positionVisibleHostMenuToAnchor(menu, anchor);
  }

  private restoreAnchoredHostMenuStyle(): void {
    this.hostMenuPositioning.restoreAnchoredHostMenuStyle();
  }

  private findHostMoreMenuAction(menu: ParentNode, action: EntryMoreMenuAction): HTMLElement | null {
    return findHostMoreMenuActionInMenu(menu, action);
  }

  private readHostEntryActionSelection(
    groupId: string,
    entry: ManagedHistoryEntry,
  ): { matched: boolean; selection: EntryActionSelection | null } {
    return readHostEntryActionSelectionFromRoots(this.collectHostSearchRootsForEntry(groupId, entry));
  }

  private dispatchHumanClick(target: HTMLElement): void {
    dispatchHostHumanClick(target);
  }

  private refreshRuntimeStatusFromCurrentMetrics(archiveState = this.collectArchiveState()): void {
    this.runtimeStatus = this.buildStatus({
      supported: this.runtimeStatus.supported,
      reason: this.runtimeStatus.reason,
      totalTurns: this.managedHistory.getTotalTurns(),
      totalPairs: this.managedHistory.getTotalPairs(),
      finalizedTurns: this.runtimeStatus.finalizedTurns,
      liveDescendantCount: this.runtimeStatus.liveDescendantCount,
      visibleRange: this.runtimeStatus.visibleRange,
    }, archiveState);
  }

  private scheduleArchiveUiSync(): void {
    if (this.archiveUiSyncHandle != null) {
      return;
    }

    this.archiveUiSyncHandle = requestAnimationFrameCompat(this.win, () => {
      this.archiveUiSyncHandle = null;
      this.flushArchiveUiSync();
    });
  }

  private flushArchiveUiSync(): void {
    const archiveState = this.collectArchiveState();
    this.syncArchivePageCache(archiveState);
    this.refreshRuntimeStatusFromCurrentMetrics(archiveState);
    this.updateStatusBar(archiveState);

    const pending = this.pendingArchiveToggle;
    this.pendingArchiveToggle = null;
    if (pending != null && pending.scrollTarget != null) {
      const anchorGetter = () =>
        this.statusBar?.getBatchCardHeaderAnchor(pending.groupId) ??
        this.statusBar?.getBatchCardActionButton(pending.groupId) ??
        this.statusBar?.getBatchCardAnchor(pending.groupId) ??
        pending.anchor ??
        null;
      this.restoreScrollAnchor(
        pending.scrollTarget,
        anchorGetter,
        pending.previousScrollTop,
        pending.previousAnchorTop,
        { doublePass: true, targetAnchorTop: pending.targetAnchorTop },
      );

      if (pending.wasExpanded) {
        requestAnimationFrameCompat(this.win, () => {
          const button = this.statusBar?.getBatchCardActionButton(pending.groupId) ?? null;
          button?.focus({ preventScroll: true });
        });
      }
    }

    this.flushPendingArchiveSearchJump(archiveState);
  }

  private flushPendingArchiveSearchJump(archiveState: ArchiveUiState): void {
    const pending = this.pendingArchiveSearchJump;
    if (pending == null) {
      return;
    }

    if (archiveState.currentArchivePageIndex !== pending.pageIndex) {
      if (pending.attemptCount >= 6) {
        this.pendingArchiveSearchJump = null;
        return;
      }

      this.pendingArchiveSearchJump = {
        ...pending,
        attemptCount: pending.attemptCount + 1,
      };
      this.scheduleArchiveUiSync();
      return;
    }

    const matchingGroup = this.findArchiveGroupContainingPair(archiveState.currentPageGroups, pending.pairIndex);
    if (matchingGroup == null) {
      this.pendingArchiveSearchJump = null;
      return;
    }

    if (!this.expandedArchiveBatchIds.has(matchingGroup.id)) {
      this.expandedArchiveBatchIds.add(matchingGroup.id);
      this.pendingArchiveSearchJump = {
        ...pending,
        attemptCount: pending.attemptCount + 1,
      };
      this.scheduleArchiveUiSync();
      return;
    }

    const pairAnchor = this.statusBar?.getBatchCardPairAnchor(matchingGroup.id, pending.pairIndex) ?? null;
    if (pairAnchor == null) {
      if (pending.attemptCount >= 6) {
        this.pendingArchiveSearchJump = null;
        return;
      }

      this.pendingArchiveSearchJump = {
        ...pending,
        attemptCount: pending.attemptCount + 1,
      };
      this.scheduleArchiveUiSync();
      return;
    }

    if (typeof pairAnchor.scrollIntoView === 'function') {
      pairAnchor.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      });
    }
    this.pendingArchiveSearchJump = null;
  }

  private getBatchHeaderScrollTop(): number {
    const topChromeOffset = Math.max(0, this.statusBar?.getTopPageChromeOffset() ?? 0);
    const target = topChromeOffset + 12;
    const viewportHeight = Math.max(0, this.win.innerHeight ?? 0);
    if (viewportHeight <= 0) {
      return target;
    }
    return Math.min(target, Math.max(12, viewportHeight - 24));
  }

  private flushScrollSync(): void {
    if (this.turnContainer == null || this.scrollTarget == null) {
      return;
    }

    const visibleRange = this.computeVisibleRange(this.scrollTarget);
    const currentRange = this.runtimeStatus.visibleRange;
    if (currentRange?.start === visibleRange?.start && currentRange?.end === visibleRange?.end) {
      return;
    }

    if (this.hasLargeConversation()) {
      this.runtimeStatus = {
        ...this.runtimeStatus,
        visibleRange,
      };
      return;
    }

    const archiveState = this.collectArchiveState();
    this.runtimeStatus = this.buildStatus(
      {
        supported: this.runtimeStatus.supported,
        reason: this.runtimeStatus.reason,
        totalTurns: this.runtimeStatus.totalTurns,
        totalPairs: this.runtimeStatus.totalPairs,
        finalizedTurns: this.runtimeStatus.finalizedTurns,
        liveDescendantCount: this.runtimeStatus.liveDescendantCount,
        visibleRange,
      },
      archiveState,
    );
    this.updateStatusBar(archiveState);
  }

  private scheduleScrollRefresh(): void {
    if (this.scrollRefreshHandle != null) {
      this.win.clearTimeout(this.scrollRefreshHandle);
    }

    this.scrollRefreshHandle = this.win.setTimeout(() => {
      this.scrollRefreshHandle = null;
      this.flushScrollSync();
    }, 120);
  }

  private scheduleRefresh(): void {
    if (this.mutationRefreshHandle != null) {
      this.win.clearTimeout(this.mutationRefreshHandle);
      this.mutationRefreshHandle = null;
    }

    if (this.refreshHandle != null || this.scrollRefreshHandle != null) {
      return;
    }

    this.refreshHandle = requestAnimationFrameCompat(this.win, () => {
      this.refreshHandle = null;
      this.refreshNow();
    });
  }

  private resolveLiveDescendantCount(root: ParentNode | null, observedCount: number): number {
    const now = this.win.performance.now();
    if (!this.hasLargeConversation()) {
      this.cachedLiveDescendantCount = observedCount;
      this.lastLiveDescendantSampleAt = now;
      this.liveDescendantSampleDirty = false;
      return observedCount;
    }

    const shouldSample =
      this.liveDescendantSampleDirty ||
      this.cachedLiveDescendantCount <= 0 ||
      now - this.lastLiveDescendantSampleAt >= DESCENDANT_COUNT_SAMPLE_INTERVAL_MS;
    if (shouldSample) {
      this.cachedLiveDescendantCount = countLiveDescendants(root);
      this.lastLiveDescendantSampleAt = now;
      this.liveDescendantSampleDirty = false;
      return this.cachedLiveDescendantCount;
    }

    if (observedCount > this.cachedLiveDescendantCount) {
      this.cachedLiveDescendantCount = observedCount;
    }
    return this.cachedLiveDescendantCount;
  }

  private refreshNow(): void {
    this.refreshCount += 1;
    this.refreshLanguage();
    for (const group of this.parkingLot.getDisconnectedHardGroups()) {
      this.lastError = `host-rerender-lost-${group.id}`;
      this.softFallbackSession = true;
    }
    if (this.softFallbackSession) {
      this.restoreAllParking(0);
    }

    const snapshot = scanChatPage(this.doc);
    const totalTurnsBeforeScan = this.managedHistory.getTotalTurns();
    const totalPairsBeforeScan = this.managedHistory.getTotalPairs();
    const sampledLiveDescendantCount = this.resolveLiveDescendantCount(
      snapshot.turnContainer ?? snapshot.historyMountTarget ?? snapshot.main,
      snapshot.descendantCount,
    );

    if (!snapshot.supported || snapshot.turnContainer == null) {
      this.turnContainer = null;
      this.historyMountTarget = snapshot.historyMountTarget;
      this.active =
        !this.paused &&
        this.settings.enabled &&
        (this.initialTrimSession?.applied === true || totalTurnsBeforeScan > 0);
      this.setObservedMutationRoot(
        snapshot.historyMountTarget?.parentElement ?? snapshot.historyMountTarget ?? this.doc.body,
        'archive-only-root',
      );
      this.setScrollTarget(snapshot.scrollContainer);
      this.updateBatchSearchState();
      const archiveState = this.collectArchiveState(totalPairsBeforeScan);
      this.runtimeStatus = this.buildStatus({
        supported: false,
        reason: snapshot.reason ?? 'unsupported',
        totalTurns: totalTurnsBeforeScan,
        totalPairs: totalPairsBeforeScan,
        finalizedTurns: totalTurnsBeforeScan,
        liveDescendantCount: sampledLiveDescendantCount,
        visibleRange: null,
      }, archiveState);
      this.updateStatusBar(archiveState);
      this.primeConversationMetadataIfNeeded(archiveState);
      return;
    }

    this.turnContainer = snapshot.turnContainer;
    this.historyMountTarget = snapshot.historyMountTarget;
    this.setObservedMutationRoot(snapshot.turnContainer, 'live-turn-container');
    this.setScrollTarget(snapshot.scrollContainer);

    const orderedRecords = this.reconcileTurns(snapshot.turnNodes, snapshot.stopButtonVisible);
    this.managedHistory.syncFromRecords(orderedRecords);
    const liveSignature = orderedRecords
      .map((record) => `${record.id}:${record.isStreaming ? '1' : '0'}`)
      .join('|');
    const liveChanged = liveSignature !== this.lastLiveSignature;
    this.lastLiveSignature = liveSignature;
    if (liveChanged) {
      this.liveDescendantSampleDirty = true;
    }

    const totalTurns = this.managedHistory.getTotalTurns();
    const totalPairs = this.managedHistory.getTotalPairs();
    const visibleRange = this.computeVisibleRange(snapshot.scrollContainer);
    const spikeCount = this.frameSpikeMonitor.getSpikeCount();
    const liveFinalizedTurns = orderedRecords.filter((record) => !record.isStreaming).length;
    const hasStreamingTurns = orderedRecords.some((record) => record.isStreaming);
    const finalizedTurns = totalTurns - (hasStreamingTurns ? 1 : 0);

    if (!this.paused && this.settings.enabled && this.settings.autoEnable) {
      const activate = shouldAutoActivate({
        finalizedTurns: liveFinalizedTurns,
        descendantCount: sampledLiveDescendantCount,
        spikeCount,
        settings: this.settings,
      });
      this.active = this.active || activate;
    }

    if (!this.paused && this.settings.enabled && this.initialTrimSession?.applied === true) {
      this.active = true;
    }

    if (!this.settings.enabled || this.paused) {
      this.active = false;
      this.restoreAllParking(0);
    }

    this.updateBatchSearchState();
    const archiveState = this.collectArchiveState(totalPairs);
    this.runtimeStatus = this.buildStatus({
      supported: true,
      reason: null,
      totalTurns,
      totalPairs,
      finalizedTurns,
      liveDescendantCount: sampledLiveDescendantCount,
      visibleRange,
    }, archiveState);
    this.updateStatusBar(archiveState);
    this.primeConversationMetadataIfNeeded(archiveState);

    if (!this.active || this.paused || this.win.performance.now() < this.manualRestoreHoldUntil) {
      return;
    }

    if (this.idleHandle != null) {
      cancelIdleCallbackCompat(this.win, this.idleHandle);
    }

    const archiveGroups = archiveState.archiveGroups;

    if (
      !liveChanged &&
      this.parkingLot.getSummaries().length === archiveGroups.filter((group) => group.parkedGroupId != null).length
    ) {
      return;
    }

    this.idleHandle = requestIdleCallbackCompat(this.win, () => {
      this.idleHandle = null;
      this.syncParkedGroups(archiveState);
      this.syncArchivePageCache(archiveState);
      this.updateBatchSearchState();
      const idleArchiveState = this.collectArchiveState(this.managedHistory.getTotalPairs());
      const idleLiveDescendantCount = this.resolveLiveDescendantCount(
        this.turnContainer,
        this.cachedLiveDescendantCount,
      );
      this.runtimeStatus = this.buildStatus({
        supported: true,
        reason: null,
        totalTurns: this.managedHistory.getTotalTurns(),
        totalPairs: this.managedHistory.getTotalPairs(),
        finalizedTurns,
        liveDescendantCount: idleLiveDescendantCount,
        visibleRange,
      }, idleArchiveState);
      this.updateStatusBar(idleArchiveState);
      this.primeConversationMetadataIfNeeded(idleArchiveState);
    });
  }

  private syncParkedGroups(archiveState: ArchiveUiState): void {
    const liveArchiveGroups = archiveState.archiveGroups.filter((group) => group.entries.some((entry) => entry.liveTurnId != null));
    const expectedIds = toSet(liveArchiveGroups.map((group) => group.id));
    const totalPairs = this.managedHistory.getTotalPairs();

    for (const summary of this.parkingLot.getSummaries()) {
      const parkedGroup = this.parkingLot.getGroup(summary.id);
      if (expectedIds.has(summary.id)) {
        if (parkedGroup != null) {
          const sourceGroup = liveArchiveGroups.find((group) => group.id === summary.id) ?? null;
          const expectedPageIndex = sourceGroup != null ? this.getArchivePageIndexForGroup(sourceGroup, totalPairs) : null;
          if (parkedGroup.archivePageIndex !== expectedPageIndex) {
            parkedGroup.archivePageIndex = expectedPageIndex;
          }
        }
        continue;
      }

      this.ignoreMutationsUntil = this.win.performance.now() + 64;
      this.parkingLot.restoreGroup(summary.id);
      for (const turnId of parkedGroup?.turnIds ?? []) {
        const record = this.records.get(turnId);
        if (record != null) {
          record.parked = false;
        }
      }
    }

    for (const group of liveArchiveGroups) {
      if (group.entries.length === 0) {
        continue;
      }

      const expectedPageIndex = this.getArchivePageIndexForGroup(group, totalPairs);
      const parkedArchiveGroup = this.parkingLot.getGroup(group.id);
      if (parkedArchiveGroup != null) {
        parkedArchiveGroup.archivePageIndex = expectedPageIndex;
        continue;
      }

      const liveEntries = group.entries.filter((entry) => entry.liveTurnId != null);
      const nodeRecords = group.entries
        .map((entry) => {
          if (entry.liveTurnId == null) {
            return null;
          }
          const record = this.records.get(entry.liveTurnId);
          if (record?.node == null || !record.node.isConnected) {
            return null;
          }
          return record;
        })
        .filter((record): record is TurnRecord => record != null)
        .sort((left, right) => left.index - right.index);

      if (nodeRecords.length !== liveEntries.length) {
        continue;
      }

      if (nodeRecords.some((record) => record.isStreaming || this.isProtectedTurn(record.node))) {
        continue;
      }

      const parent = nodeRecords[0]?.node?.parentElement ?? null;
      if (parent == null || nodeRecords.some((record) => record.node?.parentElement !== parent)) {
        continue;
      }

      const nodes = nodeRecords.map((record) => record.node).filter((node): node is HTMLElement => node instanceof HTMLElement);
      const turnIds = nodeRecords.map((record) => record.id);
      const startIndex = Math.min(...nodeRecords.map((record) => record.index));
      const endIndex = Math.max(...nodeRecords.map((record) => record.index));
      const mode = this.softFallbackSession || this.settings.softFallback ? 'soft' : 'hard';

      this.ignoreMutationsUntil = this.win.performance.now() + 64;
      const parkedGroup = this.parkingLot.park({
        id: group.id,
        mode,
        parent,
        startIndex,
        endIndex,
        turnIds,
        nodes,
        pairStartIndex: group.pairStartIndex,
        pairEndIndex: group.pairEndIndex,
        pairCount: group.pairCount,
        archivePageIndex: expectedPageIndex,
      });

      if (parkedGroup == null) {
        continue;
      }

      for (const record of nodeRecords) {
        record.parked = true;
      }
    }

    this.managedHistory.setLiveStartIndex(
      this.managedHistory.getFirstVisibleLiveTurnIndex(this.parkingLot.getParkedTurnIds()),
    );
  }

  private syncArchivePageCache(archiveState: ArchiveUiState): void {
    const residentPageIndexes = resolveResidentArchivePageIndexes(
      archiveState.archivePageCount,
      archiveState.currentArchivePageIndex,
    );

    for (const summary of this.parkingLot.getSummaries()) {
      const pageIndex = summary.archivePageIndex;
      if (pageIndex == null) {
        continue;
      }

      if (residentPageIndexes.has(pageIndex)) {
        this.parkingLot.rehydrateGroup(summary.id);
      } else {
        this.parkingLot.serializeGroup(summary.id);
      }
    }
  }

  private reconcileTurns(liveTurnNodes: HTMLElement[], stopButtonVisible: boolean): TurnRecord[] {
    const orderedIds: string[] = [];
    const orderedIdSet = new Set<string>();
    liveTurnNodes.forEach((node, index) => {
      if (!node.dataset[TURN_ID_DATASET]) {
        node.dataset[TURN_ID_DATASET] = `turn-${this.chatId}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      }

      if (!node.parentElement?.dataset.turboRenderParentKey) {
        node.parentElement?.setAttribute('data-turbo-render-parent-key', 'conversation-root');
      }

      const id = node.dataset[TURN_ID_DATASET]!;
      const messageId = resolveMessageId(node);
      const role = detectTurnRole(node);
      const isStreaming = isStreamingTurn(node, {
        isLastTurn: index === liveTurnNodes.length - 1,
        stopButtonVisible,
      });
      const contentRevision = computeTurnContentRevision(node, role, messageId, isStreaming);
      const record = this.records.get(id) ?? {
        id,
        index,
        role,
        isStreaming,
        parked: false,
        node,
        messageId,
        contentRevision,
      };

      record.index = index;
      record.role = role;
      record.isStreaming = isStreaming;
      record.node = node;
      record.messageId = messageId;
      record.contentRevision = contentRevision;
      record.parked = this.parkingLot.isTurnParked(id);
      this.records.set(id, record);
      orderedIds.push(id);
      orderedIdSet.add(id);

      this.captureHostActionTemplate(record);
    });

    for (const [id, record] of this.records.entries()) {
      if (!orderedIdSet.has(id) && !this.parkingLot.isTurnParked(id)) {
        this.records.delete(id);
      }
    }

    return orderedIds.map((id, index) => {
      const record = this.records.get(id)!;
      record.index = index;
      record.parked = this.parkingLot.isTurnParked(id);
      return record;
    });
  }

  private captureHostActionTemplate(record: TurnRecord): void {
    const lane = record.role === 'user' ? 'user' : record.role === 'assistant' ? 'assistant' : null;
    if (lane == null || this.entryActionTemplateByLane.has(lane) || record.node == null) {
      return;
    }

    const template = captureHostActionTemplate(record.node, lane);
    if (template == null) {
      return;
    }

    this.entryActionTemplateByLane.set(lane, template);
  }

  private computeVisibleRange(scrollContainer: HTMLElement): IndexRange | null {
    return computeVisibleRangeFromTurnContainer(
      this.turnContainer,
      scrollContainer,
      (turnId) => this.records.get(turnId)?.index ?? null,
    );
  }

  private isProtectedTurn(node: HTMLElement | null): boolean {
    return isProtectedTurnNode({
      node,
      doc: this.doc,
      win: this.win,
      lastInteractionNode: this.lastInteractionNode,
      lastInteractionAt: this.lastInteractionAt,
    });
  }

  private collectArchiveState(totalPairs = this.managedHistory.getTotalPairs()): ArchiveUiState {
    const hotPairCount = this.getHotPairCount(totalPairs);
    this.pruneExpandedArchiveBatches(totalPairs);
    const archivePageCount = this.managedHistory.getArchivedPageCount(ARCHIVE_PAGE_PAIR_COUNT, hotPairCount);
    const currentArchivePageIndex = this.resolveArchivePageIndex(totalPairs);
    const currentArchivePageMeta =
      currentArchivePageIndex != null
        ? this.managedHistory.getArchivedPageMeta(currentArchivePageIndex, ARCHIVE_PAGE_PAIR_COUNT, hotPairCount)
        : null;
    const archiveGroups = this.getAllArchiveGroups(totalPairs, hotPairCount);
    const currentPageGroups = this.getCurrentPageArchiveGroups(totalPairs, currentArchivePageIndex);
    return {
      archivePageCount,
      currentArchivePageIndex,
      currentArchivePageMeta,
      isRecentView: currentArchivePageIndex == null,
      archiveGroups,
      currentPageGroups,
      collapsedBatchCount: currentPageGroups.filter((group) => !group.expanded).length,
      expandedBatchCount: currentPageGroups.filter((group) => group.expanded).length,
    };
  }

  private buildStatus(
    input: {
      supported: boolean;
      reason: string | null;
      totalTurns: number;
      totalPairs: number;
      finalizedTurns: number;
      liveDescendantCount: number;
      visibleRange: IndexRange | null;
    },
    archiveState = this.collectArchiveState(input.totalPairs),
  ): TabRuntimeStatus {
    const hotPairCount = this.getHotPairCount(input.totalPairs);

    return buildRuntimeStatus({
      ...input,
      hotPairCount,
      handledTurnsTotal: this.managedHistory.getArchivedTurnsTotal(hotPairCount),
      archivedTurnsTotal: this.managedHistory.getArchivedTurnsTotal(hotPairCount),
      active: this.active,
      paused: this.paused,
      mode: this.settings.mode,
      softFallback: this.softFallbackSession || this.settings.softFallback,
      initialTrimSession: this.initialTrimSession,
      chatId: this.chatId,
      observedRootKind: this.observedRootKind,
      refreshCount: this.refreshCount,
      spikeCount: this.frameSpikeMonitor.getSpikeCount(),
      lastError: this.lastError,
      contentScriptInstanceId: this.contentScriptInstanceId,
      contentScriptStartedAt: this.contentScriptStartedAt,
      parkedTurns: this.parkingLot.getTotalParkedTurns(),
      parkedGroups: this.parkingLot.getSummaries().length,
      residentParkedGroups: this.parkingLot.getResidentGroupCount(),
      serializedParkedGroups: this.parkingLot.getSerializedGroupCount(),
      archiveState,
    });
  }

  private setObservedMutationRoot(
    root: Node | null,
    kind: 'live-turn-container' | 'archive-only-root',
  ): void {
    this.observedRootKind = kind;
    if (this.mutationObserver == null || root == null || this.observedMutationRoot === root) {
      return;
    }

    this.mutationObserver.disconnect();
    this.observedMutationRoot = root;
    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-busy', 'data-testid', 'data-message-author-role', 'data-message-id'],
    });
  }

  private setScrollTarget(target: HTMLElement | null): void {
    if (this.scrollTarget === target) {
      return;
    }

    if (this.scrollTarget != null) {
      this.scrollTarget.removeEventListener('scroll', this.handleScroll);
    }

    this.scrollTarget = target;
    if (this.scrollTarget != null) {
      this.scrollTarget.addEventListener('scroll', this.handleScroll, { passive: true });
    }
  }

  private readonly handleScroll = (): void => {
    if (this.paused || this.win.performance.now() < this.ignoreScrollUntil) {
      return;
    }

    this.scheduleScrollRefresh();
  };

  private refreshLanguage(): void {
    this.uiLanguage = getContentLanguage(this.settings, this.doc);
    this.t = createTranslator(this.uiLanguage);
    this.parkingLot.setTranslator(this.t);
    this.statusBar?.setTranslator(this.t);
  }

  private updateStatusBar(archiveState = this.collectArchiveState()): void {
    if (this.statusBar == null || this.paused) {
      return;
    }

    const currentPageGroups = archiveState.currentPageGroups;
    const entryActionAvailability = this.buildEntryActionAvailability(currentPageGroups);
    if (this.entryActionMenu == null && this.readAloudMenuSelection != null) {
      this.entryActionMenu = this.readAloudMenuSelection;
    }
    this.statusBar.update(
      this.runtimeStatus,
      this.historyMountTarget ?? this.turnContainer,
      {
        conversationId: this.getConversationIdForReadAloud(),
        archivePageCount: archiveState.archivePageCount,
        currentArchivePageIndex: archiveState.currentArchivePageIndex,
        currentArchivePageMeta: archiveState.currentArchivePageMeta,
        isRecentView: archiveState.isRecentView,
        archiveGroups: currentPageGroups,
        archiveSearchOpen: this.archiveSearchOpen,
        archiveSearchQuery: this.archiveSearchQuery,
        archiveSearchResults: this.archiveSearchResults,
        activeArchiveSearchPageIndex: this.activeArchiveSearchPageIndex,
        activeArchiveSearchPairIndex: this.activeArchiveSearchPairIndex,
        collapsedBatchCount: currentPageGroups.filter((group) => !group.expanded).length,
        expandedBatchCount: currentPageGroups.filter((group) => group.expanded).length,
        entryActionAvailability,
        entryActionSelection: this.buildEntryActionSelectionMap(currentPageGroups, entryActionAvailability),
        entryActionTemplates: this.buildEntryActionTemplateMap(),
        entryHostMessageIds: this.buildEntryHostMessageIdMap(currentPageGroups),
        entryActionMenu: this.entryActionMenu,
        entryActionSpeakingEntryKey: this.entryActionSpeakingEntryKey,
        entryActionCopiedEntryKey: this.entryActionCopiedEntryKey,
        showShareActions: this.isShareActionsDebugEnabled(),
        preferHostMorePopover: this.shouldPreferHostMorePopover(),
      },
    );
  }

  private buildEntryActionSelectionMap(
    archiveGroups: ManagedHistoryGroup[],
    entryActionAvailability: EntryActionAvailabilityMap,
  ): EntryActionSelectionMap {
    const selections: EntryActionSelectionMap = Object.fromEntries(this.entryActionSelectionByEntryId);
    if (!this.shouldPreferHostMorePopover()) {
      return selections;
    }

    for (const group of archiveGroups) {
      if (!shouldResolveEntryMetadataForGroup(group)) {
        continue;
      }
      for (const entry of group.entries) {
        if (isSupplementalHistoryEntry(entry)) {
          const entryKey = getArchiveEntrySelectionKey(entry);
          delete selections[entryKey];
          this.entryActionSelectionByEntryId.delete(entryKey);
          continue;
        }
        if (entry.role !== 'assistant') {
          continue;
        }

        const entryKey = getArchiveEntrySelectionKey(entry);
        const availability = entryActionAvailability[entryKey];
        if (availability?.like !== 'host-bound' && availability?.dislike !== 'host-bound') {
          continue;
        }
        const hostSelection = this.readHostEntryActionSelection(group.id, entry);
        if (!hostSelection.matched) {
          continue;
        }

        if (hostSelection.selection == null) {
          delete selections[entryKey];
        } else {
          selections[entryKey] = hostSelection.selection;
        }
      }
    }

    return selections;
  }

  private buildEntryActionTemplateMap(): EntryActionTemplateMap {
    return buildEntryActionTemplateMap(this.entryActionTemplateByLane);
  }

  private resolveBackendFeedbackMessageId(groupId: string, entry: ManagedHistoryEntry): string | null {
    const conversationId = this.getConversationIdForReadAloud();
    const conversationPayload = this.getConversationPayloadForReadAloud(conversationId);
    const messageId =
      resolveEntryHostMessageIdFromConversationPayload(entry, conversationPayload) ??
      this.findRenderedArchiveMessageIdForEntry(groupId, entry) ??
      this.entryHostMessageIdCache.get(getArchiveEntrySelectionKey(entry)) ??
      this.findHostMessageIdForEntry(entry, groupId) ??
      resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId);
    const normalized = messageId?.trim() ?? '';
    return normalized.length > 0 && !isSyntheticMessageId(normalized) ? normalized : null;
  }

  private canUseBackendFeedbackForEntry(groupId: string, entry: ManagedHistoryEntry): boolean {
    return (
      this.runtimeStatus.routeKind === 'chat' &&
      entry.role === 'assistant' &&
      this.getConversationIdForReadAloud() != null &&
      this.resolveBackendFeedbackMessageId(groupId, entry) != null
    );
  }

  private async sendBackendMessageFeedback(
    groupId: string,
    entry: ManagedHistoryEntry,
    selection: EntryActionSelection,
  ): Promise<boolean> {
    if (!this.canUseBackendFeedbackForEntry(groupId, entry)) {
      return false;
    }

    const conversationId = this.getConversationIdForReadAloud();
    if (conversationId == null) {
      return false;
    }

    await this.ensureConversationSnapshotForReadAloud(conversationId);
    const messageId = this.resolveBackendFeedbackMessageId(groupId, entry);
    if (messageId == null) {
      return false;
    }

    const headers = await this.readAloudBackend.buildJsonHeaders();

    const url = new URL('/backend-api/conversation/message_feedback', this.win.location.origin);
    try {
      const response = await this.win.fetch(url.toString(), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          message_id: messageId,
          conversation_id: conversationId,
          rating: selection === 'like' ? 'thumbsUp' : 'thumbsDown',
        }),
      });
      if (!response.ok) {
        return false;
      }
    } catch {
      return false;
    }

    this.entryActionSelectionByEntryId.set(getArchiveEntrySelectionKey(entry), selection);
    this.updateStatusBar(this.collectArchiveState());
    return true;
  }

  private buildEntryHostMessageIdMap(archiveGroups: ManagedHistoryGroup[]): Record<string, string> {
    const hostMessageIds: Record<string, string> = {};
    const conversationPayload = this.getConversationPayloadForReadAloud(this.getConversationIdForReadAloud());
    const activeEntryKeys = new Set<string>();
    for (const group of archiveGroups) {
      if (!shouldResolveEntryMetadataForGroup(group)) {
        continue;
      }
      for (const entry of group.entries) {
        if (isSupplementalHistoryEntry(entry)) {
          continue;
        }
        if (entry.role !== 'assistant' && entry.role !== 'user') {
          continue;
        }
        const entryKey = getArchiveEntrySelectionKey(entry);
        activeEntryKeys.add(entryKey);
        const cachedHostMessageId = this.entryHostMessageIdCache.get(entryKey) ?? null;
        const hostMessageId =
          resolveEntryHostMessageIdFromConversationPayload(entry, conversationPayload) ??
          this.findRenderedArchiveMessageIdForEntry(group.id, entry) ??
          cachedHostMessageId ??
          this.findHostMessageIdForEntry(entry, group.id, group) ??
          null;
        if (hostMessageId != null && hostMessageId.length > 0) {
          this.entryHostMessageIdCache.set(entryKey, hostMessageId);
          hostMessageIds[entryKey] = hostMessageId;
        }
      }
    }

    for (const entryKey of [...this.entryHostMessageIdCache.keys()]) {
      if (!activeEntryKeys.has(entryKey)) {
        this.entryHostMessageIdCache.delete(entryKey);
      }
    }

    return hostMessageIds;
  }

  private buildEntryActionAvailability(groups: ManagedHistoryGroup[]): EntryActionAvailabilityMap {
    const { availability, activeEntryIds } = buildEntryActionAvailabilityMap(groups, {
      resolveHostArchiveActionBinding: (groupId, entry, action) =>
        this.resolveHostArchiveActionBinding(groupId, entry, action),
      canUseBackendFeedbackForEntry: (groupId, entry) => this.canUseBackendFeedbackForEntry(groupId, entry),
    });

    for (const entryId of [...this.entryActionSelectionByEntryId.keys()]) {
      if (!activeEntryIds.has(entryId)) {
        this.entryActionSelectionByEntryId.delete(entryId);
      }
    }

    return availability;
  }

  private resetArchiveSearchState(): void {
    this.archiveSearchOpen = false;
    this.archiveSearchQuery = '';
    this.archiveSearchResults = [];
    this.clearArchiveSearchSelection();
  }

  private clearArchiveSearchSelection(): void {
    this.activeArchiveSearchPageIndex = null;
    this.activeArchiveSearchPairIndex = null;
    this.pendingArchiveSearchJump = null;
  }

  private clearPageLocalArchiveUiState(options: {
    clearSearchSelection?: boolean;
  } = {}): void {
    const { clearSearchSelection = true } = options;
    this.expandedArchiveBatchIds.clear();
    this.entryActionSelectionByEntryId.clear();
    this.entryHostMessageIdCache.clear();
    this.entryActionMenu = null;
    this.readAloudMenuSelection = null;
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    this.clearReadAloudPlayback({ updateStatusBar: false });
    if (clearSearchSelection) {
      this.clearArchiveSearchSelection();
    }
  }

  private toggleArchiveSearch(): void {
    this.archiveSearchOpen = !this.archiveSearchOpen;
    if (!this.archiveSearchOpen) {
      this.pendingArchiveSearchJump = null;
    }
    this.scheduleArchiveUiSync();
  }

  private setArchiveSearchQuery(query: string): void {
    this.archiveSearchOpen = true;
    this.archiveSearchQuery = query;
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private clearArchiveSearch(): void {
    this.archiveSearchQuery = '';
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private openArchiveSearchResult(result: ArchivePageMatch): void {
    const pageCount = this.getArchivePageCount();
    if (pageCount <= 0) {
      this.archivePager.goToRecent();
      this.clearPageLocalArchiveUiState({ clearSearchSelection: false });
      this.updateBatchSearchState();
      this.scheduleArchiveUiSync();
      return;
    }

    const pageIndex = Math.max(0, Math.min(result.pageIndex, pageCount - 1));
    this.archiveSearchOpen = true;
    this.activeArchiveSearchPageIndex = pageIndex;
    this.activeArchiveSearchPairIndex = result.firstMatchPairIndex;
    this.pendingArchiveSearchJump = {
      pageIndex,
      pairIndex: result.firstMatchPairIndex,
      attemptCount: 0,
    };

    this.archivePager.goToPage(pageIndex, pageCount);
    this.clearPageLocalArchiveUiState({ clearSearchSelection: false });
    const matchingGroup = this.findArchiveGroupContainingPair(
      this.getArchiveGroupsForPage(pageIndex, this.managedHistory.getTotalPairs(), new Set()),
      result.firstMatchPairIndex,
    );
    if (matchingGroup != null) {
      this.expandedArchiveBatchIds.add(matchingGroup.id);
    }

    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private findArchiveGroupContainingPair(
    groups: ReadonlyArray<ManagedHistoryGroup>,
    pairIndex: number,
  ): ManagedHistoryGroup | null {
    return groups.find((group) => group.pairStartIndex <= pairIndex && pairIndex <= group.pairEndIndex) ?? null;
  }

  private getRecordForEntry(entry: ManagedHistoryEntry): TurnRecord | null {
    const candidateIds = [entry.liveTurnId, entry.turnId].filter(
      (value): value is string => value != null && value.length > 0,
    );

    for (const id of candidateIds) {
      const record = this.records.get(id);
      if (record != null) {
        return record;
      }
    }

    return null;
  }

  private updateBatchSearchState(totalPairs = this.managedHistory.getTotalPairs()): void {
    this.pruneExpandedArchiveBatches(totalPairs);
    const normalizedQuery = this.archiveSearchQuery.trim();
    if (normalizedQuery.length === 0) {
      this.archiveSearchResults = [];
      this.clearArchiveSearchSelection();
      return;
    }

    this.archiveSearchResults = this.managedHistory.searchArchivedPages(
      normalizedQuery,
      ARCHIVE_PAGE_PAIR_COUNT,
      this.getHotPairCount(totalPairs),
    );

    if (this.activeArchiveSearchPageIndex == null) {
      return;
    }

    const activeResult =
      this.archiveSearchResults.find((result) => result.pageIndex === this.activeArchiveSearchPageIndex) ?? null;
    if (activeResult == null) {
      this.clearArchiveSearchSelection();
      return;
    }

    this.activeArchiveSearchPairIndex = activeResult.firstMatchPairIndex;
    if (this.pendingArchiveSearchJump != null) {
      this.pendingArchiveSearchJump = {
        ...this.pendingArchiveSearchJump,
        pairIndex: activeResult.firstMatchPairIndex,
      };
    }
  }

  private pruneExpandedArchiveBatches(totalPairs = this.managedHistory.getTotalPairs()): void {
    const pageIndex = this.resolveArchivePageIndex(totalPairs);
    const validIds = toSet(this.getArchiveGroupsForPage(pageIndex, totalPairs, new Set()).map((group) => group.id));
    for (const groupId of [...this.expandedArchiveBatchIds]) {
      if (!validIds.has(groupId)) {
        this.expandedArchiveBatchIds.delete(groupId);
      }
    }
  }

  private getHotPairCount(totalPairs: number): number {
    const desired = this.settings.mode === 'performance' ? this.settings.liveHotPairs : this.settings.keepRecentPairs;
    return Math.max(0, Math.min(totalPairs, desired));
  }

  private getBatchPairCount(): number {
    return Math.max(1, this.settings.batchPairCount);
  }

  private getArchivePageCount(totalPairs = this.managedHistory.getTotalPairs()): number {
    return this.managedHistory.getArchivedPageCount(ARCHIVE_PAGE_PAIR_COUNT, this.getHotPairCount(totalPairs));
  }

  private resolveArchivePageIndex(totalPairs = this.managedHistory.getTotalPairs()): number | null {
    const pageCount = this.getArchivePageCount(totalPairs);
    if (pageCount <= 0) {
      this.archivePager.goToRecent();
      return null;
    }

    const currentPageIndex = this.archivePager.currentPageIndex;
    if (currentPageIndex == null) {
      return null;
    }

    const normalizedPageIndex = Math.max(0, Math.min(currentPageIndex, pageCount - 1));
    if (normalizedPageIndex !== currentPageIndex) {
      this.archivePager.goToPage(normalizedPageIndex, pageCount);
    }

    return normalizedPageIndex;
  }

  private getArchivePageIndexForGroup(
    group: ManagedHistoryGroup,
    totalPairs = this.managedHistory.getTotalPairs(),
  ): number | null {
    const pageCount = this.getArchivePageCount(totalPairs);
    if (pageCount <= 0) {
      return null;
    }

    const pageIndex = Math.trunc(group.pairStartIndex / ARCHIVE_PAGE_PAIR_COUNT);
    if (!Number.isFinite(pageIndex)) {
      return null;
    }

    return Math.max(0, Math.min(pageIndex, pageCount - 1));
  }

  private getAllArchiveGroups(
    totalPairs = this.managedHistory.getTotalPairs(),
    hotPairCount = this.getHotPairCount(totalPairs),
    expandedBatchIds: ReadonlySet<string> = this.expandedArchiveBatchIds,
  ): ManagedHistoryGroup[] {
    return this.managedHistory.getArchiveGroups(hotPairCount, this.getBatchPairCount(), '', expandedBatchIds);
  }

  private getCurrentPageArchiveGroups(
    totalPairs = this.managedHistory.getTotalPairs(),
    currentArchivePageIndex = this.resolveArchivePageIndex(totalPairs),
    expandedBatchIds: ReadonlySet<string> = this.expandedArchiveBatchIds,
  ): ManagedHistoryGroup[] {
    return this.getArchiveGroupsForPage(currentArchivePageIndex, totalPairs, expandedBatchIds);
  }

  private getArchiveGroupsForPage(
    pageIndex: number | null,
    totalPairs = this.managedHistory.getTotalPairs(),
    expandedBatchIds: ReadonlySet<string> = this.expandedArchiveBatchIds,
  ): ManagedHistoryGroup[] {
    if (pageIndex == null) {
      return [];
    }

    return this.managedHistory.getArchiveGroupsForPage(
      pageIndex,
      ARCHIVE_PAGE_PAIR_COUNT,
      this.getHotPairCount(totalPairs),
      this.getBatchPairCount(),
      this.archiveSearchQuery,
      expandedBatchIds,
    );
  }

  private expandNewestCollapsedArchiveGroup(totalPairs = this.managedHistory.getTotalPairs()): void {
    const pageIndex = this.archivePager.currentPageIndex;
    if (pageIndex == null) {
      return;
    }

    const pageGroups = this.getArchiveGroupsForPage(pageIndex, totalPairs, new Set());
    const newestCollapsedGroup = [...pageGroups].reverse().find((group) => !group.expanded);
    if (newestCollapsedGroup != null) {
      this.expandedArchiveBatchIds.add(newestCollapsedGroup.id);
    }
  }

  private openNewestArchivePage(): void {
    const pageCount = this.getArchivePageCount();
    if (pageCount <= 0) {
      this.archivePager.goToRecent();
      this.clearPageLocalArchiveUiState();
      this.updateBatchSearchState();
      this.scheduleArchiveUiSync();
      return;
    }

    this.archivePager.openNewest(pageCount);
    this.clearPageLocalArchiveUiState();
    this.expandNewestCollapsedArchiveGroup();
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private goOlderArchivePage(): void {
    const pageCount = this.getArchivePageCount();
    if (pageCount <= 0) {
      this.archivePager.goToRecent();
      this.clearPageLocalArchiveUiState();
      this.updateBatchSearchState();
      this.scheduleArchiveUiSync();
      return;
    }

    this.archivePager.goOlder(pageCount);
    this.clearPageLocalArchiveUiState();
    this.expandNewestCollapsedArchiveGroup();
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private goNewerArchivePage(): void {
    const pageCount = this.getArchivePageCount();
    if (pageCount <= 0) {
      this.archivePager.goToRecent();
      this.clearPageLocalArchiveUiState();
      this.updateBatchSearchState();
      this.scheduleArchiveUiSync();
      return;
    }

    this.archivePager.goNewer(pageCount);
    this.clearPageLocalArchiveUiState();
    this.expandNewestCollapsedArchiveGroup();
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private goToRecentArchiveView(): void {
    this.archivePager.goToRecent();
    this.clearPageLocalArchiveUiState();
    this.updateBatchSearchState();
    this.scheduleArchiveUiSync();
  }

  private highlightTranscriptTurn(node: HTMLElement): void {
    this.highlightedTurnNode?.classList.remove(UI_CLASS_NAMES.transcriptHighlight);
    this.highlightedTurnNode = node;
    node.classList.add(UI_CLASS_NAMES.transcriptHighlight);
    this.scheduleHighlightReset();
  }

  private clearHighlights(): void {
    this.highlightedTurnNode?.classList.remove(UI_CLASS_NAMES.transcriptHighlight);
    this.highlightedTurnNode = null;
  }

  private scheduleHighlightReset(): void {
    if (this.highlightResetHandle != null) {
      this.win.clearTimeout(this.highlightResetHandle);
    }

    this.highlightResetHandle = this.win.setTimeout(() => {
      this.clearHighlights();
      this.highlightResetHandle = null;
      this.updateStatusBar();
    }, 2200);
  }
}
