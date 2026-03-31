import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, UI_CLASS_NAMES } from '../../lib/shared/constants';
import { getChatIdFromPathname } from '../../lib/shared/chat-id';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import type { InitialTrimSession } from '../../lib/shared/types';
import { mountGroupedTranscriptFixture, mountTranscriptFixture } from '../../lib/testing/transcript-fixture';

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

function createSessionTurn(
  index: number,
  override: Partial<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    parts: string[];
    renderKind: 'markdown-text' | 'host-snapshot' | 'structured-message';
    contentType: string | null;
    snapshotHtml: string | null;
    structuredDetails: string | null;
    hiddenFromConversation: boolean;
  }> = {},
) {
  return {
    id: `session-turn-${index}`,
    role: override.role ?? (index % 2 === 0 ? 'user' as const : 'assistant' as const),
    parts: override.parts ?? [`Turn ${index + 1} archived content.`],
    renderKind: override.renderKind ?? 'markdown-text',
    contentType: override.contentType ?? 'text',
    snapshotHtml: override.snapshotHtml ?? null,
    structuredDetails: override.structuredDetails ?? null,
    hiddenFromConversation: override.hiddenFromConversation ?? false,
    createTime: index,
  };
}

function createInitialTrimSession(totalTurns: number, hotStartIndex: number): InitialTrimSession {
  const turns = Array.from({ length: totalTurns }, (_, index) => createSessionTurn(index));
  const totalPairs = Math.ceil(totalTurns / 2);
  const hotTurnCount = totalTurns - hotStartIndex;
  const hotPairCount = Math.ceil(hotTurnCount / 2);

  return {
    chatId: getChatIdFromPathname(document.location.pathname),
    routeKind: document.location.pathname.includes('/share/') ? 'share' : 'chat',
    routeId: document.location.pathname.split('/').filter(Boolean).at(-1) ?? null,
    conversationId: 'conversation-inline-batches',
    applied: true,
    reason: 'trimmed',
    mode: 'performance',
    totalMappingNodes: totalTurns + 12,
    totalVisibleTurns: totalTurns,
    activeBranchLength: totalTurns,
    hotVisibleTurns: hotTurnCount,
    coldVisibleTurns: hotStartIndex,
    initialHotPairs: hotPairCount,
    hotPairCount,
    archivedPairCount: totalPairs - hotPairCount,
    initialHotTurns: hotPairCount * 2,
    hotStartIndex,
    hotTurnCount,
    archivedTurnCount: hotStartIndex,
    activeNodeId: `session-turn-${totalTurns - 1}`,
    turns,
    coldTurns: turns.slice(0, hotStartIndex),
    capturedAt: Date.now(),
  };
}

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

    const status = controller.getStatus();
    expect(status.archivedTurnsTotal).toBe(14);
    expect(status.collapsedBatchCount).toBeGreaterThan(0);

    const inlineRoot = document.querySelector<HTMLElement>('[data-turbo-render-inline-history-root="true"]');
    expect(inlineRoot).not.toBeNull();
    expect(inlineRoot?.nextElementSibling).toBe(fixture.transcript);
    expect(document.querySelector(`.${UI_CLASS_NAMES.historyTrigger}`)).toBeNull();
    expect(document.querySelector(`.${UI_CLASS_NAMES.archiveRoot}`)).toBeNull();

    const initialBatchRail = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchRail}`);
    expect(initialBatchRail).not.toBeNull();

    const turboRenderStyle = [...document.head.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .find((text) => text.includes(`.${UI_CLASS_NAMES.inlineBatchRail}`));
    expect(turboRenderStyle).toContain('position: sticky');

    const initialBatchButton = inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`);
    expect(initialBatchButton?.textContent).toBe('Expand');
    const batchMetaLabels = [...(inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchMeta} strong`) ?? [])]
      .map((element) => element.textContent?.trim() ?? '');
    expect(batchMetaLabels[0]).toBe('Pair #1-5');
    expect(batchMetaLabels[1]).toBe('Pair #6-10 · 2/5');
    expect(inlineRoot?.querySelector(`.${UI_CLASS_NAMES.inlineBatchPreview}`)).not.toBeNull();
    fixture.scroller.scrollTop = 480;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (
        this.matches(`.${UI_CLASS_NAMES.inlineBatchCard}[data-group-id="archive-slot-0"]`)
      ) {
        const expanded = this.querySelector(`.${UI_CLASS_NAMES.inlineBatchEntries}`) != null;
        return {
          top: expanded ? 260 : 200,
          bottom: expanded ? 380 : 320,
          left: 0,
          right: 900,
          width: 900,
          height: 120,
          x: 0,
          y: expanded ? 260 : 200,
          toJSON: () => '',
        } as DOMRect;
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

    expect(
      inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.textContent,
    ).toBe('Collapse');
    const expandedFirstCard = inlineRoot?.querySelector<HTMLElement>(
      `.${UI_CLASS_NAMES.inlineBatchCard}[data-group-id="archive-slot-0"]`,
    );
    expect(expandedFirstCard?.querySelector(`.${UI_CLASS_NAMES.inlineBatchPreview}`)).toBeNull();
    expect(fixture.scroller.scrollTop).toBe(540);
    expect(controller.getStatus().expandedBatchCount).toBeGreaterThan(0);
    expect(fixture.transcript.querySelectorAll('[data-testid^="conversation-turn-"]')).toHaveLength(10);
    expect(document.querySelectorAll('[data-turbo-render-group-id]')).toHaveLength(0);
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
      parts: ['Paragraph with **打开终端** and ``bash`` and `pnpm test`.\n\n- item one\n- item two\n\n> quoted\n\n```ts\nconst answer = 42;\n```'],
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
    expect(inlineRoot).not.toBeNull();

    inlineRoot?.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.inlineBatchAction}`)?.click();
    await flush();

    const entryBodies = inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}`) ?? [];
    expect(entryBodies.length).toBeGreaterThan(0);
    const markdownBodies = [
      ...(inlineRoot?.querySelectorAll<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"]`) ?? []),
    ];
    const formattedMarkdownBody = markdownBodies.find((body) => body.textContent?.includes('打开终端'));
    expect(formattedMarkdownBody?.querySelector('strong')?.textContent).toBe('打开终端');
    expect(formattedMarkdownBody?.textContent).not.toContain('**打开终端**');
    expect(formattedMarkdownBody?.textContent).not.toContain('``bash``');
    expect(formattedMarkdownBody?.querySelector('code[data-language="ts"]')?.textContent).toContain('const answer = 42;');

    const structuredBody = inlineRoot?.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"]`);
    expect(structuredBody?.textContent).toContain('netstat -lntp');
    expect(inlineRoot?.textContent).not.toContain('is_visually_hidden_from_conversation');
    expect(inlineRoot?.textContent).not.toContain('Locate message');
    expect(inlineRoot?.textContent).not.toContain('Show details');
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

    controller.setInitialTrimSession(createInitialTrimSession(24, 8));
    controller.start();
    await flush();

    const status = controller.getStatus();
    expect(status.chatId).toBe('share:share-123');
    expect(status.routeKind).toBe('share');
    expect(document.querySelector('[data-turbo-render-inline-history-root="true"]')).not.toBeNull();
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
});
