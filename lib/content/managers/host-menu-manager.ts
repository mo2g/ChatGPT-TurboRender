import { isTurboRenderUiNode } from '../utils/chatgpt-adapter';
import { dispatchHumanClick as dispatchHostHumanClick } from '../host-integration/host-action-events';
import { findHostActionButton } from '../core/message-actions';
import {
  doesHostActionButtonMatchEntry as doesHostActionButtonMatchArchiveEntry,
  normalizeEntryText,
} from '../host-integration/host-action-matching';
import { waitForHostElement } from '../host-integration/host-action-wait';
import {
  findHostMoreMenuAction as findHostMoreMenuActionInMenu,
  readHostEntryActionSelection as readHostEntryActionSelectionFromRoots,
} from '../host-integration/host-more-menu-actions';
import type {
  ArchiveEntryAction,
  EntryActionSelection,
  EntryMoreMenuAction,
  HostActionTemplateSnapshot,
} from '../core/message-actions';
import type { ManagedHistoryEntry, ManagedHistoryGroup, TurnRecord } from '../../shared/types';
import type { StatusBar } from '../rendering/status-bar';
import type { ParkingLot } from './parking-lot';
import type { MutationObserverManager } from './mutation-observer-manager';
import type { ViewportManager } from './viewport-manager';
import type { HostMenuPositioning } from '../host-integration/host-menu-positioning';
import type { EntryActionManager } from './entry-action-manager';
import { isSyntheticMessageId, resolvePreferredMessageId } from '../core/managed-history';
import { matchesHostActionCandidate } from '../utils/turbo-render-controller-utils';

const HOST_MENU_WAIT_TIMEOUT_MS = 800;
const HOST_MENU_ACTION_WAIT_TIMEOUT_MS = 600;

export interface HostArchiveActionBinding {
  action: ArchiveEntryAction;
  anchor: HTMLElement | null;
  button: HTMLElement;
}

export interface OpenHostMenuResult {
  menu: HTMLElement;
  previousMenus: Set<HTMLElement>;
}

export interface HostMenuManagerOptions {
  win: Window;
  doc: Document;
  statusBar: StatusBar | null;
  parkingLot: ParkingLot;
  mutationObserverManager: MutationObserverManager;
  viewportManager: ViewportManager;
  hostMenuPositioning: HostMenuPositioning;
  entryActionManager: EntryActionManager;
  shouldUseHostActionClicks: () => boolean;
  shouldPreferHostMorePopover: () => boolean;
  onIncrementDebugCounter: (action: 'read-aloud') => void;
  getRecordForEntry: (entry: ManagedHistoryEntry) => TurnRecord | null;
  findRenderedArchiveMessageIdForEntry: (groupId: string | null, entry: ManagedHistoryEntry) => string | null;
  findParkedMessageIdForEntry: (groupId: string | null, entry: ManagedHistoryEntry) => string | null;
  findHostMessageIdForEntry: (entry: ManagedHistoryEntry, groupId: string | null, group?: ManagedHistoryGroup | null) => string | null;
  doesHostActionButtonMatchEntry: (candidate: HTMLElement, entry: ManagedHistoryEntry) => boolean;
}

export class HostMenuManager {
  private readonly win: Window;
  private readonly doc: Document;
  private readonly statusBar: StatusBar | null;
  private readonly parkingLot: ParkingLot;
  private readonly mutationObserverManager: MutationObserverManager;
  private readonly viewportManager: ViewportManager;
  private readonly hostMenuPositioning: HostMenuPositioning;
  private readonly entryActionManager: EntryActionManager;
  private readonly getShouldUseHostActionClicks: () => boolean;
  private readonly getShouldPreferHostMorePopover: () => boolean;
  private readonly onIncrementDebugCounter: (action: 'read-aloud') => void;
  private readonly getRecordForEntry: (entry: ManagedHistoryEntry) => TurnRecord | null;
  private readonly findRenderedArchiveMessageIdForEntry: (groupId: string | null, entry: ManagedHistoryEntry) => string | null;
  private readonly findParkedMessageIdForEntry: (groupId: string | null, entry: ManagedHistoryEntry) => string | null;
  private readonly findHostMessageIdForEntry: (entry: ManagedHistoryEntry, groupId: string | null, group?: ManagedHistoryGroup | null) => string | null;
  private readonly doesHostActionButtonMatchEntry: (candidate: HTMLElement, entry: ManagedHistoryEntry) => boolean;

