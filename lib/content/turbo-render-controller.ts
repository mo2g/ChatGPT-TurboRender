import {
  BUILD_SIGNATURE,
  DEFAULT_SETTINGS,
  TURN_ID_DATASET,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY,
  TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY,
  UI_CLASS_NAMES,
} from '../shared/constants';
import { getChatIdFromPathname, getRouteIdFromRuntimeId, getRouteKindFromRuntimeId } from '../shared/chat-id';
import {
  createTranslator,
  getContentLanguage,
  type Translator,
  type UiLanguage,
} from '../shared/i18n';
import type {
  ArchivePageMatch,
  ArchivePageMeta,
  IndexRange,
  InitialTrimSession,
  ManagedHistoryEntry,
  ManagedHistoryGroup,
  Settings,
  TabRuntimeStatus,
  TurnRecord,
  TurnRole,
} from '../shared/types';

import {
  buildTurnsFromFixture,
  checkFixtureCompatibility,
  detectTurnRole,
  getFixtureData,
  isStreamingTurn,
  isTurnNode,
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
  type EntryActionAvailability,
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
import { shouldAutoActivate } from './layout';
import {
  ManagedHistoryStore,
  extractMessageIdFromHtml,
  isSyntheticMessageId,
  isSupplementalHistoryEntry,
  resolvePreferredMessageId,
} from './managed-history';
import { ArchivePager } from './archive-pager';
import { ParkingLot } from './parking-lot';
import { StatusBar } from './status-bar';
import type { ConversationPayload } from '../shared/conversation-trim';
import { resolveReadAloudMessageIdFromPayload } from '../shared/conversation-trim';

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

function requestAnimationFrameCompat(win: Window, callback: FrameRequestCallback): number {
  return win.requestAnimationFrame?.(callback) ?? win.setTimeout(() => callback(win.performance.now()), 16);
}

function cancelAnimationFrameCompat(win: Window, handle: number): void {
  if (win.cancelAnimationFrame != null) {
    win.cancelAnimationFrame(handle);
  } else {
    win.clearTimeout(handle);
  }
}

function requestIdleCallbackCompat(win: Window, callback: IdleRequestCallback): number {
  return (
    win.requestIdleCallback?.(callback, { timeout: 250 }) ??
    win.setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining: () => 0,
        }),
      16,
    )
  );
}

function cancelIdleCallbackCompat(win: Window, handle: number): void {
  if (win.cancelIdleCallback != null) {
    win.cancelIdleCallback(handle);
  } else {
    win.clearTimeout(handle);
  }
}

const SCROLL_RESTORE_IGNORE_MS = 240;
const READ_ALOUD_SNAPSHOT_FAILURE_MS = 120_000;
const HOST_MENU_WAIT_TIMEOUT_MS = 1_000;
const HOST_MENU_ACTION_WAIT_TIMEOUT_MS = 2_000;
const LARGE_CONVERSATION_TURN_THRESHOLD = 600;
const LARGE_CONVERSATION_REFRESH_DELAY_MS = 180;
const ARCHIVE_PAGE_PAIR_COUNT = 20;
const DESCENDANT_COUNT_CAP = 4_000;
const DESCENDANT_COUNT_SAMPLE_INTERVAL_MS = 1_500;

function countLiveDescendants(root: ParentNode | null): number {
  if (root == null || !('ownerDocument' in root)) {
    return 0;
  }

  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc == null) {
    return 0;
  }

  const showElement = doc.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
  const walker = doc.createTreeWalker(root, showElement);
  let count = 0;
  while (walker.nextNode()) {
    count += 1;
    if (count >= DESCENDANT_COUNT_CAP) {
      return DESCENDANT_COUNT_CAP;
    }
  }
  return count;
}

function toSet(values: string[]): Set<string> {
  return new Set(values);
}

function areSettingsEquivalent(left: Settings, right: Settings): boolean {
  return (
    left.enabled === right.enabled &&
    left.autoEnable === right.autoEnable &&
    left.language === right.language &&
    left.mode === right.mode &&
    left.minFinalizedBlocks === right.minFinalizedBlocks &&
    left.minDescendants === right.minDescendants &&
    left.keepRecentPairs === right.keepRecentPairs &&
    left.batchPairCount === right.batchPairCount &&
    left.initialHotPairs === right.initialHotPairs &&
    left.liveHotPairs === right.liveHotPairs &&
    left.keepRecentTurns === right.keepRecentTurns &&
    left.viewportBufferTurns === right.viewportBufferTurns &&
    left.groupSize === right.groupSize &&
    left.initialTrimEnabled === right.initialTrimEnabled &&
    left.initialHotTurns === right.initialHotTurns &&
    left.liveHotTurns === right.liveHotTurns &&
    left.coldRestoreMode === right.coldRestoreMode &&
    left.softFallback === right.softFallback &&
    left.frameSpikeThresholdMs === right.frameSpikeThresholdMs &&
    left.frameSpikeCount === right.frameSpikeCount &&
    left.frameSpikeWindowMs === right.frameSpikeWindowMs
  );
}

const HOST_ACTION_LABEL_PATTERNS: Record<ArchiveEntryAction, RegExp[]> = {
  copy: [/^copy\b/i, /\bcopy\b/i, /复制/],
  like: [/^like\b/i, /\blike\b/i, /thumbs?\s*up/i, /upvote/i, /喜欢/, /赞/],
  dislike: [/^dislike\b/i, /\bdislike\b/i, /thumbs?\s*down/i, /downvote/i, /不喜欢/, /踩/],
  share: [/^share\b/i, /\bshare\b/i, /分享/],
  more: [
    /^more\b/i,
    /\bmore\s+actions?\b/i,
    /\bmore\s+options?\b/i,
    /\boptions?\b/i,
    /\bmenu\b/i,
    /更多操作/,
    /更多/,
    /⋯/,
    /…/,
  ],
};

const HOST_ACTION_TESTID_PATTERNS: Record<ArchiveEntryAction, RegExp[]> = {
  copy: [/^copy-turn-action-button$/i],
  like: [/^good-response-turn-action-button$/i, /^like-turn-action-button$/i],
  dislike: [/^bad-response-turn-action-button$/i, /^dislike-turn-action-button$/i],
  share: [/^share-turn-action-button$/i],
  more: [/^more-turn-action-button$/i],
};

interface ArchiveUiState {
  archivePageCount: number;
  currentArchivePageIndex: number | null;
  currentArchivePageMeta: ArchivePageMeta | null;
  isRecentView: boolean;
  archiveGroups: ManagedHistoryGroup[];
  currentPageGroups: ManagedHistoryGroup[];
  collapsedBatchCount: number;
  expandedBatchCount: number;
}

function findClosestTurnNode(target: Node | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  if (isTurboRenderUiNode(target)) {
    return null;
  }

  const candidate =
    (isTurnNode(target) ? target : null) ??
    target.closest<HTMLElement>('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn');

  return candidate != null && !isTurboRenderUiNode(candidate) ? candidate : null;
}

function resolveMessageId(node: HTMLElement | null): string | null {
  if (node == null || isTurboRenderUiNode(node)) {
    return null;
  }

  const turnContainer =
    node.closest<HTMLElement>('[data-testid^="conversation-turn-"], .conversation-turn, article') ??
    node.parentElement;

  const candidates: string[] = [];
  const appendCandidates = (root: HTMLElement | null): void => {
    if (root == null) {
      return;
    }

    const direct = root.getAttribute('data-host-message-id')?.trim() ?? root.getAttribute('data-message-id')?.trim();
    if (direct != null && direct.length > 0) {
      candidates.push(direct);
    }

    for (const descendant of root.querySelectorAll<HTMLElement>('[data-host-message-id], [data-message-id]')) {
      const messageId =
        descendant.getAttribute('data-host-message-id')?.trim() ??
        descendant.getAttribute('data-message-id')?.trim();
      if (messageId != null && messageId.length > 0) {
        candidates.push(messageId);
      }
    }
  };

  appendCandidates(node);
  if (turnContainer != null && turnContainer !== node) {
    appendCandidates(turnContainer);
  }

  let current = node.parentElement;
  while (current != null) {
    const ancestorId = current.getAttribute('data-host-message-id')?.trim() ?? current.getAttribute('data-message-id')?.trim();
    if (ancestorId != null && ancestorId.length > 0) {
      candidates.push(ancestorId);
    }
    for (const descendant of current.querySelectorAll<HTMLElement>('[data-host-message-id], [data-message-id]')) {
      const messageId =
        descendant.getAttribute('data-host-message-id')?.trim() ??
        descendant.getAttribute('data-message-id')?.trim();
      if (messageId != null && messageId.length > 0) {
        candidates.push(messageId);
      }
    }
    current = current.parentElement;
  }

  return resolvePreferredMessageId(...candidates);
}

