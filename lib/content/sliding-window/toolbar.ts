import {
  TURBO_RENDER_UI_ROOT_ATTRIBUTE,
  TURBO_RENDER_UI_ROOT_VALUE,
} from '../../shared/constants';
import type { Translator } from '../../shared/i18n';
import {
  createToolbarRoot,
  injectToolbarStyles,
  escapeHtml,
  escapeAttribute,
} from '../ui/base-toolbar';
import {
  getWindowPageCount,
  getWindowPageForRange,
  type SlidingWindowRuntimeState,
  type SlidingWindowSearchMatch,
} from '../../shared/sliding-window';

import slidingWindowStyles from '../../styles/sliding-window.css?inline';

const PANEL_OPEN_STORAGE_KEY = 'chatgpt-turborender:sliding-window:panel-open';


export type SlidingWindowToolbarNavigationDirection = 'first' | 'older' | 'newer' | 'latest';

export interface SlidingWindowToolbarHandlers {
  onNavigate(direction: SlidingWindowToolbarNavigationDirection): void;
  onNavigateToPage(page: number): void;
  onSearch(query: string): void;
  onOpenSearchResult(pairIndex: number): void;
  onOpenSettings(): void;
}

export interface SlidingWindowToolbarOptions {
  iconUrl?: string | null;
}

interface ActiveInputSnapshot {
  action: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

export class SlidingWindowToolbar {
  private readonly doc: Document;
  private readonly handlers: SlidingWindowToolbarHandlers;
  private readonly iconUrl: string | null;
  private root: HTMLElement | null = null;
  private t: Translator;
  private state: SlidingWindowRuntimeState | null = null;
  private searchQuery = '';
  private searchResults: SlidingWindowSearchMatch[] = [];
  private pageDraft: string | null = null;
  private open: boolean;
  private scrollbarResizeObserver: ResizeObserver | null = null;
  private scrollbarMutationObserver: MutationObserver | null = null;
  private scrollbarVisualViewport: VisualViewport | null = null;
  private scrollbarSyncTimer: number | null = null;
  private scrollbarWindowListenerBound = false;
  private isComposing = false;

  constructor(
    doc: Document,
    t: Translator,
    handlers: SlidingWindowToolbarHandlers,
    options: SlidingWindowToolbarOptions = {},
  ) {
    this.doc = doc;
    this.t = t;
    this.handlers = handlers;
    this.iconUrl = options.iconUrl ?? null;
    this.open = this.readOpenState();
  }

  mount(): void {
    if (this.root != null) {
      return;
    }

    injectToolbarStyles(this.doc, 'turbo-render-sliding-window-style', slidingWindowStyles);
    const root = createToolbarRoot(this.doc, {
      rootClassName: 'turbo-render-sliding-window',
      rootDataset: { turboRenderSlidingWindowRoot: 'true' },
    });
    root.addEventListener('click', (event) => this.handleClick(event));
    root.addEventListener('input', (event) => this.handleInput(event));
    root.addEventListener('keydown', (event) => this.handleKeydown(event));
    root.addEventListener('compositionstart', () => this.handleCompositionStart());
    root.addEventListener('compositionend', (event) => this.handleCompositionEnd(event));
    this.doc.body?.append(root);
    this.root = root;
    this.installScrollbarGutterTracking();
    this.render();
  }

  destroy(): void {
    this.uninstallScrollbarGutterTracking();
    this.root?.remove();
    this.root = null;
  }

  setTranslator(t: Translator): void {
    this.t = t;
    this.render();
  }

  setState(state: SlidingWindowRuntimeState | null): void {
    this.state = state;
    this.pageDraft = null;
    this.render();
  }

  setSearchResults(query: string, results: SlidingWindowSearchMatch[]): void {
    this.searchQuery = query;
    this.searchResults = results;
    this.render();
  }

  private rangeLabel(): string {
    const state = this.state;
    if (state == null || state.totalPairs <= 0) {
      return this.t('slidingWindowNoCache');
    }

    return this.t('slidingWindowRange', {
      start: state.range.startPairIndex + 1,
      end: state.range.endPairIndex + 1,
      total: state.totalPairs,
    });
  }

  private pageInfo(): { currentPage: number; pageCount: number } {
    const state = this.state;
    if (state == null || state.totalPairs <= 0) {
      return {
        currentPage: 0,
        pageCount: 0,
      };
    }

    const windowPairs = Math.max(1, state.pairCount);
    return {
      currentPage: getWindowPageForRange(state.range, state.totalPairs, windowPairs),
      pageCount: getWindowPageCount(state.totalPairs, windowPairs),
    };
  }

