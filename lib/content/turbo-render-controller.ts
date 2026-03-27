import { DEFAULT_SETTINGS, TURN_ID_DATASET, UI_CLASS_NAMES } from '../shared/constants';
import { createTranslator, getContentLanguage, type Translator, type UiLanguage } from '../shared/i18n';
import type {
  IndexRange,
  InitialTrimSession,
  ManagedHistoryEntry,
  Settings,
  TabRuntimeStatus,
  TurnRecord,
} from '../shared/types';

import { detectTurnRole, isStreamingTurn, isTurnNode, scanChatPage } from './chatgpt-adapter';
import { FrameSpikeMonitor } from './frame-spike-monitor';
import { computeHotRange, planTurnGroups, shouldAutoActivate } from './layout';
import { ManagedHistoryStore } from './managed-history';
import { ParkingLot } from './parking-lot';
import { StatusBar } from './status-bar';

export interface TurboRenderControllerOptions {
  document?: Document;
  window?: Window;
  settings?: Settings;
  paused?: boolean;
  mountUi?: boolean;
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

function rangesIntersect(left: IndexRange, right: IndexRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function countLiveDescendants(root: ParentNode | null): number {
  if (root == null || !('querySelectorAll' in root)) {
    return 0;
  }

  return root.querySelectorAll('*').length;
}

function extractNodeParts(node: HTMLElement): string[] {
  const text = node.textContent?.trim() ?? '';
  if (text.length === 0) {
    return [];
  }

  return text
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
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
  private refreshHandle: number | null = null;
  private idleHandle: number | null = null;
  private routePollHandle: number | null = null;
  private highlightResetHandle: number | null = null;
  private scrollTarget: HTMLElement | null = null;
  private turnContainer: HTMLElement | null = null;
  private highlightedTurnNode: HTMLElement | null = null;
  private lastHref: string;
  private active = false;
  private softFallbackSession = false;
  private lastError: string | null = null;
  private chatId: string;
  private initialTrimSession: InitialTrimSession | null = null;
  private runtimeStatus: TabRuntimeStatus;
  private lastInteractionNode: Node | null = null;
  private lastInteractionAt = 0;
  private manualRestoreHoldUntil = 0;
  private historyPanelOpen = false;
  private historyPanelHandledTurns = 0;
  private historyPanelHoldUntil = 0;
  private historyPanelStartedDuringStreaming = false;
  private highlightedHistoryEntryId: string | null = null;
  private uiLanguage: UiLanguage = 'en';
  private t: Translator = createTranslator('en');
  private readonly records = new Map<string, TurnRecord>();
  private readonly handleScroll = () => this.scheduleRefresh();

  constructor(options: TurboRenderControllerOptions = {}) {
    this.doc = options.document ?? document;
    this.win = options.window ?? window;
    this.settings = options.settings ?? DEFAULT_SETTINGS;
    this.paused = options.paused ?? false;
    this.mountUi = options.mountUi ?? true;
    this.onPauseToggle = options.onPauseToggle;
    this.chatId = this.doc.location?.pathname ?? '/';
    this.lastHref = this.doc.location?.href ?? '';
    this.frameSpikeMonitor = new FrameSpikeMonitor(
      this.win,
      this.settings.frameSpikeThresholdMs,
      this.settings.frameSpikeWindowMs,
    );
    this.runtimeStatus = this.buildStatus({
      supported: false,
      reason: 'not-started',
      totalTurns: 0,
      finalizedTurns: 0,
      liveDescendantCount: 0,
      visibleRange: null,
    });
  }

  start(): void {
    if (this.mountUi) {
      this.statusBar = new StatusBar(this.doc, {
        onRestoreNearby: () => {
          this.restoreNearby();
          this.scheduleRefresh();
        },
        onRestoreAll: () => {
          this.restoreAll();
          this.scheduleRefresh();
        },
        onTogglePause: () => {
          const next = !this.paused;
          void this.onPauseToggle?.(next, this.chatId);
          this.setPaused(next);
        },
        onOpenHistoryPanel: () => {
          this.openHistoryPanel();
          this.scheduleRefresh();
        },
        onCloseHistoryPanel: () => {
          this.closeHistoryPanel();
          this.scheduleRefresh();
        },
        onActivateHistoryEntry: (entryId) => {
          this.activateManagedHistoryEntry(entryId);
          this.scheduleRefresh();
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
    if (this.routePollHandle != null) {
      this.win.clearInterval(this.routePollHandle);
      this.routePollHandle = null;
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

  setInitialTrimSession(session: InitialTrimSession | null): void {
    this.initialTrimSession = session;
    this.managedHistory.setInitialTrimSession(session);
    if (session?.applied === true && this.settings.enabled && !this.paused) {
      this.active = true;
    }
    this.scheduleRefresh();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.active = false;
      this.closeHistoryPanel();
      this.restoreAll();
    }
    this.scheduleRefresh();
  }

  restoreAll(): void {
    this.restoreAllInternal(5000);
  }

  openHistoryPanel(): void {
    this.historyPanelOpen = true;
    this.historyPanelHandledTurns = Math.max(this.historyPanelHandledTurns, this.getHandledTurnsTotal());
    this.historyPanelHoldUntil = this.win.performance.now() + 30_000;
    this.historyPanelStartedDuringStreaming = [...this.records.values()].some((record) => record.isStreaming);
    this.restoreAllInternal(30_000);
  }

  closeHistoryPanel(): void {
    this.historyPanelOpen = false;
    this.historyPanelHandledTurns = 0;
    this.historyPanelHoldUntil = 0;
    this.historyPanelStartedDuringStreaming = false;
    this.manualRestoreHoldUntil = 0;
    this.highlightedHistoryEntryId = null;
  }

  restoreNearby(): void {
    const visibleRange = this.runtimeStatus.visibleRange;
    if (visibleRange == null) {
      return;
    }

    const targetRange = {
      start: Math.max(0, visibleRange.start - this.settings.groupSize),
      end: visibleRange.end + this.settings.groupSize,
    };

    for (const group of this.parkingLot.getSummaries()) {
      if (rangesIntersect(targetRange, { start: group.startIndex, end: group.endIndex })) {
        const restoredGroup = this.parkingLot.getGroup(group.id);
        this.parkingLot.restoreGroup(group.id);
        for (const turnId of restoredGroup?.turnIds ?? []) {
          const record = this.records.get(turnId);
          if (record != null) {
            record.parked = false;
          }
        }
      }
    }
  }

  private restoreAllInternal(holdMs: number): void {
    this.parkingLot.restoreAll();
    for (const record of this.records.values()) {
      record.parked = false;
    }
    this.manualRestoreHoldUntil = this.win.performance.now() + holdMs;
    this.runtimeStatus = this.buildStatus({
      supported: this.runtimeStatus.supported,
      reason: this.runtimeStatus.reason,
      totalTurns: this.runtimeStatus.totalTurns,
      finalizedTurns: this.runtimeStatus.finalizedTurns,
      liveDescendantCount: countLiveDescendants(this.turnContainer),
      visibleRange: this.runtimeStatus.visibleRange,
    });
    this.updateStatusBar();
  }

  private activateManagedHistoryEntry(entryId: string): void {
    const entry = this.managedHistory.findEntry(entryId);
    if (entry == null) {
      return;
    }

    this.highlightedHistoryEntryId = entryId;
    this.scheduleHighlightReset();

    if (entry.source === 'initial-trim') {
      return;
    }

    if (entry.groupId != null && this.parkingLot.has(entry.groupId)) {
      const restoredGroup = this.parkingLot.getGroup(entry.groupId);
      this.parkingLot.restoreGroup(entry.groupId);
      for (const turnId of restoredGroup?.turnIds ?? []) {
        const record = this.records.get(turnId);
        if (record != null) {
          record.parked = false;
        }
      }
    }

    const node = entry.turnId != null ? this.records.get(entry.turnId)?.node : null;
    if (node instanceof HTMLElement && node.isConnected) {
      node.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      this.highlightTranscriptTurn(node);
    }
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

    this.doc.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element | null;
        const groupId =
          target?.closest<HTMLElement>('[data-turbo-render-action="restore-group"]')?.dataset.groupId ??
          this.parkingLot.findGroupIdByPlaceholder(target);

        if (groupId == null) {
          return;
        }

        event.preventDefault();
        this.parkingLot.restoreGroup(groupId);
        this.scheduleRefresh();
      },
      true,
    );

    this.win.addEventListener('resize', () => this.scheduleRefresh(), { passive: true });
    this.win.addEventListener('pagehide', () => this.stop(), { once: true });

    this.mutationObserver = new MutationObserver(() => this.scheduleRefresh());
    this.setObservedMutationRoot(this.doc.body);

    this.routePollHandle = this.win.setInterval(() => {
      if (this.doc.location?.href !== this.lastHref) {
        this.lastHref = this.doc.location?.href ?? '';
        this.handleRouteChange();
      }
    }, 1000);
  }

  private handleRouteChange(): void {
    this.parkingLot.restoreAll();
    this.managedHistory.clear();
    this.clearHighlights();
    this.records.clear();
    this.active = false;
    this.softFallbackSession = false;
    this.lastError = null;
    this.initialTrimSession = null;
    this.closeHistoryPanel();
    this.setObservedMutationRoot(this.doc.body);
    this.setScrollTarget(null);
    this.scheduleRefresh();
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
    this.refreshLanguage();
    for (const group of this.parkingLot.getDisconnectedHardGroups()) {
      this.lastError = `host-rerender-lost-${group.id}`;
      this.softFallbackSession = true;
    }
    if (this.softFallbackSession) {
      this.restoreAll();
    }

    const snapshot = scanChatPage(this.doc);
    this.chatId = snapshot.chatId;
    if (this.initialTrimSession != null && this.initialTrimSession.chatId !== this.chatId) {
      this.initialTrimSession = null;
      this.managedHistory.setInitialTrimSession(null);
    }

    if (!snapshot.supported || snapshot.turnContainer == null) {
      this.turnContainer = null;
      this.active = false;
      this.setObservedMutationRoot(this.doc.body);
      this.setScrollTarget(null);
      this.runtimeStatus = this.buildStatus({
        supported: false,
        reason: snapshot.reason ?? 'unsupported',
        totalTurns: 0,
        finalizedTurns: 0,
        liveDescendantCount: snapshot.descendantCount,
        visibleRange: null,
      });
      this.updateStatusBar();
      return;
    }

    this.turnContainer = snapshot.turnContainer;
    this.setObservedMutationRoot(snapshot.turnContainer.parentElement ?? snapshot.turnContainer);
    this.setScrollTarget(snapshot.scrollContainer);
    this.managedHistory.setInitialTrimSession(this.initialTrimSession);
    const orderedRecords = this.reconcileTurns(snapshot.turnNodes, snapshot.stopButtonVisible);
    const visibleRange = this.computeVisibleRange(snapshot.scrollContainer);
    const initialColdTurns = this.initialTrimSession?.applied ? this.initialTrimSession.coldVisibleTurns : 0;
    const hasStreamingTurns = orderedRecords.some((record) => record.isStreaming);
    this.syncHistoryPanel(hasStreamingTurns);
    const finalizedTurns = orderedRecords.filter((record) => !record.isStreaming).length + initialColdTurns;
    const totalTurns = orderedRecords.length + initialColdTurns;
    const spikeCount = this.frameSpikeMonitor.getSpikeCount();

    if (!this.paused && this.settings.enabled && this.settings.autoEnable) {
      const activate = shouldAutoActivate({
        finalizedTurns: orderedRecords.filter((record) => !record.isStreaming).length,
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
      this.restoreAll();
    }

    this.runtimeStatus = this.buildStatus({
      supported: true,
      reason: null,
      totalTurns,
      finalizedTurns,
      liveDescendantCount: snapshot.descendantCount,
      visibleRange,
    });
    this.updateStatusBar();

    if (!this.active || this.paused || this.win.performance.now() < this.manualRestoreHoldUntil) {
      return;
    }

    if (this.idleHandle != null) {
      cancelIdleCallbackCompat(this.win, this.idleHandle);
    }

    const candidates = orderedRecords.map((record) => ({
      id: record.id,
      index: record.index,
      parked: record.parked,
      isStreaming: record.isStreaming,
      protected: this.isProtectedTurn(record.node),
      parentKey: record.node?.parentElement?.dataset.turboRenderParentKey ?? 'root',
    }));

    const hotRange = computeHotRange(orderedRecords.length, visibleRange, {
      keepRecentTurns:
        this.settings.mode === 'performance' ? this.settings.liveHotTurns : this.settings.keepRecentTurns,
      viewportBufferTurns: this.settings.viewportBufferTurns,
    });

    this.idleHandle = requestIdleCallbackCompat(this.win, () => {
      this.idleHandle = null;
      this.restoreIntersectingGroups(hotRange);
      const plans = planTurnGroups(candidates, hotRange, this.settings.groupSize);

      for (const plan of plans) {
        if (this.parkingLot.has(plan.id)) {
          continue;
        }

        const nodes = plan.turnIds
          .map((turnId) => this.records.get(turnId)?.node)
          .filter((node): node is HTMLElement => node instanceof HTMLElement && node.isConnected);

        if (nodes.length !== plan.turnIds.length) {
          continue;
        }

        const parent = nodes[0]?.parentElement;
        if (parent == null || nodes.some((node) => node.parentElement !== parent)) {
          continue;
        }

        const mode = this.softFallbackSession || this.settings.softFallback ? 'soft' : 'hard';
        const group = this.parkingLot.park({
          id: plan.id,
          mode,
          parent,
          startIndex: plan.startIndex,
          endIndex: plan.endIndex,
          turnIds: plan.turnIds,
          nodes,
        });

        if (group == null) {
          continue;
        }

        const groupEntries: ManagedHistoryEntry[] = [];
        for (const [index, turnId] of plan.turnIds.entries()) {
          const record = this.records.get(turnId);
          const node = nodes[index];
          if (record == null || node == null) {
            continue;
          }

          record.parked = true;
          if (mode === 'hard') {
            record.node = group.nodes[index] ?? null;
          }

          groupEntries.push(
            ManagedHistoryStore.createParkedEntry({
              groupId: plan.id,
              turnId,
              turnIndex: (this.initialTrimSession?.coldVisibleTurns ?? 0) + record.index,
              role: record.role,
              parts: extractNodeParts(node),
            }),
          );
        }

        this.managedHistory.upsertParkedGroup(plan.id, groupEntries);
      }

      this.runtimeStatus = this.buildStatus({
        supported: true,
        reason: null,
        totalTurns,
        finalizedTurns,
        liveDescendantCount: countLiveDescendants(this.turnContainer),
        visibleRange,
      });
      this.updateStatusBar();
    });
  }

  private reconcileTurns(liveTurnNodes: HTMLElement[], stopButtonVisible: boolean): TurnRecord[] {
    if (this.turnContainer == null) {
      return [];
    }

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
      record.parked = false;
      this.records.set(id, record);
    });

    const orderedIds: string[] = [];
    for (const child of Array.from(this.turnContainer.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }

      const groupId = child.getAttribute('data-turbo-render-group-id');
      if (groupId != null) {
        const group = this.parkingLot.getGroup(groupId);
        if (group != null) {
          orderedIds.push(...group.turnIds);
        }
        continue;
      }

      if (isTurnNode(child)) {
        const turnId = child.dataset[TURN_ID_DATASET];
        if (turnId != null) {
          orderedIds.push(turnId);
        }
      }
    }

    const summaries = this.parkingLot.getSummaries();
    for (const [id, record] of this.records.entries()) {
      if (!orderedIds.includes(id) && !record.parked) {
        this.records.delete(id);
      }
    }

    return orderedIds.map((id, index) => {
      const record = this.records.get(id)!;
      record.index = index;
      record.parked = summaries.some((group) => group.startIndex <= index && group.endIndex >= index);
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

      const groupId = child.getAttribute('data-turbo-render-group-id');
      if (groupId != null) {
        const summary = this.parkingLot.getSummaries().find((group) => group.id === groupId);
        if (summary != null) {
          ranges.push({ start: summary.startIndex, end: summary.endIndex });
        }
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

  private restoreIntersectingGroups(hotRange: IndexRange): void {
    for (const group of this.parkingLot.getSummaries()) {
      if (rangesIntersect(hotRange, { start: group.startIndex, end: group.endIndex })) {
        const restoredGroup = this.parkingLot.getGroup(group.id);
        this.parkingLot.restoreGroup(group.id);
        for (const turnId of restoredGroup?.turnIds ?? []) {
          const record = this.records.get(turnId);
          if (record != null) {
            record.parked = false;
          }
        }
      }
    }
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

    const recentInteraction =
      this.lastInteractionNode != null &&
      this.win.performance.now() - this.lastInteractionAt < 1500 &&
      node.contains(this.lastInteractionNode);

    return recentInteraction;
  }

  private buildStatus(input: {
    supported: boolean;
    reason: string | null;
    totalTurns: number;
    finalizedTurns: number;
    liveDescendantCount: number;
    visibleRange: IndexRange | null;
  }): TabRuntimeStatus {
    return {
      supported: input.supported,
      chatId: this.chatId,
      reason: input.reason,
      active: this.active,
      paused: this.paused,
      mode: this.settings.mode,
      softFallback: this.softFallbackSession || this.settings.softFallback,
      initialTrimApplied: this.initialTrimSession?.applied ?? false,
      initialTrimmedTurns: this.initialTrimSession?.coldVisibleTurns ?? 0,
      totalMappingNodes: this.initialTrimSession?.totalMappingNodes ?? 0,
      activeBranchLength: this.initialTrimSession?.activeBranchLength ?? 0,
      totalTurns: input.totalTurns,
      finalizedTurns: input.finalizedTurns,
      handledTurnsTotal: this.historyPanelOpen
        ? Math.max(this.historyPanelHandledTurns, this.getHandledTurnsTotal())
        : this.getHandledTurnsTotal(),
      historyPanelOpen: this.historyPanelOpen,
      parkedTurns: this.parkingLot.getTotalParkedTurns(),
      parkedGroups: this.parkingLot.getSummaries().length,
      liveDescendantCount: input.liveDescendantCount,
      visibleRange: input.visibleRange,
      spikeCount: this.frameSpikeMonitor.getSpikeCount(),
      lastError: this.lastError,
    };
  }

  private setObservedMutationRoot(root: Node | null): void {
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
    if (this.scrollTarget === target) {
      return;
    }

    this.scrollTarget?.removeEventListener('scroll', this.handleScroll);
    this.scrollTarget = target;
    this.scrollTarget?.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  private getHandledTurnsTotal(): number {
    return (this.initialTrimSession?.coldVisibleTurns ?? 0) + this.parkingLot.getTotalParkedTurns();
  }

  private syncHistoryPanel(hasStreamingTurns: boolean): void {
    if (!this.historyPanelOpen) {
      return;
    }

    const now = this.win.performance.now();
    const shouldCloseByStream = this.historyPanelStartedDuringStreaming && !hasStreamingTurns;

    if (shouldCloseByStream || now >= this.historyPanelHoldUntil) {
      this.closeHistoryPanel();
    }
  }

  private refreshLanguage(): void {
    this.uiLanguage = getContentLanguage(this.settings, this.doc);
    this.t = createTranslator(this.uiLanguage);
    this.parkingLot.setTranslator(this.t);
    this.statusBar?.setTranslator(this.t);
  }

  private updateStatusBar(): void {
    this.statusBar?.update(
      this.runtimeStatus,
      this.turnContainer,
      this.managedHistory.getEntries(),
      this.highlightedHistoryEntryId,
    );
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
    this.highlightedHistoryEntryId = null;
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
