import { BUILD_SIGNATURE, DEFAULT_SETTINGS, TURN_ID_DATASET, UI_CLASS_NAMES } from '../shared/constants';
import { getChatIdFromPathname, getRouteKindFromRuntimeId } from '../shared/chat-id';
import {
  createTranslator,
  getContentLanguage,
  type Translator,
  type UiLanguage,
} from '../shared/i18n';
import type {
  IndexRange,
  InitialTrimSession,
  ManagedHistoryGroup,
  Settings,
  TabRuntimeStatus,
  TurnRecord,
} from '../shared/types';

import { detectTurnRole, isStreamingTurn, isTurnNode, scanChatPage } from './chatgpt-adapter';
import { FrameSpikeMonitor } from './frame-spike-monitor';
import { shouldAutoActivate } from './layout';
import { ManagedHistoryStore } from './managed-history';
import { ParkingLot } from './parking-lot';
import { StatusBar } from './status-bar';

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

function requestAnimationFrameCompat(win: Window, callback: FrameRequestCallback): number {
  return win.requestAnimationFrame?.(callback) ?? win.setTimeout(() => callback(win.performance.now()), 16);
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

function countLiveDescendants(root: ParentNode | null): number {
  if (root == null || !('querySelectorAll' in root)) {
    return 0;
  }

  return root.querySelectorAll('*').length;
}

function toSet(values: string[]): Set<string> {
  return new Set(values);
}

function findClosestTurnNode(target: Node | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return (
    (isTurnNode(target) ? target : null) ??
    target.closest<HTMLElement>('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn')
  );
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
  private searchQuery = '';
  private ignoreMutationsUntil = 0;
  private refreshCount = 0;
  private lastLiveSignature = '';
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
    if (this.mountUi) {
      this.statusBar = new StatusBar(this.doc, {
        onSearchQueryChange: (query) => {
          this.searchQuery = query.trim();
          this.updateBatchSearchState();
          this.refreshRuntimeStatusFromCurrentMetrics();
          this.updateStatusBar();
        },
        onToggleArchiveGroup: (groupId, anchor) => {
          this.toggleArchiveGroup(groupId, anchor);
        },
      });
    }

    this.refreshLanguage();
    this.frameSpikeMonitor.start();
    this.bindEvents();
    this.scheduleRefresh();
  }

  stop(): void {
    this.parkingLot.restoreAll();
    this.managedHistory.clear();
    this.expandedArchiveBatchIds.clear();
    this.clearHighlights();
    this.frameSpikeMonitor.stop();
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.observedMutationRoot = null;
    if (this.refreshHandle != null) {
      this.win.cancelAnimationFrame?.(this.refreshHandle) ?? this.win.clearTimeout(this.refreshHandle);
      this.refreshHandle = null;
    }
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
    this.clearHighlights();
    this.records.clear();
    this.active = false;
    this.softFallbackSession = false;
    this.lastError = null;
    this.initialTrimSession = null;
    this.historyMountTarget = null;
    this.turnContainer = null;
    this.chatId = chatId;
    this.searchQuery = '';
    this.setObservedMutationRoot(this.doc.body, 'archive-only-root');
    this.setScrollTarget(null);
    this.runtimeStatus = this.buildStatus({
      supported: false,
      reason: 'chat-change',
      totalTurns: 0,
      totalPairs: 0,
      finalizedTurns: 0,
      liveDescendantCount: 0,
      visibleRange: null,
    });
    this.updateStatusBar();
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
    this.paused = paused;
    if (paused) {
      this.active = false;
      this.restoreAllParking(0);
    }
    this.scheduleRefresh();
  }

  restoreAll(): void {
    const batchPairCount = this.getBatchPairCount();
    const hotPairCount = this.getHotPairCount(this.managedHistory.getTotalPairs());
    for (const group of this.managedHistory.getArchiveGroups(
      hotPairCount,
      batchPairCount,
      this.searchQuery,
      this.expandedArchiveBatchIds,
    )) {
      this.expandedArchiveBatchIds.add(group.id);
    }
    this.manualRestoreHoldUntil = this.win.performance.now() + 5000;
    this.updateBatchSearchState();
    this.scheduleRefresh();
  }

  restoreNearby(): void {
    const visibleRange = this.runtimeStatus.visibleRange;
    const hotPairCount = this.getHotPairCount(this.managedHistory.getTotalPairs());
    const archiveGroups = this.managedHistory.getArchiveGroups(
      hotPairCount,
      this.getBatchPairCount(),
      this.searchQuery,
      this.expandedArchiveBatchIds,
    );
    const latestCollapsedGroup = [...archiveGroups].reverse().find((group) => !group.expanded);
    if (latestCollapsedGroup != null) {
      this.expandedArchiveBatchIds.add(latestCollapsedGroup.id);
    }

    this.manualRestoreHoldUntil = this.win.performance.now() + 3000;
    this.updateBatchSearchState();
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
    this.updateBatchSearchState();
    this.runtimeStatus = this.buildStatus({
      supported: this.runtimeStatus.supported,
      reason: this.runtimeStatus.reason,
      totalTurns: this.managedHistory.getTotalTurns(),
      totalPairs: this.managedHistory.getTotalPairs(),
      finalizedTurns: this.runtimeStatus.finalizedTurns,
      liveDescendantCount: countLiveDescendants(this.turnContainer),
      visibleRange: this.runtimeStatus.visibleRange,
    });
    this.updateStatusBar();
  }

  private bindEvents(): void {
    this.doc.addEventListener(
      'pointerdown',
      (event) => {
        this.lastInteractionNode = event.target as Node | null;
        this.lastInteractionAt = this.win.performance.now();
      },
      true,
    );

    this.win.addEventListener('resize', () => this.scheduleRefresh(), { passive: true });
    this.win.addEventListener('pagehide', () => this.stop(), { once: true });

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.shouldRefreshForMutations(mutations)) {
        this.scheduleRefresh();
      }
    });
    this.setObservedMutationRoot(this.doc.body, 'archive-only-root');
  }

  private shouldRefreshForMutations(mutations: MutationRecord[]): boolean {
    if (this.win.performance.now() < this.ignoreMutationsUntil) {
      return false;
    }

    return mutations.some((mutation) => {
      if (mutation.type === 'attributes') {
        return findClosestTurnNode(mutation.target) != null;
      }

      if (findClosestTurnNode(mutation.target) != null) {
        return true;
      }

      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
        if (!(node instanceof Element)) {
          return false;
        }
        return findClosestTurnNode(node) != null || node.querySelector('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn') != null;
      });
    });
  }

  private toggleArchiveGroup(groupId: string, anchor: HTMLElement | null): void {
    const scrollTarget = this.scrollTarget ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousAnchorTop = anchor?.getBoundingClientRect().top ?? null;
    const previousScrollTop = scrollTarget?.scrollTop ?? 0;

    if (this.expandedArchiveBatchIds.has(groupId)) {
      this.expandedArchiveBatchIds.delete(groupId);
    } else {
      this.expandedArchiveBatchIds.add(groupId);
    }

    this.updateBatchSearchState();
    this.refreshRuntimeStatusFromCurrentMetrics();
    this.updateStatusBar();

    this.win.requestAnimationFrame(() => {
      const nextAnchor = this.statusBar?.getToggleButton(groupId) ?? null;
      if (nextAnchor == null || previousAnchorTop == null || scrollTarget == null) {
        return;
      }

      const nextTop = nextAnchor.getBoundingClientRect().top;
      scrollTarget.scrollTop = previousScrollTop + (nextTop - previousAnchorTop);
    });
  }

  private refreshRuntimeStatusFromCurrentMetrics(): void {
    this.runtimeStatus = this.buildStatus({
      supported: this.runtimeStatus.supported,
      reason: this.runtimeStatus.reason,
      totalTurns: this.managedHistory.getTotalTurns(),
      totalPairs: this.managedHistory.getTotalPairs(),
      finalizedTurns: this.runtimeStatus.finalizedTurns,
      liveDescendantCount: this.runtimeStatus.liveDescendantCount,
      visibleRange: this.runtimeStatus.visibleRange,
    });
  }

  private scheduleRefresh(): void {
    if (this.refreshHandle != null) {
      return;
    }

    this.refreshHandle = requestAnimationFrameCompat(this.win, () => {
      this.refreshHandle = null;
      this.refreshNow();
    });
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
      this.runtimeStatus = this.buildStatus({
        supported: false,
        reason: snapshot.reason ?? 'unsupported',
        totalTurns: totalTurnsBeforeScan,
        totalPairs: totalPairsBeforeScan,
        finalizedTurns: totalTurnsBeforeScan,
        liveDescendantCount: snapshot.descendantCount,
        visibleRange: null,
      });
      this.updateBatchSearchState();
      this.updateStatusBar();
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
        descendantCount: snapshot.descendantCount,
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

    this.runtimeStatus = this.buildStatus({
      supported: true,
      reason: null,
      totalTurns,
      totalPairs,
      finalizedTurns,
      liveDescendantCount: snapshot.descendantCount,
      visibleRange,
    });
    this.updateBatchSearchState();
    this.updateStatusBar();

    if (!this.active || this.paused || this.win.performance.now() < this.manualRestoreHoldUntil) {
      return;
    }

    if (this.idleHandle != null) {
      cancelIdleCallbackCompat(this.win, this.idleHandle);
    }

    const hotPairCount = this.getHotPairCount(totalPairs);
    const archiveGroups = this.managedHistory.getArchiveGroups(
      hotPairCount,
      this.getBatchPairCount(),
      this.searchQuery,
      this.expandedArchiveBatchIds,
    );

    if (
      !liveChanged &&
      this.parkingLot.getSummaries().length === archiveGroups.filter((group) => group.parkedGroupId != null).length
    ) {
      return;
    }

    this.idleHandle = requestIdleCallbackCompat(this.win, () => {
      this.idleHandle = null;
      this.syncParkedGroups(archiveGroups);
      this.updateBatchSearchState();
      this.runtimeStatus = this.buildStatus({
        supported: true,
        reason: null,
        totalTurns: this.managedHistory.getTotalTurns(),
        totalPairs: this.managedHistory.getTotalPairs(),
        finalizedTurns,
        liveDescendantCount: countLiveDescendants(this.turnContainer),
        visibleRange,
      });
      this.updateStatusBar();
    });
  }

  private syncParkedGroups(archiveGroups: ManagedHistoryGroup[]): void {
    const liveArchiveGroups = archiveGroups.filter((group) => group.entries.some((entry) => entry.liveTurnId != null));
    const expectedIds = toSet(liveArchiveGroups.map((group) => group.id));

    for (const summary of this.parkingLot.getSummaries()) {
      if (expectedIds.has(summary.id)) {
        continue;
      }

      const group = this.parkingLot.getGroup(summary.id);
      this.ignoreMutationsUntil = this.win.performance.now() + 64;
      this.parkingLot.restoreGroup(summary.id);
      for (const turnId of group?.turnIds ?? []) {
        const record = this.records.get(turnId);
        if (record != null) {
          record.parked = false;
        }
      }
    }

    for (const group of liveArchiveGroups) {
      if (this.parkingLot.has(group.id) || group.entries.length === 0) {
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

  private reconcileTurns(liveTurnNodes: HTMLElement[], stopButtonVisible: boolean): TurnRecord[] {
    const orderedIds: string[] = [];
    liveTurnNodes.forEach((node, index) => {
      if (!node.dataset[TURN_ID_DATASET]) {
        node.dataset[TURN_ID_DATASET] = `turn-${this.chatId}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      }

      if (!node.parentElement?.dataset.turboRenderParentKey) {
        node.parentElement?.setAttribute('data-turbo-render-parent-key', 'conversation-root');
      }

      const id = node.dataset[TURN_ID_DATASET]!;
      const record = this.records.get(id) ?? {
        id,
        index,
        role: detectTurnRole(node),
        isStreaming: false,
        parked: false,
        node,
      };

      record.index = index;
      record.role = detectTurnRole(node);
      record.isStreaming = isStreamingTurn(node, {
        isLastTurn: index === liveTurnNodes.length - 1,
        stopButtonVisible,
      });
      record.node = node;
      record.parked = this.parkingLot.isTurnParked(id);
      this.records.set(id, record);
      orderedIds.push(id);
    });

    for (const [id, record] of this.records.entries()) {
      if (!orderedIds.includes(id) && !this.parkingLot.isTurnParked(id)) {
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

  private computeVisibleRange(scrollContainer: HTMLElement): IndexRange | null {
    if (this.turnContainer == null) {
      return null;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const childRects = Array.from(this.turnContainer.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement)
      .map((child) => child.getBoundingClientRect());

    const hasRealLayout = childRects.some(
      (rect) => rect.height > 0 || rect.width > 0 || rect.top !== 0 || rect.bottom !== 0,
    );

    if (!hasRealLayout && containerRect.height === 0 && containerRect.width === 0) {
      return null;
    }

    const ranges: IndexRange[] = [];

    for (const child of Array.from(this.turnContainer.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }

      const rect = child.getBoundingClientRect();
      const intersects = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;
      if (!intersects) {
        continue;
      }

      const turnId = child.dataset[TURN_ID_DATASET];
      if (turnId == null) {
        continue;
      }
      const record = this.records.get(turnId);
      if (record != null) {
        ranges.push({ start: record.index, end: record.index });
      }
    }

    if (ranges.length === 0) {
      return null;
    }

    return {
      start: Math.min(...ranges.map((range) => range.start)),
      end: Math.max(...ranges.map((range) => range.end)),
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

  private buildStatus(input: {
    supported: boolean;
    reason: string | null;
    totalTurns: number;
    totalPairs: number;
    finalizedTurns: number;
    liveDescendantCount: number;
    visibleRange: IndexRange | null;
  }): TabRuntimeStatus {
    const hotPairCount = this.getHotPairCount(input.totalPairs);
    const archiveGroups = this.managedHistory.getArchiveGroups(
      hotPairCount,
      this.getBatchPairCount(),
      this.searchQuery,
      this.expandedArchiveBatchIds,
    );
    const collapsedBatchCount = archiveGroups.filter((group) => !group.expanded).length;
    const expandedBatchCount = archiveGroups.filter((group) => group.expanded).length;

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
      archivedTurnsTotal: this.managedHistory.getArchivedTurnsTotal(hotPairCount),
      expandedArchiveGroups: expandedBatchCount,
      historyAnchorMode: 'hidden',
      slotBatchCount: archiveGroups.length,
      collapsedBatchCount,
      expandedBatchCount,
      parkedTurns: this.parkingLot.getTotalParkedTurns(),
      parkedGroups: this.parkingLot.getSummaries().length,
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
      attributeFilter: ['aria-busy', 'data-testid', 'data-message-author-role'],
    });
  }

  private setScrollTarget(target: HTMLElement | null): void {
    this.scrollTarget = target;
  }

  private refreshLanguage(): void {
    this.uiLanguage = getContentLanguage(this.settings, this.doc);
    this.t = createTranslator(this.uiLanguage);
    this.parkingLot.setTranslator(this.t);
    this.statusBar?.setTranslator(this.t);
  }

  private updateStatusBar(): void {
    if (this.statusBar == null) {
      return;
    }

    this.statusBar.update(
      this.runtimeStatus,
      this.historyMountTarget ?? this.turnContainer,
      {
        archiveGroups: this.managedHistory.getArchiveGroups(
          this.getHotPairCount(this.managedHistory.getTotalPairs()),
          this.getBatchPairCount(),
          this.searchQuery,
          this.expandedArchiveBatchIds,
        ),
        collapsedBatchCount: this.runtimeStatus.collapsedBatchCount,
        expandedBatchCount: this.runtimeStatus.expandedBatchCount,
        searchQuery: this.searchQuery,
      },
    );
  }

  private updateBatchSearchState(): void {
    this.pruneExpandedArchiveBatches();
  }

  private pruneExpandedArchiveBatches(): void {
    const validIds = toSet(
      this.managedHistory
        .getArchiveGroups(
          this.getHotPairCount(this.managedHistory.getTotalPairs()),
          this.getBatchPairCount(),
          this.searchQuery,
          this.expandedArchiveBatchIds,
        )
        .map((group) => group.id),
    );
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