function resolveRealMessageId(...candidates: Array<string | null | undefined>): string | null {
  const resolved = resolvePreferredMessageId(...candidates);
  if (resolved == null || isSyntheticMessageId(resolved)) {
    return null;
  }

  return resolved;
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

function getCandidateLabel(node: HTMLElement): string {
  return [
    node.getAttribute('aria-label'),
    node.getAttribute('title'),
    node.textContent,
  ]
    .filter((value): value is string => value != null && value.trim().length > 0)
    .join(' ')
    .trim();
}

function computeTurnContentRevision(
  node: HTMLElement,
  role: TurnRole,
  messageId: string | null,
  isStreaming: boolean,
): string {
  const hostMessageId = node.getAttribute('data-host-message-id')?.trim() ?? '';
  const busy = node.getAttribute('aria-busy') === 'true' ? '1' : '0';
  const childCount = node.childElementCount;
  const firstTag = node.firstElementChild?.tagName ?? '';
  const lastTag = node.lastElementChild?.tagName ?? '';
  return [role, messageId ?? '', hostMessageId, busy, isStreaming ? '1' : '0', String(childCount), firstTag, lastTag]
    .join('|');
}

function matchesHostActionCandidate(candidate: HTMLElement, action: ArchiveEntryAction): boolean {
  const testId = candidate.getAttribute('data-testid');
  if (testId != null && HOST_ACTION_TESTID_PATTERNS[action].some((pattern) => pattern.test(testId))) {
    return true;
  }

  const label = getCandidateLabel(candidate);
  return HOST_ACTION_LABEL_PATTERNS[action].some((pattern) => pattern.test(label));
}

function buildEntryTextSearchCandidates(entry: ManagedHistoryEntry): string[] {
  const rawCandidates = [
    resolveArchiveCopyText(entry),
    entry.text,
    ...entry.parts,
  ];

  const normalized = new Set<string>();
  for (const candidate of rawCandidates) {
    const text = candidate.replace(/\s+/g, ' ').trim();
    if (text.length === 0) {
      continue;
    }

    normalized.add(text);
    normalized.add(text.slice(0, 192).trim());
    normalized.add(text.slice(0, 128).trim());
    normalized.add(text.slice(0, 80).trim());
  }

  return [...normalized].filter((candidate) => candidate.length > 0);
}

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
  private anchoredHostMenu: {
    target: HTMLElement;
    menu: HTMLElement;
    previousInlineStyle: string | null;
  } | null = null;
  private pendingHostMoreActionRestore: (() => void) | null = null;
  private readonly readAloudConversationPayloadCache = new Map<string, ConversationPayload>();
  private readonly readAloudConversationSnapshotPrimed = new Set<string>();
  private readonly readAloudConversationSnapshotRequests = new Map<string, Promise<void>>();
  private readonly readAloudConversationSnapshotFailures = new Map<string, number>();
  private readAloudAccessToken: { value: string; expiresAt: number } | null = null;
  private readAloudAccessTokenRequest: Promise<string | null> | null = null;
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
    this.readAloudAccessToken = null;
    this.readAloudAccessTokenRequest = null;
  }

  private async resolveReadAloudAccessToken(): Promise<string | null> {
    const cached = this.readAloudAccessToken;
    if (cached != null && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (this.readAloudAccessTokenRequest != null) {
      return this.readAloudAccessTokenRequest;
    }

    const request = (async () => {
      try {
        const sessionUrl = new URL('/api/auth/session', this.win.location.origin);
        const response = await this.win.fetch(sessionUrl.toString(), {
          credentials: 'include',
        });
        if (!response.ok) {
          this.clearReadAloudAccessToken();
          return null;
        }

        const payload = (await response.json()) as {
          accessToken?: unknown;
          expires?: unknown;
        };
        const accessToken = typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';
        if (accessToken.length === 0) {
          this.clearReadAloudAccessToken();
          return null;
        }

        const expiresAt =
          typeof payload.expires === 'string'
            ? Math.min(Date.parse(payload.expires) - 60_000, Date.now() + 10 * 60_000)
            : Date.now() + 10 * 60_000;
        this.readAloudAccessToken = {
          value: accessToken,
          expiresAt: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + 60_000,
        };
        return accessToken;
      } catch {
        this.clearReadAloudAccessToken();
        return null;
      }
    })();

    this.readAloudAccessTokenRequest = request;
    try {
      return await request;
    } finally {
      if (this.readAloudAccessTokenRequest === request) {
        this.readAloudAccessTokenRequest = null;
      }
    }
  }

  private async buildReadAloudAuthorizationHeaders(): Promise<HeadersInit | undefined> {
    const accessToken = await this.resolveReadAloudAccessToken();
    return accessToken == null ? undefined : { Authorization: `Bearer ${accessToken}` };
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
        const headers = await this.buildReadAloudAuthorizationHeaders();
        const response = await this.win.fetch(snapshotUrl.toString(), {
          credentials: 'include',
          headers,
        });
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
    const bodyValue = this.doc.body?.dataset.turboRenderReadAloudResolvedMessageId?.trim() ?? '';
    if (bodyValue.length > 0) {
      return bodyValue;
    }

    const documentValue = this.doc.documentElement.dataset.turboRenderReadAloudResolvedMessageId?.trim() ?? '';
    if (documentValue.length > 0) {
      return documentValue;
    }

    return null;
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
    const now = this.win.performance.now();
    if (now < this.ignoreMutationsUntil || now < this.ignoreScrollUntil || this.scrollRefreshHandle != null) {
      return false;
    }

    const largeConversation = this.hasLargeConversation();
    const hasStructuralTurnChange = (nodes: Node[]): boolean =>
      nodes.some((node) => {
        if (!(node instanceof Element) || isTurboRenderUiNode(node)) {
          return false;
        }
        return (
          findClosestTurnNode(node) != null ||
          node.querySelector('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn') != null
        );
      });

    return mutations.some((mutation) => {
      if (mutation.target instanceof Element && isTurboRenderUiNode(mutation.target)) {
        return false;
      }

      if (mutation.type === 'attributes') {
        if (!(mutation.target instanceof Element)) {
          return false;
        }
        const turnRoot = findClosestTurnNode(mutation.target);
        if (turnRoot == null) {
          return false;
        }

        const attributeName = mutation.attributeName ?? '';
        if (attributeName === 'aria-busy') {
          return mutation.target === turnRoot || mutation.target.closest('[aria-busy]') === turnRoot;
        }
        if (attributeName === 'data-message-id' || attributeName === 'data-message-author-role') {
          return mutation.target === turnRoot;
        }
        if (attributeName === 'data-testid') {
          return (
            mutation.target === turnRoot ||
            mutation.target.matches('[data-testid^="conversation-turn-"], [data-testid="stop-button"]')
          );
        }
        return false;
      }

      if (mutation.type !== 'childList') {
        return false;
      }

      const targetTurn = findClosestTurnNode(mutation.target);
      if (targetTurn != null) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        const targetElement = mutation.target instanceof Element ? mutation.target : null;
        if (
          largeConversation &&
          targetElement != null &&
          targetElement !== targetTurn &&
          !targetElement.matches('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn') &&
          !hasStructuralTurnChange(changedNodes)
        ) {
          return false;
        }
        if (
          changedNodes.some((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              return (node.textContent?.trim().length ?? 0) > 0;
            }
            if (!(node instanceof Element)) {
              return false;
            }
            if (isTurboRenderUiNode(node)) {
              return false;
            }
            return true;
          })
        ) {
          return true;
        }

        return (
          targetElement != null &&
          (targetElement === targetTurn ||
            targetElement.matches('[data-testid^="conversation-turn-"], [data-message-author-role]'))
        );
      }

      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (largeConversation) {
        return hasStructuralTurnChange(changedNodes);
      }

      return hasStructuralTurnChange(changedNodes);
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
    if (this.shouldPreferHostMorePopover() && !this.isDebugReadAloudBackendEnabled()) {
      return false;
    }

    return this.isDebugReadAloudBackendEnabled() || this.getConversationIdForReadAloud() != null;
  }

  private shouldAllowLocalReadAloudFallback(): boolean {
    const hostname = this.doc.location.hostname;
    return (
      !(hostname === 'chatgpt.com' ||
      hostname.endsWith('.chatgpt.com') ||
      hostname === 'chat.openai.com' ||
      hostname.endsWith('.chat.openai.com'))
    );
  }

  private isDebugReadAloudBackendEnabled(): boolean {
    return (
      (this.win as Window & { __turboRenderDebugReadAloudBackend?: boolean }).__turboRenderDebugReadAloudBackend === true ||
      this.doc.documentElement.getAttribute('data-turbo-render-debug-read-aloud-backend') === '1' ||
      this.doc.body?.getAttribute('data-turbo-render-debug-read-aloud-backend') === '1' ||
      this.doc.documentElement.dataset.turboRenderDebugReadAloudBackend === '1' ||
      this.doc.body?.dataset.turboRenderDebugReadAloudBackend === '1'
    );
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
    (this.win as Window & { __turboRenderReadAloudContext?: typeof serialized }).__turboRenderReadAloudContext = serialized;

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

    if (this.doc.body != null) {
      for (const [key, value] of fields) {
        this.doc.body.dataset[key] = value;
      }
    }
    if (this.doc.documentElement != null) {
      for (const [key, value] of fields) {
        this.doc.documentElement.dataset[key] = value;
      }
    }
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
    const debugConversationId =
      (this.win as Window & { __turboRenderDebugConversationId?: string }).__turboRenderDebugConversationId ??
      this.doc.body?.dataset.turboRenderDebugConversationId ??
      this.doc.documentElement.dataset.turboRenderDebugConversationId ??
      null;
    if (debugConversationId != null && debugConversationId.trim().length > 0) {
      return debugConversationId.trim();
    }

    return (
      getRouteIdFromRuntimeId(getChatIdFromPathname(this.doc.location?.pathname ?? '/')) ??
      getRouteIdFromRuntimeId(this.chatId) ??
      this.initialTrimSession?.conversationId ??
      null
    );
  }

  private buildReadAloudUrl(entry: ManagedHistoryEntry, groupId: string | null = null): string | null {
    const debugUrl =
      (this.win as Window & { __turboRenderDebugReadAloudUrl?: string }).__turboRenderDebugReadAloudUrl ??
      this.doc.documentElement.getAttribute('data-turbo-render-debug-read-aloud-url') ??
      this.doc.body?.getAttribute('data-turbo-render-debug-read-aloud-url') ??
      this.doc.body?.dataset.turboRenderDebugReadAloudUrl ??
      this.doc.documentElement.dataset.turboRenderDebugReadAloudUrl ??
      null;
    if (debugUrl != null && debugUrl.trim().length > 0) {
      return debugUrl.trim();
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

    const url = new URL('/backend-api/synthesize', this.win.location.origin);
    url.searchParams.set('message_id', messageId);
    url.searchParams.set('conversation_id', conversationId);
    url.searchParams.set('voice', 'cove');
    url.searchParams.set('format', 'aac');
    return url.toString();
  }

  private buildDirectReadAloudUrl(conversationId: string, messageId: string): string {
    const url = new URL('/backend-api/synthesize', this.win.location.origin);
    url.searchParams.set('message_id', messageId);
    url.searchParams.set('conversation_id', conversationId);
    url.searchParams.set('voice', 'cove');
    url.searchParams.set('format', 'aac');
    return url.toString();
  }

  private findParkedMessageIdForEntry(groupId: string | null, entry: ManagedHistoryEntry): string | null {
    if (groupId == null) {
      return null;
    }

    const parkedGroup = this.parkingLot.getGroup(groupId);
    if (parkedGroup == null || parkedGroup.nodes.length === 0) {
      return null;
    }

    const archiveGroup = this.collectArchiveState().currentPageGroups.find((group) => group.id === groupId) ?? null;
    if (archiveGroup == null) {
      return null;
    }
    const entryIndex = archiveGroup?.entries.findIndex((candidate) => candidate.id === entry.id) ?? -1;
    if (entryIndex >= 0) {
      const indexedMessageId = parkedGroup.messageIds[entryIndex] ?? null;
      if (indexedMessageId != null && indexedMessageId.length > 0 && !isSyntheticMessageId(indexedMessageId)) {
        return indexedMessageId;
      }
    }

    for (const messageId of parkedGroup.messageIds) {
      if (messageId != null && messageId.length > 0 && !isSyntheticMessageId(messageId)) {
        return messageId;
      }
    }

    const candidates: HTMLElement[] = [];
    if (entryIndex >= 0 && entryIndex < parkedGroup.nodes.length) {
      const indexedCandidate = parkedGroup.nodes[entryIndex];
      if (indexedCandidate != null) {
        candidates.push(indexedCandidate);
      }
    }

    candidates.push(...parkedGroup.nodes);
    for (const candidate of candidates) {
      const messageId = resolveMessageId(candidate);
      if (messageId != null && messageId.length > 0 && !isSyntheticMessageId(messageId)) {
        return messageId;
      }
    }

    return null;
  }

  private findRenderedArchiveMessageIdForEntry(groupId: string | null, entry: ManagedHistoryEntry): string | null {
    if (groupId == null || this.statusBar == null) {
      return null;
    }

    const actionAnchor = this.statusBar.getEntryActionAnchor(groupId, entry.id);
    const entryFrame =
      actionAnchor?.closest<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryFrame}`) ??
      actionAnchor ??
      null;
    const entryRoot =
      entryFrame ??
      actionAnchor?.closest<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`) ??
      null;
    if (entryRoot == null) {
      return null;
    }

    const candidates: string[] = [];
    const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
    if (role != null) {
      for (const descendant of entryRoot.querySelectorAll<HTMLElement>(
        `[data-message-author-role="${role}"][data-host-message-id], [data-message-author-role="${role}"][data-message-id]`,
      )) {
        const messageId =
          descendant.getAttribute('data-host-message-id')?.trim() ??
          descendant.getAttribute('data-message-id')?.trim();
        if (messageId != null && messageId.length > 0) {
          candidates.push(messageId);
        }
      }
    }

    const direct = entryRoot.getAttribute('data-host-message-id')?.trim() ?? entryRoot.getAttribute('data-message-id')?.trim();
    if (direct != null && direct.length > 0) {
      candidates.push(direct);
    }

    for (const descendant of entryRoot.querySelectorAll<HTMLElement>('[data-host-message-id], [data-message-id]')) {
      const messageId =
        descendant.getAttribute('data-host-message-id')?.trim() ??
        descendant.getAttribute('data-message-id')?.trim();
      if (messageId != null && messageId.length > 0) {
        candidates.push(messageId);
      }
    }

    const messageId = resolveRealMessageId(...candidates);
    if (messageId == null || messageId.length === 0 || isSyntheticMessageId(messageId)) {
      return null;
    }

    return messageId;
  }

  private findHostMessageIdForEntry(
    entry: ManagedHistoryEntry,
    groupId: string | null = null,
    archiveGroupOverride: ManagedHistoryGroup | null = null,
  ): string | null {
    const scope = this.doc.body ?? this.turnContainer ?? this.historyMountTarget;
    if (scope == null) {
      return null;
    }

    const record = this.getRecordForEntry(entry);
    const targetIndex = record?.index ?? entry.turnIndex;
    const normalizedEntryTexts = buildEntryTextSearchCandidates(entry).map((candidate) => this.normalizeEntryText(candidate));
    if (normalizedEntryTexts.length === 0) {
      return null;
    }

    const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
    const syntheticTurnIndex = resolveSyntheticTurnIndex(
      entry.messageId,
      entry.turnId,
      record?.messageId,
      record?.id,
    );
    const archiveGroup =
      archiveGroupOverride ??
      (groupId != null
        ? this.collectArchiveState().currentPageGroups.find((candidate) => candidate.id === groupId) ?? null
        : null);
    const archiveTurnOffset = this.initialTrimSession?.archivedTurnCount ?? 0;
    const setHostReadAloudDebug = (debug: {
      precisePairId?: string | null;
      preciseTargetId?: string | null;
      turnPairId?: string | null;
      turnTargetId?: string | null;
      selectedSource?: string | null;
      selectedId?: string | null;
    }): void => {
      const fields: Array<[string, string | null | undefined]> = [
        ['turboRenderDebugReadAloudHostPrecisePairId', debug.precisePairId],
        ['turboRenderDebugReadAloudHostPreciseTargetId', debug.preciseTargetId],
        ['turboRenderDebugReadAloudHostTurnPairId', debug.turnPairId],
        ['turboRenderDebugReadAloudHostTurnTargetId', debug.turnTargetId],
        ['turboRenderDebugReadAloudHostSelectedSource', debug.selectedSource],
        ['turboRenderDebugReadAloudHostSelectedId', debug.selectedId],
      ];

      if (this.doc.body != null) {
        for (const [key, value] of fields) {
          this.doc.body.dataset[key] = value ?? '';
        }
      }
      if (this.doc.documentElement != null) {
        for (const [key, value] of fields) {
          this.doc.documentElement.dataset[key] = value ?? '';
        }
      }
    };

    const getCandidateMessageId = (candidate: HTMLElement | null, preferDescendants = false): string | null => {
      if (candidate == null || isTurboRenderUiNode(candidate)) {
        return null;
      }

      const descendantMessageIds = [...candidate.querySelectorAll<HTMLElement>(
        'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id], article[data-message-author-role][data-host-message-id], article[data-message-author-role][data-message-id]',
      )]
        .map((descendant) =>
          descendant.getAttribute('data-host-message-id')?.trim() ??
          descendant.getAttribute('data-message-id')?.trim() ??
          '',
        )
        .filter((messageId) => messageId.length > 0 && !isSyntheticMessageId(messageId));
      const directMessageId = candidate.getAttribute('data-host-message-id')?.trim() ?? candidate.getAttribute('data-message-id')?.trim() ?? '';

      if (preferDescendants) {
        if (descendantMessageIds.length > 0) {
          return descendantMessageIds[0]!;
        }
        if (directMessageId.length > 0 && !isSyntheticMessageId(directMessageId)) {
          return directMessageId;
        }
      } else {
        if (directMessageId.length > 0 && !isSyntheticMessageId(directMessageId)) {
          return directMessageId;
        }
        if (descendantMessageIds.length > 0) {
          return descendantMessageIds[0]!;
        }
      }

      const resolvedMessageId = resolveMessageId(candidate);
      if (resolvedMessageId != null && resolvedMessageId.length > 0 && !isSyntheticMessageId(resolvedMessageId)) {
        return resolvedMessageId;
      }

      return null;
    };

    if (syntheticTurnIndex != null) {
      const syntheticTurnOffset =
        archiveTurnOffset + (archiveGroup != null ? archiveGroup.pairStartIndex * 2 + syntheticTurnIndex : syntheticTurnIndex);
      const directTurnCandidates = [...scope.querySelectorAll<HTMLElement>(
        '[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn, article',
      )].filter((candidate) => !isTurboRenderUiNode(candidate));
      const indexedCandidate = directTurnCandidates[syntheticTurnOffset] ?? null;
      const indexedMessageId = getCandidateMessageId(indexedCandidate, true);
      if (indexedMessageId != null) {
        setHostReadAloudDebug({
          turnTargetId: indexedMessageId,
          selectedSource: 'turn-index',
          selectedId: indexedMessageId,
        });
        return indexedMessageId;
      }

      const directTextMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
        'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id]',
      )].filter((candidate) => !isTurboRenderUiNode(candidate));
      const indexedTextCandidate = directTextMessageCandidates[syntheticTurnOffset] ?? null;
      const indexedTextMessageId = getCandidateMessageId(indexedTextCandidate, true);
      if (indexedTextMessageId != null) {
        setHostReadAloudDebug({
          turnTargetId: indexedTextMessageId,
          selectedSource: 'turn-index-text',
          selectedId: indexedTextMessageId,
        });
        return indexedTextMessageId;
      }
    }

    const textMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
      'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id]',
    )].filter((candidate) => !isTurboRenderUiNode(candidate));
    const articleMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
      'article[data-message-author-role][data-host-message-id], article[data-message-author-role][data-message-id]',
    )].filter((candidate) => !isTurboRenderUiNode(candidate));
    const genericMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
      '[data-message-author-role][data-host-message-id], [data-message-author-role][data-message-id]',
    )].filter((candidate) => !isTurboRenderUiNode(candidate));

    const preciseCandidateGroups = [
      textMessageCandidates,
      articleMessageCandidates,
      genericMessageCandidates,
    ];

    for (const candidates of preciseCandidateGroups) {
      const roleSpecificPreciseCandidates =
        role == null
          ? candidates
          : candidates.filter((candidate) => candidate.getAttribute('data-message-author-role') === role);

      const precisePairCandidate = roleSpecificPreciseCandidates[entry.pairIndex] ?? null;
      const precisePairMessageId = getCandidateMessageId(precisePairCandidate);
      if (precisePairMessageId != null) {
        setHostReadAloudDebug({
          precisePairId: precisePairMessageId,
          selectedSource: 'precise-pair',
          selectedId: precisePairMessageId,
        });
        return precisePairMessageId;
      }

      const preciseIndexedCandidate = roleSpecificPreciseCandidates[targetIndex] ?? null;
      const preciseIndexedMessageId = getCandidateMessageId(preciseIndexedCandidate);
      if (preciseIndexedMessageId != null) {
        setHostReadAloudDebug({
          preciseTargetId: preciseIndexedMessageId,
          selectedSource: 'precise-target',
          selectedId: preciseIndexedMessageId,
        });
        return preciseIndexedMessageId;
      }

      for (const candidate of roleSpecificPreciseCandidates) {
        const candidateText = this.normalizeEntryText(candidate.textContent ?? '');
        if (candidateText.length === 0) {
          continue;
        }

        for (const normalizedEntryText of normalizedEntryTexts) {
          const sharedPrefix = normalizedEntryText.slice(0, 48);
        if (
          candidateText === normalizedEntryText ||
          candidateText.includes(normalizedEntryText) ||
          normalizedEntryText.includes(candidateText) ||
          (sharedPrefix.length > 0 &&
            (candidateText.startsWith(sharedPrefix) || normalizedEntryText.startsWith(candidateText.slice(0, 48))))
        ) {
          const messageId = getCandidateMessageId(candidate);
          if (messageId != null) {
            setHostReadAloudDebug({
              selectedSource: 'precise-text',
              selectedId: messageId,
            });
            return messageId;
          }
        }
      }
      }
    }

    const turnCandidates = [...scope.querySelectorAll<HTMLElement>(
      '[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn, article',
    )].filter((candidate) => !isTurboRenderUiNode(candidate));

    const roleSpecificTurnCandidates =
      role == null
        ? turnCandidates
        : turnCandidates.filter((candidate) => candidate.getAttribute('data-message-author-role') === role);

    const directTurnCandidate = role != null ? roleSpecificTurnCandidates[entry.pairIndex] ?? null : null;
    const directTurnMessageId = getCandidateMessageId(directTurnCandidate, true);
    if (directTurnMessageId != null) {
      setHostReadAloudDebug({
        turnPairId: directTurnMessageId,
        selectedSource: 'turn-pair',
        selectedId: directTurnMessageId,
      });
      return directTurnMessageId;
    }

    const turnIndexedCandidate = roleSpecificTurnCandidates[targetIndex] ?? null;
    const turnIndexedMessageId = getCandidateMessageId(turnIndexedCandidate, true);
    if (turnIndexedMessageId != null) {
      setHostReadAloudDebug({
        turnTargetId: turnIndexedMessageId,
        selectedSource: 'turn-target',
        selectedId: turnIndexedMessageId,
      });
      return turnIndexedMessageId;
    }

    for (const candidate of roleSpecificTurnCandidates) {
      const candidateText = this.normalizeEntryText(candidate.textContent ?? '');
      if (candidateText.length === 0) {
        continue;
      }

      for (const normalizedEntryText of normalizedEntryTexts) {
        const sharedPrefix = normalizedEntryText.slice(0, 48);
        if (
          candidateText === normalizedEntryText ||
          candidateText.includes(normalizedEntryText) ||
          normalizedEntryText.includes(candidateText) ||
          (sharedPrefix.length > 0 &&
            (candidateText.startsWith(sharedPrefix) || normalizedEntryText.startsWith(candidateText.slice(0, 48))))
        ) {
          const messageId = getCandidateMessageId(candidate, true);
          if (messageId != null) {
            setHostReadAloudDebug({
              selectedSource: 'turn-text',
              selectedId: messageId,
            });
            return messageId;
          }
        }
      }
    }

    setHostReadAloudDebug({});
    return null;
  }

  private normalizeEntryText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private doesHostActionButtonMatchEntry(candidate: HTMLElement, entry: ManagedHistoryEntry): boolean {
    if (isTurboRenderUiNode(candidate)) {
      return false;
    }

    const expectedRole =
      entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null;
    const normalizedEntryTexts = buildEntryTextSearchCandidates(entry)
      .map((value) => this.normalizeEntryText(value))
      .filter((value) => value.length > 0);
    if (normalizedEntryTexts.length === 0) {
      return false;
    }

    const scopes = [
      candidate.closest<HTMLElement>('[data-message-author-role]'),
      candidate.closest<HTMLElement>('[data-testid^="conversation-turn-"]'),
      candidate.closest<HTMLElement>('.agent-turn'),
      candidate.closest<HTMLElement>('article'),
      candidate.parentElement,
    ].filter((value, index, values): value is HTMLElement => value != null && values.indexOf(value) === index);

    for (const scope of scopes) {
      const role = scope.getAttribute('data-message-author-role');
      if (expectedRole != null && role != null && role !== expectedRole) {
        continue;
      }

      const candidateText = this.normalizeEntryText(scope.textContent ?? '');
      if (candidateText.length === 0) {
        continue;
      }

      for (const normalizedEntryText of normalizedEntryTexts) {
        const sharedPrefix = normalizedEntryText.slice(0, 48);
        if (
          candidateText === normalizedEntryText ||
          candidateText.includes(normalizedEntryText) ||
          normalizedEntryText.includes(candidateText) ||
          (sharedPrefix.length > 0 &&
            (candidateText.startsWith(sharedPrefix) ||
              normalizedEntryText.startsWith(candidateText.slice(0, 48))))
        ) {
          return true;
        }
      }
    }

    return false;
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

  private resolveReadAloudStreamMimeType(response: Response): string | null {
    const MediaSourceCtor = (this.win as Window & { MediaSource?: typeof MediaSource }).MediaSource;
    if (MediaSourceCtor == null || typeof MediaSourceCtor.isTypeSupported !== 'function') {
      return null;
    }

    const responseType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const candidates = [
      responseType,
      responseType === 'audio/aac' ? 'audio/aac' : '',
      responseType.includes('aac') ? 'audio/mp4; codecs="mp4a.40.2"' : '',
      responseType === 'audio/mpeg' ? 'audio/mpeg' : '',
    ].filter((candidate): candidate is string => candidate.length > 0);

    for (const candidate of [...new Set(candidates)]) {
      if (MediaSourceCtor.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private waitForMediaSourceOpen(mediaSource: MediaSource): Promise<boolean> {
    if (mediaSource.readyState === 'open') {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;
      const timeout = this.win.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        mediaSource.removeEventListener('sourceopen', onOpen);
        resolve(false);
      }, 3000);
      const onOpen = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.win.clearTimeout(timeout);
        resolve(true);
      };
      mediaSource.addEventListener('sourceopen', onOpen);
    });
  }

  private appendReadAloudChunk(sourceBuffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
    if (chunk.byteLength === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        sourceBuffer.removeEventListener('updateend', onUpdateEnd);
        sourceBuffer.removeEventListener('error', onError);
      };
      const onUpdateEnd = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('read aloud source buffer append failed'));
      };
      sourceBuffer.addEventListener('updateend', onUpdateEnd);
      sourceBuffer.addEventListener('error', onError);
      try {
        const buffer = new Uint8Array(chunk.byteLength);
        buffer.set(chunk);
        sourceBuffer.appendBuffer(buffer.buffer);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private cleanupUnusedReadAloudObjectUrl(audio: HTMLAudioElement, objectUrl: string): void {
    if (this.entryActionReadAloudObjectUrl === objectUrl) {
      this.entryActionReadAloudObjectUrl = null;
    }
    audio.removeAttribute('src');
    try {
      audio.load();
    } catch {
      // Ignore load failures in detached/test contexts.
    }
    URL.revokeObjectURL(objectUrl);
  }

  private async tryStreamReadAloudResponse(
    response: Response,
    audio: HTMLAudioElement,
    entryKey: string,
    generation: number,
  ): Promise<boolean> {
    const stream = response.body;
    const mimeType = this.resolveReadAloudStreamMimeType(response);
    const MediaSourceCtor = (this.win as Window & { MediaSource?: typeof MediaSource }).MediaSource;
    if (stream == null || mimeType == null || MediaSourceCtor == null) {
      this.setReadAloudStreamingDebug('unsupported');
      return false;
    }

    const mediaSource = new MediaSourceCtor();
    const objectUrl = URL.createObjectURL(mediaSource);
    this.entryActionReadAloudObjectUrl = objectUrl;
    audio.src = objectUrl;
    audio.load();

    const opened = await this.waitForMediaSourceOpen(mediaSource);
    if (!opened || this.entryActionReadAloudGeneration !== generation) {
      this.cleanupUnusedReadAloudObjectUrl(audio, objectUrl);
      return false;
    }

    let sourceBuffer: SourceBuffer;
    try {
      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    } catch {
      this.cleanupUnusedReadAloudObjectUrl(audio, objectUrl);
      this.setReadAloudStreamingDebug('unsupported');
      return false;
    }

    const reader = stream.getReader();
    let started = false;
    this.setReadAloudStreamingDebug('1');
    audio.dataset.turboRenderReadAloudMode = 'backend-stream';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (this.entryActionReadAloudGeneration !== generation || this.entryActionSpeakingEntryKey !== entryKey) {
          await reader.cancel().catch(() => undefined);
          return true;
        }
        if (done) {
          break;
        }
        if (value == null || value.byteLength === 0) {
          continue;
        }
        await this.appendReadAloudChunk(sourceBuffer, value);
        if (!started) {
          started = true;
          await audio.play();
        }
      }

      if (!started) {
        this.clearReadAloudPlayback({ updateStatusBar: true });
        return true;
      }
      if (mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }
      return true;
    } catch {
      if (this.entryActionReadAloudGeneration !== generation || this.entryActionSpeakingEntryKey !== entryKey) {
        return true;
      }
      this.setReadAloudStreamingDebug('error');
      this.clearReadAloudPlayback({ updateStatusBar: true });
      return true;
    } finally {
      reader.releaseLock();
    }
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
        const headers = await this.buildReadAloudAuthorizationHeaders();
        const response = await this.win.fetch(backendUrl, {
          credentials: 'include',
          headers,
          signal: abortController.signal,
        });
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
        if (await this.tryStreamReadAloudResponse(response, audio, entryKey, generation)) {
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
      this.toggleEntryActionMenu(group.id, entryKey, entry.role === 'user' ? 'user' : 'assistant');
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
      openedMore = await this.clickHostArchiveAction(groupId, entry, 'more', anchorGetter, {
        allowBroadMoreFallback: true,
      });
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
    return new Promise((resolve) => {
      const observeRoot = this.doc.body ?? this.doc.documentElement;
      let settled = false;
      let timeoutHandle: number | null = null;
      let frameHandle: number | null = null;
      let observer: MutationObserver | null = null;

      const cleanup = (): void => {
        if (timeoutHandle != null) {
          this.win.clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (frameHandle != null) {
          cancelAnimationFrameCompat(this.win, frameHandle);
          frameHandle = null;
        }
        observer?.disconnect();
        observer = null;
      };

      const settle = (menu: HTMLElement | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(menu);
      };

      const probe = (): boolean => {
        const menu = this.findPreferredHostMenu(previousMenus, anchorGetter());
        if (menu == null) {
          return false;
        }
        settle(menu);
        return true;
      };

      const scheduleFrameProbe = (): void => {
        if (settled) {
          return;
        }
        frameHandle = requestAnimationFrameCompat(this.win, () => {
          frameHandle = null;
          if (!probe()) {
            scheduleFrameProbe();
          }
        });
      };

      if (observeRoot != null && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => {
          probe();
        });
        observer.observe(observeRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state'],
        });
      }

      timeoutHandle = this.win.setTimeout(() => {
        settle(null);
      }, timeoutMs);

      if (!probe()) {
        scheduleFrameProbe();
      }
    });
  }

  private waitForHostMoreMenuAction(
    previousMenus: Set<HTMLElement>,
    anchorGetter: () => HTMLElement | null,
    action: EntryMoreMenuAction,
    timeoutMs: number,
  ): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
      const observeRoot = this.doc.body ?? this.doc.documentElement;
      let settled = false;
      let timeoutHandle: number | null = null;
      let frameHandle: number | null = null;
      let observer: MutationObserver | null = null;

      const cleanup = (): void => {
        if (timeoutHandle != null) {
          this.win.clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (frameHandle != null) {
          cancelAnimationFrameCompat(this.win, frameHandle);
          frameHandle = null;
        }
        observer?.disconnect();
        observer = null;
      };

      const settle = (target: HTMLElement | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(target);
      };

      const probe = (): boolean => {
        const menu = this.findPreferredHostMenu(previousMenus, anchorGetter());
        const menuAction = menu != null ? this.findHostMoreMenuAction(menu, action) : null;
        if (menuAction == null) {
          return false;
        }
        settle(menuAction);
        return true;
      };

      const scheduleFrameProbe = (): void => {
        if (settled) {
          return;
        }
        frameHandle = requestAnimationFrameCompat(this.win, () => {
          frameHandle = null;
          if (!probe()) {
            scheduleFrameProbe();
          }
        });
      };

      if (observeRoot != null && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => {
          probe();
        });
        observer.observe(observeRoot, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state'],
        });
      }

      timeoutHandle = this.win.setTimeout(() => {
        settle(null);
      }, timeoutMs);

      if (!probe()) {
        scheduleFrameProbe();
      }
    });
  }

  private async clickHostReadAloudStopButton(): Promise<boolean> {
    if (!this.shouldUseHostActionClicks()) {
      return false;
    }

    return this.runWithSuppressedEntryActionMenuDismissal(async () => {
      const waitUntil = this.win.performance.now() + 4_000;
      let stopButton: HTMLElement | undefined;
      while (this.win.performance.now() < waitUntil) {
        const exactSelectors = [
          'button[data-testid="voice-stop-turn-action-button"]',
          'button[data-testid="stop-read-aloud-turn-action-button"]',
          '[role="menuitem"][data-testid="voice-play-turn-action-button"]',
          '[role="menuitem"][aria-label="停止"]',
        ];
        stopButton = exactSelectors
          .flatMap((selector) => [...this.doc.querySelectorAll<HTMLElement>(selector)])
          .find(
            (candidate): candidate is HTMLElement =>
              candidate != null &&
              !isTurboRenderUiNode(candidate) &&
              candidate.getClientRects().length > 0,
          );

        if (stopButton == null) {
          const labelPatterns = [/stop reading/i, /stop read aloud/i, /停止朗读/i, /停止阅读/i];
          stopButton = [...this.doc.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitem"], a')]
            .find((candidate) => {
              if (isTurboRenderUiNode(candidate)) {
                return false;
              }
              if (candidate.getClientRects().length <= 0) {
                return false;
              }

              const label = [
                candidate.getAttribute('aria-label'),
                candidate.getAttribute('title'),
                candidate.textContent,
              ]
                .filter((value): value is string => value != null && value.trim().length > 0)
                .join(' ')
                .trim();

              return labelPatterns.some((pattern) => pattern.test(label));
            }) as HTMLElement | undefined;
        }

        if (stopButton != null) {
          break;
        }

        await new Promise<void>((resolve) => {
          requestAnimationFrameCompat(this.win, () => resolve());
        });
      }

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
    return [...this.doc.querySelectorAll<HTMLElement>('[role="menu"]')].filter((candidate) => {
      if (isTurboRenderUiNode(candidate)) {
        return false;
      }
      if (candidate.getClientRects().length <= 0) {
        return false;
      }
      const style = this.win.getComputedStyle(candidate);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  private findPreferredHostMenu(previousMenus: Set<HTMLElement>, anchor: HTMLElement | null): HTMLElement | null {
    const menus = this.getVisibleHostMenus();
    const candidatePools = [
      menus.filter((menu) => !previousMenus.has(menu)),
      menus,
    ];

    for (const pool of candidatePools) {
      if (pool.length === 0) {
        continue;
      }

      if (anchor == null) {
        return pool[0] ?? null;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const scored = pool
        .map((menu) => {
          const rect = this.resolveHostMenuPositionTarget(menu).getBoundingClientRect();
          const leftDelta = Math.abs(rect.left - anchorRect.left);
          const verticalDelta = Math.abs(rect.bottom - anchorRect.top);
          const score = leftDelta + verticalDelta * 2;
          return { menu, score };
        })
        .sort((left, right) => left.score - right.score);

      if ((scored[0]?.menu ?? null) != null) {
        return scored[0]!.menu;
      }
    }

    return null;
  }

  private temporarilyAnchorHostActionTarget(target: HTMLElement, anchor: HTMLElement): (() => void) | null {
    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.width <= 0 || anchorRect.height <= 0) {
      return null;
    }

    const previousStyle = target.getAttribute('style');
    target.style.setProperty('position', 'fixed', 'important');
    target.style.setProperty('left', `${Math.round(anchorRect.left)}px`, 'important');
    target.style.setProperty('top', `${Math.round(anchorRect.top)}px`, 'important');
    target.style.setProperty('width', `${Math.max(1, Math.round(anchorRect.width))}px`, 'important');
    target.style.setProperty('height', `${Math.max(1, Math.round(anchorRect.height))}px`, 'important');
    target.style.setProperty('right', 'auto', 'important');
    target.style.setProperty('bottom', 'auto', 'important');
    target.style.setProperty('margin', '0', 'important');
    target.style.setProperty('transform', 'none', 'important');
    target.style.setProperty('opacity', '0', 'important');
    target.style.setProperty('pointer-events', 'none', 'important');
    target.style.setProperty('z-index', '-1', 'important');

    return () => {
      if (previousStyle == null || previousStyle.length === 0) {
        target.removeAttribute('style');
      } else {
        target.setAttribute('style', previousStyle);
      }
    };
  }

  private scheduleHostActionTargetRestore(restore: () => void, frames: number): void {
    if (frames <= 0) {
      restore();
      return;
    }

    const step = (remaining: number): void => {
      if (remaining <= 0) {
        restore();
        return;
      }

      requestAnimationFrameCompat(this.win, () => {
        step(remaining - 1);
      });
    };

    step(frames);
  }

  private clearPendingHostMoreActionRestore(): void {
    const restore = this.pendingHostMoreActionRestore;
    this.pendingHostMoreActionRestore = null;
    restore?.();
  }

  private resolveHostMenuPositionTarget(menu: HTMLElement): HTMLElement {
    const wrapper = menu.closest<HTMLElement>('[data-radix-popper-content-wrapper]');
    if (wrapper != null && !isTurboRenderUiNode(wrapper)) {
      return wrapper;
    }
    return menu;
  }

  private positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const positionTarget = this.resolveHostMenuPositionTarget(menu);
    const menuRect = positionTarget.getBoundingClientRect();
    if (anchorRect.width <= 0 || anchorRect.height <= 0 || menuRect.width <= 0 || menuRect.height <= 0) {
      return;
    }

    const gap = 8;
    const viewportPadding = 8;
    const topChromeOffset = this.statusBar?.getTopPageChromeOffset?.() ?? 0;
    const topLimit = Math.max(viewportPadding, topChromeOffset + viewportPadding);
    const viewportLeft = anchorRect.left;
    const aboveTop = anchorRect.top - menuRect.height - gap;
    const belowTop = anchorRect.bottom + gap;
    const spaceAbove = anchorRect.top - topLimit;
    const placeAbove = spaceAbove >= menuRect.height + gap;
    const viewportTop = placeAbove ? Math.max(topLimit, aboveTop) : belowTop;

    this.captureAnchoredHostMenuStyle(positionTarget, menu);
    positionTarget.style.setProperty('position', 'fixed', 'important');
    positionTarget.style.setProperty('inset', 'auto', 'important');
    positionTarget.style.setProperty('left', `${Math.round(viewportLeft)}px`, 'important');
    positionTarget.style.setProperty('top', `${Math.round(viewportTop)}px`, 'important');
    positionTarget.style.setProperty('right', 'auto', 'important');
    positionTarget.style.setProperty('bottom', 'auto', 'important');
    positionTarget.style.setProperty('transform', 'none', 'important');
    positionTarget.style.setProperty('margin', '0', 'important');
    positionTarget.style.setProperty('z-index', '60', 'important');
    positionTarget.dataset.turboRenderHostMenuAnchored = 'true';
    positionTarget.dataset.turboRenderHostMenuPlacement = placeAbove ? 'above' : 'below';
    menu.dataset.turboRenderHostMenuAnchored = 'true';
    menu.dataset.turboRenderHostMenuPlacement = placeAbove ? 'above' : 'below';
  }

  private captureAnchoredHostMenuStyle(target: HTMLElement, menu: HTMLElement): void {
    if (this.anchoredHostMenu?.target === target) {
      return;
    }
    this.restoreAnchoredHostMenuStyle();
    this.anchoredHostMenu = {
      target,
      menu,
      previousInlineStyle: target.getAttribute('style'),
    };
  }

  private restoreAnchoredHostMenuStyle(): void {
    const anchored = this.anchoredHostMenu;
    this.anchoredHostMenu = null;
    if (anchored == null) {
      return;
    }

    const { target, menu, previousInlineStyle } = anchored;
    delete target.dataset.turboRenderHostMenuAnchored;
    delete target.dataset.turboRenderHostMenuPlacement;
    delete menu.dataset.turboRenderHostMenuAnchored;
    delete menu.dataset.turboRenderHostMenuPlacement;
    if (previousInlineStyle == null || previousInlineStyle.length === 0) {
      target.removeAttribute('style');
    } else {
      target.setAttribute('style', previousInlineStyle);
    }
  }

  private findHostMoreMenuAction(menu: ParentNode, action: EntryMoreMenuAction): HTMLElement | null {
    const exactSelectors =
      action === 'branch'
        ? [
            'button[data-testid="branch-in-new-chat-turn-action-button"]',
            '[role="menuitem"][data-testid="branch-in-new-chat-turn-action-button"]',
            '[data-testid="branch-in-new-chat-turn-action-button"]',
          ]
        : action === 'stop-read-aloud'
          ? [
              '[role="menuitem"][data-testid="voice-play-turn-action-button"]',
              '[role="menuitem"][aria-label="停止"]',
              'button[data-testid="voice-stop-turn-action-button"]',
              'button[data-testid="stop-read-aloud-turn-action-button"]',
              'div[data-testid="voice-play-turn-action-button"]',
              'div[data-testid="stop-read-aloud-turn-action-button"]',
            ]
          : [
            'button[data-testid="voice-play-turn-action-button"]',
            'button[data-testid="read-aloud-turn-action-button"]',
            '[role="menuitem"][data-testid="voice-play-turn-action-button"]',
            '[role="menuitem"][data-testid="read-aloud-turn-action-button"]',
            'div[data-testid="voice-play-turn-action-button"]',
            'div[data-testid="read-aloud-turn-action-button"]',
          ];
    const exactMatch = exactSelectors
      .map((selector) => menu.querySelector<HTMLElement>(selector))
      .find((candidate): candidate is HTMLElement => candidate != null && !isTurboRenderUiNode(candidate));
    if (exactMatch != null) {
      return exactMatch;
    }

    const labelPatterns =
      action === 'branch'
        ? [/branch in new chat/i, /new chat/i, /分支到新聊天/i]
        : action === 'stop-read-aloud'
          ? [/stop reading/i, /stop read aloud/i, /停止朗读/i]
          : [/read aloud/i, /朗读/i];

    return (
      [...menu.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="button"], a')].find((candidate) => {
        if (isTurboRenderUiNode(candidate)) {
          return false;
        }

        const label = [
          candidate.getAttribute('aria-label'),
          candidate.getAttribute('title'),
          candidate.textContent,
        ]
          .filter((value): value is string => value != null && value.trim().length > 0)
          .join(' ')
          .trim();

        return labelPatterns.some((pattern) => pattern.test(label));
      }) ?? null
    );
  }

  private readHostEntryActionSelection(
    groupId: string,
    entry: ManagedHistoryEntry,
  ): { matched: boolean; selection: EntryActionSelection | null } {
    const searchRoots = this.collectHostSearchRootsForEntry(groupId, entry);
    if (searchRoots.length === 0) {
      return { matched: false, selection: null };
    }

    const likeButton = searchRoots
      .map((root) => findHostActionButton(root, 'like'))
      .find((candidate): candidate is HTMLElement => candidate != null && !isTurboRenderUiNode(candidate));
    const dislikeButton = searchRoots
      .map((root) => findHostActionButton(root, 'dislike'))
      .find((candidate): candidate is HTMLElement => candidate != null && !isTurboRenderUiNode(candidate));

    if (likeButton == null && dislikeButton == null) {
      return { matched: false, selection: null };
    }

    const isPressed = (candidate: HTMLElement | undefined): boolean => {
      if (candidate == null) {
        return false;
      }

      return (
        candidate.getAttribute('aria-pressed') === 'true' ||
        candidate.classList.contains('text-token-text-primary') ||
        candidate.dataset.state === 'on'
      );
    };

    if (isPressed(likeButton)) {
      return { matched: true, selection: 'like' };
    }
    if (isPressed(dislikeButton)) {
      return { matched: true, selection: 'dislike' };
    }

    return { matched: true, selection: null };
  }

  private dispatchHumanClick(target: HTMLElement): void {
    if (this.dispatchReactLikeClick(target)) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    const dispatchPointer = (type: string, buttons: number): void => {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      } as PointerEventInit;
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent(type, eventInit));
        return;
      }
      target.dispatchEvent(new MouseEvent(type, eventInit));
    };

    dispatchPointer('pointerover', 0);
    dispatchPointer('pointerenter', 0);
    target.dispatchEvent(
      new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 0,
      }),
    );
    target.dispatchEvent(
      new MouseEvent('mouseenter', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 0,
      }),
    );
    dispatchPointer('pointerdown', 1);
    target.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 1,
      }),
    );
    dispatchPointer('pointerup', 0);
    target.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 0,
      }),
    );
    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: centerX,
        clientY: centerY,
        button: 0,
        buttons: 0,
      }),
    );
  }

  private dispatchReactLikeClick(target: HTMLElement): boolean {
    const reactProps = this.getReactProps(target);
    if (reactProps == null) {
      return false;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const createEvent = (buttons: number) => {
      const clientX = rect.x + rect.width / 2;
      const clientY = rect.y + rect.height / 2;
      let defaultPrevented = false;
      const event = {
        isTrusted: true,
        get defaultPrevented(): boolean {
          return defaultPrevented;
        },
        button: 0,
        buttons,
        clientX,
        clientY,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        pointerType: 'mouse',
        detail: 1,
        target,
        currentTarget: target,
        nativeEvent: undefined as unknown,
        preventDefault(): void {
          defaultPrevented = true;
        },
        stopPropagation(): void {
          // No-op for the synthetic host bridge.
        },
      } as {
        isTrusted: boolean;
        defaultPrevented: boolean;
        button: number;
        buttons: number;
        clientX: number;
        clientY: number;
        ctrlKey: boolean;
        metaKey: boolean;
        altKey: boolean;
        shiftKey: boolean;
        pointerType: string;
        detail: number;
        target: EventTarget | null;
        currentTarget: EventTarget | null;
        nativeEvent: unknown;
        preventDefault(): void;
        stopPropagation(): void;
      };
      event.nativeEvent = {
        isTrusted: true,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        pointerType: event.pointerType,
        detail: event.detail,
        target,
        currentTarget: target,
        get defaultPrevented(): boolean {
          return defaultPrevented;
        },
        preventDefault(): void {
          defaultPrevented = true;
        },
        stopPropagation(): void {
          // No-op for the synthetic host bridge.
        },
      } as unknown;
      return event;
    };

    const invoke = (name: string, event: ReturnType<typeof createEvent>): boolean => {
      const handler = reactProps[name];
      if (typeof handler !== 'function') {
        return false;
      }

      try {
        handler(event);
      } catch {
        // Fall through to the DOM event bridge below when React props misbehave.
      }
      return true;
    };

    const pointerMoveEvent = createEvent(1);
    const pointerDownEvent = createEvent(1);
    const pointerUpEvent = createEvent(0);
    const clickEvent = createEvent(0);
    let invoked = false;
    invoked = invoke('onPointerMove', pointerMoveEvent) || invoked;
    invoked = invoke('onPointerDown', pointerDownEvent) || invoked;
    invoked = invoke('onPointerUp', pointerUpEvent) || invoked;
    invoked = invoke('onClick', clickEvent) || invoked;

    return invoked;
  }

  private getReactProps(target: HTMLElement): Record<string, unknown> | null {
    const propsKey = Reflect.ownKeys(target).find(
      (key): key is string => typeof key === 'string' && key.startsWith('__reactProps'),
    );
    if (propsKey == null) {
      return null;
    }

    const props = (target as unknown as Record<string, unknown>)[propsKey];
    if (props == null || typeof props !== 'object') {
      return null;
    }

    return props as Record<string, unknown>;
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

    // Priority 1: Check for fixture replay mode first (origin fixture replay)
    const fixtureData = getFixtureData(this.doc);
    if (fixtureData?.conversation != null) {
      console.log(`[TurboRender] Fixture replay mode detected: ${fixtureData.fixtureId}`);
      // Use fixture data to build turns, bypassing normal DOM scanning
      const fixtureTurns = buildTurnsFromFixture(fixtureData.conversation, this.doc);
      console.log(`[TurboRender] Built ${fixtureTurns.length} turns from fixture`);
      if (fixtureTurns.length > 0) {
        // Check version compatibility
        const compatibilityWarning = checkFixtureCompatibility(fixtureData.version);
        if (compatibilityWarning != null) {
          console.warn(`[TurboRender] Fixture compatibility warning: ${compatibilityWarning}`);
        }
        // Build InitialTrimSession from fixture turns
        const now = Date.now();
        const initialTrimSession: InitialTrimSession = {
          chatId: `chat:${fixtureData.conversationId}`,
          routeKind: 'chat',
          routeId: fixtureData.conversationId,
          conversationId: fixtureData.conversationId,
          applied: true,
          reason: 'fixture-replay',
          mode: 'compatibility',
          totalMappingNodes: fixtureTurns.length,
          totalVisibleTurns: fixtureTurns.length,
          activeBranchLength: fixtureTurns.length,
          hotVisibleTurns: 0,
          coldVisibleTurns: fixtureTurns.length,
          initialHotPairs: 0,
          hotPairCount: 0,
          archivedPairCount: Math.floor(fixtureTurns.length / 2),
          initialHotTurns: 0,
          hotStartIndex: 0,
          hotTurnCount: 0,
          archivedTurnCount: fixtureTurns.length,
          activeNodeId: null,
          turns: fixtureTurns.map((turn, index) => ({
            id: turn.id,
            index,
            role: turn.role,
            isStreaming: turn.isStreaming,
            parked: true,
            messageId: turn.messageId,
            parts: [],
            renderKind: 'markdown-text',
            contentType: null,
            snapshotHtml: null,
            structuredDetails: null,
            hiddenFromConversation: false,
            createTime: now / 1000,
          })),
          coldTurns: [],
          capturedAt: now,
        };
        this.setInitialTrimSession(initialTrimSession);
        this.turnContainer = null;
        // Find a suitable mount target in the DOM
        // Try main content area first, then look for specific ChatGPT containers
        const main = this.doc.querySelector('main');
        const article = this.doc.querySelector('article');
        const firstSection = this.doc.querySelector('section');
        const mountTarget = main ?? article ?? firstSection ?? this.doc.body;
        this.historyMountTarget = mountTarget;
        console.log(`[TurboRender] Debug: mountTarget set to ${mountTarget?.tagName ?? 'null'}, main=${!!main}, article=${!!article}, section=${!!firstSection}`);
        this.active = !this.paused && this.settings.enabled;
        this.setObservedMutationRoot(
          this.historyMountTarget.parentElement ?? this.historyMountTarget ?? this.doc.body,
          'archive-only-root',
        );
        this.setScrollTarget(this.doc.scrollingElement as HTMLElement | null);
        this.updateBatchSearchState();
        // For fixture mode: force hotPairCount to 0 to ensure all turns become archive groups
        const totalPairs = this.managedHistory.getTotalPairs();
        const archiveState = this.collectArchiveStateForFixture(totalPairs);
        console.log(`[TurboRender] Archive groups: ${archiveState.archiveGroups.length}, totalPairs: ${totalPairs}`);
        this.runtimeStatus = this.buildStatus({
          supported: true,
          reason: null,
          totalTurns: this.managedHistory.getTotalTurns(),
          totalPairs: totalPairs,
          finalizedTurns: this.managedHistory.getTotalTurns(),
          liveDescendantCount: 0,
          visibleRange: null,
        }, archiveState);
        console.log(`[TurboRender] Debug: statusBar=${this.statusBar != null}, mountTarget=${this.historyMountTarget?.tagName}, active=${this.active}`);
        this.updateStatusBar(archiveState);
        this.primeConversationMetadataIfNeeded(archiveState);
        console.log(`[TurboRender] Loaded ${fixtureTurns.length} turns from fixture ${fixtureData.fixtureId}`);
        return;
      }
    }

    // Priority 2: Normal DOM scanning for live ChatGPT pages
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

  private getResidentArchivePageIndexes(archiveState: ArchiveUiState): Set<number> {
    const residentPageIndexes = new Set<number>();
    if (archiveState.archivePageCount <= 0) {
      return residentPageIndexes;
    }

    if (archiveState.currentArchivePageIndex == null) {
      residentPageIndexes.add(archiveState.archivePageCount - 1);
      return residentPageIndexes;
    }

    const start = Math.max(0, archiveState.currentArchivePageIndex - 1);
    const end = Math.min(archiveState.archivePageCount - 1, archiveState.currentArchivePageIndex + 1);
    for (let index = start; index <= end; index += 1) {
      residentPageIndexes.add(index);
    }

    return residentPageIndexes;
  }

  private syncArchivePageCache(archiveState: ArchiveUiState): void {
    const residentPageIndexes = this.getResidentArchivePageIndexes(archiveState);

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
    if (this.turnContainer == null) {
      return null;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    let hasRealLayout = false;
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    let encounteredVisible = false;

    for (const child of this.turnContainer.children) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }

      const rect = child.getBoundingClientRect();
      if (rect.height > 0 || rect.width > 0 || rect.top !== 0 || rect.bottom !== 0) {
        hasRealLayout = true;
      }

      if (rect.bottom < containerRect.top) {
        continue;
      }

      if (rect.top > containerRect.bottom) {
        if (encounteredVisible) {
          break;
        }
        continue;
      }

      const intersects = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;
      if (!intersects) {
        continue;
      }
      encounteredVisible = true;

      const turnId = child.dataset[TURN_ID_DATASET];
      if (turnId == null) {
        continue;
      }
      const record = this.records.get(turnId);
      if (record != null) {
        if (record.index < start) {
          start = record.index;
        }
        if (record.index > end) {
          end = record.index;
        }
      }
    }

    if (!hasRealLayout && containerRect.height === 0 && containerRect.width === 0) {
      return null;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }

    return {
      start,
      end,
    };
  }

  private isProtectedTurn(node: HTMLElement | null): boolean {
    if (node == null) {
      return false;
    }

    const activeElement = this.doc.activeElement;
    if (activeElement != null && node.contains(activeElement)) {
      return true;
    }

    const selection = this.win.getSelection();
    if (selection != null && selection.rangeCount > 0) {
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if ((anchorNode != null && node.contains(anchorNode)) || (focusNode != null && node.contains(focusNode))) {
        return true;
      }
    }

    return (
      this.lastInteractionNode != null &&
      this.win.performance.now() - this.lastInteractionAt < 1500 &&
      node.contains(this.lastInteractionNode)
    );
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

  /**
   * Special version for fixture mode: forces all pairs to be archived (hotPairCount=0)
   * so that archive groups are created and UI becomes visible.
   */
  private collectArchiveStateForFixture(totalPairs: number): ArchiveUiState {
    const hotPairCount = 0;
    this.pruneExpandedArchiveBatches(totalPairs);
    const archivePageCount = this.managedHistory.getArchivedPageCount(ARCHIVE_PAGE_PAIR_COUNT, hotPairCount);
    const currentArchivePageIndex =
      this.archivePager.currentPageIndex ?? (archivePageCount > 0 ? archivePageCount - 1 : null);
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

    return {
      supported: input.supported,
      chatId: this.chatId,
      routeKind: getRouteKindFromRuntimeId(this.chatId),
      reason: input.reason,
      archiveOnly: !input.supported && input.totalTurns > 0,
      active: this.active,
      paused: this.paused,
      mode: this.settings.mode,
      softFallback: this.softFallbackSession || this.settings.softFallback,
      initialTrimApplied: this.initialTrimSession?.applied ?? false,
      initialTrimmedTurns: this.initialTrimSession?.coldVisibleTurns ?? 0,
      totalMappingNodes: this.initialTrimSession?.totalMappingNodes ?? 0,
      activeBranchLength: this.initialTrimSession?.activeBranchLength ?? 0,
      totalTurns: input.totalTurns,
      totalPairs: input.totalPairs,
      hotPairsVisible: hotPairCount,
      finalizedTurns: input.finalizedTurns,
      handledTurnsTotal: this.managedHistory.getArchivedTurnsTotal(hotPairCount),
      historyPanelOpen: false,
      archivePageCount: archiveState.archivePageCount,
      currentArchivePageIndex: archiveState.currentArchivePageIndex,
      archivedTurnsTotal: this.managedHistory.getArchivedTurnsTotal(hotPairCount),
      expandedArchiveGroups: archiveState.currentPageGroups.filter((group) => group.expanded).length,
      historyAnchorMode: 'hidden',
      slotBatchCount: archiveState.currentPageGroups.length,
      collapsedBatchCount: archiveState.currentPageGroups.filter((group) => !group.expanded).length,
      expandedBatchCount: archiveState.currentPageGroups.filter((group) => group.expanded).length,
      parkedTurns: this.parkingLot.getTotalParkedTurns(),
      parkedGroups: this.parkingLot.getSummaries().length,
      residentParkedGroups: this.parkingLot.getResidentGroupCount(),
      serializedParkedGroups: this.parkingLot.getSerializedGroupCount(),
      liveDescendantCount: input.liveDescendantCount,
      visibleRange: input.visibleRange,
      observedRootKind: this.observedRootKind,
      refreshCount: this.refreshCount,
      spikeCount: this.frameSpikeMonitor.getSpikeCount(),
      lastError: this.lastError,
      contentScriptInstanceId: this.contentScriptInstanceId,
      contentScriptStartedAt: this.contentScriptStartedAt,
      buildSignature: BUILD_SIGNATURE,
    };
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
        entryActionSelection: this.buildEntryActionSelectionMap(currentPageGroups),
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

  private buildEntryActionSelectionMap(archiveGroups: ManagedHistoryGroup[]): EntryActionSelectionMap {
    const selections: EntryActionSelectionMap = Object.fromEntries(this.entryActionSelectionByEntryId);
    if (!this.shouldPreferHostMorePopover()) {
      return selections;
    }

    for (const group of archiveGroups) {
      if (!this.shouldResolveEntryMetadataForGroup(group)) {
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

  private shouldResolveEntryMetadataForGroup(group: ManagedHistoryGroup): boolean {
    return group.expanded;
  }

  private buildEntryActionTemplateMap(): EntryActionTemplateMap {
    return Object.fromEntries(this.entryActionTemplateByLane);
  }

  private resolveEntryHostMessageIdFromConversationPayload(
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

  private buildEntryHostMessageIdMap(archiveGroups: ManagedHistoryGroup[]): Record<string, string> {
    const hostMessageIds: Record<string, string> = {};
    const conversationPayload = this.getConversationPayloadForReadAloud(this.getConversationIdForReadAloud());
    const activeEntryKeys = new Set<string>();
    for (const group of archiveGroups) {
      if (!this.shouldResolveEntryMetadataForGroup(group)) {
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
          this.resolveEntryHostMessageIdFromConversationPayload(entry, conversationPayload) ??
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
    const availability: EntryActionAvailabilityMap = {};
    const activeEntryIds = new Set<string>();

    for (const group of groups) {
      for (const entry of group.entries) {
        const entryKey = getArchiveEntrySelectionKey(entry);
        activeEntryIds.add(entryKey);
        if (isSupplementalHistoryEntry(entry)) {
          availability[entryKey] = {
            copy: 'unavailable',
            like: 'unavailable',
            dislike: 'unavailable',
            share: 'unavailable',
            more: 'unavailable',
          };
          continue;
        }
        const assistantActionBinding = (action: ArchiveEntryAction): EntryActionAvailability['copy'] =>
          entry.role === 'assistant' && this.resolveHostArchiveActionBinding(group.id, entry, action) != null
            ? 'host-bound'
            : 'unavailable';
        const copyMode: EntryActionAvailability['copy'] =
          this.resolveHostArchiveActionBinding(group.id, entry, 'copy') != null ? 'host-bound' : 'local-fallback';
        availability[entryKey] = {
          copy: copyMode,
          like: assistantActionBinding('like'),
          dislike: assistantActionBinding('dislike'),
          share: assistantActionBinding('share'),
          more: entry.role === 'assistant' ? 'local-fallback' : 'unavailable',
        };
      }
    }

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