  private render(): void {
    const root = this.root;
    if (root == null) {
      return;
    }

    const activeInput = this.captureActiveInput();
    const state = this.state;
    const pageInfo = this.pageInfo();
    const pageInputValue = this.pageDraft ?? (pageInfo.currentPage > 0 ? String(pageInfo.currentPage) : '');
    const canGoOlder = state != null && state.range.startPairIndex > 0;
    const canGoNewer = state != null && !state.isLatestWindow;
    const canJumpPage = pageInfo.pageCount > 0;
    const readonly = state != null && !state.isLatestWindow;
    root.innerHTML = `
      <button
        type="button"
        class="turbo-render-sliding-window__trigger"
        data-action="toggle"
        aria-expanded="${this.open ? 'true' : 'false'}"
        aria-label="${this.escapeAttribute(this.t('slidingWindowOpenPanel'))}"
        title="${this.escapeAttribute(this.t('slidingWindowOpenPanel'))}"
      >
        ${this.renderTriggerIcon()}
      </button>
      <div class="turbo-render-sliding-window__panel" role="dialog" aria-label="${this.escapeAttribute(this.t('appName'))}">
        <div class="turbo-render-sliding-window__header">
          <strong class="turbo-render-sliding-window__range">${this.escape(this.rangeLabel())}</strong>
          <button
            type="button"
            class="turbo-render-sliding-window__close"
            data-action="close"
            aria-label="${this.escapeAttribute(this.t('slidingWindowClosePanel'))}"
            title="${this.escapeAttribute(this.t('slidingWindowClosePanel'))}"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 1L7 7M7 7L1 13M7 7L13 1M7 7L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="turbo-render-sliding-window__nav">
          <button type="button" data-action="first" ${canGoOlder ? '' : 'disabled'}>${this.escape(this.t('slidingWindowFirst'))}</button>
          <button type="button" data-action="older" ${canGoOlder ? '' : 'disabled'}>${this.escape(this.t('slidingWindowOlder'))}</button>
          <button type="button" data-action="newer" ${canGoNewer ? '' : 'disabled'}>${this.escape(this.t('slidingWindowNewer'))}</button>
          <button type="button" data-action="latest" ${canGoNewer ? '' : 'disabled'}>${this.escape(this.t('slidingWindowLatest'))}</button>
        </div>
        <div class="turbo-render-sliding-window__page-row">
          <span class="turbo-render-sliding-window__page-text">${this.escape(this.t('slidingWindowPage', {
            page: pageInfo.currentPage,
            total: pageInfo.pageCount,
          }))}</span>
          <input
            type="number"
            data-action="page"
            min="1"
            max="${String(Math.max(1, pageInfo.pageCount))}"
            inputmode="numeric"
            value="${this.escapeAttribute(pageInputValue)}"
            ${canJumpPage ? '' : 'disabled'}
          />
          <button type="button" data-action="page-go" ${canJumpPage ? '' : 'disabled'}>${this.escape(this.t('slidingWindowPageGo'))}</button>
          <button type="button" class="turbo-render-sliding-window__settings-btn" data-action="settings" title="${this.escapeAttribute(this.t('slidingWindowSettings'))}" aria-label="${this.escapeAttribute(this.t('slidingWindowSettings'))}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <input
          type="search"
          data-action="search"
          value="${this.escapeAttribute(this.searchQuery)}"
          placeholder="${this.escapeAttribute(this.t('slidingWindowSearch'))}"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="turbo-render-sliding-window__page-row" ${readonly ? '' : 'hidden'}>
          <p class="turbo-render-sliding-window__readonly">
            ${this.escape(this.t('slidingWindowReadonly'))}
          </p>
          <button type="button" data-action="latest">${this.escape(this.t('slidingWindowLatest'))}</button>
        </div>
        <div class="turbo-render-sliding-window__results" ${this.searchResults.length > 0 ? '' : 'hidden'}>
          ${this.searchResults.map((result) => `
            <button type="button" data-action="search-result" data-pair-index="${String(result.pairIndex)}">
              <span>${this.escape(this.t('slidingWindowSearchResult', { pair: result.pairIndex + 1 }))}</span>
              <small>${this.escape(result.excerpt)}</small>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    this.applyOpenState();
    this.restoreActiveInput(activeInput);
  }

  private renderTriggerIcon(): string {
    if (this.iconUrl != null && this.iconUrl.length > 0) {
      return `<img src="${this.escapeAttribute(this.iconUrl)}" alt="" />`;
    }

    return '<span aria-hidden="true">TR</span>';
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
    const action = target?.dataset.action;
    if (action == null || action === 'search' || action === 'page') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (action === 'toggle') {
      this.setOpen(!this.open);
      return;
    }

    if (action === 'close') {
      this.setOpen(false);
      return;
    }

    if (action === 'first' || action === 'older' || action === 'newer' || action === 'latest') {
      this.handlers.onNavigate(action);
      return;
    }

    if (action === 'page-go') {
      this.navigateToPageFromInput();
      return;
    }

    if (action === 'search-result') {
      const pairIndex = Number(target?.dataset.pairIndex);
      if (Number.isSafeInteger(pairIndex) && pairIndex >= 0) {
        this.handlers.onOpenSearchResult(pairIndex);
      }
      return;
    }

    if (action === 'settings') {
      this.handlers.onOpenSettings();
      return;
    }
  }