  private pendingHostMoreActionRestore: (() => void) | null = null;
  private suppressEntryActionMenuToggle = false;
  
  // 缓存 resolveArchiveActionBinding 的结果以避免重复 DOM 查询
  private actionBindingCache = new Map<string, HostArchiveActionBinding | null>();
  // 缓存 collectHostSearchRootsForEntry 的搜索结果
  private searchRootsCache = new Map<string, HTMLElement[]>()

  constructor(options: HostMenuManagerOptions) {
    this.win = options.win;
    this.doc = options.doc;
    this.statusBar = options.statusBar;
    this.parkingLot = options.parkingLot;
    this.mutationObserverManager = options.mutationObserverManager;
    this.viewportManager = options.viewportManager;
    this.hostMenuPositioning = options.hostMenuPositioning;
    this.entryActionManager = options.entryActionManager;
    this.getShouldUseHostActionClicks = options.shouldUseHostActionClicks;
    this.getShouldPreferHostMorePopover = options.shouldPreferHostMorePopover;
    this.onIncrementDebugCounter = options.onIncrementDebugCounter;
    this.getRecordForEntry = options.getRecordForEntry;
    this.findRenderedArchiveMessageIdForEntry = options.findRenderedArchiveMessageIdForEntry;
    this.findParkedMessageIdForEntry = options.findParkedMessageIdForEntry;
    this.findHostMessageIdForEntry = options.findHostMessageIdForEntry;
    this.doesHostActionButtonMatchEntry = options.doesHostActionButtonMatchEntry;
  }

  reset(): void {
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    this.suppressEntryActionMenuToggle = false;
    // 只清除 messageIdElementCache（DOM 引用可能失效），保留 actionBindingCache 和 searchRootsCache
    // 这样跨页面时缓存仍然有效
    this.messageIdElementCache = null;
    this.messageIdCacheVersion++;
    
    // 预构建 messageIdElementCache，避免第一次调用时的延迟
    // 使用 requestIdleCallback 在空闲时构建，不阻塞主线程
    const schedule = (this.win as typeof window).requestIdleCallback ?? this.win.setTimeout;
    schedule(() => {
      if (!this.messageIdElementCache) {
        this.messageIdElementCache = this.buildMessageIdCache();
      }
    }, { timeout: 50 } as IdleRequestOptions);
  }
  
