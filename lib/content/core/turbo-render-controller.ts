import {
  DEFAULT_SETTINGS,
  TURN_ID_DATASET,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY,
  UI_CLASS_NAMES,
} from '../../shared/constants';
import { getChatIdFromPathname, getRouteIdFromRuntimeId } from '../../shared/chat-id';
import {
  resolveResidentArchivePageIndexes,
  type ArchiveUiState,
} from '../state/archive-ui-state';
import {
  createTranslator,
  getContentLanguage,
  type Translator,
  type UiLanguage,
} from '../../shared/i18n';
import type {
  ArchivePageMatch,
  IndexRange,
  InitialTrimSession,
  ManagedHistoryEntry,
  ManagedHistoryGroup,
  Settings,
  TabRuntimeStatus,
  TurnRecord,
} from '../../shared/types';

import {
  detectTurnRole,
  isStreamingTurn,
  isTurboRenderUiNode,
  scanChatPage,
} from '../utils/chatgpt-adapter';
import { FrameSpikeMonitor } from '../managers/frame-spike-monitor';
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
} from '../state/entry-action-state';
import { shouldAutoActivate } from '../utils/layout';
import { dispatchHumanClick as dispatchHostHumanClick } from '../host-integration/host-action-events';
import {
  doesHostActionButtonMatchEntry as doesHostActionButtonMatchArchiveEntry,
  normalizeEntryText,
} from '../host-integration/host-action-matching';
import { HostMenuPositioning } from '../host-integration/host-menu-positioning';
import {
  findHostMessageIdForEntryInScope,
  findParkedMessageIdForEntryInGroup,
  findRenderedArchiveMessageIdFromActionAnchor,
} from '../host-integration/host-message-id-resolver';
import {
  findHostMoreMenuAction as findHostMoreMenuActionInMenu,
  readHostEntryActionSelection as readHostEntryActionSelectionFromRoots,
} from '../host-integration/host-more-menu-actions';
import { shouldRefreshForMutations as shouldRefreshForMutationBatch } from '../utils/mutation-refresh-filter';
import { computeVisibleRangeFromTurnContainer } from '../utils/visible-range';
import { isProtectedTurn as isProtectedTurnNode } from '../host-integration/protected-turn';
import { buildRuntimeStatus } from '../utils/runtime-status-builder';
import { waitForHostElement } from '../host-integration/host-action-wait';
import {
  ManagedHistoryStore,
  extractMessageIdFromHtml,
  isSyntheticMessageId,
  isSupplementalHistoryEntry,
  resolvePreferredMessageId,
} from './managed-history';
import { ArchivePager } from '../managers/archive-pager';
import { ParkingLot } from '../managers/parking-lot';
import {
  ReadAloudBackendClient,
  buildReadAloudSynthesizeUrl,
  createIncludeCredentialsRequestInit,
  resolveDebugReadAloudUrl,
  resolveEntryHostMessageIdFromConversationPayload,
} from '../read-aloud-backend';
import { tryStreamReadAloudResponse } from '../read-aloud-streaming';
import { StatusBar } from '../rendering/status-bar';
import { ReadAloudManager } from '../managers/read-aloud-manager';
import { ReadAloudSnapshotCache } from '../state/read-aloud-snapshot-cache';
import { EntryActionManager } from '../managers/entry-action-manager';
import { ArchiveUIManager } from '../managers/archive-ui-manager';
import { ViewportManager } from '../managers/viewport-manager';
import { MutationObserverManager } from '../managers/mutation-observer-manager';
import { HostMenuManager } from '../managers/host-menu-manager';
import type { ConversationPayload } from '../../shared/conversation-trim';
import { resolveReadAloudMessageIdFromPayload } from '../../shared/conversation-trim';
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
} from '../utils/turbo-render-controller-utils';
import { setDataset, deleteDataset } from '../utils/dataset-utils';
import { SlidingWindowManager } from '../managers/sliding-window-manager';
import {mwLogger} from "@/lib/main-world/logger";

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

const SCROLL_RESTORE_IGNORE_MS = 240;