  private handleInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.action === 'search') {
      this.searchQuery = target.value;
      // 在中文输入法组合过程中不触发搜索，避免失焦
      if (!this.isComposing) {
        this.handlers.onSearch(target.value);
      }
      return;
    }

    if (target.dataset.action === 'page') {
      this.pageDraft = target.value;
    }
  }

  private handleCompositionStart(): void {
    this.isComposing = true;
  }

  private handleCompositionEnd(event: CompositionEvent): void {
    this.isComposing = false;
    // 组合结束时触发搜索
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.action === 'search') {
      this.handlers.onSearch(target.value);
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.setOpen(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.key !== 'Enter') {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.dataset.action === 'search') {
      this.handlers.onSearch(target.value);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (target.dataset.action === 'page') {
      this.navigateToPageFromInput();
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private navigateToPageFromInput(): void {
    const pageInfo = this.pageInfo();
    if (pageInfo.pageCount <= 0) {
      return;
    }

    const input = this.root?.querySelector<HTMLInputElement>('input[data-action="page"]');
    const rawValue = input?.value ?? this.pageDraft ?? '';
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const page = Math.min(pageInfo.pageCount, Math.max(1, Math.floor(parsed)));
    this.pageDraft = null;
    this.handlers.onNavigateToPage(page);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.writeOpenState(open);
    this.applyOpenState();
  }

  private applyOpenState(): void {
    const root = this.root;
    if (root == null) {
      return;
    }

    root.classList.toggle('turbo-render-sliding-window--open', this.open);
    root.dataset.open = this.open ? 'true' : 'false';
    const trigger = root.querySelector<HTMLButtonElement>('button[data-action="toggle"]');
    trigger?.setAttribute('aria-expanded', this.open ? 'true' : 'false');
    const triggerLabel = this.t(this.open ? 'slidingWindowClosePanel' : 'slidingWindowOpenPanel');
    trigger?.setAttribute('aria-label', triggerLabel);
    trigger?.setAttribute('title', triggerLabel);
  }

  private readOpenState(): boolean {
    try {
      return this.doc.defaultView?.sessionStorage.getItem(PANEL_OPEN_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private writeOpenState(open: boolean): void {
    try {
      this.doc.defaultView?.sessionStorage.setItem(PANEL_OPEN_STORAGE_KEY, open ? 'true' : 'false');
    } catch {
      // Ignore storage failures in private or constrained contexts.
    }
  }

  private installScrollbarGutterTracking(): void {
    const win = this.doc.defaultView;
    this.syncScrollbarGutter();
    if (win == null) {
      return;
    }

    if (!this.scrollbarWindowListenerBound) {
      win.addEventListener('resize', this.handleScrollbarGeometryChange, { passive: true });
      this.scrollbarWindowListenerBound = true;
    }

    const visualViewport = win.visualViewport ?? null;
    if (visualViewport != null && this.scrollbarVisualViewport == null) {
      visualViewport.addEventListener('resize', this.handleScrollbarGeometryChange, { passive: true });
      this.scrollbarVisualViewport = visualViewport;
    }

    if (this.scrollbarResizeObserver == null && typeof win.ResizeObserver === 'function') {
      const observer = new win.ResizeObserver(this.handleScrollbarGeometryChange);
      observer.observe(this.doc.documentElement);
      if (this.doc.body != null) {
        observer.observe(this.doc.body);
      }
      this.scrollbarResizeObserver = observer;
    }

    if (this.scrollbarMutationObserver == null && this.doc.body != null && typeof win.MutationObserver === 'function') {
      const observer = new win.MutationObserver(this.handleScrollbarDomChange);
      observer.observe(this.doc.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      this.scrollbarMutationObserver = observer;
    }
  }

  private uninstallScrollbarGutterTracking(): void {
    const win = this.doc.defaultView;
    if (this.scrollbarWindowListenerBound) {
      win?.removeEventListener('resize', this.handleScrollbarGeometryChange);
      this.scrollbarWindowListenerBound = false;
    }

    this.scrollbarVisualViewport?.removeEventListener('resize', this.handleScrollbarGeometryChange);
    this.scrollbarVisualViewport = null;
    this.scrollbarResizeObserver?.disconnect();
    this.scrollbarResizeObserver = null;
    this.scrollbarMutationObserver?.disconnect();
    this.scrollbarMutationObserver = null;
    if (this.scrollbarSyncTimer != null) {
      win?.clearTimeout(this.scrollbarSyncTimer);
      this.scrollbarSyncTimer = null;
    }
  }

  private readonly handleScrollbarGeometryChange = (): void => {
    this.syncScrollbarGutter();
  };

  private readonly handleScrollbarDomChange = (): void => {
    this.scheduleScrollbarGutterSync();
  };

  private scheduleScrollbarGutterSync(): void {
    const win = this.doc.defaultView;
    if (win == null) {
      this.syncScrollbarGutter();
      return;
    }

    if (this.scrollbarSyncTimer != null) {
      return;
    }

    this.scrollbarSyncTimer = win.setTimeout(() => {
      this.scrollbarSyncTimer = null;
      this.syncScrollbarGutter();
    }, 0);
  }

  private syncScrollbarGutter(): void {
    const root = this.root;
    if (root == null) {
      return;
    }

    root.style.setProperty(
      '--turbo-render-sliding-window-scrollbar-gutter',
      `${String(this.getViewportScrollbarGutter())}px`,
    );
  }

  private getViewportScrollbarGutter(): number {
    const win = this.doc.defaultView;
    const viewportWidth = win?.innerWidth ?? 0;
    const documentContentWidth = this.doc.documentElement.clientWidth;
    if (
      !Number.isFinite(viewportWidth) ||
      !Number.isFinite(documentContentWidth) ||
      viewportWidth <= 0 ||
      documentContentWidth <= 0
    ) {
      return 0;
    }

    const documentScrollbarGutter = Math.max(0, viewportWidth - documentContentWidth);
    let rightBoundary = documentScrollbarGutter > 0 ? documentContentWidth : viewportWidth;
    const scrollContainerBoundary = this.getRightEdgeScrollContainerBoundary(viewportWidth, documentScrollbarGutter);
    if (scrollContainerBoundary != null) {
      rightBoundary = Math.max(rightBoundary === viewportWidth ? 0 : rightBoundary, scrollContainerBoundary);
    }

    return Math.max(0, Math.round(viewportWidth - Math.min(viewportWidth, rightBoundary)));
  }

  private getRightEdgeScrollContainerBoundary(viewportWidth: number, documentScrollbarGutter: number): number | null {
    const candidates = this.doc.querySelectorAll<HTMLElement>([
      'main',
      '[class*="overflow-auto"]',
      '[class*="overflow-y-auto"]',
      '[class*="overflow-scroll"]',
      '[class*="overflow-y-scroll"]',
      '[class*="scroll-root"]',
      '[style*="overflow"]',
    ].join(','));
    const viewportContentRight = viewportWidth - documentScrollbarGutter;
    let boundary: number | null = null;

    for (const candidate of candidates) {
      const style = this.doc.defaultView?.getComputedStyle(candidate);
      if (style == null || !this.canScrollVertically(candidate, style.overflowY)) {
        continue;
      }

      const rect = candidate.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= (this.doc.defaultView?.innerHeight ?? 0) ||
        rect.right < viewportContentRight - 2
      ) {
        continue;
      }

      const candidateBoundary = rect.left + candidate.clientLeft + candidate.clientWidth;
      const rightGutter = rect.right - candidateBoundary;
      if (!Number.isFinite(candidateBoundary) || rightGutter <= 0.5) {
        continue;
      }

      boundary = boundary == null ? candidateBoundary : Math.max(boundary, candidateBoundary);
    }

    return boundary;
  }

  private canScrollVertically(element: HTMLElement, overflowY: string): boolean {
    if (overflowY === 'hidden' || overflowY === 'clip' || overflowY === 'visible') {
      return false;
    }

    return element.scrollHeight > element.clientHeight + 1;
  }

  private captureActiveInput(): ActiveInputSnapshot | null {
    const root = this.root;
    const active = this.doc.activeElement;
    if (root == null || !(active instanceof HTMLInputElement) || !root.contains(active)) {
      return null;
    }

    let selectionStart: number | null;
    let selectionEnd: number | null;
    try {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    } catch {
      selectionStart = null;
      selectionEnd = null;
    }

    return {
      action: active.dataset.action ?? '',
      selectionStart,
      selectionEnd,
    };
  }

  private restoreActiveInput(snapshot: ActiveInputSnapshot | null): void {
    if (snapshot == null || snapshot.action.length === 0) {
      return;
    }

    const input = this.root?.querySelector<HTMLInputElement>(`input[data-action="${snapshot.action}"]`);
    if (input == null) {
      return;
    }

    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }

    if (snapshot.selectionStart != null && snapshot.selectionEnd != null) {
      try {
        input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      } catch {
        // Number inputs do not support text selection.
      }
    }
  }

  private escape = escapeHtml;
  private escapeAttribute = escapeAttribute;
}
