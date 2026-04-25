import { describe, expect, it, vi } from 'vitest';

import { createBackgroundService } from '../../lib/background/service';
import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import type { TabRuntimeStatus } from '../../lib/shared/types';

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
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 5,
          url: 'https://chatgpt.com/c/abc',
          active: true,
          index: 0,
        },
      ]),
      getTabStatus: vi.fn().mockResolvedValue({
        supported: true,
        chatId: 'chat:abc',
        routeKind: 'chat',
        reason: null,
        archiveOnly: false,
        active: true,
        paused: false,
        mode: 'performance',
        softFallback: false,
        initialTrimApplied: true,
        initialTrimmedTurns: 80,
        totalMappingNodes: 200,
        activeBranchLength: 110,
        totalTurns: 10,
        totalPairs: 5,
        hotPairsVisible: 5,
        finalizedTurns: 9,
        handledTurnsTotal: 84,
        historyPanelOpen: false,
        archivePageCount: 0,
        currentArchivePageIndex: null,
        archivedTurnsTotal: 68,
        expandedArchiveGroups: 1,
        historyAnchorMode: 'host-share',
        slotBatchCount: 3,
        collapsedBatchCount: 2,
        expandedBatchCount: 1,
        parkedTurns: 4,
        parkedGroups: 1,
        liveDescendantCount: 120,
        visibleRange: { start: 6, end: 9 },
        observedRootKind: 'live-turn-container',
        refreshCount: 2,
        spikeCount: 2,
        lastError: null,
        contentScriptInstanceId: 'instance-abc12345',
        contentScriptStartedAt: 1_700_000_000_000,
        buildSignature: 'test-build',
      }),
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      paused: true,
      targetTabId: 5,
      activeTabId: 5,
      usingWindowFallback: false,
      activeTabRouteKind: 'chat',
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
      routeKind: 'chat',
      reason: null,
      archiveOnly: false,
      active: true,
      paused: false,
      mode: 'performance',
      softFallback: false,
      initialTrimApplied: false,
      initialTrimmedTurns: 0,
      totalMappingNodes: 40,
      activeBranchLength: 10,
      totalTurns: 10,
      totalPairs: 5,
      hotPairsVisible: 5,
      finalizedTurns: 10,
      handledTurnsTotal: 0,
      historyPanelOpen: false,
      archivePageCount: 0,
      currentArchivePageIndex: null,
      archivedTurnsTotal: 0,
      expandedArchiveGroups: 0,
      historyAnchorMode: 'hidden',
      slotBatchCount: 0,
      collapsedBatchCount: 0,
      expandedBatchCount: 0,
      parkedTurns: 0,
      parkedGroups: 0,
      liveDescendantCount: 40,
      visibleRange: { start: 2, end: 9 },
      observedRootKind: 'live-turn-container',
      refreshCount: 1,
      spikeCount: 0,
      lastError: null,
      contentScriptInstanceId: 'instance-restore',
      contentScriptStartedAt: 1_700_000_000_100,
      buildSignature: 'test-build',
    });

    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 8,
        url: 'https://chatgpt.com/c/abc',
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 8,
          url: 'https://chatgpt.com/c/abc',
          active: true,
          index: 0,
        },
      ]),
      getTabStatus: vi.fn().mockResolvedValue(null),
      forwardToTab,
    });

    await service.handle({ type: 'RESTORE_ALL' });
    expect(forwardToTab).toHaveBeenCalledWith(8, { type: 'RESTORE_ALL' });
  });

  it('does not fall back from non-ChatGPT pages even when a supported ChatGPT tab exists in the same window', async () => {
    const getTabStatus = vi.fn<(tabId: number) => Promise<TabRuntimeStatus | null>>(async (tabId) => {
      if (tabId === 1) {
        return null;
      }

      if (tabId === 2) {
        return {
          supported: false,
          chatId: 'chat:unknown',
          routeKind: 'unknown',
          reason: 'split-parents',
          archiveOnly: false,
          active: false,
          paused: false,
          mode: 'performance',
          softFallback: false,
          initialTrimApplied: false,
          initialTrimmedTurns: 0,
          totalMappingNodes: 0,
          activeBranchLength: 0,
          totalTurns: 0,
          totalPairs: 0,
          hotPairsVisible: 0,
          finalizedTurns: 0,
          handledTurnsTotal: 0,
          historyPanelOpen: false,
          archivePageCount: 0,
          currentArchivePageIndex: null,
          archivedTurnsTotal: 0,
          expandedArchiveGroups: 0,
          historyAnchorMode: 'hidden',
          slotBatchCount: 0,
          collapsedBatchCount: 0,
          expandedBatchCount: 0,
          parkedTurns: 0,
          parkedGroups: 0,
          liveDescendantCount: 0,
          visibleRange: null,
          observedRootKind: 'archive-only-root',
          refreshCount: 0,
          spikeCount: 0,
          lastError: null,
          contentScriptInstanceId: 'instance-unsupported',
          contentScriptStartedAt: 1_700_000_000_050,
          buildSignature: 'test-build',
        };
      }

      return {
        supported: true,
        chatId: 'chat:good',
        routeKind: 'chat',
        reason: null,
        archiveOnly: false,
        active: true,
        paused: false,
        mode: 'performance',
        softFallback: false,
        initialTrimApplied: false,
        initialTrimmedTurns: 0,
        totalMappingNodes: 120,
        activeBranchLength: 50,
        totalTurns: 8,
        totalPairs: 4,
        hotPairsVisible: 4,
        finalizedTurns: 8,
        handledTurnsTotal: 0,
        historyPanelOpen: false,
        archivePageCount: 0,
        currentArchivePageIndex: null,
        archivedTurnsTotal: 0,
        expandedArchiveGroups: 0,
        historyAnchorMode: 'hidden',
        slotBatchCount: 0,
        collapsedBatchCount: 0,
        expandedBatchCount: 0,
        parkedTurns: 0,
        parkedGroups: 0,
        liveDescendantCount: 400,
        visibleRange: { start: 0, end: 7 },
        observedRootKind: 'live-turn-container',
        refreshCount: 2,
        spikeCount: 1,
        lastError: null,
        contentScriptInstanceId: 'instance-supported',
        contentScriptStartedAt: 1_700_000_000_100,
        buildSignature: 'test-build',
      };
    });

    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 1,
        url: 'https://example.com/',
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 1,
          url: 'https://example.com/',
          active: true,
          index: 0,
        },
        {
          id: 2,
          url: 'https://chatgpt.com/',
          active: false,
          index: 1,
        },
        {
          id: 3,
          url: 'https://chat.openai.com/c/good',
          active: false,
          index: 2,
        },
      ]),
      getTabStatus,
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      targetTabId: 1,
      activeTabId: 1,
      usingWindowFallback: false,
      activeTabSupportedHost: false,
      activeTabRouteKind: 'home',
      runtime: null,
    });
    expect(getTabStatus).toHaveBeenCalledTimes(1);
    expect(getTabStatus).toHaveBeenCalledWith(1);
    expect(getTabStatus).not.toHaveBeenCalledWith(2);
    expect(getTabStatus).not.toHaveBeenCalledWith(3);
  });

  it.each([
    ['home', 'https://chatgpt.com/', 'home' as const],
    ['unknown', 'https://chatgpt.com/gpts', 'unknown' as const],
  ])('does not fall back from ChatGPT %s routes', async (_label, url, routeKind) => {
    const getTabStatus = vi.fn<(tabId: number) => Promise<TabRuntimeStatus | null>>(async (tabId) => {
      if (tabId === 41) {
        return null;
      }

      if (tabId === 42) {
        return {
          supported: true,
          chatId: 'chat:fallback-candidate',
          routeKind: 'chat',
          reason: null,
          archiveOnly: false,
          active: true,
          paused: false,
          mode: 'performance',
          softFallback: false,
          initialTrimApplied: false,
          initialTrimmedTurns: 0,
          totalMappingNodes: 12,
          activeBranchLength: 8,
          totalTurns: 8,
          totalPairs: 4,
          hotPairsVisible: 4,
          finalizedTurns: 8,
          handledTurnsTotal: 0,
          historyPanelOpen: false,
          archivePageCount: 0,
          currentArchivePageIndex: null,
          archivedTurnsTotal: 0,
          expandedArchiveGroups: 0,
          historyAnchorMode: 'hidden',
          slotBatchCount: 0,
          collapsedBatchCount: 0,
          expandedBatchCount: 0,
          parkedTurns: 0,
          parkedGroups: 0,
          liveDescendantCount: 12,
          visibleRange: { start: 0, end: 7 },
          observedRootKind: 'live-turn-container',
          refreshCount: 1,
          spikeCount: 0,
          lastError: null,
          contentScriptInstanceId: 'instance-fallback-candidate',
          contentScriptStartedAt: 1_700_000_200_000,
          buildSignature: 'test-build',
        };
      }

      return null;
    });

    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 41,
        url,
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 41,
          url,
          active: true,
          index: 0,
        },
        {
          id: 42,
          url: 'https://chatgpt.com/share/fallback-candidate',
          active: false,
          index: 1,
        },
      ]),
      getTabStatus,
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      targetTabId: 41,
      activeTabId: 41,
      usingWindowFallback: false,
      activeTabSupportedHost: true,
      activeTabRouteKind: routeKind,
      runtime: null,
    });
    expect(getTabStatus).toHaveBeenCalledTimes(1);
    expect(getTabStatus).toHaveBeenCalledWith(41);
    expect(getTabStatus).not.toHaveBeenCalledWith(42);
  });

  it('uses share runtime ids for paused-state lookup on share pages', async () => {
    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({ 'share:share-123': true }),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 11,
        url: 'https://chatgpt.com/share/share-123?locale=zh-CN',
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 11,
          url: 'https://chatgpt.com/share/share-123?locale=zh-CN',
          active: true,
          index: 0,
        },
      ]),
      getTabStatus: vi.fn().mockResolvedValue(null),
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      paused: true,
      activeTabRouteKind: 'share',
      runtime: null,
    });
  });

  it('marks active ChatGPT conversation route when runtime is temporarily unavailable', async () => {
    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 77,
        url: 'https://chatgpt.com/c/e77b97e5-a8b7-4380',
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 77,
          url: 'https://chatgpt.com/c/e77b97e5-a8b7-4380',
          active: true,
          index: 0,
        },
      ]),
      getTabStatus: vi.fn().mockResolvedValue(null),
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      runtime: null,
      activeTabSupportedHost: true,
      activeTabRouteKind: 'chat',
      usingWindowFallback: false,
    });
  });

  it('uses getActiveTab host and route hints when window tab list is unavailable', async () => {
    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 201,
        url: 'https://chatgpt.com/c/active-only',
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([]),
      getTabStatus: vi.fn().mockResolvedValue(null),
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      runtime: null,
      targetTabId: 201,
      activeTabId: 201,
      activeTabSupportedHost: true,
      activeTabRouteKind: 'chat',
      usingWindowFallback: false,
    });
  });

  it('falls back only from supported ChatGPT conversation pages when the active runtime is temporarily unavailable', async () => {
    const getTabStatus = vi.fn<(tabId: number) => Promise<TabRuntimeStatus | null>>(async (tabId) => {
      if (tabId === 301) {
        return null;
      }

      if (tabId === 302) {
        return {
          supported: true,
          chatId: 'chat:fallback-hit',
          routeKind: 'chat',
          reason: null,
          archiveOnly: false,
          active: true,
          paused: false,
          mode: 'performance',
          softFallback: false,
          initialTrimApplied: false,
          initialTrimmedTurns: 0,
          totalMappingNodes: 12,
          activeBranchLength: 8,
          totalTurns: 8,
          totalPairs: 4,
          hotPairsVisible: 4,
          finalizedTurns: 8,
          handledTurnsTotal: 0,
          historyPanelOpen: false,
          archivePageCount: 0,
          currentArchivePageIndex: null,
          archivedTurnsTotal: 0,
          expandedArchiveGroups: 0,
          historyAnchorMode: 'hidden',
          slotBatchCount: 0,
          collapsedBatchCount: 0,
          expandedBatchCount: 0,
          parkedTurns: 0,
          parkedGroups: 0,
          liveDescendantCount: 12,
          visibleRange: { start: 0, end: 7 },
          observedRootKind: 'live-turn-container',
          refreshCount: 1,
          spikeCount: 0,
          lastError: null,
          contentScriptInstanceId: 'instance-fallback-hit',
          contentScriptStartedAt: 1_700_000_100_000,
          buildSignature: 'test-build',
        };
      }

      return null;
    });

    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue({
        id: 301,
        url: 'https://chatgpt.com/c/fallback-active',
        active: true,
        index: 0,
      }),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([
        {
          id: 301,
          url: 'https://chatgpt.com/c/fallback-active',
          active: true,
          index: 0,
        },
        {
          id: 302,
          url: 'https://chatgpt.com/share/fallback-hit',
          active: false,
          index: 2,
        },
      ]),
      getTabStatus,
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      targetTabId: 302,
      activeTabId: 301,
      usingWindowFallback: true,
      activeTabSupportedHost: true,
      activeTabRouteKind: 'chat',
      runtime: {
        chatId: 'chat:fallback-hit',
        supported: true,
      },
    });
    expect(getTabStatus).toHaveBeenCalledTimes(2);
    expect(getTabStatus).toHaveBeenCalledWith(301);
    expect(getTabStatus).toHaveBeenCalledWith(302);
  });

  it('keeps no-supported-tab context when host and route are undetermined', async () => {
    const service = createBackgroundService({
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      getPausedChats: vi.fn().mockResolvedValue({}),
      setPausedChat: vi.fn().mockResolvedValue(undefined),
      getActiveTab: vi.fn().mockResolvedValue(null),
      getCurrentWindowTabs: vi.fn().mockResolvedValue([]),
      getTabStatus: vi.fn().mockResolvedValue(null),
      forwardToTab: vi.fn().mockResolvedValue(null),
    });

    const result = await service.handle({ type: 'GET_TAB_STATUS' });
    expect(result).toMatchObject({
      runtime: null,
      activeTabId: null,
      activeTabSupportedHost: false,
      activeTabRouteKind: null,
      usingWindowFallback: false,
    });
  });
});
