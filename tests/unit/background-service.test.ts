import { describe, expect, it, vi } from 'vitest';

import { createBackgroundService } from '../../lib/background/service';
import { DEFAULT_SETTINGS } from '../../lib/shared/constants';

describe('background service', () => {
  it('builds tab status from the active tab and content runtime', async () => {
    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({ 'chat:abc': true }),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 5,
        url: 'https://chatgpt.com/c/abc',
      }),
      getTabStatus: vi.fn().mockResolvedValue({
        supported: true,
        chatId: 'chat:abc',
        reason: null,
        active: true,
        paused: false,
        mode: 'performance',
        softFallback: false,
        initialTrimApplied: true,
        initialTrimmedTurns: 80,
        totalMappingNodes: 200,
        activeBranchLength: 110,
        totalTurns: 10,
        finalizedTurns: 9,
        handledTurnsTotal: 84,
        historyPanelOpen: false,
        parkedTurns: 4,
        parkedGroups: 1,
        liveDescendantCount: 120,
        visibleRange: { start: 6, end: 9 },
        spikeCount: 2,
        lastError: null,
      }),
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      paused: true,
      runtime: {
        chatId: 'chat:abc',
        paused: true,
      },
    });
  });

  it('forwards restore messages to the active tab', async () => {
    const forwardToTab = vi.fn().mockResolvedValue({
      supported: true,
      chatId: 'chat:abc',
      reason: null,
      active: true,
      paused: false,
      mode: 'performance',
      softFallback: false,
      initialTrimApplied: false,
      initialTrimmedTurns: 0,
      totalMappingNodes: 40,
      activeBranchLength: 10,
      totalTurns: 10,
      finalizedTurns: 10,
      handledTurnsTotal: 0,
      historyPanelOpen: false,
      parkedTurns: 0,
      parkedGroups: 0,
      liveDescendantCount: 40,
      visibleRange: { start: 2, end: 9 },
      spikeCount: 0,
      lastError: null,
    });

    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 8,
        url: 'https://chatgpt.com/c/abc',
      }),
      getTabStatus: vi.fn().mockResolvedValue(null),
      forwardToTab,
    });

    await service.handle({ type: 'RESTORE_ALL' });
    expect(forwardToTab).toHaveBeenCalledWith(8, { type: 'RESTORE_ALL' });
  });
});