  /**
   * 生成搜索根缓存键 - 基于 messageId 以便跨页面复用
   */
  private getSearchRootsCacheKey(entry: ManagedHistoryEntry): string {
    // 只使用 messageId，完全移除 groupId 依赖，实现真正的跨页面缓存共享
    const messageId = resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId);
    return `search:${messageId || entry.id}`;
  }
  
  /**
   * 生成缓存键 - 基于 messageId 以便跨页面复用
   */
  private getActionBindingCacheKey(entry: ManagedHistoryEntry, action: ArchiveEntryAction): string {
    // 只使用 messageId 和 action，完全移除 groupId 依赖，实现真正的跨页面缓存共享
    const messageId = resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId);
    return `action:${messageId || entry.id}:${action}`;
  }

  // ========== Public Methods ==========

  async clickMoreMenuAction(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: EntryMoreMenuAction,
    anchorGetter: () => HTMLElement | null,
  ): Promise<boolean> {
    if (!this.getShouldUseHostActionClicks()) {
      return false;
    }

    return this.runWithSuppressedEntryActionMenuDismissal(async () => {
      const hostMenuResult = await this.openMoreMenu(groupId, entry, anchorGetter);
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

      this.setDebugDataset({
        turboRenderDebugReadAloudRoute: 'host-menu',
        turboRenderDebugReadAloudMenuAction: action,
        turboRenderDebugReadAloudHostMenuFound: hostMenuAction != null ? '1' : '0',
      });

      if (hostMenuAction == null) {
        return false;
      }

      const scrollTarget = this.viewportManager.getScrollTarget() ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
      const previousScrollTop = scrollTarget?.scrollTop ?? null;
      this.mutationObserverManager.setIgnoreMutations(500);
      this.dispatchHumanClick(hostMenuAction);
      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      return true;
    });
  }

  async toggleMoreMenu(
    groupId: string,
    entry: ManagedHistoryEntry,
    anchorGetter: () => HTMLElement | null,
  ): Promise<boolean> {
    if (!this.getShouldUseHostActionClicks()) {
      return false;
    }

    return this.runWithSuppressedEntryActionMenuDismissal(async () => {
      this.restoreAnchoredHostMenuStyle();
      this.clearPendingHostMoreActionRestore();
      const previousMenus = new Set(this.getVisibleHostMenus());
      const scrollTarget = this.viewportManager.getScrollTarget() ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
      const previousScrollTop = scrollTarget?.scrollTop ?? null;
      this.suppressEntryActionMenuToggle = true;
      let toggled = false;
      try {
        toggled = await this.clickArchiveAction(groupId, entry, 'more', anchorGetter);
      } finally {
        this.suppressEntryActionMenuToggle = false;
      }

      if (!toggled) {
        return false;
      }

      this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      const hostMenu = await this.waitForPreferredHostMenu(previousMenus, anchorGetter, HOST_MENU_WAIT_TIMEOUT_MS);
      const anchor = anchorGetter();
      if (hostMenu != null && anchor != null && anchor.isConnected && this.isElementVisible(anchor)) {
        this.positionVisibleHostMenuToAnchor(hostMenu, anchor);
      }
      this.clearPendingHostMoreActionRestore();
      return true;
    });
  }

  async openMoreMenu(
    groupId: string,
    entry: ManagedHistoryEntry,
    anchorGetter: () => HTMLElement | null,
  ): Promise<OpenHostMenuResult | null> {
    this.restoreAnchoredHostMenuStyle();
    this.clearPendingHostMoreActionRestore();
    const previousMenus = new Set(this.getVisibleHostMenus());
    const scrollTarget = this.viewportManager.getScrollTarget() ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
    const previousScrollTop = scrollTarget?.scrollTop ?? null;
    this.suppressEntryActionMenuToggle = true;
    let openedMore = false;
    try {
      openedMore = await this.clickArchiveAction(groupId, entry, 'more', anchorGetter);
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
    if (anchor != null && anchor.isConnected && this.isElementVisible(anchor)) {
      this.positionVisibleHostMenuToAnchor(hostMenu, anchor);
    }
    this.clearPendingHostMoreActionRestore();
    return {
      menu: hostMenu,
      previousMenus,
    };
  }

  async clickArchiveAction(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
    anchorGetter: () => HTMLElement | null,
    options: {
      allowBroadMoreFallback?: boolean;
    } = {},
  ): Promise<boolean> {
    if (!this.getShouldUseHostActionClicks()) {
      return false;
    }

    const scrollTarget = this.viewportManager.getScrollTarget() ?? ((this.doc.scrollingElement as HTMLElement | null) ?? this.doc.body);
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

    const dispatchAnchoredHostAction = (candidate: HTMLElement): void => {
      const shouldAnchorToArchiveProxy =
        anchor != null &&
        this.getShouldPreferHostMorePopover() &&
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
      this.getShouldPreferHostMorePopover() &&
      (action === 'more' || action === 'like' || action === 'dislike');
    const shouldRestoreScrollAfterAction = true;
    const shouldSuppressMutationsForAction = action === 'more' || action === 'like' || action === 'dislike';

    // Try exact message button
    const exactMessageButton = this.findExactMessageHostActionButton(preferredMessageIds, action);
    if (exactMessageButton != null && exactMessageButton.isConnected) {
      if (shouldSuppressMutationsForAction) {
        this.mutationObserverManager.setIgnoreMutations(500);
      }
      dispatchAnchoredHostAction(exactMessageButton);
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
      return true;
    }

    // Try scoped button
    const scopedButton =
      preferPreciseHostBinding
        ? null
        : searchRoots.length > 0
          ? this.findScopedHostActionButton(searchRoots, action)
          : null;
    if (scopedButton != null && scopedButton.isConnected) {
      if (shouldSuppressMutationsForAction) {
        this.mutationObserverManager.setIgnoreMutations(500);
      }
      dispatchAnchoredHostAction(scopedButton);
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
      return true;
    }

    // Try global fallback
    const shouldSkipGlobalFallback = this.getShouldPreferHostMorePopover() || preferPreciseHostBinding;
    if (!shouldSkipGlobalFallback) {
      const globalButton = this.findGlobalHostActionButton(anchor, action, entry);
      if (globalButton != null) {
        if (globalButton.isConnected) {
          if (shouldSuppressMutationsForAction) {
            this.mutationObserverManager.setIgnoreMutations(500);
          }
          dispatchAnchoredHostAction(globalButton);
          if (shouldRestoreScrollAfterAction) {
            this.restoreExactScrollTop(scrollTarget, previousScrollTop);
          }
          return true;
        }
      }
    }

    // Broad fallback for 'more' action
    if (action === 'more' && options.allowBroadMoreFallback) {
      const broadButton = this.findGlobalHostActionButton(anchor, action, entry);
      if (broadButton != null && broadButton.isConnected) {
        if (shouldSuppressMutationsForAction) {
          this.mutationObserverManager.setIgnoreMutations(500);
        }
        dispatchAnchoredHostAction(broadButton);
        if (shouldRestoreScrollAfterAction) {
          this.restoreExactScrollTop(scrollTarget, previousScrollTop);
        }
        return true;
      }
    }

    // Fallback with node search
    return this.fallbackClickWithNodeSearch(groupId, entry, action, scrollTarget, previousScrollTop, preferPreciseHostBinding, shouldRestoreScrollAfterAction, shouldSuppressMutationsForAction, dispatchAnchoredHostAction);
  }

  readHostEntryActionSelection(
    groupId: string,
    entry: ManagedHistoryEntry,
  ): { matched: boolean; selection: EntryActionSelection | null } {
    return readHostEntryActionSelectionFromRoots(this.collectHostSearchRootsForEntry(groupId, entry));
  }

  resolveArchiveActionBinding(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
  ): HostArchiveActionBinding | null {
    if (!this.getShouldUseHostActionClicks()) {
      return null;
    }
    
    // 检查缓存
    const cacheKey = this.getActionBindingCacheKey(entry, action);
    const cached = this.actionBindingCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    
    performance.now();

      for (const root of this.collectHostSearchRootsForEntry(groupId, entry)) {
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
      const result: HostArchiveActionBinding = { action, anchor: null, button };
      this.actionBindingCache.set(cacheKey, result);
      return result;
    }
    
    this.actionBindingCache.set(cacheKey, null);
    return null;
  }

  // ========== Helper Methods ==========

  private isHostActionButtonRenderable(button: HTMLElement): boolean {
    // 使用 checkVisibility API 或 offsetParent 避免强制重排
    return this.isElementVisible(button);
  }

  // 元素可见性缓存，避免重复计算
  private elementVisibleCache: WeakMap<HTMLElement, { visible: boolean; timestamp: number }> = new WeakMap();
  private readonly VISIBLE_CACHE_TTL = 50; // 50ms 缓存

  private isElementVisible(element: HTMLElement): boolean {
    // 检查缓存
    const cached = this.elementVisibleCache.get(element);
    if (cached && performance.now() - cached.timestamp < this.VISIBLE_CACHE_TTL) {
      return cached.visible;
    }

    let visible: boolean;
    // 优先使用 checkVisibility API（Chrome 106+，不触发重排）
    const checkVisibility = (element as HTMLElement & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
    if (typeof checkVisibility === 'function') {
      visible = checkVisibility.call(element, { checkOpacity: true, checkVisibilityCSS: true });
    } else {
      // 降级：使用 isConnected 和隐藏属性检查（避免 offsetParent 重排）
      visible = element.isConnected && 
                !element.hasAttribute('hidden') && 
                element.getAttribute('aria-hidden') !== 'true';
    }
    
    // 更新缓存
    this.elementVisibleCache.set(element, { visible, timestamp: performance.now() });
    return visible;
  }

  private async runWithSuppressedEntryActionMenuDismissal<T>(fn: () => Promise<T>): Promise<T> {
    this.entryActionManager.setSuppressMenuDismissal(true);
    try {
      return await fn();
    } finally {
      this.entryActionManager.setSuppressMenuDismissal(false);
    }
  }

  private restoreExactScrollTop(scrollTarget: HTMLElement | null, previousScrollTop: number | null): void {
    if (scrollTarget == null || previousScrollTop == null) {
      return;
    }
    this.viewportManager.setIgnoreScroll(500);
    scrollTarget.scrollTop = previousScrollTop;
  }

  private setDebugDataset(data: Record<string, string | null | undefined>): void {
    for (const [key, value] of Object.entries(data)) {
      if (value == null) continue;
      if (this.doc.body != null) {
        this.doc.body.dataset[key] = value;
      }
      if (this.doc.documentElement != null) {
        this.doc.documentElement.dataset[key] = value;
      }
    }
  }

  private dispatchHumanClick(target: HTMLElement): void {
    dispatchHostHumanClick(target);
  }

  private getVisibleHostMenus(): HTMLElement[] {
    return this.hostMenuPositioning.getVisibleHostMenus();
  }

  private findPreferredHostMenu(previousMenus: Set<HTMLElement>, anchor: HTMLElement | null): HTMLElement | null {
    return this.hostMenuPositioning.findPreferredHostMenu(previousMenus, anchor);
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

  private findHostMoreMenuAction(menu: ParentNode, action: EntryMoreMenuAction): HTMLElement | null {
    return findHostMoreMenuActionInMenu(menu, action);
  }

  private temporarilyAnchorHostActionTarget(target: HTMLElement, anchor: HTMLElement): (() => void) | null {
    return this.hostMenuPositioning.temporarilyAnchorHostActionTarget(target, anchor);
  }

  private scheduleHostActionTargetRestore(restore: () => void, frames: number): void {
    this.hostMenuPositioning.scheduleHostActionTargetRestore(restore, frames);
  }

  private restoreAnchoredHostMenuStyle(): void {
    this.hostMenuPositioning.restoreAnchoredHostMenuStyle();
  }

  private clearPendingHostMoreActionRestore(): void {
    const restore = this.pendingHostMoreActionRestore;
    this.pendingHostMoreActionRestore = null;
    restore?.();
  }

  private positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void {
    this.hostMenuPositioning.positionVisibleHostMenuToAnchor(menu, anchor);
  }

  private findExactMessageHostActionButton(
    preferredMessageIds: string[],
    action: ArchiveEntryAction,
  ): HTMLElement | null {
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
          this.isElementVisible(candidate) &&
          !isTurboRenderUiNode(candidate)
        ) {
          return candidate;
        }
      }
    }
    return null;
  }

  private findScopedHostActionButton(
    searchRoots: HTMLElement[],
    action: ArchiveEntryAction,
  ): HTMLElement | null {
    if (searchRoots.length === 0) {
      return null;
    }

    for (const root of searchRoots) {
      const candidate = findHostActionButton(root, action);
      if (
        candidate != null &&
        this.isElementVisible(candidate) &&
        !isTurboRenderUiNode(candidate)
      ) {
        return candidate;
      }
    }

    return null;
  }

  private findGlobalHostActionButton(
    anchor: HTMLElement | null,
    action: ArchiveEntryAction,
    entry: ManagedHistoryEntry,
  ): HTMLElement | null {
    // 性能优化：限制搜索范围，避免查询整个文档
    // 优先在 anchor 附近或主内容区域搜索，而不是整个文档
    const searchRoot = this.findSearchRoot(anchor);
    const allElements = searchRoot.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"], a');

    // 限制最大检查数量，防止处理过多元素导致卡顿
    const maxElementsToCheck = 100;
    const candidates: HTMLElement[] = [];

    let checkedCount = 0;
    for (const candidate of allElements) {
      if (checkedCount >= maxElementsToCheck) break;
      checkedCount++;

      if (isTurboRenderUiNode(candidate)) continue;
      // 使用快速检查替代 isElementVisible 以提高性能
      if (!this.isElementQuickVisible(candidate)) continue;
      if (!matchesHostActionCandidate(candidate, action)) continue;
      candidates.push(candidate);
    }

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

    // 批量获取位置信息，减少重排次数
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
  }

  /**
   * 查找搜索根节点 - 限制搜索范围以提高性能
   */
  private findSearchRoot(anchor: HTMLElement | null): HTMLElement | Document {
    if (anchor != null) {
      // 优先在 anchor 的 article 或 section 父元素内搜索
      const container = anchor.closest<HTMLElement>('article, section, [data-testid^="conversation-turn-"], main');
      if (container != null) {
        return container;
      }
    }
    // 在主内容区域搜索
    const mainContent = this.doc.querySelector<HTMLElement>('main, [role="main"], .flex-1.overflow-hidden');
    if (mainContent != null) {
      return mainContent;
    }
    // 降级：在整个文档搜索（但这不是理想情况）
    return this.doc;
  }

  /**
   * 快速可见性检查 - 使用带缓存的 isElementVisible
   */
  private isElementQuickVisible(element: HTMLElement): boolean {
    return this.isElementVisible(element);
  }

  private fallbackClickWithNodeSearch(
    groupId: string,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
    scrollTarget: HTMLElement | null,
    previousScrollTop: number | null,
    preferPreciseHostBinding: boolean,
    shouldRestoreScrollAfterAction: boolean,
    shouldSuppressMutationsForAction: boolean,
    dispatchAnchoredHostAction: (candidate: HTMLElement) => void,
  ): boolean {
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
        this.mutationObserverManager.setIgnoreMutations(500);
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

    this.mutationObserverManager.setIgnoreMutations(128);
    if (!this.parkingLot.restoreGroup(groupId)) {
      return false;
    }

    for (const turnId of parkedGroup.turnIds) {
      const parkedRecord = this.getRecordForEntry({ liveTurnId: turnId } as ManagedHistoryEntry);
      if (parkedRecord != null) {
        parkedRecord.parked = false;
      }
    }

    try {
      dispatchAnchoredHostAction(button);
      return true;
    } finally {
      this.mutationObserverManager.setIgnoreMutations(128);
      if (shouldRestoreScrollAfterAction) {
        this.restoreExactScrollTop(scrollTarget, previousScrollTop);
      }
    }
  }

  // 全局 messageId 到元素映射缓存，用于批量查询优化
  private messageIdElementCache: Map<string, HTMLElement[]> | null = null;
  private messageIdCacheVersion = 0;

  private buildMessageIdCache(): Map<string, HTMLElement[]> {
    performance.now();
      const cache = new Map<string, HTMLElement[]>();
    
    // 限制搜索范围
    const searchRoot = this.findSearchRoot(null);
    
    // 一次性查询所有可能的 message 元素
    const allMessageElements = searchRoot.querySelectorAll<HTMLElement>(
      '[data-message-id], [data-host-message-id]'
    );
    
    // 构建 messageId -> elements[] 映射
    for (const el of allMessageElements) {
      if (isTurboRenderUiNode(el)) continue;
      
      const msgId = el.getAttribute('data-message-id')?.trim() || 
                   el.getAttribute('data-host-message-id')?.trim();
      if (msgId) {
        const existing = cache.get(msgId) || [];
        if (!existing.includes(el)) {
          existing.push(el);
          cache.set(msgId, existing);
        }
      }
    }
    
    return cache;
  }

  private collectHostSearchRootsForEntry(groupId: string, entry: ManagedHistoryEntry): HTMLElement[] {
    // 检查缓存
    const cacheKey = this.getSearchRootsCacheKey(entry);
    const cached = this.searchRootsCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    
    const messageIds = [
      this.findRenderedArchiveMessageIdForEntry(groupId, entry),
      resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId),
      this.findHostMessageIdForEntry(entry, groupId),
    ]
      .map((candidate) => candidate?.trim() ?? '')
      .filter((candidate, index, values) => candidate.length > 0 && values.indexOf(candidate) === index);

    // 使用批量查询缓存
    if (!this.messageIdElementCache) {
      this.messageIdElementCache = this.buildMessageIdCache();
    }
    
    const searchRoots: HTMLElement[] = [];
    const cache = this.messageIdElementCache;
    
    // 限制 parent 遍历深度，避免遍历整个 DOM 树
    const MAX_PARENT_DEPTH = 5;
    
    for (const messageId of messageIds) {
      const elements = cache.get(messageId);
      if (!elements) continue;
      
      for (const messageRoot of elements) {
        let current: HTMLElement | null = messageRoot;
        let depth = 0;
        while (current != null && current !== this.doc.body && depth < MAX_PARENT_DEPTH) {
          if (!isTurboRenderUiNode(current) && !searchRoots.includes(current)) {
            searchRoots.push(current);
          }
          current = current.parentElement;
          depth++;
        }
      }
    }

    if (searchRoots.length > 0) {
      this.searchRootsCache.set(cacheKey, searchRoots);
      return searchRoots;
    }

    // 回退到 record node
    const record = this.getRecordForEntry(entry);
    const node = record?.node ?? null;
    let current: HTMLElement | null = node;
    while (current != null) {
      if (!isTurboRenderUiNode(current) && !searchRoots.includes(current)) {
        searchRoots.push(current);
      }
      current = current.parentElement;
    }

    this.searchRootsCache.set(cacheKey, searchRoots);
    return searchRoots;
  }
}
