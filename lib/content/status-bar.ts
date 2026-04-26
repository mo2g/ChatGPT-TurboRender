import { TURBO_RENDER_UI_ROOT_ATTRIBUTE, UI_CLASS_NAMES } from '../shared/constants';
import { getChatIdFromPathname, getRouteIdFromRuntimeId } from '../shared/chat-id';
import { buildInteractionPairs } from '../shared/interaction-pairs';
import { createTranslator, type Translator } from '../shared/i18n';
import type {
  ArchivePageMeta,
  HistoryAnchorMode,
  ManagedHistoryEntry,
  ManagedHistoryGroup,
  TabRuntimeStatus,
} from '../shared/types';

import type {
  ArchiveEntryAction,
  EntryActionAvailability,
  EntryActionAvailabilityMap,
  EntryActionMenuSelection,
  EntryActionRequest,
  EntryActionSelection,
  EntryActionTemplateMap,
  EntryActionSelectionMap,
  EntryMoreMenuAction,
  HostActionTemplateSnapshot,
} from './message-actions';
import {
  ENTRY_ACTION_LANE,
  findHostActionButton,
  getArchiveEntrySelectionKey,
  instantiateHostActionTemplate,
  isEntryActionEnabled,
} from './message-actions';
import { renderManagedHistoryEntryBody } from './history-entry-renderer';
import {
  ENTRY_ACTION_TEST_IDS,
  createCheckIcon,
  createSvgIcon,
} from './status-bar-icons';
import { ensureTurboRenderStyles } from './status-bar-styles';
import { isSupplementalHistoryEntry, resolvePreferredMessageId } from './managed-history';
import type { ArchivePageMatch } from '../shared/types';

export interface StatusBarState {
  conversationId: string | null;
  archivePageCount: number;
  currentArchivePageIndex: number | null;
  currentArchivePageMeta: ArchivePageMeta | null;
  isRecentView: boolean;
  archiveGroups: ManagedHistoryGroup[];
  archiveSearchOpen: boolean;
  archiveSearchQuery: string;
  archiveSearchResults: ArchivePageMatch[];
  activeArchiveSearchPageIndex: number | null;
  activeArchiveSearchPairIndex: number | null;
  collapsedBatchCount: number;
  expandedBatchCount: number;
  entryActionAvailability: EntryActionAvailabilityMap;
  entryActionSelection: EntryActionSelectionMap;
  entryActionTemplates: EntryActionTemplateMap;
  entryHostMessageIds: Record<string, string>;
  entryActionMenu: EntryActionMenuSelection | null;
  entryActionSpeakingEntryKey: string | null;
  entryActionCopiedEntryKey: string | null;
  showShareActions: boolean;
  preferHostMorePopover: boolean;
}

export interface StatusBarActions {
  onOpenNewestArchivePage(): void;
  onGoOlderArchivePage(): void;
  onGoNewerArchivePage(): void;
  onGoToRecentArchiveView(): void;
  onToggleArchiveSearch(): void;
  onArchiveSearchQueryChange(query: string): void;
  onClearArchiveSearch(): void;
  onOpenArchiveSearchResult(result: ArchivePageMatch): void;
  onToggleArchiveGroup(groupId: string, anchor: HTMLElement | null): void;
  onEntryAction(request: EntryActionRequest): void;
  onMoreMenuAction(request: {
    groupId: string;
    entryId: string;
    action: EntryMoreMenuAction;
  }): void;
}

interface BatchCardView {
  root: HTMLElement;
  main: HTMLElement;
  header: HTMLElement;
  meta: HTMLElement;
  summary: HTMLElement;
  rail: HTMLElement;
  button: HTMLButtonElement;
  preview: HTMLElement;
  entries: HTMLElement;
  previewKey: string;
  entriesKey: string;
  entriesRendered: boolean;
  expanded: boolean;
}

const INLINE_ROOT_ATTRIBUTE = 'data-turbo-render-inline-history-root';

function getSlotSummaryText(t: Translator, group: ManagedHistoryGroup): string {
  return t('historyBatchSummary', {
    start: group.slotPairStartIndex + 1,
    end: group.slotPairEndIndex + 1,
  });
}

function getFilledSummaryText(t: Translator, group: ManagedHistoryGroup): string {
  if (group.filledPairCount >= group.capacity) {
    return getSlotSummaryText(t, group);
  }
  return `${getSlotSummaryText(t, group)} · ${group.filledPairCount}/${group.capacity}`;
}

export class StatusBar {
  private root: HTMLElement | null = null;
  private groupsRoot: HTMLElement | null = null;
  private currentStatus: TabRuntimeStatus | null = null;
  private currentState: StatusBarState | null = null;
  private currentConversationId: string | null = null;
  private readonly groupViews = new Map<string, BatchCardView>();
  private forceRender = true;
  private t: Translator = createTranslator('en');
  private cachedTopPageChromeOffset = 0;
  private pageChromeOffsetDirty = true;
  private pageChromeLayoutSignature = '';
  private resizeListenerBound = false;

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  setTranslator(translator: Translator): void {
    this.t = translator;
    this.forceRender = true;
    this.render();
  }

  getAnchorMode(): HistoryAnchorMode {
    return 'hidden';
  }

  update(status: TabRuntimeStatus, target: HTMLElement | null, state: StatusBarState): HistoryAnchorMode {
    this.currentStatus = status;
    this.currentState = state;
    const nextConversationId = state.conversationId?.trim() ?? null;
    if (nextConversationId !== this.currentConversationId) {
      this.currentConversationId = nextConversationId;
    }
    this.mount(target);
    this.render();
    return 'hidden';
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.groupsRoot = null;
    this.groupViews.clear();
    if (this.resizeListenerBound) {
      this.doc.defaultView?.removeEventListener('resize', this.handleWindowResize);
      this.resizeListenerBound = false;
    }
    this.pageChromeOffsetDirty = true;
    this.pageChromeLayoutSignature = '';
  }

  focusArchive(): void {}

  focusEntry(): boolean {
    return false;
  }

