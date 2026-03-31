import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import type { TabStatusResponse } from '../../lib/shared/types';

function createStatus(paused: boolean): TabStatusResponse {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      language: 'en',
    },
    paused,
    runtime: {
      supported: true,
      chatId: 'share:test-share',
      routeKind: 'share',
      reason: null,
      archiveOnly: false,
      active: !paused,
      paused,
      mode: 'performance',
      softFallback: false,
      initialTrimApplied: false,
      initialTrimmedTurns: 0,
      totalMappingNodes: 128,
      activeBranchLength: 40,
      totalTurns: 18,
      totalPairs: 9,
      hotPairsVisible: 5,
      finalizedTurns: 18,
      handledTurnsTotal: 6,
      historyPanelOpen: false,
      archivedTurnsTotal: 6,
      expandedArchiveGroups: 0,
      historyAnchorMode: 'hidden',
      slotBatchCount: 2,
      collapsedBatchCount: 2,
      expandedBatchCount: 0,
      parkedTurns: 6,
      parkedGroups: 2,
      liveDescendantCount: 128,
      visibleRange: { start: 4, end: 17 },
      observedRootKind: 'live-turn-container',
      refreshCount: 3,
      spikeCount: 1,
      lastError: null,
      contentScriptInstanceId: 'instance-test',
      contentScriptStartedAt: 1_700_000_000_000,
      buildSignature: 'test-build',
    },
    targetTabId: 77,
    activeTabId: 77,
    usingWindowFallback: false,
    activeTabSupportedHost: true,
    activeTabRouteKind: 'share',
  };
}

describe('popup entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('renders a single chat toggle button and flips between restore and TurboRender', async () => {
    let currentStatus = createStatus(false);
    const sendMessage = vi.fn(async (message: { type: string; paused?: boolean }) => {
      if (message.type === 'GET_TAB_STATUS') {
        return currentStatus;
      }

      if (message.type === 'PAUSE_CHAT') {
        const nextPaused = message.paused ?? false;
        currentStatus = {
          ...currentStatus,
          paused: nextPaused,
          runtime: currentStatus.runtime == null
            ? null
            : {
                ...currentStatus.runtime,
                paused: nextPaused,
                active: !nextPaused,
              },
        };
        return currentStatus;
      }

      return currentStatus;
    });
    const getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    vi.doMock('wxt/browser', () => ({
      browser: {
        runtime: {
          getURL,
          sendMessage,
          openOptionsPage: vi.fn(),
        },
      },
    }));

    await import('../../entrypoints/popup/main');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const toggleButton = document.querySelector<HTMLButtonElement>('#toggle-chat-mode');
    expect(toggleButton).not.toBeNull();
    expect(toggleButton?.textContent).toContain('Restore this chat');
    expect(document.querySelector('#restore-nearby')).toBeNull();
    expect(document.querySelector('#restore-all')).toBeNull();

    toggleButton?.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PAUSE_CHAT',
        chatId: 'share:test-share',
        paused: true,
        tabId: 77,
      }),
    );
    expect(document.querySelector<HTMLButtonElement>('#toggle-chat-mode')?.textContent).toContain(
      'TurboRender this chat',
    );

    document.querySelector<HTMLButtonElement>('#toggle-chat-mode')?.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PAUSE_CHAT',
        chatId: 'share:test-share',
        paused: false,
        tabId: 77,
      }),
    );
    expect(document.querySelector<HTMLButtonElement>('#toggle-chat-mode')?.textContent).toContain(
      'Restore this chat',
    );
  });
});
