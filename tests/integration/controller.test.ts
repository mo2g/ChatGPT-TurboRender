import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, UI_CLASS_NAMES } from '../../lib/shared/constants';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import { StatusBar } from '../../lib/content/status-bar';
import { installConversationBootstrap } from '../../lib/main-world/conversation-bootstrap';
import type { ArchiveEntryAction } from '../../lib/content/message-actions';
import type { ManagedHistoryEntry } from '../../lib/shared/types';
import { mountGroupedTranscriptFixture, mountTranscriptFixture } from '../../lib/testing/transcript-fixture';
import {
  clearArchiveSearch,
  clickArchiveSearchResult,
  createInitialTrimSession,
  createSessionTurn,
  flush,
  getArchiveSearchInput,
  goNewerArchivePage,
  goOlderArchivePage,
  goToRecentArchiveView,
  openNewestArchivePage,
  setArchiveSearchQuery,
  toggleArchiveSearch,
} from './controller-test-helpers';

describe('TurboRenderController', () => {
  const activeControllers: TurboRenderController[] = [];

  beforeEach(() => {
    activeControllers.length = 0;
    globalThis.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(window.performance.now()), 16)) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame ??= ((handle: number) =>
      window.clearTimeout(handle)) as typeof cancelAnimationFrame;
    globalThis.requestIdleCallback ??= ((callback: IdleRequestCallback) =>
      window.setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => 0,
          }),
        16,
      )) as typeof requestIdleCallback;
    globalThis.cancelIdleCallback ??= ((handle: number) =>
      window.clearTimeout(handle)) as typeof cancelIdleCallback;
  });

  afterEach(() => {
    for (const controller of activeControllers) {
      controller.stop();
    }
    activeControllers.length = 0;
    delete (window as Window & {
      __turboRenderDebugReadAloudBackend?: boolean;
      __turboRenderDebugConversationId?: string;
      __turboRenderDebugReadAloudUrl?: string;
      __turboRenderReadAloudContext?: unknown;
    }).__turboRenderDebugReadAloudBackend;
    delete (window as Window & {
      __turboRenderDebugReadAloudBackend?: boolean;
      __turboRenderDebugConversationId?: string;
      __turboRenderDebugReadAloudUrl?: string;
      __turboRenderReadAloudContext?: unknown;
    }).__turboRenderDebugConversationId;
    delete (window as Window & {
      __turboRenderDebugReadAloudBackend?: boolean;
      __turboRenderDebugConversationId?: string;
      __turboRenderDebugReadAloudUrl?: string;
      __turboRenderReadAloudContext?: unknown;
    }).__turboRenderDebugReadAloudUrl;
    delete (window as Window & {
      __turboRenderDebugReadAloudBackend?: boolean;
      __turboRenderDebugConversationId?: string;
      __turboRenderDebugReadAloudUrl?: string;
      __turboRenderReadAloudContext?: unknown;
    }).__turboRenderReadAloudContext;
    delete document.body.dataset.turboRenderDebugReadAloudBackend;
    delete document.body.dataset.turboRenderDebugConversationId;
    delete document.body.dataset.turboRenderDebugReadAloudUrl;
    delete document.body.dataset.turboRenderDebugReadAloudRoute;
    delete document.body.dataset.turboRenderDebugReadAloudMenuAction;
    delete document.body.dataset.turboRenderDebugReadAloudResolvedConversationId;
    delete document.body.dataset.turboRenderDebugReadAloudResolvedMessageId;
    delete document.body.dataset.turboRenderDebugReadAloudResponseStatus;
    delete document.body.dataset.turboRenderReadAloudConversationId;
    delete document.body.dataset.turboRenderReadAloudEntryRole;
    delete document.body.dataset.turboRenderReadAloudEntryText;
    delete document.body.dataset.turboRenderReadAloudEntryKey;
    delete document.body.dataset.turboRenderReadAloudEntryMessageId;
    delete document.body.dataset.turboRenderReadAloudMode;
    delete document.body.dataset.turboRenderReadAloudBranch;
    delete document.body.dataset.hostActionCopyCount;
    delete document.body.dataset.hostActionLikeCount;
    delete document.body.dataset.hostActionDislikeCount;
    delete document.body.dataset.hostActionShareCount;
    delete document.body.dataset.hostActionBranchCount;
    delete document.body.dataset.hostActionReadAloudCount;
    delete document.body.dataset.hostActionStopReadAloudCount;
    delete document.documentElement.dataset.turboRenderDebugReadAloudBackend;
    delete document.documentElement.dataset.turboRenderDebugConversationId;
    delete document.documentElement.dataset.turboRenderDebugReadAloudUrl;
    delete document.documentElement.dataset.turboRenderDebugReadAloudRoute;
    delete document.documentElement.dataset.turboRenderDebugReadAloudMenuAction;
    delete document.documentElement.dataset.turboRenderDebugReadAloudResolvedConversationId;
    delete document.documentElement.dataset.turboRenderDebugReadAloudResolvedMessageId;
    delete document.documentElement.dataset.turboRenderDebugReadAloudResponseStatus;
    delete document.documentElement.dataset.turboRenderReadAloudConversationId;
    delete document.documentElement.dataset.turboRenderReadAloudEntryRole;
    delete document.documentElement.dataset.turboRenderReadAloudEntryText;
    delete document.documentElement.dataset.turboRenderReadAloudEntryKey;
    delete document.documentElement.dataset.turboRenderReadAloudEntryMessageId;
    delete document.documentElement.dataset.turboRenderReadAloudMode;
    delete document.documentElement.dataset.turboRenderReadAloudBranch;
    delete document.documentElement.dataset.hostActionCopyCount;
    delete document.documentElement.dataset.hostActionLikeCount;
    delete document.documentElement.dataset.hostActionDislikeCount;
    delete document.documentElement.dataset.hostActionShareCount;
    delete document.documentElement.dataset.hostActionBranchCount;
    delete document.documentElement.dataset.hostActionReadAloudCount;
    delete document.documentElement.dataset.hostActionStopReadAloudCount;
    vi.restoreAllMocks();
  });

  it('renders archive batches above the hot transcript and keeps only the latest 5 pairs live', async () => {
    const fixture = mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(24, 4));
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot).not.toBeNull();
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.inlineHistoryBoundary}`)).not.toBeNull();
    expect(inlineRoot?.querySelector('[data-turbo-render-batch-anchor="true"]')).toBeNull();
    expect(inlineRoot?.nextElementSibling).toBe(fixture.transcript);

    const status = controller.getStatus();
    expect(status.archivedTurnsTotal).toBe(14);

    await openNewestArchivePage();
    await flush();

    expect(controller.getStatus().collapsedBatchCount).toBeGreaterThan(0);

    const initialBatchHeader = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchHeader}`);
    expect(initialBatchHeader).not.toBeNull();

    const turboRenderStyle = [...document.head.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .find((text) => text.includes(`.${UI_CLASS_NAMES.inlineBatchRail}`));
    expect(turboRenderStyle).toContain('position: sticky');
    expect(turboRenderStyle).toContain('border: 1px solid');
    expect(turboRenderStyle).toContain('border-radius: 18px');
    expect(turboRenderStyle).toContain('background: rgba(255, 255, 255, 0.96)');
    expect(turboRenderStyle).toContain('box-shadow: 0 10px 30px');
    expect(turboRenderStyle).toContain('background: transparent');
    expect(turboRenderStyle).toContain('box-shadow: none');
    expect(turboRenderStyle).toContain('padding: 14px 16px 0');
    expect(turboRenderStyle).not.toContain('border-color: transparent');
    expect(turboRenderStyle).toContain('display: grid');
    expect(turboRenderStyle).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(turboRenderStyle).toContain('justify-self: end');
    expect(turboRenderStyle).toContain('align-self: start');
    expect(turboRenderStyle).toContain('max-width: min(68ch, 100%)');
    expect(turboRenderStyle).toContain('padding: 12px 16px');
    expect(turboRenderStyle).toContain('border-radius: 18px');
    expect(turboRenderStyle).toContain('background: rgba(243, 244, 246, 0.96)');
    expect(turboRenderStyle).toContain('border: 0;');
    expect(turboRenderStyle).toContain('gap: 8px');
    expect(turboRenderStyle).toContain('width: 100%');
    expect(turboRenderStyle).toContain('padding-top: 0;');
    expect(turboRenderStyle).toContain('gap: 6px');
    expect(turboRenderStyle).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(turboRenderStyle).toContain('justify-items: stretch');
    expect(turboRenderStyle).toContain(`.${UI_CLASS_NAMES.historyEntryFrame}`);
    expect(turboRenderStyle).toContain('position: sticky');
    expect(turboRenderStyle).toContain('top: calc(var(--turbo-render-page-header-offset, 0px) + 12px)');
    expect(turboRenderStyle).toContain('top: calc(var(--turbo-render-page-header-offset, 0px) + 12px)');
    expect(turboRenderStyle).toContain('display: inline-flex');
    expect(turboRenderStyle).toContain('flex-wrap: nowrap');
    expect(turboRenderStyle).toContain('white-space: nowrap');
    expect(turboRenderStyle).toContain('width: fit-content');
    expect(turboRenderStyle).toContain('max-width: 100%');
    expect(turboRenderStyle).toContain(`.${UI_CLASS_NAMES.historyEntryActionMenu}`);
    expect(turboRenderStyle).toContain(`.${UI_CLASS_NAMES.historyEntryActionMenuAnchor}`);
    expect(turboRenderStyle).toContain('width: min(100%, 48rem)');
    expect(turboRenderStyle).toContain('position: fixed');
    expect(turboRenderStyle).toContain(`.${UI_CLASS_NAMES.historyEntryActionMenuHeader}`);
    expect(turboRenderStyle).toContain(`.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"]`);
    expect(turboRenderStyle).toContain('display: block');
    expect(turboRenderStyle).toContain('padding: 0');
    expect(turboRenderStyle).toContain('background: transparent');
    expect(turboRenderStyle).toContain(`.${UI_CLASS_NAMES.softFolded}`);
    expect(turboRenderStyle).toContain('display: none !important');
    expect(turboRenderStyle).not.toContain('content-visibility: auto');

    const initialBatchButton = inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`);
    expect(initialBatchButton?.textContent).toBe('Expand');
    const batchMetaLabels = [...(inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchMeta} strong`) ?? [])]
      .map((element) => element.textContent?.trim() ?? '');
    expect(batchMetaLabels[0]).toBe('Pair #1-5');
    expect(batchMetaLabels[1]).toBe('Pair #6-10 · 2/5');
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.inlineBatchPreview}`)).not.toBeNull();
    fixture.scroller.scrollTop = 480;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const batchCard = this.closest?.(`.${UI_CLASS_NAMES.inlineBatchCard}[data-group-id="archive-slot-0"]`);
      if (batchCard instanceof HTMLElement) {
        const expanded = batchCard.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntries}`)?.hidden === false;
        const cardTop = (expanded ? 260 : 200) - fixture.scroller.scrollTop;
        if (this === batchCard) {
          return {
            top: cardTop,
            bottom: cardTop + 120,
            left: 0,
            right: 900,
            width: 900,
            height: 120,
            x: 0,
            y: cardTop,
            toJSON: () => '',
          } as DOMRect;
        }

        if (
          this.matches(`.${UI_CLASS_NAMES.inlineBatchHeader}`) ||
          this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`)
        ) {
          const top = 12;
          return {
            top,
            bottom: top + 32,
            left: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 760 : 0,
            right: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 792 : 900,
            width: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 32 : 900,
            height: 32,
            x: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 760 : 0,
            y: top,
            toJSON: () => '',
          } as DOMRect;
        }
      }

      return {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => '',
      } as DOMRect;
    });

    initialBatchButton?.click();
    await flush();
    rectSpy.mockRestore();

    const headerStyle = initialBatchHeader != null
      ? {
          display: getComputedStyle(initialBatchHeader).display,
          position: getComputedStyle(initialBatchHeader).position,
        }
      : null;
    const actionButtonStyle = initialBatchButton != null
      ? {
          position: getComputedStyle(initialBatchButton).position,
          top: getComputedStyle(initialBatchButton).top,
          alignSelf: getComputedStyle(initialBatchButton).alignSelf,
          gridTemplateColumns: getComputedStyle(initialBatchHeader ?? initialBatchButton).gridTemplateColumns,
        }
      : null;

    expect(
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.textContent,
    ).toBe('Collapse');
    expect(headerStyle?.display).toBe('grid');
    expect(actionButtonStyle?.gridTemplateColumns).not.toBe('none');
    expect(headerStyle?.position).not.toBe('sticky');
    expect(actionButtonStyle?.position).toBe('sticky');
    expect(actionButtonStyle?.top).toBe('calc(var(--turbo-render-page-header-offset, 0px) + 12px)');
    expect(actionButtonStyle?.alignSelf).toBe('start');
    const expandedFirstCard = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.inlineBatchCard}[data-group-id="archive-slot-0"]`,
    );
    expect(expandedFirstCard?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchPreview}`)?.hidden).toBe(true);
    const userBody = expandedFirstCard?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"]`);
    expect(userBody).not.toBeNull();
    expect(userBody?.parentElement?.classList.contains(UI_CLASS_NAMES.historyEntryFrame)).toBe(true);
    expect(expandedFirstCard?.querySelector(`.${UI_CLASS_NAMES.historyEntryCard}`)).toBeNull();
    expect(expandedFirstCard?.querySelector(`.${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"]`)).not.toBeNull();
    expect(expandedFirstCard?.dataset.conversationId ?? '').not.toBe('');
    expect(userBody?.dataset.conversationId ?? '').toBe(expandedFirstCard?.dataset.conversationId ?? '');
    expect(userBody?.dataset.messageId ?? '').not.toBe('');
    expect(userBody?.dataset.hostMessageId ?? '').toBe(userBody?.dataset.messageId ?? '');
    const userActions = expandedFirstCard?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="user"]`,
    );
    expect(userActions).not.toBeNull();
    expect(userActions?.dataset.template).toBe('host');
    expect(userActions?.dataset.conversationId ?? '').toBe(expandedFirstCard?.dataset.conversationId ?? '');
    expect(userActions?.dataset.messageId ?? '').toBe(userBody?.dataset.messageId ?? '');
    expect(userActions?.querySelectorAll('button')).toHaveLength(1);
    expect(userActions?.querySelector<HTMLButtonElement>('button[data-testid="copy-turn-action-button"]')).not.toBeNull();
    expect(userActions?.querySelector<HTMLButtonElement>('button[data-testid="copy-turn-action-button"]')?.textContent).toBe('');
    expect(userActions?.querySelectorAll('button svg')).toHaveLength(1);
    expect(
      userActions?.querySelector('button[data-testid="copy-turn-action-button"]')?.parentElement?.dataset
        .turboRenderTemplateWrapper,
    ).toBe('true');
    const assistantActions = expandedFirstCard?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
    );
    expect(assistantActions).not.toBeNull();
    expect(assistantActions?.dataset.template).toBe('host');
    expect(assistantActions?.dataset.conversationId ?? '').toBe(expandedFirstCard?.dataset.conversationId ?? '');
    expect(assistantActions?.dataset.messageId ?? '').not.toBe('');
    expect(assistantActions?.querySelectorAll('button')).toHaveLength(5);
    expect(assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"]')).not.toBeNull();
    expect(assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="bad-response-turn-action-button"]')).not.toBeNull();
    expect(assistantActions?.querySelectorAll('button svg')).toHaveLength(5);
    expect(
      assistantActions?.querySelector('button[data-testid="more-turn-action-button"]')?.parentElement?.classList.contains(
        UI_CLASS_NAMES.historyEntryActionMenuAnchor,
      ),
    ).toBe(true);
    expect(fixture.scroller.scrollTop).toBe(480);
    expect(controller.getStatus().expandedBatchCount).toBeGreaterThan(0);
    expect(fixture.transcript.querySelectorAll('[data-testid^="conversation-turn-"]')).toHaveLength(10);
    expect(document.querySelectorAll('[data-turbo-render-group-id]')).toHaveLength(0);
  });

  it('uses captured host icons for fallback archive action buttons when a full host row is unavailable', async () => {
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    document
      .querySelectorAll<HTMLElement>(
        '[data-message-author-role="assistant"] button[data-testid="share-turn-action-button"], [data-message-author-role="assistant"] button[data-testid="more-turn-action-button"]',
      )
      .forEach((button) => button.remove());

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(20, 10);
    for (const [index, turn] of session.turns.entries()) {
      turn.parts = [`Turn ${index + 1} primary content.`];
    }
    session.coldTurns = session.turns.slice(0, session.archivedTurnCount);
    controller.setInitialTrimSession(session);
    controller.start();
    await flush();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();
    await flush();

    const firstEntry = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`);
    const assistantActions = firstEntry?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
    );
    expect(assistantActions).not.toBeNull();
    expect(assistantActions?.dataset.template).toBe('fallback');

    const copyButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="copy-turn-action-button"]');
    const likeButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"]');
    const dislikeButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="bad-response-turn-action-button"]');
    const shareButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="share-turn-action-button"]');
    const moreButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]');
    expect(copyButton?.dataset.turboRenderIconTemplate).toBe('host');
    expect(likeButton?.dataset.turboRenderIconTemplate).toBe('host');
    expect(dislikeButton?.dataset.turboRenderIconTemplate).toBe('host');
    expect(shareButton?.dataset.turboRenderIconTemplate).toBe('local');
    expect(moreButton?.dataset.turboRenderIconTemplate).toBe('local');
    expect(copyButton?.querySelector<SVGSVGElement>('svg')?.style.width).toBe('16px');
  });

  it('switches between archive pages and returns to the recent view', async () => {
    mountTranscriptFixture(document, { turnCount: 60, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(60, 42));
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot).not.toBeNull();
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.inlineHistoryBoundary}`)).not.toBeNull();
    expect(inlineRoot?.querySelector('[data-turbo-render-batch-anchor="true"]')).toBeNull();

    const pager = controller as unknown as {
      archivePager: { currentPageIndex: number | null };
    };

    await openNewestArchivePage();
    expect(pager.archivePager.currentPageIndex).toBe(1);
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"]')).not.toBeNull();

    await goOlderArchivePage();
    await flush();
    expect(pager.archivePager.currentPageIndex).toBe(0);
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"]')).not.toBeNull();

    await goNewerArchivePage();
    expect(pager.archivePager.currentPageIndex).toBe(1);
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"]')).not.toBeNull();

    await goToRecentArchiveView();
    expect(pager.archivePager.currentPageIndex).toBeNull();
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"]')).toBeNull();
  });

  it('opens archive search results by page and keeps the match highlighted after the jump', async () => {
    mountTranscriptFixture(document, { turnCount: 60, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(60, 42);
    session.turns[10] = createSessionTurn(10, { parts: ['older search needle localhost:5000'] });
    session.turns[40] = createSessionTurn(40, { parts: ['newer search needle localhost:5000'] });
    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot?.querySelector('[data-turbo-render-batch-anchor="true"]')).toBeNull();

    await toggleArchiveSearch();
    expect(getArchiveSearchInput()).not.toBeNull();

    await setArchiveSearchQuery('localhost:5000');

    const resultButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-turbo-render-action="open-archive-search-result"]')];
    expect(resultButtons).toHaveLength(2);
    expect(resultButtons[0]?.dataset.pageIndex).toBe('1');
    expect(resultButtons[0]?.dataset.pairIndex).toBe('20');
    expect(resultButtons[1]?.dataset.pageIndex).toBe('0');
    expect(resultButtons[1]?.dataset.pairIndex).toBe('5');
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"]')).toBeNull();

    await clickArchiveSearchResult(1);

    const pager = controller as unknown as {
      archivePager: { currentPageIndex: number | null };
    };
    expect(pager.archivePager.currentPageIndex).toBe(0);

    const olderPageBatch = document.querySelector<HTMLElement>(
      '[data-turbo-render-batch-anchor="true"][data-group-id="archive-slot-1"]',
    );
    expect(olderPageBatch).not.toBeNull();
    expect(olderPageBatch?.getAttribute('data-state')).toBe('expanded');
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"][data-group-id="archive-slot-4"]')).toBeNull();

    const activeResult = document.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.inlineHistorySearchResult}.${UI_CLASS_NAMES.inlineHistorySearchResultActive}`,
    );
    expect(activeResult?.dataset.pageIndex).toBe('0');
    expect(activeResult?.dataset.pairIndex).toBe('5');

    const highlightedPair = document.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.inlineBatchSearchHighlight}[data-pair-index="5"]`,
    );
    expect(highlightedPair).not.toBeNull();

    await clearArchiveSearch();

    expect(document.querySelector('[data-turbo-render-action="open-archive-search-result"]')).toBeNull();
    expect(document.querySelector(`.${UI_CLASS_NAMES.inlineBatchSearchHighlight}`)).toBeNull();
    expect(document.querySelector('[data-turbo-render-batch-anchor="true"]')).not.toBeNull();
    expect(pager.archivePager.currentPageIndex).toBe(0);
  });

  it('uses sampled sticky top chrome offsets when no .page-header exists', async () => {
    const fixture = mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const stickyHeader = document.createElement('div');
    stickyHeader.textContent = 'sticky host header';
    stickyHeader.style.position = 'sticky';
    stickyHeader.style.top = '0';
    stickyHeader.style.height = '64px';
    stickyHeader.style.width = '100%';
    fixture.main.prepend(stickyHeader);
    expect(document.querySelector('.page-header')).toBeNull();
    expect(document.querySelector('[data-testid="page-header"]')).toBeNull();

    vi.spyOn(stickyHeader, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 64,
      left: 0,
      right: 900,
      width: 900,
      height: 64,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    const originalElementsFromPoint = document.elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: (_x: number, y: number) => (y <= 64 ? [stickyHeader, fixture.main] : [fixture.main]),
    });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    try {
      controller.setInitialTrimSession(createInitialTrimSession(24, 4));
      controller.start();
      await flush();

      const topOffset = (controller as unknown as { getBatchHeaderScrollTop(): number }).getBatchHeaderScrollTop();
      expect(topOffset).toBe(76);
    } finally {
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: originalElementsFromPoint,
      });
    }
  });

  it('mounts archived actions into host justify slots when host snapshots provide them', async () => {
    mountTranscriptFixture(document, { turnCount: 18, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(24, 8);
    session.turns[0] = createSessionTurn(0, {
      role: 'user',
      renderKind: 'host-snapshot',
      snapshotHtml:
        '<div data-message-author-role="user"><div class="text-message">User archived content</div><div class="z-0 flex justify-end"><div role="group"></div></div></div>',
    });
    session.turns[1] = createSessionTurn(1, {
      role: 'assistant',
      renderKind: 'host-snapshot',
      snapshotHtml:
        '<div data-message-author-role="assistant"><div class="text-message">Assistant archived content</div><div class="z-0 flex min-h-[46px] justify-start"><div role="group"></div></div></div>',
    });
    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const userActions = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="user"]`,
    );
    const assistantActions = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
    );
    expect(userActions).not.toBeNull();
    expect(assistantActions).not.toBeNull();
    expect(userActions?.dataset.actionMount).toBe('host-slot');
    expect(assistantActions?.dataset.actionMount).toBe('host-slot');
    expect(userActions?.parentElement?.className.includes('justify-end')).toBe(true);
    expect(assistantActions?.parentElement?.className.includes('justify-start')).toBe(true);
  });

  it('scrolls the current batch back to the top when collapsing it', async () => {
    const fixture = mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(24, 4));
    controller.start();
    await flush();

    await openNewestArchivePage();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    const scroller = fixture.scroller;
    const firstBatch = inlineRoot?.querySelector<HTMLElement>('[data-turbo-render-batch-anchor="true"]');
    const firstToggle = firstBatch?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`);
    expect(firstBatch).not.toBeNull();
    expect(firstToggle).not.toBeNull();
    if (firstBatch == null || firstToggle == null) {
      throw new Error('Harness transcript is missing expected batch controls.');
    }

    scroller.scrollTop = 480;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === scroller) {
        return {
          top: 0,
          bottom: 640,
          left: 0,
          right: 900,
          width: 900,
          height: 640,
          x: 0,
          y: 0,
          toJSON: () => '',
        } as DOMRect;
      }

      const batchCard = this.closest?.(`.${UI_CLASS_NAMES.inlineBatchCard}[data-group-id="archive-slot-0"]`);
      if (batchCard instanceof HTMLElement) {
        const expanded = batchCard.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntries}`)?.hidden === false;
        const cardTop = (expanded ? 260 : 80) - scroller.scrollTop;
        if (this === batchCard) {
          return {
            top: cardTop,
            bottom: cardTop + 120,
            left: 0,
            right: 900,
            width: 900,
            height: 120,
            x: 0,
            y: cardTop,
            toJSON: () => '',
          } as DOMRect;
        }

        if (
          this.matches(`.${UI_CLASS_NAMES.inlineBatchHeader}`) ||
          this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`)
        ) {
          const top = 12;
          return {
            top,
            bottom: top + 32,
            left: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 760 : 0,
            right: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 792 : 900,
            width: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 32 : 900,
            height: 32,
            x: this.matches(`.${UI_CLASS_NAMES.inlineBatchAction}`) ? 760 : 0,
            y: top,
            toJSON: () => '',
          } as DOMRect;
        }
      }

      return {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => '',
      } as DOMRect;
    });

    firstToggle.click();
    await flush();
    expect(scroller.scrollTop).toBe(480);

    firstToggle.click();
    await flush();
    await flush();
    rectSpy.mockRestore();

    expect(scroller.scrollTop).toBe(480);
    expect(document.activeElement).toBe(firstToggle);
  });

  it('coalesces rapid expand/collapse toggles and reuses the batch subtree', async () => {
    mountGroupedTranscriptFixture(document, {
      turnCount: 12,
      daySizes: [6, 6],
      streaming: false,
    });

    const updateSpy = vi.spyOn(StatusBar.prototype, 'update');
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(20, 10));
    controller.start();
    await flush();
    await flush();

    await openNewestArchivePage();
    const toggle = document.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`);
    expect(toggle).not.toBeNull();
    toggle?.click();
    await flush();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    const entriesBefore = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntries}`);
    expect(entriesBefore).not.toBeNull();

    const updateBaseline = updateSpy.mock.calls.length;
    toggle?.click();
    toggle?.click();
    await flush();
    await flush();

    expect(updateSpy.mock.calls.length - updateBaseline).toBeLessThanOrEqual(2);
    expect(inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntries}`)).toBe(entriesBefore);
  });

  it('uses soft-fold mode for parked live batches when configured', async () => {
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
        softFallback: true,
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(24, 4));
    controller.start();
    await flush();

    expect(controller.getStatus().softFallback).toBe(true);
    expect(document.querySelectorAll(`.${UI_CLASS_NAMES.softFolded}`).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-turbo-render-group-id]').length).toBe(0);
  });

  it('renders markdown and structured initial-trim content inside inline batch cards without locate/detail actions', async () => {
    mountTranscriptFixture(document, { turnCount: 10, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(14, 4);
    session.turns[0] = createSessionTurn(0, {
      role: 'user',
      parts: ['Show me the archived markdown response.'],
    });
    session.turns[1] = createSessionTurn(1, {
      role: 'assistant',
      parts: ['## Archived heading\nParagraph with **打开终端** and ``bash`` and `pnpm test`.\n\n---\n\n- item one\n- item two\n\n> quoted\n\n```ts\nconst answer = 42;\n```'],
      renderKind: 'markdown-text',
    });
    session.turns[2] = createSessionTurn(2, {
      role: 'tool',
      parts: [],
      renderKind: 'structured-message',
      contentType: 'tool_result',
      structuredDetails: '{"tool":"browser","output":"netstat -lntp"}',
    });
    session.turns[3] = createSessionTurn(3, {
      role: 'system',
      parts: [],
      renderKind: 'structured-message',
      contentType: 'text',
      structuredDetails: '{"metadata":{"is_visually_hidden_from_conversation":true}}',
      hiddenFromConversation: true,
    });
    session.coldTurns = session.turns.slice(0, session.archivedTurnCount);

    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    await openNewestArchivePage();
    expect(inlineRoot).not.toBeNull();

    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const entryBodies = inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}`) ?? [];
    expect(entryBodies.length).toBeGreaterThan(0);
    const userBody = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"]`);
    expect(userBody).not.toBeNull();
    expect(userBody?.closest(`.${UI_CLASS_NAMES.historyEntryFrame}`)?.classList.contains(UI_CLASS_NAMES.historyEntryFrame)).toBe(true);
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryCard}`)).toBeNull();
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"]`)).not.toBeNull();
    const markdownBodies = [
      ...(inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"]`) ?? []),
    ];
    const formattedMarkdownBody = markdownBodies.find((body) => body.textContent?.includes('打开终端'));
    expect(formattedMarkdownBody?.classList.contains('text-message')).toBe(true);
    expect(formattedMarkdownBody?.querySelector('.markdown.prose')).not.toBeNull();
    expect(formattedMarkdownBody?.querySelector('h2')?.textContent).toBe('Archived heading');
    expect(formattedMarkdownBody?.querySelector('strong')?.textContent).toBe('打开终端');
    expect(formattedMarkdownBody?.textContent).not.toContain('**打开终端**');
    expect(formattedMarkdownBody?.textContent).not.toContain('## Archived heading');
    expect(formattedMarkdownBody?.textContent).not.toContain('``bash``');
    expect(formattedMarkdownBody?.querySelector('hr')).not.toBeNull();
    expect(formattedMarkdownBody?.querySelector('code[data-language="ts"]')?.textContent).toContain('const answer = 42;');

    const structuredBody = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"]`);
    expect(structuredBody?.textContent).toContain('netstat -lntp');
    expect(inlineRoot?.textContent).not.toContain('is_visually_hidden_from_conversation');
    expect(inlineRoot?.textContent).not.toContain('Locate message');
    expect(inlineRoot?.textContent).not.toContain('Show details');
  });

  it('renders structured assistant turns as supplemental traces without actions', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/c/chat-123');
    mountTranscriptFixture(document, { turnCount: 14, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    try {
      const session = createInitialTrimSession(14, 4);
      session.turns[0] = createSessionTurn(0, {
        role: 'user',
        parts: ['First user question.'],
      });
      session.turns[1] = createSessionTurn(1, {
        role: 'assistant',
        renderKind: 'structured-message',
        contentType: 'thoughts',
        structuredDetails: '{"reasoning":"Working it out"}',
      });
      session.turns[2] = createSessionTurn(2, {
        role: 'assistant',
        parts: ['Final assistant reply after thinking.'],
      });
      session.turns[3] = createSessionTurn(3, {
        role: 'user',
        parts: ['Second user question.'],
      });

      controller.setInitialTrimSession(session);
      controller.start();
      await flush();
      await flush();

      const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
      await openNewestArchivePage();
      expect(inlineRoot).not.toBeNull();
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();
      await flush();

      const structuredBodies = [
        ...(inlineRoot?.querySelectorAll<HTMLElement>(
          `.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"]`,
        ) ?? []),
      ];
      const structuredBody = structuredBodies.find(
        (body) => body.dataset.supplementalRole === 'thoughts' || body.textContent?.includes('Working it out'),
      );
      expect(structuredBody).not.toBeNull();
      expect(structuredBody?.querySelector('summary')?.textContent).toBe('Thinking');
      expect(structuredBody?.closest(`.${UI_CLASS_NAMES.historyEntryFrame}`)?.querySelector(`.${UI_CLASS_NAMES.historyEntryActions}`)).toBeNull();

      const assistantReply = [
        ...(inlineRoot?.querySelectorAll<HTMLElement>(
          `.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"][data-lane="assistant"]`,
        ) ?? []),
      ].find((body) => body.textContent?.includes('Final assistant reply after thinking.'));
      expect(assistantReply).not.toBeNull();

      const assistantActions = assistantReply?.closest(`.${UI_CLASS_NAMES.historyEntryFrame}`)?.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}`,
      );
      expect(assistantActions).not.toBeNull();
      expect(inlineRoot?.textContent).not.toContain('structured message');
    } finally {
      controller.stop();
      activeControllers.splice(activeControllers.indexOf(controller), 1);
      history.replaceState({}, '', originalPath);
    }
  });

  it('renders host snapshot user content without an extra visible wrapper', async () => {
    mountTranscriptFixture(document, { turnCount: 10, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(14, 4);
    session.turns[0] = createSessionTurn(0, {
      role: 'user',
      renderKind: 'host-snapshot',
      snapshotHtml: '<div data-message-author-role="user" class="user-turn"><div class="user-bubble">Official bubble text</div></div>',
      parts: ['Official bubble text'],
    });
    session.turns[1] = createSessionTurn(1, {
      role: 'assistant',
      parts: ['Reply.'],
    });
    session.coldTurns = session.turns.slice(0, session.archivedTurnCount);

    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const userBody = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"][data-render-kind="host-snapshot"]`,
    );
    expect(userBody).not.toBeNull();
    expect(userBody?.closest(`.${UI_CLASS_NAMES.historyEntryFrame}`)?.classList.contains(UI_CLASS_NAMES.historyEntryFrame)).toBe(true);
    expect(userBody?.innerHTML).toContain('data-message-author-role="user"');
    expect(userBody?.innerHTML).toContain('Official bubble text');
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryCard}`)).toBeNull();
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"]`)).not.toBeNull();
  });

  it('renders fallback user messages with the official bubble structure', async () => {
    mountTranscriptFixture(document, { turnCount: 10, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(14, 4);
    session.turns[0] = createSessionTurn(0, {
      role: 'user',
      parts: [
        'This is a deliberately long archived user message that should wrap across multiple lines while staying on the right side of the batch card instead of becoming a centered full-width panel.',
      ],
    });
    session.turns[1] = createSessionTurn(1, {
      role: 'assistant',
      parts: ['Short reply.'],
    });
    session.coldTurns = session.turns.slice(0, session.archivedTurnCount);

    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const userBody = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"]`);
    expect(userBody).not.toBeNull();
    expect(userBody?.closest(`.${UI_CLASS_NAMES.historyEntryFrame}`)?.classList.contains(UI_CLASS_NAMES.historyEntryFrame)).toBe(true);
    expect(userBody?.classList.contains('text-message')).toBe(true);
    expect(userBody?.classList.contains('items-end')).toBe(true);
    expect(userBody?.classList.contains('whitespace-normal')).toBe(true);
    const bubble = userBody?.querySelector<HTMLElement>('.user-message-bubble-color');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector<HTMLElement>('div')?.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(userBody?.textContent).toContain('deliberately long archived user message');
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"]`)).not.toBeNull();
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryCard}`)).toBeNull();
  });

  it('renders official action buttons for archived live turns and forwards clicks to host controls', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/c/chat-123');
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    for (const [index, turn] of [...document.querySelectorAll<HTMLElement>('[data-testid^="conversation-turn-"]')].entries()) {
      turn.dataset.messageId = `session-turn-${index}`;
      turn.dataset.hostMessageId = `session-turn-${index}`;
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"], button[data-testid="share-turn-action-button"], button[data-testid="more-turn-action-button"]',
    )) {
      Object.defineProperty(button, 'getClientRects', {
        configurable: true,
        value: () => [
          {
            x: 0,
            y: 0,
            width: 24,
            height: 24,
            top: 0,
            left: 0,
            right: 24,
            bottom: 24,
            toJSON: () => '',
          },
        ],
      });
    }
    const speechState = { speaking: false, pending: false, paused: false };
    class MockSpeechSynthesisUtterance extends EventTarget {
      text: string;

      constructor(text: string) {
        super();
        this.text = text;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        get speaking() {
          return speechState.speaking;
        },
        get pending() {
          return speechState.pending;
        },
        get paused() {
          return speechState.paused;
        },
        cancel() {
          speechState.speaking = false;
          speechState.pending = false;
          speechState.paused = false;
        },
        speak(utterance: MockSpeechSynthesisUtterance) {
          speechState.speaking = true;
          speechState.pending = false;
          speechState.paused = false;
          void utterance;
        },
      },
    });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 1,
        minDescendants: 1,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(false);
    const session = createInitialTrimSession(20, 10);
    for (const [index, turn] of session.turns.entries()) {
      turn.parts = [`Turn ${index + 1} primary content.`];
    }
    session.coldTurns = session.turns.slice(0, session.archivedTurnCount);
    controller.setInitialTrimSession(session);

    try {
      controller.start();
      await flush();
      await flush();

      const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
      expect(inlineRoot).not.toBeNull();
      await openNewestArchivePage();
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();
      await flush();

      const firstEntry = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`);
      expect(firstEntry).not.toBeNull();

      const userActions = firstEntry?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="user"]`);
      const assistantActions = firstEntry?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`);
      expect(userActions?.querySelectorAll('button')).toHaveLength(1);
      expect(assistantActions?.querySelectorAll('button')).toHaveLength(5);
      const userCopyButton = userActions?.querySelector<HTMLButtonElement>('button[data-testid="copy-turn-action-button"]');
      const assistantMoreButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]');
      expect(userCopyButton?.dataset.messageId?.length ?? 0).toBeGreaterThan(0);
      expect(assistantMoreButton?.dataset.messageId).toBe(assistantActions?.dataset.messageId);
      expect(assistantMoreButton?.dataset.hostMessageId).toBe(assistantActions?.dataset.hostMessageId);

      userCopyButton?.click();
      assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="copy-turn-action-button"]')?.click();
      assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"]')?.click();
      await flush();
      await flush();
      const refreshedEntries = inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`);
      const refreshedFirstEntry = refreshedEntries?.[0];
      const assistantActionsAfterLike = refreshedFirstEntry?.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
      );
      expect(assistantActionsAfterLike?.querySelector('button[data-testid="bad-response-turn-action-button"]')).toBeNull();
      expect(
        assistantActionsAfterLike?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"] svg')?.style.filter,
      ).toBe('brightness(0)');

      assistantActionsAfterLike?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"]')?.click();
      await flush();
      await flush();
      const assistantActionsAfterUnlike = inlineRoot?.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
      );
      expect(assistantActionsAfterUnlike?.querySelector('button[data-testid="bad-response-turn-action-button"]')).not.toBeNull();
      expect(
        assistantActionsAfterUnlike?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"] svg')?.style.filter,
      ).toBe('');

      const secondEntry = refreshedEntries?.[1];
      const secondAssistantActions = secondEntry?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`);
      secondAssistantActions?.querySelector<HTMLButtonElement>('button[data-testid="bad-response-turn-action-button"]')?.click();
      await flush();
      await flush();
      const refreshedEntriesAfterDislike = inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`);
      const refreshedFirstEntryAfterDislike = refreshedEntriesAfterDislike?.[0];
      const assistantActionsAfterDislike = refreshedFirstEntryAfterDislike?.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
      );
      assistantActionsAfterDislike?.querySelector<HTMLButtonElement>('button[data-testid="share-turn-action-button"]')?.click();
      const refreshedSecondEntryAfterDislike = refreshedEntriesAfterDislike?.[1];
      const secondAssistantDislikeButton = refreshedSecondEntryAfterDislike?.querySelector<HTMLButtonElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
      )?.querySelector<HTMLButtonElement>(
        'button[data-testid="bad-response-turn-action-button"]',
      );
      expect(secondAssistantDislikeButton?.querySelector('svg')?.style.filter).toBe('brightness(0)');
      const moreButton = assistantActionsAfterDislike?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]');
      moreButton?.click();
      await flush();
      const moreMenu = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}`);
      expect(moreMenu).not.toBeNull();
      expect(moreMenu?.parentElement?.classList.contains(UI_CLASS_NAMES.historyEntryActionMenuAnchor)).toBe(true);
      expect(moreMenu?.textContent).toContain('Branch in new chat');
      expect(moreMenu?.textContent).toContain('Read aloud');
      moreMenu?.querySelector<HTMLButtonElement>('button[data-testid="branch-in-new-chat-turn-action-button"]')?.click();
      await flush();
      const assistantActionsAfterBranch = inlineRoot?.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
      );
      const moreButtonAfterBranch = assistantActionsAfterBranch?.querySelector<HTMLButtonElement>(
        'button[data-testid="more-turn-action-button"]',
      );
      moreButtonAfterBranch?.click();
      await flush();
      const moreMenuAfterReopen = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}`);
      expect(moreMenuAfterReopen).not.toBeNull();
      expect(moreMenuAfterReopen?.querySelector('button[data-testid="read-aloud-turn-action-button"]')).not.toBeNull();
      moreMenuAfterReopen?.querySelector<HTMLButtonElement>('button[data-testid="read-aloud-turn-action-button"]')?.click();
      await flush();
      await flush();
      const moreMenuDuringReadAloud = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}`);
      expect(moreMenuDuringReadAloud).not.toBeNull();
      expect(moreMenuDuringReadAloud?.parentElement?.classList.contains(UI_CLASS_NAMES.historyEntryActionMenuAnchor)).toBe(true);
      const hostStopPopupButton = document.createElement('button');
      hostStopPopupButton.type = 'button';
      hostStopPopupButton.textContent = 'Stop reading';
      hostStopPopupButton.setAttribute('data-testid', 'stop-read-aloud-turn-action-button');
      hostStopPopupButton.setAttribute('aria-label', 'Stop reading');
      Object.defineProperty(hostStopPopupButton, 'getClientRects', {
        value: () => [
          {
            x: 0,
            y: 0,
            width: 40,
            height: 24,
            top: 0,
            left: 0,
            right: 40,
            bottom: 24,
            toJSON: () => '',
          },
        ],
      });
      hostStopPopupButton.addEventListener('click', () => {
        const current = Number(document.body.dataset.hostActionStopReadAloudCount ?? '0');
        document.body.dataset.hostActionStopReadAloudCount = String(current + 1);
      });
      document.body.append(hostStopPopupButton);
      hostStopPopupButton.click();
      await flush();

      expect(Number(document.body.dataset.hostActionCopyCount ?? '0')).toBeGreaterThanOrEqual(2);
      expect(document.body.dataset.hostActionLikeCount).toBe('1');
      expect(document.body.dataset.hostActionDislikeCount).toBe('1');
      expect(document.body.dataset.hostActionShareCount).toBe('1');
      expect(Number(document.body.dataset.hostActionStopReadAloudCount ?? '0')).toBe(1);
    } finally {
      controller.stop();
      activeControllers.splice(activeControllers.indexOf(controller), 1);
      history.replaceState({}, '', originalPath);
    }
  }, 30_000);

  it('falls back to the official message feedback endpoint when archived actions have no host button', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/c/chat-123');
    document.body.innerHTML = '<main><section><p>Hydrating conversation shell.</p></section></main>';

    const session = createInitialTrimSession(12, 8);
    const payload = {
      current_node: session.turns.at(-1)?.id ?? null,
      mapping: Object.fromEntries(
        session.turns.map((turn, index) => [
          turn.id,
          {
            id: turn.id,
            parent: index > 0 ? session.turns[index - 1]?.id ?? null : null,
            children: index + 1 < session.turns.length ? [session.turns[index + 1]!.id] : [],
            message: {
              id: turn.id,
              author: { role: turn.role },
              content: { content_type: 'text', parts: turn.parts },
              create_time: index,
            },
          },
        ]),
      ),
    };
    (window as Window & { __turboRenderConversationPayloadCache?: Record<string, unknown> })
      .__turboRenderConversationPayloadCache = {
        'chat-123': payload,
        'conversation-inline-batches': payload,
      };

    const feedbackBodies: unknown[] = [];
    const originalFetch = window.fetch;
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) {
        return new Response(
          JSON.stringify({
            accessToken: 'test-access-token',
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/backend-api/conversation/chat-123') || url.includes('/backend-api/conversation/conversation-inline-batches')) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/backend-api/conversation/message_feedback')) {
        feedbackBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 1,
        minDescendants: 1,
        keepRecentPairs: 2,
        liveHotPairs: 2,
        batchPairCount: 2,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);
    controller.setInitialTrimSession(session);

    try {
      controller.start();
      await flush();
      await openNewestArchivePage();
      document.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();
      await flush();

      const likeButton = document.querySelector<HTMLButtonElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"] button[data-testid="good-response-turn-action-button"]`,
      );
      expect(likeButton).not.toBeNull();
      expect(likeButton?.disabled).toBe(false);

      likeButton?.click();
      await flush();
      await flush();
      await flush();

      expect(feedbackBodies).toEqual([
        {
          message_id: 'session-turn-1',
          conversation_id: 'chat-123',
          rating: 'thumbsUp',
        },
      ]);
      const likedActions = document.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
      );
      const likedButton = likedActions?.querySelector<HTMLButtonElement>(
        'button[data-testid="good-response-turn-action-button"]',
      );
      expect(likedButton?.getAttribute('aria-pressed')).toBe('true');
      expect(likedButton?.querySelector('svg')?.style.filter).toBe('brightness(0)');
      expect(likedActions?.querySelector('button[data-testid="bad-response-turn-action-button"]')).toBeNull();
    } finally {
      window.fetch = originalFetch;
      controller.stop();
      activeControllers.splice(activeControllers.indexOf(controller), 1);
      history.replaceState({}, '', originalPath);
    }
  }, 30_000);

  it('prefers the host More popover when host popovers are available', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/c/chat-123');
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 1,
        minDescendants: 1,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    const toggleHostMoreMenuSpy = vi
      .spyOn(
        controller as unknown as {
          toggleHostMoreMenu(
            groupId: string,
            entry: ManagedHistoryEntry,
            anchorGetter: () => HTMLElement | null,
          ): Promise<boolean>;
        },
        'toggleHostMoreMenu',
      )
      .mockResolvedValue(true);
    controller.setInitialTrimSession(createInitialTrimSession(20, 10));

    try {
      controller.start();
      await flush();
      await flush();

      const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
      expect(inlineRoot).not.toBeNull();
      await openNewestArchivePage();
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();
      await flush();

      const assistantMoreButton = inlineRoot?.querySelector<HTMLButtonElement>(
        `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"] button[data-turbo-render-action="more"]`,
      );
      expect(assistantMoreButton).not.toBeNull();
      assistantMoreButton?.click();
      await flush();

      const moreMenu = inlineRoot?.querySelector<HTMLElement>('[data-turbo-render-entry-menu="true"]');
      expect(toggleHostMoreMenuSpy).toHaveBeenCalled();
      expect(moreMenu).toBeNull();
    } finally {
      controller.stop();
      activeControllers.splice(activeControllers.indexOf(controller), 1);
      history.replaceState({}, '', originalPath);
    }
  }, 30_000);

  it('does not fake archived like and dislike state when no host action or backend fallback is available', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/c/chat-123');
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 1,
        minDescendants: 1,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    const resolveBindingSpy = vi.spyOn(
      controller as unknown as {
        resolveHostArchiveActionBinding(
          groupId: string,
          entry: ManagedHistoryEntry,
          action: ArchiveEntryAction,
          anchorGetter?: () => HTMLElement | null,
        ): unknown;
      },
      'resolveHostArchiveActionBinding',
    ).mockReturnValue(null);
    vi.spyOn(
      controller as unknown as {
        getConversationIdForReadAloud(): string | null;
      },
      'getConversationIdForReadAloud',
    ).mockReturnValue(null);
    const session = createInitialTrimSession(20, 10);
    session.conversationId = null;
    controller.setInitialTrimSession(session);

    try {
      controller.start();
      await flush();
      await flush();

      const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
      expect(inlineRoot).not.toBeNull();
      await openNewestArchivePage();
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();
      await flush();

      const getAssistantActions = () =>
        inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`) ?? null;
      const likeButton = getAssistantActions()?.querySelector<HTMLButtonElement>(
        'button[data-testid="good-response-turn-action-button"]',
      );
      expect(likeButton).not.toBeNull();
      expect(likeButton?.getAttribute('aria-pressed')).toBe('false');
      expect(likeButton?.dataset.turboRenderActionMode).toBe('unavailable');
      expect(likeButton?.disabled).toBe(true);

      likeButton?.click();
      await flush();
      await flush();

      const unlikedActions = getAssistantActions();
      expect(
        unlikedActions?.querySelector<HTMLButtonElement>('button[data-testid="good-response-turn-action-button"]')?.getAttribute(
          'aria-pressed',
        ),
      ).toBe('false');
      expect(unlikedActions?.querySelector('button[data-testid="bad-response-turn-action-button"]')).not.toBeNull();
      expect(resolveBindingSpy).toHaveBeenCalled();
    } finally {
      controller.stop();
      activeControllers.splice(activeControllers.indexOf(controller), 1);
      history.replaceState({}, '', originalPath);
    }
  }, 30_000);

  it('prefers host message ids over TurboRender archive copies when building read aloud urls', async () => {
    document.body.innerHTML = `
      <main>
        <div class="text-message min-h-8" data-message-id="real-user-message-id" data-message-author-role="user">
          <div>Host user prompt for speech.</div>
        </div>
        <section data-turbo-render-ui-root="true">
          <article data-message-id="turn-chat:e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f-1-cwdqxl" data-message-author-role="assistant">
            <div class="${UI_CLASS_NAMES.inlineBatchEntry}">
              <div class="${UI_CLASS_NAMES.historyEntryBody}" data-render-kind="markdown-text">
                <p>Archived assistant speech summary.</p>
              </div>
            </div>
          </article>
        </section>
        <div class="text-message min-h-8" data-message-id="real-message-id" data-message-author-role="assistant">
          <div>Host assistant reply for speech.</div>
        </div>
      </main>
    `;
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugConversationId = 'conversation-real-id';

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 1,
      pairIndex: 1,
      turnId: 'turn-chat:e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f-1-cwdqxl',
      liveTurnId: null,
      messageId: 'turn-chat:e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f-1-cwdqxl',
      groupId: null,
      parts: ['Assistant reply for speech.'],
      text: 'Assistant reply for speech.',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const url = (controller as unknown as {
      buildReadAloudUrl(
        entry: ManagedHistoryEntry,
        groupId: string | null,
      ): string | null;
    }).buildReadAloudUrl(entry, null);

    expect(url).not.toBeNull();
    const requestUrl = new URL(url!);
    expect(requestUrl.searchParams.get('conversation_id')).toBe('conversation-real-id');
    expect(requestUrl.searchParams.get('message_id')).toBe('real-message-id');
    expect(requestUrl.searchParams.get('message_id')).not.toMatch(/^turn-chat:/);
    expect(document.body.dataset.turboRenderDebugReadAloudHostSelectedSource).toBe('turn-index');
  });

  it('prefers rendered archive entry message ids over synthetic entry ids when building read aloud urls', async () => {
    document.body.innerHTML = `
      <main>
        <section data-turbo-render-ui-root="true">
          <div class="${UI_CLASS_NAMES.inlineBatchEntry}">
            <div class="${UI_CLASS_NAMES.historyEntryFrame}" data-message-id="real-user-message-id" data-message-author-role="user">
              <div class="${UI_CLASS_NAMES.historyEntryBody}" data-render-kind="host-snapshot" data-message-id="real-user-message-id">
                <p>User prompt for speech.</p>
              </div>
              <div class="${UI_CLASS_NAMES.historyEntryActions}" data-group-id="archive-slot-0" data-entry-id="history-user-entry" data-message-id="real-user-message-id"></div>
            </div>
            <div class="${UI_CLASS_NAMES.historyEntryFrame}" data-message-id="real-archive-message-id" data-message-author-role="assistant">
              <div class="${UI_CLASS_NAMES.historyEntryBody}" data-render-kind="markdown-text" data-message-id="real-archive-message-id">
                <p>Assistant reply for speech.</p>
              </div>
              <div class="${UI_CLASS_NAMES.historyEntryActions}" data-group-id="archive-slot-0" data-entry-id="history-entry" data-message-id="real-archive-message-id"></div>
            </div>
          </div>
        </section>
      </main>
    `;
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugConversationId = 'conversation-real-id';

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const actionAnchor = document.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-entry-id="history-entry"]`,
    ) ?? null;
    (controller as unknown as {
      statusBar: {
        getEntryActionAnchor(groupId: string, entryId: string): HTMLElement | null;
        destroy(): void;
      };
    }).statusBar = {
      getEntryActionAnchor: () => actionAnchor,
      destroy: () => {},
    };

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'turn-chat:synthetic-message-id',
      liveTurnId: null,
      messageId: 'turn-chat:synthetic-message-id',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply for speech.'],
      text: 'Assistant reply for speech.',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const url = (controller as unknown as {
      buildReadAloudUrl(
        entry: ManagedHistoryEntry,
        groupId: string | null,
      ): string | null;
    }).buildReadAloudUrl(entry, 'archive-slot-0');

    expect(url).not.toBeNull();
    const requestUrl = new URL(url!);
    expect(requestUrl.searchParams.get('conversation_id')).toBe('conversation-real-id');
    expect(requestUrl.searchParams.get('message_id')).toBe('real-archive-message-id');
    expect(requestUrl.searchParams.get('message_id')).not.toMatch(/^turn-chat:/);
  });

  it('refuses to build backend read aloud urls from synthetic ids alone', async () => {
    document.body.innerHTML = `
      <main>
        <section data-turbo-render-ui-root="true">
          <article data-message-id="turn-chat:synthetic-message-id" data-message-author-role="assistant">
            <div class="${UI_CLASS_NAMES.inlineBatchEntry}">
              <div class="${UI_CLASS_NAMES.historyEntryBody}" data-render-kind="markdown-text">
                <p>Assistant reply for speech.</p>
              </div>
            </div>
          </article>
        </section>
      </main>
    `;
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugConversationId = 'conversation-real-id';

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'turn-chat:synthetic-message-id',
      liveTurnId: null,
      messageId: 'turn-chat:synthetic-message-id',
      groupId: null,
      parts: ['Assistant reply for speech.'],
      text: 'Assistant reply for speech.',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const url = (controller as unknown as {
      buildReadAloudUrl(
        entry: ManagedHistoryEntry,
        groupId: string | null,
      ): string | null;
    }).buildReadAloudUrl(entry, null);

    expect(url).toBeNull();
    expect(document.body.dataset.turboRenderDebugReadAloudCandidateParked ?? '').toBe('');
    expect(document.body.dataset.turboRenderDebugReadAloudCandidateHost ?? '').toBe('');
    expect(document.body.dataset.turboRenderDebugReadAloudCandidateSnapshot ?? '').toBe('');
    expect(document.body.dataset.turboRenderDebugReadAloudCandidateRecord ?? '').toBe('');
    expect(document.body.dataset.turboRenderDebugReadAloudCandidateNode ?? '').toBe('');
    expect(document.body.dataset.turboRenderDebugReadAloudMessageId ?? '').toBe('');
  });

  it('binds host More clicks to the current archive entry instead of the nearest global button', async () => {
    document.body.innerHTML = `
      <main>
        <section>
          <article data-message-id="wrong-message-id" data-message-author-role="assistant">
            <button data-testid="more-turn-action-button" aria-label="More">Wrong</button>
          </article>
          <article data-message-id="target-message-id" data-message-author-role="assistant">
            <button data-testid="more-turn-action-button" aria-label="More">Target</button>
          </article>
        </section>
      </main>
    `;

    const wrongButton = document.querySelectorAll<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')[0]!;
    const targetButton = document.querySelectorAll<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')[1]!;
    Object.defineProperty(wrongButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    Object.defineProperty(targetButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    vi.spyOn(wrongButton, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 24,
      left: 0,
      right: 24,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);
    vi.spyOn(targetButton, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      bottom: 224,
      left: 200,
      right: 224,
      width: 24,
      height: 24,
      x: 200,
      y: 200,
      toJSON: () => '',
    } as DOMRect);

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    const dispatchSpy = vi.spyOn(
      controller as unknown as { dispatchHumanClick(target: HTMLElement): void },
      'dispatchHumanClick',
    );

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'turn-chat:target-message-id',
      liveTurnId: null,
      messageId: 'target-message-id',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply'],
      text: 'Assistant reply',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const acted = await (controller as unknown as {
      clickHostArchiveAction(
        groupId: string,
        entry: ManagedHistoryEntry,
        action: 'more',
        anchorGetter: () => HTMLElement | null,
      ): Promise<boolean>;
    }).clickHostArchiveAction('archive-slot-0', entry, 'more', () => wrongButton);

    expect(acted).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(targetButton);
  });

  it('does not fall back to the nearest global More button on host pages when the current archive entry has no precise binding', async () => {
    document.body.innerHTML = `
      <main>
        <section>
          <article data-message-id="wrong-message-id" data-message-author-role="assistant">
            <button data-testid="more-turn-action-button" aria-label="More">Wrong</button>
          </article>
        </section>
      </main>
    `;

    const wrongButton = document.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')!;
    Object.defineProperty(wrongButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    vi.spyOn(wrongButton, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 24,
      left: 0,
      right: 24,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    const dispatchSpy = vi.spyOn(
      controller as unknown as { dispatchHumanClick(target: HTMLElement): void },
      'dispatchHumanClick',
    );

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 10,
      pairIndex: 5,
      turnId: 'turn-chat:missing-message-id',
      liveTurnId: null,
      messageId: 'missing-message-id',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply'],
      text: 'Assistant reply',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const acted = await (controller as unknown as {
      clickHostArchiveAction(
        groupId: string,
        entry: ManagedHistoryEntry,
        action: 'more',
        anchorGetter: () => HTMLElement | null,
      ): Promise<boolean>;
    }).clickHostArchiveAction('archive-slot-0', entry, 'more', () => wrongButton);

    expect(acted).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('can use a matching global More button when explicitly allowed', async () => {
    document.body.innerHTML = `
      <main>
        <section>
          <article data-message-author-role="assistant">
            <div>Assistant reply for speech.</div>
            <button data-testid="more-turn-action-button" aria-label="More">More</button>
          </article>
        </section>
      </main>
    `;

    const globalButton = document.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')!;
    Object.defineProperty(globalButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    vi.spyOn(globalButton, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 24,
      left: 0,
      right: 24,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    vi.spyOn(
      controller as unknown as {
        collectHostSearchRootsForEntry(groupId: string, entry: ManagedHistoryEntry): HTMLElement[];
      },
      'collectHostSearchRootsForEntry',
    ).mockReturnValue([]);
    const dispatchSpy = vi.spyOn(
      controller as unknown as { dispatchHumanClick(target: HTMLElement): void },
      'dispatchHumanClick',
    );

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 10,
      pairIndex: 5,
      turnId: 'turn-chat:missing-message-id',
      liveTurnId: null,
      messageId: 'missing-message-id',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply for speech.'],
      text: 'Assistant reply for speech.',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const acted = await (controller as unknown as {
      clickHostArchiveAction(
        groupId: string,
        entry: ManagedHistoryEntry,
        action: 'more',
        anchorGetter: () => HTMLElement | null,
        options?: { allowBroadMoreFallback?: boolean },
      ): Promise<boolean>;
    }).clickHostArchiveAction('archive-slot-0', entry, 'more', () => globalButton, {
      allowBroadMoreFallback: true,
    });

    expect(acted).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(globalButton);
  });

  it('does not click a connected host More button when its surrounding text does not match the archive entry', async () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div>Sure, here's an example code for a chatbot that can summarize the content of a large PDF.</div>
          <button data-testid="more-turn-action-button" aria-label="More">Wrong</button>
        </article>
      </main>
    `;

    const wrongArticle = document.querySelector<HTMLElement>('article[data-message-author-role="assistant"]')!;
    const wrongButton = wrongArticle.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')!;
    Object.defineProperty(wrongButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    vi.spyOn(wrongButton, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 24,
      left: 0,
      right: 24,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    const dispatchSpy = vi.spyOn(
      controller as unknown as { dispatchHumanClick(target: HTMLElement): void },
      'dispatchHumanClick',
    );
    (controller as unknown as { records: Map<string, unknown> }).records.set('turn-chat:missing-message-id', {
      id: 'turn-chat:missing-message-id',
      index: 0,
      role: 'assistant',
      isStreaming: false,
      parked: false,
      node: wrongArticle,
      messageId: null,
    });

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'turn-chat:missing-message-id',
      liveTurnId: null,
      messageId: 'missing-message-id',
      groupId: 'archive-slot-0',
      parts: ['Building a chatbot for PDF can be a useful tool for automating tasks.'],
      text: 'Building a chatbot for PDF can be a useful tool for automating tasks.',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const acted = await (controller as unknown as {
      clickHostArchiveAction(
        groupId: string,
        entry: ManagedHistoryEntry,
        action: 'more',
        anchorGetter: () => HTMLElement | null,
      ): Promise<boolean>;
    }).clickHostArchiveAction('archive-slot-0', entry, 'more', () => wrongButton);

    expect(acted).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('prefers the rendered nested host message id over an outer archive wrapper id when opening More on host pages', async () => {
    document.body.innerHTML = `
      <main>
        <section>
          <article data-message-id="target-message-id" data-message-author-role="assistant">
            <button data-testid="more-turn-action-button" aria-label="More">Target</button>
          </article>
        </section>
      </main>
    `;

    const targetButton = document.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')!;
    Object.defineProperty(targetButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    vi.spyOn(targetButton, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 24,
      left: 0,
      right: 24,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    const dispatchSpy = vi.spyOn(
      controller as unknown as { dispatchHumanClick(target: HTMLElement): void },
      'dispatchHumanClick',
    );

    const actionAnchor = document.createElement('div');
    actionAnchor.className = UI_CLASS_NAMES.historyEntryActions;
    actionAnchor.dataset.groupId = 'archive-slot-0';
    actionAnchor.dataset.entryId = 'history-entry';
    actionAnchor.innerHTML = `
      <div class="${UI_CLASS_NAMES.historyEntryFrame}" data-message-id="wrong-wrapper-id" data-message-author-role="assistant">
        <div class="${UI_CLASS_NAMES.historyEntryBody}" data-render-kind="host-snapshot" data-message-id="wrong-wrapper-id">
          <div data-message-author-role="assistant" data-message-id="target-message-id">Assistant reply.</div>
        </div>
      </div>
    `;
    document.body.append(actionAnchor);

    (controller as unknown as {
      statusBar: {
        getEntryActionAnchor(groupId: string, entryId: string): HTMLElement | null;
        destroy(): void;
      };
    }).statusBar = {
      getEntryActionAnchor: () => actionAnchor,
      destroy: () => {},
    };

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 1,
      pairIndex: 0,
      turnId: 'turn-chat:synthetic-message-id',
      liveTurnId: null,
      messageId: 'wrong-wrapper-id',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply.'],
      text: 'Assistant reply.',
      renderKind: 'host-snapshot' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const acted = await (controller as unknown as {
      clickHostArchiveAction(
        groupId: string,
        entry: ManagedHistoryEntry,
        action: 'more',
        anchorGetter: () => HTMLElement | null,
      ): Promise<boolean>;
    }).clickHostArchiveAction('archive-slot-0', entry, 'more', () => actionAnchor);

    expect(acted).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(targetButton);
  });

  it('does not use a broad scoped host root fallback for More on host pages', async () => {
    document.body.innerHTML = `
      <main>
        <section>
          <article data-message-id="wrong-message-id" data-message-author-role="assistant">
            <button data-testid="more-turn-action-button" aria-label="More">Wrong</button>
          </article>
        </section>
      </main>
    `;

    const wrongButton = document.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')!;
    Object.defineProperty(wrongButton, 'getClientRects', {
      value: () => [{ x: 0, y: 0, width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24, toJSON: () => '' }],
    });
    vi.spyOn(wrongButton, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 24,
      left: 0,
      right: 24,
      width: 24,
      height: 24,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect);

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);
    vi.spyOn(controller as unknown as { shouldPreferHostMorePopover(): boolean }, 'shouldPreferHostMorePopover').mockReturnValue(true);
    vi.spyOn(
      controller as unknown as {
        collectHostSearchRootsForEntry(groupId: string, entry: ManagedHistoryEntry): HTMLElement[];
      },
      'collectHostSearchRootsForEntry',
    ).mockReturnValue([document.querySelector('main') as HTMLElement]);
    const dispatchSpy = vi.spyOn(
      controller as unknown as { dispatchHumanClick(target: HTMLElement): void },
      'dispatchHumanClick',
    );

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 10,
      pairIndex: 5,
      turnId: 'turn-chat:missing-message-id',
      liveTurnId: null,
      messageId: 'missing-message-id',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply'],
      text: 'Assistant reply',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const acted = await (controller as unknown as {
      clickHostArchiveAction(
        groupId: string,
        entry: ManagedHistoryEntry,
        action: 'more',
        anchorGetter: () => HTMLElement | null,
      ): Promise<boolean>;
    }).clickHostArchiveAction('archive-slot-0', entry, 'more', () => wrongButton);

    expect(acted).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('positions host More popovers above or below the anchor', async () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const anchor = document.createElement('button');
    document.body.append(anchor);
    document.body.append(anchor);
    const menu = document.createElement('div');
    let anchorRect = {
      top: 40,
      bottom: 64,
      left: 200,
      right: 232,
      width: 32,
      height: 24,
      x: 200,
      y: 40,
      toJSON: () => '',
    } as DOMRect;
    let menuRect = {
      top: 0,
      bottom: 120,
      left: 0,
      right: 184,
      width: 184,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect;

    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => anchorRect);
    vi.spyOn(menu, 'getBoundingClientRect').mockImplementation(() => menuRect);

    (controller as unknown as {
      positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void;
    }).positionVisibleHostMenuToAnchor(menu, anchor);

    expect(menu.style.position).toBe('fixed');
    expect(menu.style.left).toBe('48px');
    expect(menu.style.top).toBe('72px');
    expect(menu.dataset.turboRenderHostMenuPlacement).toBe('below');

    anchorRect = {
      top: 80,
      bottom: 104,
      left: 200,
      right: 232,
      width: 32,
      height: 24,
      x: 200,
      y: 80,
      toJSON: () => '',
    } as DOMRect;

    (controller as unknown as {
      positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void;
    }).positionVisibleHostMenuToAnchor(menu, anchor);

    expect(menu.style.top).toBe('112px');
    expect(menu.dataset.turboRenderHostMenuPlacement).toBe('below');

    anchorRect = {
      top: 520,
      bottom: 544,
      left: 200,
      right: 232,
      width: 32,
      height: 24,
      x: 200,
      y: 520,
      toJSON: () => '',
    } as DOMRect;
    menuRect = {
      top: 0,
      bottom: 120,
      left: 0,
      right: 184,
      width: 184,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect;

    (controller as unknown as {
      positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void;
    }).positionVisibleHostMenuToAnchor(menu, anchor);

    expect(menu.style.position).toBe('fixed');
    expect(menu.style.left).toBe('48px');
    expect(menu.style.top).toBe('392px');
    expect(menu.dataset.turboRenderHostMenuPlacement).toBe('above');

    anchorRect = {
      top: -80,
      bottom: -56,
      left: 200,
      right: 232,
      width: 32,
      height: 24,
      x: 200,
      y: -80,
      toJSON: () => '',
    } as DOMRect;

    (controller as unknown as {
      positionVisibleHostMenuToAnchor(menu: HTMLElement, anchor: HTMLElement): void;
    }).positionVisibleHostMenuToAnchor(menu, anchor);

    expect(menu.style.top).toBe('8px');
    expect(menu.dataset.turboRenderHostMenuPlacement).toBe('below');
  });

  it('dispatches host clicks through React handlers when host props are available', () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const dispatchEventSpy = vi.fn();
    const target = {
      getBoundingClientRect: () =>
        ({
          x: 10,
          y: 20,
          width: 32,
          height: 24,
          left: 10,
          top: 20,
          right: 42,
          bottom: 44,
          toJSON: () => '',
        }) as DOMRect,
      dispatchEvent: dispatchEventSpy,
    } as unknown as HTMLElement & Record<string, unknown>;
    const calls: string[] = [];
    Object.defineProperty(target, '__reactProps$test', {
      configurable: true,
      value: {
        onPointerMove: (event: { buttons: number }) => {
          calls.push(`move:${event.buttons}`);
        },
        onPointerDown: (event: { preventDefault(): void }) => {
          calls.push('down');
          event.preventDefault();
        },
        onPointerUp: () => {
          calls.push('up');
        },
        onClick: () => {
          calls.push('click');
        },
      },
    });

    (controller as unknown as { dispatchHumanClick(target: HTMLElement): void }).dispatchHumanClick(target);

    expect(calls).toEqual(['move:1', 'down', 'up', 'click']);
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it('finds host More menu items rendered as menuitem divs', () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const menu = document.createElement('div');
    menu.innerHTML = `
      <div role="menuitem" data-testid="branch-in-new-chat-turn-action-button" aria-label="新聊天中的分支">
        <div>新聊天中的分支</div>
      </div>
      <div role="menuitem" data-testid="voice-play-turn-action-button" aria-label="朗读">
        <div>朗读</div>
      </div>
    `;

    expect(
      (controller as unknown as {
        findHostMoreMenuAction(menu: ParentNode, action: 'branch' | 'read-aloud' | 'stop-read-aloud'): HTMLElement | null;
      }).findHostMoreMenuAction(menu, 'branch'),
    ).toBe(menu.querySelector('[role="menuitem"][data-testid="branch-in-new-chat-turn-action-button"]'));
    expect(
      (controller as unknown as {
        findHostMoreMenuAction(menu: ParentNode, action: 'branch' | 'read-aloud' | 'stop-read-aloud'): HTMLElement | null;
      }).findHostMoreMenuAction(menu, 'read-aloud'),
    ).toBe(menu.querySelector('[role="menuitem"][data-testid="voice-play-turn-action-button"]'));
  });

  it('opens the inline archived More menu without probing host popovers', async () => {
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(24, 8);
    for (const turn of session.turns) {
      turn.createTime = 1_712_740_680;
    }
    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const openHostMenuSpy = vi
      .spyOn(
        controller as unknown as { openHostMoreMenu: (...args: unknown[]) => Promise<unknown> },
        'openHostMoreMenu',
      )
      .mockResolvedValue(null);
    vi.spyOn(
      controller as unknown as { shouldPreferHostMorePopover: () => boolean },
      'shouldPreferHostMorePopover',
    ).mockReturnValue(true);
    const toggleHostMoreMenuSpy = vi
      .spyOn(
        controller as unknown as {
          toggleHostMoreMenu(
            groupId: string,
            entry: ManagedHistoryEntry,
            anchorGetter: () => HTMLElement | null,
          ): Promise<boolean>;
        },
        'toggleHostMoreMenu',
      )
      .mockResolvedValue(false);

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const assistantMoreButton = inlineRoot?.querySelector<HTMLButtonElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"] button[data-testid="more-turn-action-button"]`,
    );
    expect(assistantMoreButton).not.toBeNull();
    assistantMoreButton?.click();
    await flush();

    const fallbackMenu = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`,
    );
    expect(openHostMenuSpy).not.toHaveBeenCalled();
    expect(toggleHostMoreMenuSpy).toHaveBeenCalledTimes(1);
    expect(fallbackMenu).not.toBeNull();
    expect(fallbackMenu?.textContent).toContain('Branch');

    assistantMoreButton?.click();
    await flush();
    expect(toggleHostMoreMenuSpy).toHaveBeenCalledTimes(1);
    expect(
      inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`),
    ).toBeNull();
  });

  it('copies folded assistant entries with rich clipboard data and local copied feedback', async () => {
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    class TestClipboardItem {
      readonly items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }
    const originalClipboard = window.navigator.clipboard;
    const originalClipboardItem = (window as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);
    vi.spyOn(
      controller as unknown as { shouldUseHostActionClicks(): boolean },
      'shouldUseHostActionClicks',
    ).mockReturnValue(false);

    try {
      controller.setInitialTrimSession(createInitialTrimSession(24, 8));
      controller.start();
      await flush();

      const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
      await openNewestArchivePage();
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();

      const archiveEntry = inlineRoot?.querySelector<HTMLElement>(
        `.${UI_CLASS_NAMES.inlineBatchEntry} .${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"]`,
      );
      const copyButton = archiveEntry?.querySelector<HTMLButtonElement>('button[data-turbo-render-action="copy"]');
      expect(copyButton).not.toBeNull();
      copyButton?.click();
      await flush();

      const copiedButton = inlineRoot?.querySelector<HTMLButtonElement>(
        `.${UI_CLASS_NAMES.inlineBatchEntry} .${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"] button[data-turbo-render-action="copy"]`,
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(writeText).not.toHaveBeenCalled();
      expect(copiedButton?.dataset.copyState).toBe('copied');
      expect(copiedButton?.getAttribute('aria-label')).toBe('Copied');
      const clipboardItems = write.mock.calls[0]?.[0] as TestClipboardItem[] | undefined;
      expect(clipboardItems).toHaveLength(1);
      const item = clipboardItems![0]!;
      expect(Object.keys(item.items)).toEqual(['text/plain', 'text/html']);
    } finally {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
      Object.defineProperty(window, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
    }
  });

  it('prefers a precise host copy action before local clipboard fallback', async () => {
    mountTranscriptFixture(document, { turnCount: 20, streaming: false });
    const write = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = window.navigator.clipboard;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { write },
    });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    try {
      controller.setInitialTrimSession(createInitialTrimSession(24, 8));
      controller.start();
      await flush();

      const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
      await openNewestArchivePage();
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
      await flush();

      const hostButton = document.createElement('button');
      const resolveBindingSpy = vi.spyOn(
        controller as unknown as {
          resolveHostArchiveActionBinding(
            groupId: string,
            entry: ManagedHistoryEntry,
            action: 'copy',
            anchorGetter: () => HTMLElement | null,
          ): unknown;
        },
        'resolveHostArchiveActionBinding',
      ).mockImplementation((_groupId, _entry, action, anchorGetter) => ({
        action,
        anchor: typeof anchorGetter === 'function' ? anchorGetter() : null,
        button: hostButton,
      }));
      const dispatchSpy = vi.spyOn(
        controller as unknown as {
          dispatchHostArchiveAction(binding: unknown, groupId: string, entry: ManagedHistoryEntry): boolean;
        },
        'dispatchHostArchiveAction',
      ).mockReturnValue(true);

      const copyButton = inlineRoot?.querySelector<HTMLButtonElement>(
        `.${UI_CLASS_NAMES.inlineBatchEntry} .${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"] button[data-turbo-render-action="copy"]`,
      );
      expect(copyButton).not.toBeNull();
      copyButton?.click();
      await flush();

      expect(resolveBindingSpy).toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
      const refreshedCopyButton = inlineRoot?.querySelector<HTMLButtonElement>(
        `.${UI_CLASS_NAMES.inlineBatchEntry} .${UI_CLASS_NAMES.historyEntryFrame}[data-lane="assistant"] button[data-turbo-render-action="copy"]`,
      );
      expect(refreshedCopyButton?.dataset.copyState).toBe('copied');
    } finally {
      controller.stop();
      activeControllers.splice(activeControllers.indexOf(controller), 1);
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('anchors host More popovers once and keeps them static after open', async () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'turn-chat:history-entry',
      liveTurnId: null,
      messageId: 'history-entry',
      groupId: 'archive-slot-0',
      parts: ['Assistant reply'],
      text: 'Assistant reply',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const anchor = document.createElement('button');
    let anchorRect = {
      top: 360,
      bottom: 384,
      left: 240,
      right: 272,
      width: 32,
      height: 24,
      x: 240,
      y: 360,
      toJSON: () => '',
    } as DOMRect;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => anchorRect);
    vi.spyOn(anchor, 'getClientRects').mockImplementation(
      () => [anchorRect] as unknown as DOMRectList,
    );

    const menu = document.createElement('div');
    const menuRect = {
      top: 0,
      bottom: 120,
      left: 0,
      right: 184,
      width: 184,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => '',
    } as DOMRect;
    vi.spyOn(menu, 'getBoundingClientRect').mockImplementation(() => menuRect);

    vi.spyOn(
      controller as unknown as {
        clickHostArchiveAction(
          groupId: string,
          candidateEntry: ManagedHistoryEntry,
          action: 'more',
          anchorGetter: () => HTMLElement | null,
        ): Promise<boolean>;
      },
      'clickHostArchiveAction',
    ).mockResolvedValue(true);
    vi.spyOn(
      controller as unknown as {
        waitForPreferredHostMenu(
          previousMenus: Set<HTMLElement>,
          anchorGetter: () => HTMLElement | null,
          timeoutMs: number,
        ): Promise<HTMLElement | null>;
      },
      'waitForPreferredHostMenu',
    ).mockResolvedValue(menu);
    const result = await (controller as unknown as {
      openHostMoreMenu(
        groupId: string,
        candidateEntry: ManagedHistoryEntry,
        anchorGetter: () => HTMLElement | null,
      ): Promise<{ menu: HTMLElement } | null>;
    }).openHostMoreMenu('archive-slot-0', entry, () => anchor);
    expect(result?.menu).toBe(menu);

    const topBefore = menu.style.top;
    const leftBefore = menu.style.left;
    anchorRect = {
      ...anchorRect,
      top: 120,
      bottom: 144,
      y: 120,
    };

    await new Promise((resolve) => setTimeout(resolve, 64));
    expect(menu.style.top).toBe(topBefore);
    expect(menu.style.left).toBe(leftBefore);
  });

  it('prefers conversation payload ids over stale archive ids before backend read aloud playback', async () => {
    const conversationId = 'e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f';
    document.body.innerHTML = `
      <main>
        <section data-turbo-render-ui-root="true"></section>
      </main>
    `;
    const readAloudContext = {
      conversationId,
      entryRole: 'assistant' as const,
      entryText: 'mismatched assistant text',
      entryKey: 'history-entry',
      entryMessageId: 'assistant5',
    };
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugConversationId = conversationId;
    document.body.dataset.turboRenderDebugReadAloudUrl =
      `https://chatgpt.com/backend-api/synthesize?message_id=turn-chat:${conversationId}-5-9ox7ch&conversation_id=${conversationId}&voice=cove&format=aac`;
    document.body.dataset.turboRenderReadAloudConversationId = conversationId;
    document.body.dataset.turboRenderReadAloudEntryRole = readAloudContext.entryRole;
    document.body.dataset.turboRenderReadAloudEntryText = readAloudContext.entryText;
    document.body.dataset.turboRenderReadAloudEntryKey = readAloudContext.entryKey;
    (window as typeof window & { __turboRenderReadAloudContext?: typeof readAloudContext }).__turboRenderReadAloudContext =
      readAloudContext;

    const nativeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (requestUrl.includes('/api/auth/session')) {
        return new Response(
          JSON.stringify({
            accessToken: 'test-read-aloud-access-token',
            expires: '2099-01-01T00:00:00.000Z',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes(`/backend-api/conversation/${conversationId}`)) {
        return new Response(
          JSON.stringify({
            current_node: 'assistant5',
            mapping: {
              root: { id: 'root', parent: null, children: ['assistant5'], message: null },
              assistant5: {
                id: 'assistant5',
                parent: 'root',
                children: [],
                message: {
                  id: 'assistant5',
                  author: { role: 'assistant', name: null, metadata: {} },
                  create_time: 8,
                  content: { content_type: 'text', parts: ['assistant-5'] },
                },
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (requestUrl.includes('/backend-api/synthesize')) {
        return new Response('', {
          status: 200,
          headers: { 'content-type': 'audio/aac' },
        });
      }

      throw new Error(`Unexpected fetch request: ${requestUrl}`);
    }) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanupBootstrap = installConversationBootstrap(window, document);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_CONFIG',
          payload: {
            enabled: true,
            mode: 'performance',
            initialTrimEnabled: true,
            initialHotPairs: 2,
            minFinalizedBlocks: 4,
          },
        },
      }),
    );

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'turn-chat:synthetic-message-id',
      liveTurnId: null,
      messageId: 'turn-chat:synthetic-message-id',
      groupId: null,
      parts: ['assistant-5'],
      text: 'assistant-5',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:read-aloud');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await (controller as unknown as {
      startReadAloudPlayback(
        groupId: string | null,
        entry: ManagedHistoryEntry,
        entryKey: string,
        options?: {
          conversationId?: string | null;
          resolvedConversationMessageId?: string | null;
        },
      ): Promise<void>;
    }).startReadAloudPlayback(null, entry, 'history-entry', {
      conversationId,
      resolvedConversationMessageId: 'stale-archive-message-id',
    });

    expect(nativeFetch).toHaveBeenCalledTimes(3);
    const sessionCall = (nativeFetch as unknown as Mock).mock.calls[0]![0];
    const conversationCall = (nativeFetch as unknown as Mock).mock.calls[1]![0];
    const conversationInit = (nativeFetch as unknown as Mock).mock.calls[1]![1] as RequestInit | undefined;
    const synthesizeCall = (nativeFetch as unknown as Mock).mock.calls[2]![0];
    const synthesizeInit = (nativeFetch as unknown as Mock).mock.calls[2]![1] as RequestInit | undefined;
    expect(
      typeof sessionCall === 'string'
        ? sessionCall
        : sessionCall instanceof Request
          ? sessionCall.url
          : String(sessionCall),
    ).toContain('/api/auth/session');
    expect(
      typeof conversationCall === 'string'
        ? conversationCall
        : conversationCall instanceof Request
          ? conversationCall.url
          : String(conversationCall),
    ).toContain(`/backend-api/conversation/${conversationId}`);

    const synthesizeUrl = new URL(
      typeof synthesizeCall === 'string'
        ? synthesizeCall
        : synthesizeCall instanceof URL
          ? synthesizeCall.toString()
          : synthesizeCall instanceof Request
            ? synthesizeCall.url
            : String(synthesizeCall),
    );
    expect((conversationInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer test-read-aloud-access-token',
    );
    expect((synthesizeInit?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      'Bearer test-read-aloud-access-token',
    );
    expect(synthesizeUrl.searchParams.get('conversation_id')).toBe(conversationId);
    expect(synthesizeUrl.searchParams.get('message_id')).toBe('assistant5');
    expect(synthesizeUrl.searchParams.get('message_id')).not.toMatch(/^turn-chat:/);
    expect(document.body.dataset.turboRenderDebugReadAloudResolvedSource).toBe('conversation-payload');
    expect(document.body.dataset.turboRenderDebugReadAloudResponseStatus).toBe('200');
    expect(playSpy).toHaveBeenCalledTimes(1);

    playSpy.mockRestore();
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
    cleanupBootstrap();
  });

  it('marks backend read aloud active before the synthesize body finishes', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/');
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugReadAloudUrl =
      'https://chatgpt.com/backend-api/synthesize?message_id=assistant5&conversation_id=conversation-real-id&voice=cove&format=aac';

    let closeSynthesizeStream: (() => void) | null = null;
    const synthesizeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        closeSynthesizeStream = () => controller.close();
      },
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (requestUrl.includes('/api/auth/session')) {
        return new Response(JSON.stringify({ accessToken: 'token', expires: '2099-01-01T00:00:00.000Z' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (requestUrl.includes('/backend-api/synthesize')) {
        return new Response(synthesizeStream, {
          status: 200,
          headers: { 'content-type': 'audio/aac' },
        });
      }
      throw new Error(`Unexpected fetch request: ${requestUrl}`);
    }) as typeof window.fetch;
    const originalFetch = window.fetch;
    window.fetch = fetchSpy;

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const states: Array<{ entryActionSpeakingEntryKey: string | null }> = [];
    (controller as unknown as {
      statusBar: {
        update(status: unknown, target: HTMLElement | null, state: { entryActionSpeakingEntryKey: string | null }): 'hidden';
        destroy(): void;
      };
    }).statusBar = {
      update: (_status, _target, state) => {
        states.push({ entryActionSpeakingEntryKey: state.entryActionSpeakingEntryKey });
        return 'hidden';
      },
      destroy: () => {},
    };

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'assistant5',
      liveTurnId: null,
      messageId: 'assistant5',
      groupId: null,
      parts: ['assistant-5'],
      text: 'assistant-5',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:read-aloud');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    try {
      const playback = (controller as unknown as {
        startReadAloudPlayback(
          groupId: string | null,
          entry: ManagedHistoryEntry,
          entryKey: string,
        ): Promise<void>;
      }).startReadAloudPlayback(null, entry, 'history-entry');
      await flush();

      expect(states.some((state) => state.entryActionSpeakingEntryKey === 'history-entry')).toBe(true);
      expect(document.body.dataset.turboRenderReadAloudMode).toBe('backend');
      expect(playSpy).not.toHaveBeenCalled();

      expect(closeSynthesizeStream).not.toBeNull();
      closeSynthesizeStream!();
      await playback;
      expect(playSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.fetch = originalFetch;
      playSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
      history.replaceState({}, '', originalPath);
    }
  });

  it('streams backend read aloud through MediaSource before the response closes', async () => {
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    history.replaceState({}, '', '/');
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugReadAloudUrl =
      'https://chatgpt.com/backend-api/synthesize?message_id=assistant5&conversation_id=conversation-real-id&voice=cove&format=aac';

    const originalMediaSource = (window as Window & { MediaSource?: typeof MediaSource }).MediaSource;
    const originalFetch = window.fetch;
    const appendedChunks: Uint8Array[] = [];

      class FakeMediaSource extends EventTarget {
      static isTypeSupported(type: string): boolean {
        return type === 'audio/aac';
      }

      readyState: ReadyState = 'closed';

      constructor() {
        super();
        window.setTimeout(() => {
          this.readyState = 'open';
          this.dispatchEvent(new Event('sourceopen'));
        }, 0);
      }

    }
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: FakeMediaSource,
    });

    let closeSynthesizeStream: (() => void) | null = null;
    const synthesizeStream = new ReadableStream<Uint8Array>({
      start(controller) {
        closeSynthesizeStream = () => controller.close();
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (requestUrl.includes('/api/auth/session')) {
        return new Response(JSON.stringify({ accessToken: 'token', expires: '2099-01-01T00:00:00.000Z' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (requestUrl.includes('/backend-api/synthesize')) {
        return new Response(synthesizeStream, {
          status: 200,
          headers: { 'content-type': 'audio/aac' },
        });
      }
      throw new Error(`Unexpected fetch request: ${requestUrl}`);
    }) as typeof window.fetch;
    window.fetch = fetchSpy;

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const entry = {
      id: 'history-entry',
      source: 'initial-trim' as const,
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: 'assistant5',
      liveTurnId: null,
      messageId: 'assistant5',
      groupId: null,
      parts: ['assistant-5'],
      text: 'assistant-5',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:read-aloud-stream');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    try {
      let resolved = false;
      const playback = (controller as unknown as {
        startReadAloudPlayback(
          groupId: string | null,
          entry: ManagedHistoryEntry,
          entryKey: string,
        ): Promise<void>;
      }).startReadAloudPlayback(null, entry, 'history-entry').finally(() => {
        resolved = true;
      });
      await flush();

      expect(appendedChunks).toHaveLength(1);
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(document.body.dataset.turboRenderReadAloudStreaming).toBe('1');
      expect(resolved).toBe(false);

      expect(closeSynthesizeStream).not.toBeNull();
      closeSynthesizeStream!();
      await playback;
    } finally {
      window.fetch = originalFetch;
      Object.defineProperty(window, 'MediaSource', {
        configurable: true,
        value: originalMediaSource,
      });
      playSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
      history.replaceState({}, '', originalPath);
    }
  });

  it('backs off repeated failed read aloud conversation snapshot prewarms', async () => {
    const conversationId = 'snapshot-negative-cache';
    document.body.innerHTML = `
      <main>
        <section data-turbo-render-ui-root="true"></section>
      </main>
    `;
    document.body.dataset.turboRenderDebugReadAloudBackend = '1';
    document.body.dataset.turboRenderDebugConversationId = conversationId;

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
      },
      paused: false,
      mountUi: false,
    });
    activeControllers.push(controller);

    const originalFetch = window.fetch;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (requestUrl.includes('/api/auth/session')) {
        return new Response(
          JSON.stringify({
            accessToken: 'test-read-aloud-access-token',
            expires: '2099-01-01T00:00:00.000Z',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return new Response('missing', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }) as typeof window.fetch;
    window.fetch = fetchSpy;

    try {
      await (controller as unknown as {
        ensureConversationSnapshotForReadAloud(conversationId: string | null): Promise<void>;
      }).ensureConversationSnapshotForReadAloud(conversationId);
      await (controller as unknown as {
        ensureConversationSnapshotForReadAloud(conversationId: string | null): Promise<void>;
      }).ensureConversationSnapshotForReadAloud(conversationId);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('keeps inline history visible when transcript parking is unsupported', async () => {
    const fixture = mountGroupedTranscriptFixture(document, {
      turnCount: 12,
      daySizes: [6, 6],
      streaming: false,
    });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(20, 10));
    controller.start();
    await flush();

    const status = controller.getStatus();
    expect(status.supported).toBe(false);
    expect(status.archiveOnly).toBe(true);
    expect(status.archivedTurnsTotal).toBe(10);

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot).not.toBeNull();
    expect(inlineRoot?.nextElementSibling).toBe(fixture.dayGroups[0]);
    expect(document.querySelectorAll('[data-turbo-render-group-id]').length).toBe(0);
  });

  it('reports share route runtime ids while keeping inline batch UI on share pages', async () => {
    history.replaceState({}, '', '/share/share-123');
    mountTranscriptFixture(document, { turnCount: 18, streaming: false });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(24, 8);
    for (const turn of session.turns) {
      turn.createTime = 1_712_740_680;
    }
    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const status = controller.getStatus();
    expect(status.chatId).toBe('share:share-123');
    expect(status.routeKind).toBe('share');
    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot).not.toBeNull();
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.historyEntryActions}`)).toBeNull();
  });

  it('keeps share route actions available when the debug override is enabled', async () => {
    history.replaceState({}, '', '/share/share-123?turbo-render-debug-actions=1');
    mountTranscriptFixture(document, { turnCount: 18, streaming: false });
    document.documentElement.lang = 'zh-CN';

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'auto',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    const session = createInitialTrimSession(24, 8);
    for (const turn of session.turns) {
      turn.createTime = 1_712_740_680;
    }
    controller.setInitialTrimSession(session);
    controller.start();
    await flush();

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot).not.toBeNull();
    await openNewestArchivePage();
    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const assistantActions = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`);
    expect(assistantActions).not.toBeNull();
    const shareButton = assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="share-turn-action-button"]');
    expect(shareButton?.disabled).toBe(true);
    expect(shareButton?.title).toContain('官方分享按钮');
    assistantActions?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')?.click();
    await flush();
    const refreshedAssistantActions = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`,
    );
    const menu = refreshedAssistantActions?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}`);
    expect(menu).not.toBeNull();
    expect(menu?.className).toContain('popover');
    expect(menu?.querySelector<HTMLElement>('[data-turbo-render-menu-header="true"]')?.textContent?.trim()).not.toBe('');
    expect(menu?.textContent).toContain('新聊天中的分支');
    expect(menu?.textContent).toContain('朗读');

    refreshedAssistantActions?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')?.click();
    await flush();
    expect(
      inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`),
    ).toBeNull();

    inlineRoot
      ?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`)
      ?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')
      ?.click();
    await flush();
    expect(
      inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`),
    ).not.toBeNull();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flush();
    expect(
      inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`),
    ).toBeNull();

    inlineRoot
      ?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActions}[data-lane="assistant"]`)
      ?.querySelector<HTMLButtonElement>('button[data-testid="more-turn-action-button"]')
      ?.click();
    await flush();
    expect(
      inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`),
    ).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(
      inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryActionMenu}[data-turbo-render-entry-menu="true"]`),
    ).toBeNull();
  });

  it('does not clear applied inline history when a later non-applied session arrives', async () => {
    mountTranscriptFixture(document, { turnCount: 10, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
        minFinalizedBlocks: 10,
        minDescendants: 100,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(14, 4));
    controller.start();
    await flush();

    const archivedBefore = controller.getStatus().archivedTurnsTotal;
    expect(archivedBefore).toBeGreaterThan(0);

    controller.setInitialTrimSession(null);
    await flush();

    expect(controller.getStatus().archivedTurnsTotal).toBe(archivedBefore);
    expect(document.querySelector('[data-turbo-render-inline-history-root="true"]')).not.toBeNull();
  });

  it('hides plugin UI while paused and restores TurboRender when resumed', async () => {
    mountTranscriptFixture(document, { turnCount: 18, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(24, 8));
    controller.start();
    await flush();

    expect(document.querySelector('[data-turbo-render-inline-history-root="true"]')).not.toBeNull();
    expect(controller.getStatus().parkedGroups).toBeGreaterThan(0);

    controller.setPaused(true);
    await flush();

    expect(controller.getStatus().paused).toBe(true);
    expect(controller.getStatus().parkedGroups).toBe(0);
    expect(document.querySelector('[data-turbo-render-inline-history-root="true"]')).toBeNull();

    controller.setPaused(false);
    await flush();

    expect(controller.getStatus().paused).toBe(false);
    expect(controller.getStatus().active).toBe(true);
    expect(controller.getStatus().parkedGroups).toBeGreaterThan(0);
    expect(document.querySelector('[data-turbo-render-inline-history-root="true"]')).not.toBeNull();
  });

  it('keeps archive-only refreshes bounded when expanding a batch', async () => {
    mountGroupedTranscriptFixture(document, {
      turnCount: 12,
      daySizes: [6, 6],
      streaming: false,
    });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(20, 10));
    controller.start();
    await flush();

    await openNewestArchivePage();
    const refreshBefore = controller.getStatus().refreshCount;
    const toggle = document.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`);
    expect(toggle).not.toBeNull();
    toggle?.click();
    await flush();
    await flush();

    expect(controller.getStatus().refreshCount).toBeLessThanOrEqual(refreshBefore + 4);
    expect(document.querySelector('[data-turbo-render-ui-root="true"]')).not.toBeNull();
  });

  it('defers refreshes while the transcript is actively scrolling', async () => {
    const fixture = mountGroupedTranscriptFixture(document, {
      turnCount: 40,
      daySizes: [20, 20],
      streaming: false,
    });

    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.setInitialTrimSession(createInitialTrimSession(40, 10));
    controller.start();
    await flush();

    const refreshBefore = controller.getStatus().refreshCount;
    for (let index = 0; index < 10; index += 1) {
      fixture.scroller.scrollTop = index * 120;
      fixture.scroller.dispatchEvent(new Event('scroll'));
    }

    await new Promise((resolve) => setTimeout(resolve, 180));
    await flush();

    expect(controller.getStatus().refreshCount).toBeLessThanOrEqual(refreshBefore + 2);
  });

  it('skips refresh scheduling when setSettings receives an equivalent snapshot', async () => {
    mountTranscriptFixture(document, { turnCount: 18, streaming: false });
    const initialSettings = {
      ...DEFAULT_SETTINGS,
      language: 'en' as const,
      minFinalizedBlocks: 10,
      minDescendants: 100,
      keepRecentPairs: 5,
      liveHotPairs: 5,
      batchPairCount: 5,
    };

    const controller = new TurboRenderController({
      settings: initialSettings,
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.start();
    await flush();
    await flush();

    const refreshBefore = controller.getStatus().refreshCount;
    controller.setSettings({ ...initialSettings });
    await new Promise((resolve) => setTimeout(resolve, 64));
    await flush();

    expect(controller.getStatus().refreshCount).toBe(refreshBefore);
  });

  it('skips refresh scheduling when setPaused receives an unchanged value', async () => {
    mountTranscriptFixture(document, { turnCount: 18, streaming: false });
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentPairs: 5,
        liveHotPairs: 5,
        batchPairCount: 5,
      },
      paused: false,
      mountUi: true,
    });
    activeControllers.push(controller);

    controller.start();
    await flush();
    await flush();

    const refreshBefore = controller.getStatus().refreshCount;
    controller.setPaused(false);
    await new Promise((resolve) => setTimeout(resolve, 64));
    await flush();

    expect(controller.getStatus().refreshCount).toBe(refreshBefore);
  });
});
