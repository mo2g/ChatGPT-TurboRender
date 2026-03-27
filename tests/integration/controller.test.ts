import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import { mountTranscriptFixture } from '../../lib/testing/transcript-fixture';

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
  await new Promise((resolve) => setTimeout(resolve, 40));
}

describe('TurboRenderController', () => {
  beforeEach(() => {
    mountTranscriptFixture(document, { turnCount: 40, streaming: false });
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

  it('parks cold turns and restores them on demand', async () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentTurns: 6,
        viewportBufferTurns: 1,
        groupSize: 5,
      },
      paused: false,
      mountUi: false,
    });

    controller.start();
    await flush();

    expect(controller.getStatus().parkedGroups).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-turbo-render-group-id]').length).toBeGreaterThan(0);

    controller.restoreAll();
    await flush();

    expect(controller.getStatus().parkedGroups).toBe(0);
    expect(document.querySelectorAll('[data-turbo-render-group-id]').length).toBe(0);
    controller.stop();
  });

  it('uses soft-fold mode when configured', async () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentTurns: 6,
        viewportBufferTurns: 1,
        groupSize: 5,
        softFallback: true,
      },
      paused: false,
      mountUi: false,
    });

    controller.start();
    await flush();

    expect(controller.getStatus().softFallback).toBe(true);
    expect(document.querySelectorAll('.turbo-render-soft-folded').length).toBeGreaterThan(0);
    controller.stop();
  });

  it('mounts a top history shelf and lets users inspect managed history', async () => {
    const controller = new TurboRenderController({
      settings: {
        ...DEFAULT_SETTINGS,
        language: 'en',
        minFinalizedBlocks: 10,
        minDescendants: 100,
        keepRecentTurns: 6,
        liveHotTurns: 60,
        viewportBufferTurns: 1,
        groupSize: 5,
      },
      paused: false,
      mountUi: true,
    });

    controller.start();
    controller.setInitialTrimSession({
      chatId: 'chat:home',
      conversationId: 'abc',
      applied: true,
      reason: 'trimmed',
      mode: 'performance',
      totalMappingNodes: 80,
      totalVisibleTurns: 46,
      activeBranchLength: 46,
      hotVisibleTurns: 40,
      coldVisibleTurns: 6,
      initialHotTurns: 6,
      activeNodeId: 'assistant-40',
      coldTurns: Array.from({ length: 6 }, (_, index) => ({
        id: `cold-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [`Cold turn ${index}`],
        createTime: index,
      })),
      capturedAt: Date.now(),
    });
    await flush();

    expect(controller.getStatus()).toMatchObject({
      initialTrimApplied: true,
      initialTrimmedTurns: 6,
      totalTurns: 46,
      handledTurnsTotal: 6,
      historyInspectionActive: false,
      parkedTurns: 6,
    });

    const shelf = document.querySelector<HTMLElement>('[data-turbo-render-history-shelf="true"]');
    expect(shelf).not.toBeNull();
    expect(shelf?.parentElement?.getAttribute('data-testid')).toBe('conversation-transcript');
    expect(document.querySelector('[data-turbo-render-initial-cold-turns="true"]')).toBeNull();

    shelf?.querySelector<HTMLButtonElement>('button[data-action="inspect-history"]')?.click();
    await flush();

    expect(controller.getStatus()).toMatchObject({
      historyInspectionActive: true,
      handledTurnsTotal: 6,
      parkedTurns: 0,
    });
    expect(document.querySelector('[data-turbo-render-initial-cold-turns="true"]')).not.toBeNull();

    shelf?.querySelector<HTMLButtonElement>('button[data-action="inspect-history"]')?.click();
    await flush();

    expect(controller.getStatus().historyInspectionActive).toBe(false);
    controller.stop();
  });
});