const LARGE_CONVERSATION_TURN_THRESHOLD = 600;
const LARGE_CONVERSATION_REFRESH_DELAY_MS = 180;
export const ARCHIVE_PAGE_PAIR_COUNT = 20;
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
  private readonly readAloudSnapshotCache: ReadAloudSnapshotCache;
  private readonly readAloudManager: ReadAloudManager;
  private readonly entryActionManager: EntryActionManager;
  private readonly archiveUiManager: ArchiveUIManager;
  private readonly viewportManager: ViewportManager;
  private readonly mutationObserverManager: MutationObserverManager;
  private readonly hostMenuPositioning: HostMenuPositioning;
  private readonly hostMenuManager: HostMenuManager;
  private readonly slidingWindowManager: SlidingWindowManager;
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
  private activeArchiveSearchPageIndex: number | null = null;
  private activeArchiveSearchPairIndex: number | null = null;
  private readonly entryHostMessageIdCache = new Map<string, string>();
  private readAloudMenuSelection: EntryActionMenuSelection | null = null;
  private entryActionCopiedEntryKey: string | null = null;
  private entryActionCopiedResetHandle: number | null = null;
  private pendingHostMoreActionRestore: (() => void) | null = null;
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
    this.readAloudSnapshotCache = new ReadAloudSnapshotCache(this.win);
    this.readAloudManager = new ReadAloudManager({
      win: this.win,
      doc: this.doc,
      preferHostMorePopover: () => this.shouldPreferHostMorePopover(),
      shouldUseHostActionClicks: () => this.shouldUseHostActionClicks(),
      onStateChange: () => this.updateStatusBar(this.collectArchiveState()),
      sharedCache: this.readAloudSnapshotCache,
    });
    this.entryActionManager = new EntryActionManager({
      win: this.win,
      doc: this.doc,
      statusBar: this.statusBar,
      managedHistory: this.managedHistory,
      archivePager: this.archivePager,
      readAloudManager: this.readAloudManager,
      onMenuChange: () => {}, // Controller 直接通过 Manager 获取菜单状态
      onCopiedFeedback: (entryKey) => { this.entryActionCopiedEntryKey = entryKey; },
      onClearReadAloudPlayback: (options) => this.clearReadAloudPlayback(options),
      onUpdateStatusBar: () => this.updateStatusBar(),
      onIncrementDebugCounter: (action) => this.incrementDebugActionCounter(action),
      getArchiveState: () => this.collectArchiveState(),
      getInitialTrimSession: () => this.initialTrimSession,
      getRecordForEntry: (entry) => this.getRecordForEntry(entry),
      normalizeEntryText: (text) => text.trim(),
    });
    this.archiveUiManager = new ArchiveUIManager({
      win: this.win,
      managedHistory: this.managedHistory,
      archivePager: this.archivePager,
      getHotPairCount: (totalPairs) => this.getHotPairCount(totalPairs),
      getBatchPairCount: () => this.getBatchPairCount(),
      onStateChange: () => this.updateStatusBar(),
      onScheduleUiSync: () => this.scheduleArchiveUiSync(),
    });
    this.viewportManager = new ViewportManager({
      win: this.win,
      doc: this.doc,
      onScrollRefresh: () => this.flushScrollSync(),
      getPaused: () => this.paused,
    });
    this.mutationObserverManager = new MutationObserverManager({
      win: this.win,
      onMutations: (mutations) => this.handleMutations(mutations),
      largeConversationThreshold: 100,
      getCurrentRecordCount: () => this.records.size,
    });
    this.slidingWindowManager = new SlidingWindowManager({
      win: this.win,
      doc: this.doc,
      turnContainer: this.turnContainer,
      getRecords: () => this.records,
    });
    this.hostMenuPositioning = new HostMenuPositioning(
      this.doc,
      this.win,
      () => this.statusBar?.getTopPageChromeOffset?.() ?? 0,
    );
    this.hostMenuManager = new HostMenuManager({
      win: this.win,
      doc: this.doc,
      statusBar: this.statusBar,
      parkingLot: this.parkingLot,
      mutationObserverManager: this.mutationObserverManager,
      viewportManager: this.viewportManager,
      hostMenuPositioning: this.hostMenuPositioning,
      entryActionManager: this.entryActionManager,
      shouldUseHostActionClicks: () => this.shouldUseHostActionClicks(),
      shouldPreferHostMorePopover: () => this.shouldPreferHostMorePopover(),
      onIncrementDebugCounter: (action) => this.incrementDebugActionCounter(action),
      getRecordForEntry: (entry) => this.getRecordForEntry(entry),
      findRenderedArchiveMessageIdForEntry: (groupId, entry) => this.findRenderedArchiveMessageIdForEntry(groupId, entry),
      findParkedMessageIdForEntry: (groupId, entry) => this.findParkedMessageIdForEntry(groupId, entry),
      findHostMessageIdForEntry: (entry, groupId, group) => this.findHostMessageIdForEntry(entry, groupId, group),
      doesHostActionButtonMatchEntry: (candidate, entry) => this.doesHostActionButtonMatchEntry(candidate, entry),
    });
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
    mwLogger.info(`[TurboRender] Controller starting, mountUi=${this.mountUi}`);
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
      mwLogger.info(`[TurboRender] StatusBar created: ${this.statusBar != null}`);
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
    this.resetArchiveSearchState();
    this.entryActionManager.reset();
    this.entryHostMessageIdCache.clear();
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    this.clearCopiedEntryFeedback(false);
    this.readAloudManager.reset();
    this.cachedLiveDescendantCount = 0;
    this.lastLiveDescendantSampleAt = 0;
    this.liveDescendantSampleDirty = true;
    this.clearHighlights();
    this.frameSpikeMonitor.stop();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.observedMutationRoot = null;
    this.clearAllHandles();
    this.setScrollTarget(null);
    this.statusBar?.destroy();
    this.statusBar = null;
  }

  private clearAllHandles(): void {
    this.ignoreScrollUntil = 0;
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
    if (this.idleHandle != null) {
      cancelIdleCallbackCompat(this.win, this.idleHandle);
      this.idleHandle = null;
    }
    if (this.highlightResetHandle != null) {
      this.win.clearTimeout(this.highlightResetHandle);
      this.highlightResetHandle = null;
    }
  }

  getStatus(): TabRuntimeStatus {
    return this.runtimeStatus;
  }

  setSettings(settings: Settings): void {
    if (areSettingsEquivalent(this.settings, settings)) {
      return;
    }
    this.settings = settings;
    this.refreshLanguage();
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
      this.entryActionManager.reset();
      this.clearCopiedEntryFeedback(false);
      this.readAloudManager.reset();
      this.statusBar?.destroy();
    } else if (this.settings.enabled) {
      this.active = true;
      this.manualRestoreHoldUntil = 0;
    }
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
    this.entryActionManager.closeMenu();
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
        if (this.entryActionManager.isSuppressingDismissal()) {
          return;
        }
        if (this.entryActionManager.getCurrentMenu() != null && this.shouldCloseEntryActionMenu(event.target as Node | null)) {
          this.closeEntryActionMenu();
        }
      },
      true,
    );

    this.doc.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.entryActionManager.getCurrentMenu() != null) {
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

  private handleMutations(mutations: MutationRecord[]): void {
    if (mutations.some((mutation) => mutation.type === 'childList')) {
      this.liveDescendantSampleDirty = true;
    }
    if (this.shouldRefreshForMutations(mutations)) {
      this.scheduleMutationRefresh();
    }
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
    const wasExpanded = this.archiveUiManager.isBatchExpanded(groupId);
    const targetAnchorTop = this.getBatchHeaderScrollTop();
    this.archiveUiManager.toggleBatch(groupId);

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
    this.entryActionManager.toggleMenu(groupId, entryId, lane);
    this.restoreExactScrollTop(scrollTarget, previousScrollTop);
  }

  private async runWithSuppressedEntryActionMenuDismissal<T>(callback: () => Promise<T> | T): Promise<T> {
    return this.entryActionManager.runWithSuppressedDismissal(callback);
  }

  private closeEntryActionMenu(): void {
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    this.entryActionManager.closeMenu();
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
    return this.entryActionManager.shouldCloseMenu(target);
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

  private clearReadAloudPlayback(options: {
    incrementStopCount?: boolean;
    updateStatusBar?: boolean;
  } = {}): void {
    const { incrementStopCount = false, updateStatusBar = true } = options;

    // 委托给 ReadAloudManager
    const wasSpeaking = this.readAloudManager.isSpeaking();
    this.readAloudManager.stop({ incrementStopCount });

    if (incrementStopCount && wasSpeaking) {
      this.readAloudMenuSelection = null;
    }

    if (updateStatusBar) {
      this.updateStatusBar(this.collectArchiveState());
    }
  }

  private async startReadAloudPlayback(
    groupId: string | null,
    entry: ManagedHistoryEntry,
    entryKey: string,
  ): Promise<void> {
    this.clearReadAloudPlayback({ updateStatusBar: false });
    this.incrementDebugActionCounter('read-aloud');

    // 委托给 ReadAloudManager
    const started = await this.readAloudManager.start(groupId, entry, entryKey, resolveArchiveCopyText(entry), entry.role === 'user' ? 'user' : 'assistant');
    if (started) {
      this.updateStatusBar(this.collectArchiveState());
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
      if (this.entryActionManager.isMenuOpenFor(group.id, entryKey, lane)) {
        this.toggleEntryActionMenu(group.id, entryKey, lane);
        return;
      }

      if (this.shouldPreferHostMorePopover()) {
        const hostToggled = await this.hostMenuManager.toggleMoreMenu(group.id, entry, actionAnchorGetter);
        if (hostToggled) {
          return;
        }
      }
      this.toggleEntryActionMenu(group.id, entryKey, lane);
      return;
    }

    this.closeEntryActionMenu();

    if (request.action === 'copy') {
      const hostClicked = await this.hostMenuManager.clickArchiveAction(
        request.groupId,
        entry,
        request.action,
        actionAnchorGetter,
      );
      if (hostClicked) {
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
      const hostClicked = await this.hostMenuManager.clickArchiveAction(
        request.groupId,
        entry,
        request.action,
        actionAnchorGetter,
      );
      if (hostClicked) {
        await new Promise<void>((resolve) => {
          requestAnimationFrameCompat(this.win, () => resolve());
        });
        const hostSelection = this.hostMenuManager.readHostEntryActionSelection(request.groupId, entry);
        if (hostSelection.matched) {
          this.entryActionManager.setSelection(entryKey, hostSelection.selection);
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
    const acted = await this.hostMenuManager.clickArchiveAction(
      request.groupId,
      entry,
      request.action,
      actionAnchorGetter,
    );
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
    const conversationId = this.readAloudManager.getConversationId();
    this.readAloudManager.setRequestContext({
      conversationId,
      entryRole: entry != null && entry.role === 'user' ? 'user' : 'assistant',
      entryText: entry != null ? resolveArchiveCopyText(entry) : '',
      entryKey: entry != null ? getArchiveEntrySelectionKey(entry) : '',
      entryMessageId: resolvedReadAloudMessageId,
      groupId: request.groupId ?? '',
      entryId: request.entryId ?? '',
      action: request.action,
    });
    const scope = { body: this.doc.body, documentElement: this.doc.documentElement };
    setDataset(scope, 'turboRenderDebugReadAloudRequestGroupId', request.groupId ?? '');
    setDataset(scope, 'turboRenderDebugReadAloudRequestEntryId', request.entryId ?? '');
    setDataset(scope, 'turboRenderDebugReadAloudRequestAction', request.action ?? '');
    setDataset(scope, 'turboRenderDebugReadAloudRequestEntryKey', entry != null ? getArchiveEntrySelectionKey(entry) : '');
    setDataset(scope, 'turboRenderDebugReadAloudRequestLane', entry != null ? (entry.role === 'user' ? 'user' : 'assistant') : '');
    if (entry == null) {
      return;
    }

    if (request.action === 'branch') {
      this.closeEntryActionMenu();
      const hostBranched = await this.hostMenuManager.clickMoreMenuAction(group.id, entry, request.action, actionAnchorGetter);
      if (hostBranched) {
        this.incrementDebugActionCounter(request.action);
        return;
      }
      this.incrementDebugActionCounter(request.action);
      return;
    }

    const entryKey = getArchiveEntrySelectionKey(entry);
    const isReadAloudActive = this.readAloudManager.isSpeaking(entryKey);
    if (this.shouldPreferHostMorePopover() && !isReadAloudActive && request.action !== 'read-aloud') {
      if (request.action === 'stop-read-aloud') {
        const hostStopped = await this.hostMenuManager.clickMoreMenuAction(group.id, entry, 'stop-read-aloud', actionAnchorGetter);
        if (hostStopped) {
          this.incrementDebugActionCounter('stop-read-aloud');
          this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
          return;
        }
      }
    }

    if (request.action === 'stop-read-aloud' || isReadAloudActive) {
      const preservedEntryActionMenu = this.entryActionManager.getCurrentMenu();
      if (isReadAloudActive) {
        this.incrementDebugActionCounter('stop-read-aloud');
        this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
        this.entryActionManager.setCurrentMenu(preservedEntryActionMenu);
        return;
      }

      const hostStopped = await this.hostMenuManager.clickMoreMenuAction(group.id, entry, request.action, actionAnchorGetter);
      if (hostStopped) {
        this.incrementDebugActionCounter('stop-read-aloud');
        this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
        return;
      }
      this.incrementDebugActionCounter('stop-read-aloud');
      this.clearReadAloudPlayback({ incrementStopCount: false, updateStatusBar: true });
      return;
    }

    if (request.action === 'read-aloud') {
      const preservedEntryActionMenu = this.entryActionManager.getCurrentMenu();
      this.readAloudMenuSelection = preservedEntryActionMenu;
      const scope = { body: this.doc.body, documentElement: this.doc.documentElement };
      setDataset(scope, 'turboRenderDebugReadAloudRoute', 'backend');
      setDataset(scope, 'turboRenderDebugReadAloudMenuAction', request.action);
      await this.runWithSuppressedEntryActionMenuDismissal(async () => {
        await this.startReadAloudPlayback(request.groupId, entry, entryKey);
      });
      this.entryActionManager.setCurrentMenu(preservedEntryActionMenu);
      return;
    }

    const hostReadAloud = await this.hostMenuManager.clickMoreMenuAction(group.id, entry, request.action, actionAnchorGetter);
    if (hostReadAloud) {
      this.incrementDebugActionCounter('read-aloud');
      this.readAloudMenuSelection = { groupId: request.groupId, entryId: request.entryId, lane: entry.role === 'user' ? 'user' : 'assistant' };
      this.updateStatusBar(this.collectArchiveState());
      return;
    }
  }

  private clearPendingHostMoreActionRestore(): void {
    const restore = this.pendingHostMoreActionRestore;
    this.pendingHostMoreActionRestore = null;
    restore?.();
  }

  private restoreAnchoredHostMenuStyle(): void {
    this.hostMenuPositioning.restoreAnchoredHostMenuStyle();
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
    const startTime = performance.now();
    
    const archiveState = this.collectArchiveState();
    this.syncArchivePageCache(archiveState);
    this.refreshRuntimeStatusFromCurrentMetrics(archiveState);
    
    // 延迟 updateStatusBar 到主渲染完成后，减少 presentation delay
    // 使用 requestIdleCallback 或 setTimeout 让出主线程
    const scheduleUpdate = (this.win as typeof window).requestIdleCallback ?? this.win.setTimeout;
    scheduleUpdate(() => {
      this.updateStatusBar(archiveState);
    }, { timeout: 100 } as IdleRequestOptions);
    
    const syncTime = performance.now() - startTime;
    if (syncTime > 100) {
      mwLogger.debug(`[TurboRender] flushArchiveUiSync sync done - ${syncTime.toFixed(2)}ms`);
    }

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

    if (!this.archiveUiManager.isBatchExpanded(matchingGroup.id)) {
      this.archiveUiManager.expandBatch(matchingGroup.id);
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

    const visibleRange = this.slidingWindowManager.computeVisibleRange(this.scrollTarget);
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
      this.slidingWindowManager.setTurnContainer(null);
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
      this.readAloudManager.primeConversationMetadata(archiveState);
      return;
    }

    this.turnContainer = snapshot.turnContainer;
    this.slidingWindowManager.setTurnContainer(snapshot.turnContainer);
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
    const visibleRange = this.slidingWindowManager.computeVisibleRange(snapshot.scrollContainer);
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
    this.readAloudManager.primeConversationMetadata(archiveState);

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
      this.readAloudManager.primeConversationMetadata(idleArchiveState);
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

    for (const [id] of this.records.entries()) {
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
    if (lane == null || this.entryActionManager.hasTemplate(lane) || record.node == null) {
      return;
    }

    const template = captureHostActionTemplate(record.node, lane);
    if (template == null) {
      return;
    }

    this.entryActionManager.captureTemplate(lane, template);
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
    const startTime = performance.now();
    
    if (this.statusBar == null || this.paused) {
      return;
    }

    const currentPageGroups = archiveState.currentPageGroups;
    const entryActionAvailability = this.buildEntryActionAvailability(currentPageGroups);
    const availabilityTime = performance.now() - startTime;
    if (availabilityTime > 100) {
      mwLogger.debug(`[TurboRender] updateStatusBar availability built - ${availabilityTime.toFixed(2)}ms`);
    }
    const menu = this.entryActionManager.getCurrentMenu() ?? this.readAloudMenuSelection;
    this.statusBar.update(
      this.runtimeStatus,
      this.historyMountTarget ?? this.turnContainer,
      {
        conversationId: this.readAloudManager.getConversationId(),
        archivePageCount: archiveState.archivePageCount,
        currentArchivePageIndex: archiveState.currentArchivePageIndex,
        currentArchivePageMeta: archiveState.currentArchivePageMeta,
        isRecentView: archiveState.isRecentView,
        archiveGroups: currentPageGroups,
        archiveSearchOpen: this.archiveUiManager.getSearchState().open,
        archiveSearchQuery: this.archiveUiManager.getSearchState().query,
        archiveSearchResults: this.archiveUiManager.getSearchState().results,
        activeArchiveSearchPageIndex: this.activeArchiveSearchPageIndex,
        activeArchiveSearchPairIndex: this.activeArchiveSearchPairIndex,
        collapsedBatchCount: currentPageGroups.filter((group) => !group.expanded).length,
        expandedBatchCount: currentPageGroups.filter((group) => group.expanded).length,
        entryActionAvailability,
        entryActionSelection: this.buildEntryActionSelectionMap(currentPageGroups, entryActionAvailability),
        entryActionTemplates: this.buildEntryActionTemplateMap(),
        entryHostMessageIds: this.buildEntryHostMessageIdMap(currentPageGroups),
        entryActionMenu: menu,
        entryActionSpeakingEntryKey: this.readAloudManager.getState().speakingEntryKey,
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
    const selections: EntryActionSelectionMap = Object.fromEntries(this.entryActionManager.getSelectionEntries());
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
          this.entryActionManager.deleteSelection(entryKey);
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
        const hostSelection = this.hostMenuManager.readHostEntryActionSelection(group.id, entry);
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
    return buildEntryActionTemplateMap(this.entryActionManager.getTemplates());
  }

  private resolveBackendFeedbackMessageId(groupId: string, entry: ManagedHistoryEntry): string | null {
    const conversationId = this.readAloudManager.getConversationId();
    const conversationPayload = this.readAloudManager.getConversationPayload(conversationId);
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
      this.readAloudManager.getConversationId() != null &&
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

    const conversationId = this.readAloudManager.getConversationId();
    if (conversationId == null) {
      return false;
    }

    this.readAloudManager.getConversationPayload(conversationId);
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

    this.entryActionManager.setSelection(getArchiveEntrySelectionKey(entry), selection);
    this.updateStatusBar(this.collectArchiveState());
    return true;
  }

  private buildEntryHostMessageIdMap(archiveGroups: ManagedHistoryGroup[]): Record<string, string> {
    const hostMessageIds: Record<string, string> = {};
    const conversationPayload = this.readAloudManager.getConversationPayload(this.readAloudManager.getConversationId());
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
    mwLogger.debug(`[TurboRender] buildEntryActionAvailability START - ${groups.length} groups`);
    const startTime = performance.now();
    
    const { availability, activeEntryIds } = buildEntryActionAvailabilityMap(groups, {
      resolveHostArchiveActionBinding: (groupId, entry, action) =>
        this.hostMenuManager.resolveArchiveActionBinding(groupId, entry, action),
      canUseBackendFeedbackForEntry: (groupId, entry) => this.canUseBackendFeedbackForEntry(groupId, entry),
    });
    
    mwLogger.debug(`[TurboRender] buildEntryActionAvailability END - ${(performance.now() - startTime).toFixed(2)}ms`);

    this.entryActionManager.pruneSelections(activeEntryIds);

    return availability;
  }

  private resetArchiveSearchState(): void {
    this.archiveUiManager.resetSearchState();
  }

  private clearArchiveSearchSelection(): void {
    this.archiveUiManager.resetSearchSelection();
  }

  private clearPageLocalArchiveUiState(options: {
    clearSearchSelection?: boolean;
  } = {}): void {
    const { clearSearchSelection = true } = options;
    this.archiveUiManager.resetForPageChange();
    this.entryActionManager.reset();
    this.entryHostMessageIdCache.clear();
    this.readAloudMenuSelection = null;
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    this.clearReadAloudPlayback({ updateStatusBar: false });
    if (clearSearchSelection) {
      this.clearArchiveSearchSelection();
    }
  }

  private toggleArchiveSearch(): void {
    this.archiveUiManager.toggleSearch();
  }

  private setArchiveSearchQuery(query: string): void {
    this.archiveUiManager.setSearchQuery(query);
  }

  private clearArchiveSearch(): void {
    this.archiveUiManager.clearSearch();
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

    this.archiveUiManager.openSearchResult(result, this.managedHistory.getTotalPairs());
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
    this.archiveUiManager.pruneExpandedBatches(totalPairs);
    this.archiveUiManager.performSearch();
  }

  private pruneExpandedArchiveBatches(totalPairs = this.managedHistory.getTotalPairs()): void {
    this.archiveUiManager.pruneExpandedBatches(totalPairs);
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
  ): ManagedHistoryGroup[] {
    return this.managedHistory.getArchiveGroups(hotPairCount, this.getBatchPairCount(), '', this.archiveUiManager.getExpandedBatchIds());
  }

  private getCurrentPageArchiveGroups(
    totalPairs = this.managedHistory.getTotalPairs(),
    currentArchivePageIndex = this.resolveArchivePageIndex(totalPairs),
  ): ManagedHistoryGroup[] {
    return this.getArchiveGroupsForPage(currentArchivePageIndex, totalPairs);
  }

  private getArchiveGroupsForPage(
    pageIndex: number | null,
    totalPairs = this.managedHistory.getTotalPairs(),
  ): ManagedHistoryGroup[] {
    if (pageIndex == null) {
      return [];
    }

    return this.managedHistory.getArchiveGroupsForPage(
      pageIndex,
      ARCHIVE_PAGE_PAIR_COUNT,
      this.getHotPairCount(totalPairs),
      this.getBatchPairCount(),
      this.archiveUiManager.getSearchState().query,
      this.archiveUiManager.getExpandedBatchIds(),
    );
  }

  private expandNewestCollapsedArchiveGroup(totalPairs = this.managedHistory.getTotalPairs()): void {
    const pageIndex = this.archivePager.currentPageIndex;
    if (pageIndex == null) {
      return;
    }

    const pageGroups = this.getArchiveGroupsForPage(pageIndex, totalPairs);
    const newestCollapsedGroup = [...pageGroups].reverse().find((group) => !group.expanded);
    if (newestCollapsedGroup != null) {
      this.archiveUiManager.expandBatch(newestCollapsedGroup.id);
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

  private clearHighlights(): void {
    this.highlightedTurnNode?.classList.remove(UI_CLASS_NAMES.transcriptHighlight);
    this.highlightedTurnNode = null;
  }

}