  getBatchCardAnchor(groupId: string): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"]`,
    ) ?? null;
  }

  getBatchCardHeaderAnchor(groupId: string): HTMLElement | null {
    return (
      this.root?.querySelector<HTMLElement>(
        `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] .${UI_CLASS_NAMES.inlineBatchAction}`,
      ) ??
      this.root?.querySelector<HTMLElement>(
        `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] .${UI_CLASS_NAMES.inlineBatchHeader}`,
      ) ??
      null
    );
  }

  getBatchCardActionButton(groupId: string): HTMLButtonElement | null {
    return this.root?.querySelector<HTMLButtonElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] .${UI_CLASS_NAMES.inlineBatchAction}`,
    ) ?? null;
  }

  getBatchCardPairAnchor(groupId: string, pairIndex: number): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"] [data-pair-index="${pairIndex}"]`,
    ) ?? null;
  }

  getEntryActionAnchor(groupId: string, entryId: string): HTMLElement | null {
    if (this.root == null) {
      return null;
    }
    const selector = `.${UI_CLASS_NAMES.historyEntryActions}[data-group-id="${groupId}"][data-entry-id="${entryId}"]`;
    const anchors = [...this.root.querySelectorAll<HTMLElement>(selector)];
    return anchors.find((candidate) => candidate.getClientRects().length > 0) ?? anchors[0] ?? null;
  }

  getEntryActionButton(groupId: string, entryId: string, action: ArchiveEntryAction): HTMLElement | null {
    if (this.root == null) {
      return null;
    }
    const selector = `.${UI_CLASS_NAMES.historyEntryActions}[data-group-id="${groupId}"][data-entry-id="${entryId}"] button[data-turbo-render-action="${action}"]`;
    const buttons = [...this.root.querySelectorAll<HTMLElement>(selector)];
    return buttons.find((candidate) => candidate.getClientRects().length > 0) ?? buttons[0] ?? null;
  }

  getEntryBody(groupId: string, entryId: string): HTMLElement | null {
    if (this.root == null) {
      return null;
    }
    const selector = `.${UI_CLASS_NAMES.historyEntryBody}[data-group-id="${groupId}"][data-entry-id="${entryId}"]`;
    const bodies = [...this.root.querySelectorAll<HTMLElement>(selector)];
    return bodies.find((candidate) => candidate.getClientRects().length > 0) ?? bodies[0] ?? null;
  }

  getTopPageChromeOffset(): number {
    this.syncPageChromeOffset();
    return this.cachedTopPageChromeOffset;
  }

  private getBoundaryButton(action: string): HTMLButtonElement | null {
    return this.root?.querySelector<HTMLButtonElement>(`button[data-turbo-render-action="${action}"]`) ?? null;
  }

  private getSearchPanel(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-turbo-render-search-panel="true"]`) ?? null;
  }

  private getSearchInput(): HTMLInputElement | null {
    return this.root?.querySelector<HTMLInputElement>(`input[data-turbo-render-action="archive-search-input"]`) ?? null;
  }

  private getSearchSummary(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-turbo-render-search-summary="true"]`) ?? null;
  }

  private getSearchResultsRoot(): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(`[data-turbo-render-search-results="true"]`) ?? null;
  }

  private mount(target: HTMLElement | null): void {
    ensureTurboRenderStyles(this.doc);
    if (target == null) {
      return;
    }

    if (this.root == null) {
      this.root = this.doc.createElement('section');
      this.root.className = UI_CLASS_NAMES.inlineHistoryRoot;
      this.root.setAttribute(INLINE_ROOT_ATTRIBUTE, 'true');
      this.root.setAttribute(TURBO_RENDER_UI_ROOT_ATTRIBUTE, 'true');
      this.root.innerHTML = `
        <div class="${UI_CLASS_NAMES.inlineHistoryToolbar} ${UI_CLASS_NAMES.inlineHistoryBoundary}">
          <p class="${UI_CLASS_NAMES.inlineHistorySummary} ${UI_CLASS_NAMES.inlineHistoryBoundarySummary}"></p>
          <div class="${UI_CLASS_NAMES.inlineHistoryBoundaryActions}">
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="open-archive-newest"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="go-archive-older"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="go-archive-newer"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="go-archive-recent"></button>
            <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton}" data-turbo-render-action="toggle-archive-search"></button>
          </div>
          <div class="${UI_CLASS_NAMES.inlineHistorySearch}">
            <div class="${UI_CLASS_NAMES.inlineHistorySearchPanel}" data-turbo-render-search-panel="true" hidden>
              <div class="${UI_CLASS_NAMES.inlineHistorySearchHeader}">
                <input type="search" class="${UI_CLASS_NAMES.inlineHistorySearchInput}" data-turbo-render-action="archive-search-input" />
                <button type="button" class="${UI_CLASS_NAMES.inlineHistoryBoundaryButton} ${UI_CLASS_NAMES.inlineHistorySearchClear}" data-turbo-render-action="clear-archive-search"></button>
              </div>
              <p class="${UI_CLASS_NAMES.inlineHistorySummary}" data-turbo-render-search-summary="true"></p>
              <div class="${UI_CLASS_NAMES.inlineHistorySearchResults}" data-turbo-render-search-results="true"></div>
            </div>
          </div>
        </div>
        <div class="${UI_CLASS_NAMES.archiveGroups}"></div>
      `;
      this.groupsRoot = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.archiveGroups}`);
      this.getBoundaryButton('open-archive-newest')?.addEventListener('click', () => {
        this.actions.onOpenNewestArchivePage();
      });
      this.getBoundaryButton('go-archive-older')?.addEventListener('click', () => {
        this.actions.onGoOlderArchivePage();
      });
      this.getBoundaryButton('go-archive-newer')?.addEventListener('click', () => {
        this.actions.onGoNewerArchivePage();
      });
      this.getBoundaryButton('go-archive-recent')?.addEventListener('click', () => {
        this.actions.onGoToRecentArchiveView();
      });
      this.getBoundaryButton('toggle-archive-search')?.addEventListener('click', () => {
        this.actions.onToggleArchiveSearch();
      });
      this.getSearchInput()?.addEventListener('input', (event) => {
        const targetInput = event.currentTarget;
        if (!(targetInput instanceof HTMLInputElement)) {
          return;
        }
        this.actions.onArchiveSearchQueryChange(targetInput.value);
      });
      this.getBoundaryButton('clear-archive-search')?.addEventListener('click', () => {
        this.actions.onClearArchiveSearch();
      });
    }

    if (!this.resizeListenerBound) {
      this.doc.defaultView?.addEventListener('resize', this.handleWindowResize, { passive: true });
      this.resizeListenerBound = true;
    }

    if (this.root.parentElement !== target.parentElement || this.root.nextElementSibling !== target) {
      target.parentElement?.insertBefore(this.root, target);
      this.markPageChromeOffsetDirty();
    }
  }

  private render(): void {
    if (this.root == null || this.groupsRoot == null || this.currentState == null) {
      return;
    }

    this.syncPageChromeOffset();
    const hasArchivePages = this.currentState.archivePageCount > 0;
    const visible = hasArchivePages || this.currentState.archiveGroups.length > 0;
    this.root.hidden = !visible;
    if (!visible) {
      return;
    }

    const boundary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineHistoryBoundary}`);
    if (boundary != null) {
      boundary.hidden = !hasArchivePages;
    }

    const summary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineHistoryBoundarySummary}`);
    const nextSummary = !hasArchivePages
      ? this.t('historyPageEmpty')
      : this.currentState.isRecentView
        ? this.t('historyPageSummaryRecent', {
            total: this.currentState.archivePageCount,
          })
        : this.currentState.currentArchivePageMeta != null
          ? this.t('historyPageSummary', {
              page: this.currentState.currentArchivePageMeta.pageIndex + 1,
              total: this.currentState.currentArchivePageMeta.pageCount,
              start: this.currentState.currentArchivePageMeta.pairStartIndex + 1,
              end: this.currentState.currentArchivePageMeta.pairEndIndex + 1,
            })
          : this.t('historyPageEmpty');
    if (summary != null) {
      if (summary.textContent !== nextSummary) {
        summary.textContent = nextSummary;
      }
    }

    const openNewestButton = this.getBoundaryButton('open-archive-newest');
    if (openNewestButton != null) {
      openNewestButton.textContent = this.t('historyPageOpenNewest');
      openNewestButton.disabled = !hasArchivePages;
    }

    const olderButton = this.getBoundaryButton('go-archive-older');
    if (olderButton != null) {
      olderButton.textContent = this.t('historyPageOlder');
      olderButton.disabled = !hasArchivePages || this.currentState.currentArchivePageIndex == null || this.currentState.currentArchivePageIndex <= 0;
    }

    const newerButton = this.getBoundaryButton('go-archive-newer');
    if (newerButton != null) {
      newerButton.textContent = this.t('historyPageNewer');
      newerButton.disabled =
        !hasArchivePages ||
        this.currentState.currentArchivePageIndex == null ||
        this.currentState.currentArchivePageIndex >= this.currentState.archivePageCount - 1;
    }

    const recentButton = this.getBoundaryButton('go-archive-recent');
    if (recentButton != null) {
      recentButton.textContent = this.t('historyPageRecent');
      recentButton.disabled = !hasArchivePages || this.currentState.isRecentView;
    }

    const searchToggleButton = this.getBoundaryButton('toggle-archive-search');
    if (searchToggleButton != null) {
      searchToggleButton.textContent = this.currentState.archiveSearchOpen
        ? this.t('historyPageSearchClose')
        : this.t('historyPageSearchOpen');
      searchToggleButton.disabled = !hasArchivePages;
      searchToggleButton.setAttribute('aria-expanded', String(this.currentState.archiveSearchOpen));
    }

    this.renderArchiveSearch(hasArchivePages);

    this.syncGroupCards(this.currentState.archiveGroups);
    this.positionOpenEntryActionMenus();
    this.forceRender = false;
  }

  private renderArchiveSearch(hasArchivePages: boolean): void {
    if (this.currentState == null) {
      return;
    }

    const panel = this.getSearchPanel();
    const input = this.getSearchInput();
    const summary = this.getSearchSummary();
    const resultsRoot = this.getSearchResultsRoot();
    const clearButton = this.getBoundaryButton('clear-archive-search');
    const query = this.currentState.archiveSearchQuery;
    const trimmedQuery = query.trim();
    const results = this.currentState.archiveSearchResults;
    const isPanelVisible = hasArchivePages && this.currentState.archiveSearchOpen;

    if (panel != null) {
      panel.hidden = !isPanelVisible;
    }

    if (input != null) {
      input.placeholder = this.t('historyPageSearchPlaceholder');
      input.disabled = !hasArchivePages;
      if (input.value !== query) {
        input.value = query;
      }
    }

    if (clearButton != null) {
      clearButton.textContent = this.t('historyPageSearchClear');
      clearButton.disabled = trimmedQuery.length === 0;
    }

    if (summary != null) {
      summary.textContent =
        trimmedQuery.length === 0
          ? this.t('historyPageSearchHint')
          : results.length === 0
            ? this.t('historyPageSearchNoResults')
            : this.t('historyPageSearchResults', { count: results.length });
    }

    if (resultsRoot == null) {
      return;
    }

    resultsRoot.replaceChildren();
    if (trimmedQuery.length === 0 || results.length === 0) {
      return;
    }

    for (const result of results) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = UI_CLASS_NAMES.inlineHistorySearchResult;
      button.dataset.turboRenderAction = 'open-archive-search-result';
      button.dataset.pageIndex = String(result.pageIndex);
      button.dataset.pairIndex = String(result.firstMatchPairIndex);
      button.setAttribute('aria-label', this.t('historyPageSearchResultOpen'));
      button.classList.toggle(
        UI_CLASS_NAMES.inlineHistorySearchResultActive,
        this.currentState.activeArchiveSearchPageIndex === result.pageIndex &&
          this.currentState.activeArchiveSearchPairIndex === result.firstMatchPairIndex,
      );
      button.addEventListener('click', () => {
        this.actions.onOpenArchiveSearchResult(result);
      });

      const meta = this.doc.createElement('span');
      meta.className = UI_CLASS_NAMES.inlineHistorySearchResultMeta;
      meta.textContent = this.t('historyPageSearchResultSummary', {
        page: result.pageIndex + 1,
        total: result.pageCount,
        start: result.pairStartIndex + 1,
        end: result.pairEndIndex + 1,
        count: result.matchCount,
      });

      const excerpt = this.doc.createElement('span');
      excerpt.className = UI_CLASS_NAMES.inlineHistorySearchResultExcerpt;
      excerpt.textContent = result.excerpt;

      button.append(meta, excerpt);
      resultsRoot.append(button);
    }
  }

  private readonly handleWindowResize = (): void => {
    this.markPageChromeOffsetDirty();
    this.syncPageChromeOffset();
  };

  private markPageChromeOffsetDirty(): void {
    this.pageChromeOffsetDirty = true;
  }

  private computePageChromeLayoutSignature(): string {
    const rect = this.root?.getBoundingClientRect();
    if (rect == null) {
      return '';
    }
    return [
      Math.round(rect.left),
      Math.round(rect.right),
      Math.round(rect.width),
    ].join(':');
  }

  private syncPageChromeOffset(): void {
    if (this.root == null) {
      return;
    }

    const layoutSignature = this.computePageChromeLayoutSignature();
    if (layoutSignature !== this.pageChromeLayoutSignature) {
      this.pageChromeLayoutSignature = layoutSignature;
      this.pageChromeOffsetDirty = true;
    }

    if (this.pageChromeOffsetDirty) {
      this.cachedTopPageChromeOffset = this.getPageHeaderOffset();
      this.pageChromeOffsetDirty = false;
    }

    this.root.style.setProperty('--turbo-render-page-header-offset', `${this.cachedTopPageChromeOffset}px`);
  }

  private getPageHeaderOffset(): number {
    const legacyOffset = this.getLegacyPageHeaderOffset();
    const sampledOffset = this.getSampledTopChromeOffset();
    const rawOffset = Math.max(legacyOffset, sampledOffset);
    const viewportHeight = this.doc.defaultView?.innerHeight ?? 0;
    if (viewportHeight <= 0) {
      return Math.max(0, Math.round(rawOffset));
    }

    const maxOffset = Math.max(0, Math.round(viewportHeight - 24));
    return Math.min(maxOffset, Math.max(0, Math.round(rawOffset)));
  }

  private getLegacyPageHeaderOffset(): number {
    const selectors = ['header.page-header', '[data-testid="page-header"]', '.page-header'];
    for (const selector of selectors) {
      const element = this.doc.querySelector<HTMLElement>(selector);
      if (element == null) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (rect.height > 0 || rect.bottom > 0) {
        return Math.max(0, Math.round(rect.bottom));
      }
    }

    return 0;
  }

  private getSampledTopChromeOffset(): number {
    const win = this.doc.defaultView;
    if (win == null || typeof this.doc.elementsFromPoint !== 'function') {
      return 0;
    }

    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return 0;
    }

    const contentRect = this.getPrimaryContentRect(viewportWidth);
    const minX = Math.max(1, Math.round(contentRect.left + 8));
    const maxX = Math.min(viewportWidth - 1, Math.round(contentRect.right - 8));
    if (maxX < minX) {
      return 0;
    }

    const centerX = Math.round((minX + maxX) / 2);
    const sampleXs = [...new Set([minX, centerX, maxX])];
    const maxSampleY = Math.max(1, Math.min(viewportHeight - 1, 220));
    let offset = 0;

    for (let y = 1; y <= maxSampleY; y += 8) {
      for (const x of sampleXs) {
        const stack = this.doc.elementsFromPoint(x, y);
        for (const candidate of stack) {
          if (!(candidate instanceof HTMLElement)) {
            continue;
          }
          if (candidate.closest(`[${TURBO_RENDER_UI_ROOT_ATTRIBUTE}]`) != null) {
            continue;
          }

          const style = win.getComputedStyle(candidate);
          const isSemanticTopChrome =
            candidate.matches('header, [role="banner"], [data-testid*="header"], [data-testid*="Header"]') ||
            candidate.closest('header, [role="banner"]') != null;
          if (style.position !== 'fixed' && style.position !== 'sticky' && !isSemanticTopChrome) {
            continue;
          }
          if (style.display === 'none' || style.visibility === 'hidden') {
            continue;
          }

          const rect = candidate.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            continue;
          }
          const horizontalOverlap = Math.min(rect.right, contentRect.right) - Math.max(rect.left, contentRect.left);
          if (horizontalOverlap <= 0) {
            continue;
          }
          if (rect.top > y + 1 || rect.bottom < y - 1) {
            continue;
          }

          offset = Math.max(offset, Math.round(rect.bottom));
          break;
        }
      }
    }

    return Math.max(0, offset);
  }

  private getPrimaryContentRect(viewportWidth: number): { left: number; right: number } {
    const rootRect = this.root?.getBoundingClientRect() ?? null;
    if (rootRect == null || rootRect.width <= 0) {
      return {
        left: 0,
        right: viewportWidth,
      };
    }

    return {
      left: Math.max(0, rootRect.left),
      right: Math.min(viewportWidth, rootRect.right),
    };
  }

  private syncGroupCards(groups: ManagedHistoryGroup[]): void {
    if (this.groupsRoot == null) {
      return;
    }

    const nextIds = new Set(groups.map((group) => group.id));
    let layoutChanged = false;
    for (const [groupId, view] of [...this.groupViews.entries()]) {
      if (nextIds.has(groupId)) {
        continue;
      }

      view.root.remove();
      this.groupViews.delete(groupId);
      layoutChanged = true;
    }

    const query = this.currentState?.archiveSearchQuery.trim().toLowerCase() ?? '';
    const conversationId = this.getConversationId() ?? '';
    let anchor: ChildNode | null = this.groupsRoot.firstChild;
    for (const group of groups) {
      const previewKey = this.buildPreviewKey(group, conversationId);
      let view = this.groupViews.get(group.id);
      const shouldBuildEntriesKey = group.expanded || (view?.entriesRendered ?? false);
      const entriesKey = shouldBuildEntriesKey ? this.buildEntriesKey(group, query, conversationId) : '';
      if (view == null) {
        view = this.createBatchCardView(group, query, previewKey, entriesKey);
        this.groupViews.set(group.id, view);
        layoutChanged = true;
      } else if (
        this.forceRender ||
        view.expanded !== group.expanded ||
        view.previewKey !== previewKey ||
        (view.entriesRendered && view.entriesKey !== entriesKey)
      ) {
        this.updateBatchCardView(view, group, query, previewKey, entriesKey);
      }

      const parent = view.root.parentNode;
      if (parent !== this.groupsRoot || (anchor !== null && view.root !== anchor)) {
        this.groupsRoot.insertBefore(view.root, anchor);
      }
      anchor = view.root.nextSibling;
    }

    if (layoutChanged) {
      this.markPageChromeOffsetDirty();
    }
  }

  private positionOpenEntryActionMenus(): void {
    if (this.root == null || this.currentState?.entryActionMenu == null) {
      return;
    }

    const openMenus = this.root.querySelectorAll<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`,
    );
    if (openMenus.length === 0) {
      return;
    }

    const menuGap = 8;
    const viewportPadding = 8;
    const viewportWidth = this.doc.defaultView?.innerWidth ?? 0;
    const viewportHeight = this.doc.defaultView?.innerHeight ?? 0;

    for (const menu of openMenus) {
      const menuGroupId = menu.dataset.groupId ?? '';
      const menuEntryId = menu.dataset.entryId ?? '';
      const menuLane = menu.dataset.lane === 'user' ? 'user' : 'assistant';
      const selector = `button[data-turbo-render-action="more"][data-group-id="${menuGroupId}"][data-entry-id="${menuEntryId}"]`;
      const anchor = menu.closest<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenuAnchor}`) ?? menu.parentElement;
      const button =
        anchor?.querySelector<HTMLElement>(selector) ??
        this.root.querySelector<HTMLElement>(
          `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="${menuLane}"][data-group-id="${menuGroupId}"][data-entry-id="${menuEntryId}"] button[data-turbo-render-action="more"]`,
        ) ??
        this.root.querySelector<HTMLElement>(
          `button[data-turbo-render-action="more"][data-group-id="${menuGroupId}"][data-entry-id="${menuEntryId}"]`,
        );

      if (button == null) {
        continue;
      }

      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      if (menuRect.width <= 0 || menuRect.height <= 0) {
        continue;
      }

      const anchorRect = (anchor ?? button).getBoundingClientRect();
      const preferredViewportLeft =
        menuLane === 'assistant'
          ? buttonRect.right - menuRect.width
          : buttonRect.left;
      const maxLeft = Math.max(viewportPadding, viewportWidth - menuRect.width - viewportPadding);
      const viewportLeft = Math.min(Math.max(viewportPadding, preferredViewportLeft), maxLeft);

      const preferredTop = buttonRect.top - menuRect.height - menuGap;
      const fallbackTop = buttonRect.bottom + menuGap;
      const spaceAbove = buttonRect.top - viewportPadding;
      const spaceBelow = viewportHeight - buttonRect.bottom - viewportPadding;
      const shouldPlaceAbove = preferredTop >= viewportPadding || spaceAbove >= spaceBelow;
      const viewportTop = shouldPlaceAbove
        ? Math.max(viewportPadding, preferredTop)
        : Math.min(Math.max(viewportPadding, fallbackTop), Math.max(viewportPadding, viewportHeight - menuRect.height - viewportPadding));

      menu.style.position = 'absolute';
      menu.style.left = `${Math.round(viewportLeft - anchorRect.left)}px`;
      menu.style.top = `${Math.round(viewportTop - anchorRect.top)}px`;
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
      menu.style.transform = 'none';
      menu.style.zIndex = '50';
      menu.dataset.side = shouldPlaceAbove ? 'top' : 'bottom';
      menu.dataset.popoverPosition = 'anchored';
    }
  }

  private buildPreviewKey(group: ManagedHistoryGroup, conversationId: string): string {
    return [
      conversationId,
      group.matchCount,
      group.userPreview,
      group.assistantPreview,
      group.slotPairStartIndex,
      group.slotPairEndIndex,
      group.filledPairCount,
      group.capacity,
    ].join('||');
  }

  private buildEntriesKey(group: ManagedHistoryGroup, query: string, conversationId: string): string {
    const routeKind = this.currentStatus?.routeKind ?? 'unknown';
    const entriesKey = group.entries
      .map((entry) => {
        const lane = entry.role === 'user' ? 'user' : entry.role === 'assistant' ? 'assistant' : null;
        const supplemental = isSupplementalHistoryEntry(entry);
        const entryKey = getArchiveEntrySelectionKey(entry);
        const menuState = this.currentState?.entryActionMenu;
        const menuOpen = supplemental || menuState?.entryId !== entryKey || menuState?.groupId !== group.id ? '0' : '1';
        return [
          entry.id,
          entryKey,
          entry.role,
          entry.renderKind,
          entry.hiddenFromConversation ? '1' : '0',
          entry.liveTurnId ?? '',
          supplemental ? '' : this.currentState?.entryHostMessageIds[entryKey] ?? '',
          entry.text,
          entry.contentType ?? '',
          entry.snapshotHtml ?? '',
          entry.structuredDetails ?? '',
          supplemental ? '' : this.currentState?.entryActionSelection[entryKey] ?? '',
          menuOpen,
          supplemental || this.currentState?.entryActionSpeakingEntryKey !== entryKey ? '0' : '1',
          supplemental || this.currentState?.entryActionCopiedEntryKey !== entryKey ? '0' : '1',
          supplemental || lane == null ? '' : this.currentState?.entryActionTemplates[lane]?.html ?? '',
          supplemental || lane == null ? '' : this.buildActionTemplateIconKey(lane),
          supplemental || lane == null ? '' : String(this.currentState?.entryActionTemplates[lane]?.edgeInsetPx ?? ''),
        ].join(':');
      })
      .join('|');
    const actionsKey = group.entries
      .map((entry) => {
        const availability = this.getEntryActionAvailability(entry);
        return [
          entry.id,
          availability.copy,
          availability.like,
          availability.dislike,
          availability.share,
          availability.more,
        ].join(':');
      })
      .join('|');

    return [
      routeKind,
      conversationId,
      query,
      group.slotPairStartIndex,
      group.slotPairEndIndex,
      group.filledPairCount,
      group.capacity,
      group.userPreview,
      group.assistantPreview,
      this.currentState?.activeArchiveSearchPageIndex ?? '',
      this.currentState?.activeArchiveSearchPairIndex ?? '',
      entriesKey,
      actionsKey,
      this.currentState?.showShareActions ? '1' : '0',
    ].join('||');
  }

  private buildActionTemplateIconKey(lane: 'user' | 'assistant'): string {
    const iconHtmlByAction = this.currentState?.entryActionTemplates[lane]?.iconHtmlByAction;
    if (iconHtmlByAction == null) {
      return '';
    }

    return ENTRY_ACTION_LANE[lane]
      .map((action) => `${action}=${iconHtmlByAction[action] ?? ''}`)
      .join('&');
  }

  private createBatchCardView(
    group: ManagedHistoryGroup,
    query: string,
    previewKey: string,
    entriesKey: string,
  ): BatchCardView {
    const root = this.doc.createElement('section');
    root.className = UI_CLASS_NAMES.inlineBatchCard;
    root.dataset.groupId = group.id;
    root.dataset.turboRenderBatchAnchor = 'true';
    root.dataset.state = group.expanded ? 'expanded' : 'collapsed';
    root.dataset.conversationId = this.getConversationId() ?? '';

    const header = this.doc.createElement('div');
    header.className = UI_CLASS_NAMES.inlineBatchHeader;

    const meta = this.doc.createElement('div');
    meta.className = UI_CLASS_NAMES.inlineBatchMeta;

    const summary = this.doc.createElement('strong');
    meta.append(summary);

    const preview = this.doc.createElement('div');
    preview.className = UI_CLASS_NAMES.inlineBatchPreview;

    const entries = this.doc.createElement('div');
    entries.className = UI_CLASS_NAMES.inlineBatchEntries;

    const rail = this.doc.createElement('div');
    rail.className = UI_CLASS_NAMES.inlineBatchRail;
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = UI_CLASS_NAMES.inlineBatchAction;
    button.dataset.action = 'toggle-archive-group';
    button.dataset.turboRenderAction = 'toggle-archive-group';
    button.dataset.groupId = group.id;
    button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    button.setAttribute('aria-expanded', String(group.expanded));
    this.bindHostEventShield(button);
    button.addEventListener('click', () => this.actions.onToggleArchiveGroup(group.id, button));
    rail.append(button);

    const main = this.doc.createElement('div');
    main.className = UI_CLASS_NAMES.inlineBatchMain;
    header.append(meta);
    main.append(header, preview, entries);
    root.append(main, rail);

    const view: BatchCardView = {
      root,
      main,
      header,
      meta,
      summary,
      rail,
      button,
      preview,
      entries,
      previewKey: '',
      entriesKey: '',
      entriesRendered: false,
      expanded: !group.expanded,
    };
    this.updateBatchCardView(view, group, query, previewKey, entriesKey, true);
    return view;
  }

  private updateBatchCardView(
    view: BatchCardView,
    group: ManagedHistoryGroup,
    query: string,
    previewKey: string,
    entriesKey: string,
    force = false,
  ): void {
    const nextExpanded = group.expanded;
    const expandedChanged = view.expanded !== nextExpanded;
    const previewChanged = view.previewKey !== previewKey;
    const entriesChanged = view.entriesRendered && view.entriesKey !== entriesKey;
    if (!force && !previewChanged && !entriesChanged && !expandedChanged) {
      return;
    }

    view.root.classList.toggle(UI_CLASS_NAMES.inlineBatchHighlight, group.matchCount > 0);
    view.root.dataset.groupId = group.id;
    view.root.dataset.conversationId = this.getConversationId() ?? '';
    view.root.dataset.state = nextExpanded ? 'expanded' : 'collapsed';
    view.summary.textContent = getFilledSummaryText(this.t, group);
    view.button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    view.button.setAttribute('aria-expanded', String(group.expanded));

    if (force || previewChanged) {
      this.renderCollapsedPreview(view.preview, group);
      view.previewKey = previewKey;
    }
    view.preview.hidden = nextExpanded;

    const shouldRenderEntries = nextExpanded
      ? force || entriesChanged || !view.entriesRendered
      : view.entriesRendered && (force || entriesChanged);
    if (shouldRenderEntries) {
      this.renderExpandedEntries(view.entries, group, query);
      view.entriesKey = entriesKey;
      view.entriesRendered = true;
    }
    view.entries.hidden = !nextExpanded;
    view.expanded = nextExpanded;

    if (force || expandedChanged || shouldRenderEntries) {
      this.markPageChromeOffsetDirty();
    }
  }

  private renderCollapsedPreview(preview: HTMLElement, group: ManagedHistoryGroup): void {
    preview.replaceChildren();

    if (group.userPreview.length > 0) {
      const user = this.doc.createElement('p');
      user.textContent = this.t('historyBatchPreviewUser', { text: group.userPreview });
      preview.append(user);
    }
    if (group.assistantPreview.length > 0) {
      const assistant = this.doc.createElement('p');
      assistant.textContent = this.t('historyBatchPreviewAssistant', { text: group.assistantPreview });
      preview.append(assistant);
    }
    if (group.matchCount > 0) {
      const matches = this.doc.createElement('p');
      matches.className = UI_CLASS_NAMES.inlineBatchMatches;
      matches.textContent = this.t('historyBatchMatches', { count: group.matchCount });
      preview.append(matches);
    }
  }

  private renderExpandedEntries(entries: HTMLElement, group: ManagedHistoryGroup, query: string): void {
    entries.replaceChildren();
    const currentPageIndex = this.currentState?.currentArchivePageIndex ?? null;
    const activeSearchPairIndex =
      currentPageIndex != null && this.currentState?.activeArchiveSearchPageIndex === currentPageIndex
        ? this.currentState.activeArchiveSearchPairIndex
        : null;
    let highlighted =
      activeSearchPairIndex != null &&
      activeSearchPairIndex >= group.pairStartIndex &&
      activeSearchPairIndex <= group.pairEndIndex;

    for (const pair of buildInteractionPairs(
      group.entries.map((entry) => ({
        ...entry,
        text: entry.text,
      })),
    )) {
      const visibleEntries = pair.entries.filter((entry) => !entry.hiddenFromConversation);
      if (visibleEntries.length === 0) {
        continue;
      }

      const article = this.doc.createElement('article');
      article.className = UI_CLASS_NAMES.inlineBatchEntry;
      this.applyEntryMetadata(article, group, null);
      const pairIndex = pair.entries[0]?.pairIndex ?? null;
      if (pairIndex != null) {
        article.dataset.pairIndex = String(pairIndex);
      }
      const isSearchTarget = activeSearchPairIndex != null && pairIndex === activeSearchPairIndex;
      if (isSearchTarget) {
        article.classList.add(UI_CLASS_NAMES.inlineBatchSearchHighlight);
      } else if (!highlighted && query.length > 0 && pair.searchText.toLowerCase().includes(query)) {
        article.classList.add(UI_CLASS_NAMES.inlineBatchHighlight);
        highlighted = true;
      }

      for (const entry of visibleEntries) {
        const lane = entry.role === 'user' ? 'user' : 'assistant';
        const frame = this.doc.createElement('div');
        frame.className = UI_CLASS_NAMES.historyEntryFrame;
        frame.dataset.lane = lane;
        this.applyEntryMetadata(frame, group, entry);
        const body = this.createEntryBody(group, entry);
        const renderedHostMessageId = this.resolveRenderedBodyMessageId(body, lane);
        if (renderedHostMessageId != null) {
          this.applyResolvedMessageId(frame, renderedHostMessageId);
          this.applyResolvedMessageId(body, renderedHostMessageId);
        }
        frame.append(body);
        const actionRow = this.createEntryActions(group, entry);
        if (actionRow != null) {
          if (renderedHostMessageId != null) {
            this.applyResolvedMessageId(actionRow, renderedHostMessageId);
            for (const candidate of actionRow.querySelectorAll<HTMLElement>('button, [role="menuitem"]')) {
              this.applyResolvedMessageId(candidate, renderedHostMessageId);
            }
          }
          const mountedIntoHostSlot = this.mountEntryActionsIntoHostSlot(body, actionRow, lane);
          if (!mountedIntoHostSlot) {
            frame.append(actionRow);
          }
        }
        article.append(frame);
      }
      entries.append(article);
    }

    this.convergeEntryActionAlignment(entries);
  }

  private createEntryBody(group: ManagedHistoryGroup, entry: ManagedHistoryEntry): HTMLElement {
    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const body = renderManagedHistoryEntryBody(
      this.doc,
      entry,
      this.t,
      lane === 'user' ? this.t('roleUser') : this.t('roleAssistant'),
      false,
    );
    body.classList.add(UI_CLASS_NAMES.historyEntryBody);
    body.dataset.lane = lane;
    this.applyEntryMetadata(body, group, entry);
    if (isSupplementalHistoryEntry(entry)) {
      body.dataset.supplementalRole = entry.contentType?.trim() || entry.role;
    }
    return body;
  }

  private mountEntryActionsIntoHostSlot(
    body: HTMLElement,
    actions: HTMLElement,
    lane: 'user' | 'assistant',
  ): boolean {
    if (body.dataset.renderKind !== 'host-snapshot') {
      return false;
    }

    const preferredSlotHint = actions.dataset.templateSlotHint ?? null;
    const candidateSlots = [
      ...body.querySelectorAll<HTMLElement>(
        'div.justify-start, div.justify-end, div[class*="justify-start"], div[class*="justify-end"]',
      ),
    ];
    if (candidateSlots.length === 0) {
      return false;
    }

    const matchesLane = (candidate: HTMLElement): boolean => {
      const className = candidate.className;
      if (typeof className !== 'string') {
        return false;
      }
      const laneToken = lane === 'assistant' ? 'justify-start' : 'justify-end';
      return className.includes(laneToken);
    };

    const slotByLane = candidateSlots.find(matchesLane) ?? null;
    const slotByHint =
      preferredSlotHint == null
        ? null
        : candidateSlots.find((candidate) => {
            const className = candidate.className;
            if (typeof className !== 'string') {
              return false;
            }
            return preferredSlotHint === 'start'
              ? className.includes('justify-start')
              : className.includes('justify-end');
          }) ?? null;
    const slot = slotByLane ?? slotByHint ?? null;
    if (slot == null) {
      return false;
    }

    actions.dataset.actionMount = 'host-slot';
    actions.style.removeProperty('--turbo-render-action-edge-inset');
    slot.replaceChildren(actions);
    return true;
  }

  private getEntryActionAvailability(entry: ManagedHistoryEntry): EntryActionAvailability {
    if (isSupplementalHistoryEntry(entry)) {
      return {
        copy: 'unavailable',
        like: 'unavailable',
        dislike: 'unavailable',
        share: 'unavailable',
        more: 'unavailable',
      };
    }

    if (entry.role !== 'assistant') {
      return {
        copy: 'local-fallback',
        like: 'unavailable',
        dislike: 'unavailable',
        share: 'unavailable',
        more: 'unavailable',
      };
    }

    const availability = this.currentState?.entryActionAvailability[getArchiveEntrySelectionKey(entry)];
    return {
      copy: availability?.copy ?? 'local-fallback',
      like: availability?.like ?? 'unavailable',
      dislike: availability?.dislike ?? 'unavailable',
      share: availability?.share ?? 'unavailable',
      more: availability?.more ?? 'local-fallback',
    };
  }

  private createEntryActions(group: ManagedHistoryGroup, entry: ManagedHistoryEntry): HTMLElement | null {
    if (isSupplementalHistoryEntry(entry)) {
      return null;
    }

    if (this.currentStatus?.routeKind === 'share' && !this.currentState?.showShareActions) {
      return null;
    }

    if (entry.role !== 'user' && entry.role !== 'assistant') {
      return null;
    }

    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const entryKey = getArchiveEntrySelectionKey(entry);
    const selectedAction = this.currentState?.entryActionSelection[entryKey] ?? null;
    const menuState = this.currentState?.entryActionMenu;
    const menuOpen = menuState?.entryId === entryKey && menuState?.groupId === group.id;
    const speaking = this.currentState?.entryActionSpeakingEntryKey === entryKey;
    const copied = this.currentState?.entryActionCopiedEntryKey === entryKey;

    const actions = this.doc.createElement('div');
    actions.className = UI_CLASS_NAMES.historyEntryActions;
    this.applyEntryMetadata(actions, group, entry);
    actions.dataset.lane = lane;
    actions.dataset.menuOpen = String(menuOpen);
    actions.dataset.speaking = String(speaking);
    actions.dataset.actionMount = 'fallback';

    const template = this.currentState?.entryActionTemplates[lane] ?? null;
    if (template != null) {
      const templateRoot = instantiateHostActionTemplate(this.doc, template);
      if (templateRoot != null) {
        this.prepareActionTemplateButtons(templateRoot, group, entry, lane, selectedAction, menuOpen, entryKey, copied);
        this.wrapTemplateMoreButtonWithMenu(templateRoot, group, entry, lane, menuOpen, entryKey, speaking);
        if (template.slotHint != null) {
          actions.dataset.templateSlotHint = template.slotHint;
        } else {
          delete actions.dataset.templateSlotHint;
        }
        actions.dataset.template = 'host';
        actions.append(this.createTemplateActionGroup(templateRoot, template));
        this.applyActionAlignment(actions, lane, template.edgeInsetPx ?? null);
        return actions;
      }
    }

    actions.dataset.template = 'fallback';
    for (const action of ENTRY_ACTION_LANE[lane]) {
      if (lane === 'assistant' && (action === 'like' || action === 'dislike') && selectedAction != null && selectedAction !== action) {
        continue;
      }

      if (action === 'more') {
        const anchor = this.createMoreActionAnchor(group, entry, lane, selectedAction, menuOpen, entryKey, speaking);
        actions.append(anchor);
        continue;
      }

      actions.append(this.createFallbackActionButton(group, entry, action, selectedAction, menuOpen, entryKey, copied));
    }

    this.applyActionAlignment(actions, lane, null);
    return actions;
  }

  private createTemplateActionGroup(
    root: DocumentFragment,
    template: HostActionTemplateSnapshot,
  ): Node {
    const wrapperClassName = template.wrapperClassName?.trim() ?? '';
    const wrapperRole = template.wrapperRole?.trim() ?? '';

    const wrapper = this.doc.createElement('div');
    if (wrapperClassName.length > 0) {
      wrapper.className = wrapperClassName;
    } else {
      wrapper.style.display = 'contents';
    }
    if (wrapperRole.length > 0) {
      wrapper.setAttribute('role', wrapperRole);
    }
    wrapper.dataset.turboRenderTemplateWrapper = 'true';
    wrapper.append(root);
    return wrapper;
  }

  private applyActionAlignment(
    actions: HTMLElement,
    lane: 'user' | 'assistant',
    edgeInsetPx: number | null,
  ): void {
    actions.dataset.alignLane = lane;
    const normalizedInset = this.normalizeActionEdgeInset(edgeInsetPx);
    if (normalizedInset == null) {
      delete actions.dataset.templateEdgeInset;
      actions.style.removeProperty('--turbo-render-action-edge-inset');
      return;
    }

    actions.dataset.templateEdgeInset = String(normalizedInset);
    actions.style.setProperty('--turbo-render-action-edge-inset', `${normalizedInset}px`);
  }

  private normalizeActionEdgeInset(inset: number | null): number | null {
    if (inset == null) {
      return null;
    }
    const roundedInset = Math.round(inset);
    if (!Number.isFinite(roundedInset) || roundedInset < 0 || roundedInset > 72) {
      return null;
    }
    return roundedInset;
  }

  private convergeEntryActionAlignment(entriesRoot: HTMLElement): void {
    const frames = entriesRoot.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryFrame}[data-lane]`);
    for (const frame of frames) {
      const lane = frame.dataset.lane === 'user' ? 'user' : 'assistant';
      const body = frame.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryBody}[data-lane="${lane}"]`,
      );
      const actions = frame.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="${lane}"]`,
      );
      if (body == null || actions == null) {
        continue;
      }
      if (actions.dataset.actionMount === 'host-slot') {
        actions.style.removeProperty('--turbo-render-action-edge-inset');
        continue;
      }

      const measuredInset = this.measureActionInsetFromBody(body, actions, lane);
      const fallbackInset = this.normalizeActionEdgeInset(
        Number.parseFloat(actions.dataset.templateEdgeInset ?? ''),
      );
      const resolvedInset = measuredInset ?? fallbackInset;
      if (resolvedInset == null) {
        actions.style.removeProperty('--turbo-render-action-edge-inset');
        continue;
      }
      actions.style.setProperty('--turbo-render-action-edge-inset', `${resolvedInset}px`);
    }
  }

  private measureActionInsetFromBody(
    body: HTMLElement,
    actions: HTMLElement,
    lane: 'user' | 'assistant',
  ): number | null {
    const bodyRect = body.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    if (
      bodyRect.width <= 0 ||
      bodyRect.height <= 0 ||
      actionsRect.width <= 0 ||
      actionsRect.height <= 0
    ) {
      return null;
    }

    const rawInset =
      lane === 'assistant'
        ? bodyRect.left - actionsRect.left
        : actionsRect.right - bodyRect.right;
    return this.normalizeActionEdgeInset(rawInset);
  }

  private createMoreActionAnchor(
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    selectedAction: EntryActionSelection | null,
    menuOpen: boolean,
    entryKey: string,
    speaking: boolean,
  ): HTMLElement {
    const anchor = this.doc.createElement('div');
    anchor.className = UI_CLASS_NAMES.historyEntryActionMenuAnchor;
    anchor.dataset.groupId = group.id;
    anchor.dataset.entryId = entry.id;
    anchor.dataset.entryKey = entryKey;
    anchor.dataset.lane = lane;

    const button = this.createFallbackActionButton(group, entry, 'more', selectedAction, menuOpen, entryKey, false);
    anchor.append(button);

    const menu = this.createMoreActionMenu(group, entry, lane, menuOpen, entryKey, speaking);
    if (menu != null) {
      anchor.append(menu);
    }

    return anchor;
  }

  private prepareActionTemplateButtons(
    root: ParentNode,
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    selectedAction: EntryActionSelection | null,
    menuOpen: boolean,
    entryKey: string,
    copied: boolean,
  ): void {
    const availability = this.getEntryActionAvailability(entry);
    for (const action of ENTRY_ACTION_LANE[lane]) {
      if (lane === 'assistant' && (action === 'like' || action === 'dislike') && selectedAction != null && selectedAction !== action) {
        const hidden = this.findTemplateActionButton(root, action);
        if (hidden != null) {
          hidden.remove();
        }
        continue;
      }

      const button = this.findTemplateActionButton(root, action);
      if (button == null) {
        continue;
      }

      const isCopiedAction = action === 'copy' && copied;
      const label = isCopiedAction ? this.t('messageActionCopied') : this.getEntryActionLabel(action, lane);
      const templatePressed = button.getAttribute('aria-pressed') === 'true';
      const isSelected = action === 'like' || action === 'dislike' ? selectedAction === action || templatePressed : false;
      const actionMode = availability[action];
      const title = this.getEntryActionTitle(action, label, actionMode);
      button.type = 'button';
      this.applyEntryMetadata(button, group, entry);
      button.setAttribute('data-action', action);
      button.setAttribute('data-testid', ENTRY_ACTION_TEST_IDS[action]);
      button.dataset.turboRenderAction = action;
      button.dataset.turboRenderActionMode = actionMode;
      button.dataset.turboRenderTestid = ENTRY_ACTION_TEST_IDS[action];
      button.setAttribute('aria-label', label);
      button.setAttribute('title', title);
      if (action === 'copy') {
        button.dataset.copyState = copied ? 'copied' : 'idle';
        if (copied) {
          this.replaceActionButtonIcon(button, createCheckIcon(this.doc));
        }
      }
      this.bindHostEventShield(button);
      if (action === 'like' || action === 'dislike') {
        button.setAttribute('aria-pressed', String(isSelected));
        this.setSelectedActionVisualState(button, isSelected);
      } else if (action === 'more') {
        const menuId = this.getEntryActionMenuId(group.id, entryKey);
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', String(menuOpen));
        if (menuOpen) {
          button.setAttribute('aria-controls', menuId);
        } else {
          button.removeAttribute('aria-controls');
        }
        button.setAttribute('data-menu-open', String(menuOpen));
      } else {
        button.removeAttribute('aria-pressed');
      }
      button.disabled = !isEntryActionEnabled(actionMode);
      button.addEventListener('pointerdown', this.stopHostEventPropagation);
      button.addEventListener('click', (event) => {
        this.stopHostEventPropagation(event);
        if (!button.disabled) {
          this.actions.onEntryAction({
            groupId: group.id,
            entryId: entry.id,
            action,
            selectedAction: action === 'like' || action === 'dislike' ? selectedAction : null,
          });
        }
      });
    }
  }

  private wrapTemplateMoreButtonWithMenu(
    root: ParentNode,
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    menuOpen: boolean,
    entryKey: string,
    speaking: boolean,
  ): void {
    const moreButton = this.findTemplateActionButton(root, 'more');
    if (moreButton == null) {
      return;
    }

    const parent = moreButton.parentNode;
    if (parent == null) {
      return;
    }

    const anchor = this.doc.createElement('div');
    anchor.className = UI_CLASS_NAMES.historyEntryActionMenuAnchor;
    anchor.dataset.groupId = group.id;
    anchor.dataset.entryId = entry.id;
    anchor.dataset.entryKey = entryKey;
    anchor.dataset.lane = lane;

    parent.insertBefore(anchor, moreButton);
    anchor.append(moreButton);

    const menu = this.createMoreActionMenu(group, entry, lane, menuOpen, entryKey, speaking);
    if (menu != null) {
      anchor.append(menu);
    }
  }

  private createFallbackActionButton(
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    action: ArchiveEntryAction,
    selectedAction: EntryActionSelection | null,
    menuOpen: boolean,
    entryKey: string,
    copied: boolean,
  ): HTMLButtonElement {
    const button = this.doc.createElement('button');
    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const isCopiedAction = action === 'copy' && copied;
    const label = isCopiedAction ? this.t('messageActionCopied') : this.getEntryActionLabel(action, lane);
    const availability = this.getEntryActionAvailability(entry);
    const actionMode = availability[action];
    const title = this.getEntryActionTitle(action, label, actionMode);

    button.type = 'button';
    button.className = UI_CLASS_NAMES.historyEntryAction;
    this.applyEntryMetadata(button, group, entry);
    button.setAttribute('data-action', action);
    button.setAttribute('data-testid', ENTRY_ACTION_TEST_IDS[action]);
    button.dataset.turboRenderAction = action;
    button.dataset.turboRenderActionMode = actionMode;
    button.dataset.turboRenderTestid = ENTRY_ACTION_TEST_IDS[action];
    button.setAttribute('aria-label', label);
    button.setAttribute('title', title);
    if (action === 'copy') {
      button.dataset.copyState = copied ? 'copied' : 'idle';
    }
    if (action === 'like' || action === 'dislike') {
      const isSelected = selectedAction === action;
      button.setAttribute('aria-pressed', String(isSelected));
      this.setSelectedActionVisualState(button, isSelected);
    } else if (action === 'more') {
      const menuId = this.getEntryActionMenuId(group.id, entryKey);
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', String(menuOpen));
      if (menuOpen) {
        button.setAttribute('aria-controls', menuId);
      } else {
        button.removeAttribute('aria-controls');
      }
      button.setAttribute('data-menu-open', String(menuOpen));
    }
    this.appendFallbackActionIcon(button, action, lane, isCopiedAction);
    if (action === 'like' || action === 'dislike') {
      this.setSelectedActionVisualState(button, selectedAction === action);
    }
    button.disabled = !isEntryActionEnabled(actionMode);
    this.bindHostEventShield(button);
    button.addEventListener('click', (event) => {
      this.stopHostEventPropagation(event);
      if (!button.disabled) {
        this.actions.onEntryAction({
          groupId: group.id,
          entryId: entry.id,
          action,
          selectedAction: action === 'like' || action === 'dislike' ? selectedAction : null,
        });
      }
    });
    return button;
  }

  private appendFallbackActionIcon(
    button: HTMLButtonElement,
    action: ArchiveEntryAction,
    lane: 'user' | 'assistant',
    isCopiedAction: boolean,
  ): void {
    if (isCopiedAction) {
      button.dataset.turboRenderIconTemplate = 'local-copied';
      button.append(createCheckIcon(this.doc));
      return;
    }

    const hostIcon = this.instantiateHostActionIcon(action, lane);
    if (hostIcon != null) {
      button.dataset.turboRenderIconTemplate = 'host';
      button.append(hostIcon);
      return;
    }

    button.dataset.turboRenderIconTemplate = 'local';
    button.append(createSvgIcon(this.doc, action));
  }

  private instantiateHostActionIcon(
    action: ArchiveEntryAction,
    lane: 'user' | 'assistant',
  ): DocumentFragment | null {
    const iconHtml = this.currentState?.entryActionTemplates[lane]?.iconHtmlByAction?.[action]?.trim();
    if (iconHtml == null || iconHtml.length === 0) {
      return null;
    }

    const template = this.doc.createElement('template');
    template.innerHTML = iconHtml;
    return template.content.childNodes.length > 0 ? template.content : null;
  }

  private findTemplateActionButton(root: ParentNode, action: ArchiveEntryAction): HTMLButtonElement | null {
    const button = findHostActionButton(root, action);
    return button instanceof HTMLButtonElement ? button : null;
  }

  private replaceActionButtonIcon(button: HTMLButtonElement, icon: SVGSVGElement): void {
    button.querySelectorAll('svg').forEach((svg) => svg.remove());
    button.append(icon);
  }

  private setSelectedActionVisualState(button: HTMLButtonElement, selected: boolean): void {
    button.classList.toggle('text-token-text-primary', selected);
    button.classList.toggle('text-token-text-secondary', !selected);

    if (selected) {
      button.style.setProperty('color', '#111827', 'important');
      button.style.setProperty('fill', '#111827', 'important');
      button.style.setProperty('stroke', '#111827', 'important');
    } else {
      button.style.removeProperty('color');
      button.style.removeProperty('fill');
      button.style.removeProperty('stroke');
    }

    for (const svg of button.querySelectorAll<SVGElement>('svg')) {
      if (selected) {
        svg.style.setProperty('color', '#111827', 'important');
        svg.style.setProperty('fill', '#111827', 'important');
        svg.style.setProperty('stroke', '#111827', 'important');
        svg.style.setProperty('filter', 'brightness(0)', 'important');
      } else {
        svg.style.removeProperty('color');
        svg.style.removeProperty('fill');
        svg.style.removeProperty('stroke');
        svg.style.removeProperty('filter');
      }
    }
  }

  private getEntryActionLabel(action: ArchiveEntryAction, lane?: 'user' | 'assistant'): string {
    return this.t(
      action === 'copy'
        ? lane === 'assistant'
          ? 'messageActionCopyResponse'
          : lane === 'user'
            ? 'messageActionCopyMessage'
            : 'messageActionCopy'
        : action === 'like'
          ? 'messageActionLike'
          : action === 'dislike'
            ? 'messageActionDislike'
            : action === 'share'
              ? 'messageActionShare'
              : 'messageActionMore',
    );
  }

  private getEntryActionTitle(
    action: ArchiveEntryAction,
    label: string,
    mode: EntryActionAvailability['copy'],
  ): string {
    if (action === 'share' && mode === 'unavailable') {
      return this.t('messageActionShareUnavailable');
    }
    return label;
  }

  private createMoreActionMenu(
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry,
    lane: 'user' | 'assistant',
    menuOpen: boolean,
    entryKey: string,
    speaking: boolean,
  ): HTMLElement | null {
    if (!menuOpen || lane !== 'assistant') {
      return null;
    }

    const menu = this.doc.createElement('div');
    menu.className = `${UI_CLASS_NAMES.historyEntryActionMenu} z-50 max-w-xs rounded-2xl popover bg-token-main-surface-primary dark:bg-[#353535] shadow-long py-1.5`;
    this.applyEntryMetadata(menu, group, entry);
    menu.dataset.lane = lane;
    menu.dataset.turboRenderEntryMenu = 'true';
    menu.id = this.getEntryActionMenuId(group.id, entryKey);
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this.getEntryActionLabel('more'));

    const timeLabel = this.formatEntryCreateTime(entry.createTime ?? null);
    if (timeLabel != null) {
      const header = this.doc.createElement('div');
      header.className = UI_CLASS_NAMES.historyEntryActionMenuHeader;
      header.dataset.turboRenderMenuHeader = 'true';
      header.textContent = timeLabel;
      menu.append(header);
    }

    const menuActions: EntryMoreMenuAction[] = speaking ? ['branch', 'stop-read-aloud'] : ['branch', 'read-aloud'];
    for (const action of menuActions) {
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.className = `${UI_CLASS_NAMES.historyEntryActionMenuItem} group __menu-item`;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('data-action', action);
      button.dataset.turboRenderMenuAction = action;
      button.dataset.turboRenderTestid = this.getMoreMenuActionTestId(action);
      button.setAttribute('data-testid', this.getMoreMenuActionTestId(action));
      const label = this.getMoreMenuActionLabel(action);
      button.setAttribute('aria-label', label);
      button.textContent = label;
      this.bindHostEventShield(button);
      button.addEventListener('click', (event) => {
        this.stopHostEventPropagation(event);
        this.actions.onMoreMenuAction({
          groupId: group.id,
          entryId: entry.id,
          action,
        });
      }, true);
      menu.append(button);
    }

    return menu;
  }

  private formatEntryCreateTime(createTime: number | null): string | null {
    if (createTime == null || !Number.isFinite(createTime) || createTime <= 946684800) {
      return null;
    }

    const milliseconds = createTime > 1_000_000_000_000 ? createTime : createTime * 1000;
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    const locale = this.t('messageActionReadAloud') === '朗读' ? 'zh-CN' : 'en-US';
    const formatted = new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);

    return locale === 'zh-CN' ? formatted.replace(/\s+/, '，') : formatted;
  }

  private getEntryActionMenuId(groupId: string, entryId: string): string {
    return `turbo-render-entry-more-menu-${groupId}-${entryId}`;
  }

  private getConversationId(): string | null {
    const stateConversationId = this.currentState?.conversationId?.trim() ?? '';
    if (stateConversationId.length > 0) {
      return stateConversationId;
    }

    const pathConversationId = getRouteIdFromRuntimeId(getChatIdFromPathname(this.doc.location?.pathname ?? '/'));
    if (pathConversationId != null && pathConversationId.length > 0) {
      return pathConversationId;
    }

    const runtimeId = this.currentStatus?.chatId ?? '';
    const routeId = getRouteIdFromRuntimeId(runtimeId);
    if (routeId != null && routeId.length > 0) {
      return routeId;
    }

    if (runtimeId.length > 0) {
      return runtimeId;
    }

    return null;
  }

  private shouldPreferHostMorePopover(): boolean {
    // Folded-entry More menus must be TurboRender-owned; otherwise tests can pass by using ChatGPT's live menu.
    return false;
  }

  private getEntryHostMessageId(entry: ManagedHistoryEntry): string | null {
    const entryKey = getArchiveEntrySelectionKey(entry);
    const hostMessageId = this.currentState?.entryHostMessageIds[entryKey]?.trim() ?? '';
    if (hostMessageId.length > 0) {
      return hostMessageId;
    }

    return resolvePreferredMessageId(entry.messageId, entry.liveTurnId, entry.turnId);
  }

  private resolveRenderedBodyMessageId(body: HTMLElement, lane: 'user' | 'assistant'): string | null {
    const roleCandidates = [
      ...body.querySelectorAll<HTMLElement>(
        `[data-message-author-role="${lane}"][data-host-message-id], [data-message-author-role="${lane}"][data-message-id]`,
      ),
    ];
    for (const candidate of roleCandidates) {
      const messageId =
        candidate.getAttribute('data-host-message-id')?.trim() ??
        candidate.getAttribute('data-message-id')?.trim() ??
        '';
      if (messageId.length > 0) {
        return messageId;
      }
    }

    const fallbackCandidates = [...body.querySelectorAll<HTMLElement>('[data-host-message-id], [data-message-id]')];
    for (const candidate of fallbackCandidates) {
      const messageId =
        candidate.getAttribute('data-host-message-id')?.trim() ??
        candidate.getAttribute('data-message-id')?.trim() ??
        '';
      if (messageId.length > 0) {
        return messageId;
      }
    }

    return null;
  }

  private applyResolvedMessageId(target: HTMLElement, messageId: string): void {
    target.dataset.messageId = messageId;
    target.dataset.hostMessageId = messageId;
  }

  private applyEntryMetadata(
    target: HTMLElement,
    group: ManagedHistoryGroup,
    entry: ManagedHistoryEntry | null,
  ): void {
    const conversationId = this.getConversationId();
    target.dataset.groupId = group.id;
    target.dataset.conversationId = conversationId ?? '';

    if (entry == null) {
      return;
    }

    const entryKey = getArchiveEntrySelectionKey(entry);
    const messageId = this.getEntryHostMessageId(entry);
    target.dataset.entryId = entry.id;
    target.dataset.entryKey = entryKey;
    target.dataset.messageAuthorRole = entry.role;
    target.dataset.messageId = messageId ?? '';
    target.dataset.hostMessageId = messageId ?? '';
  }

  private getMoreMenuActionLabel(action: EntryMoreMenuAction): string {
    if (action === 'branch') {
      return this.t('messageActionBranchInNewChat');
    }
    if (action === 'stop-read-aloud') {
      return this.t('messageActionStopReadAloud');
    }
    return this.t('messageActionReadAloud');
  }

  private getMoreMenuActionTestId(action: EntryMoreMenuAction): string {
    if (action === 'branch') {
      return 'branch-in-new-chat-turn-action-button';
    }
    if (action === 'stop-read-aloud') {
      return 'stop-read-aloud-turn-action-button';
    }
    return 'read-aloud-turn-action-button';
  }

  private bindHostEventShield(target: HTMLElement): void {
    target.addEventListener('pointerdown', this.shieldHostEventPropagation, true);
    target.addEventListener('pointerup', this.shieldHostEventPropagation, true);
    target.addEventListener('mousedown', this.shieldHostEventPropagation, true);
    target.addEventListener('mouseup', this.shieldHostEventPropagation, true);
    target.addEventListener('auxclick', this.shieldHostEventPropagation, true);
    target.addEventListener('contextmenu', this.shieldHostEventPropagation, true);
  }

  private shieldHostEventPropagation(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private stopHostEventPropagation(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if ('stopImmediatePropagation' in event) {
      event.stopImmediatePropagation();
    }
  }
}
