import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import type { TabRuntimeStatus } from '../../lib/shared/types';

declare global {
  var defineBackground: (<T>(definition: T) => T) | undefined;
}

type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

type BackgroundEntrypoint = {
  main: () => void;
};

async function invokeRuntimeListener(listener: RuntimeListener, message: unknown): Promise<unknown> {
  return await new Promise((resolve) => {
    expect(listener(message, null, resolve)).toBe(true);
  });
}

function runBackgroundEntrypoint(module: { default: unknown }): void {
  const entrypoint = module.default as BackgroundEntrypoint;
  entrypoint.main();
}

function createRuntime(overrides: Partial<TabRuntimeStatus> = {}): TabRuntimeStatus {
  const paused = overrides.paused ?? false;
  const runtime: TabRuntimeStatus = {
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
    contentScriptInstanceId: 'instance-runtime-test',
    contentScriptStartedAt: 1_700_000_000_000,
    buildSignature: 'test-build',
  };

  Object.assign(runtime, overrides);
  runtime.active = overrides.active ?? !paused;
  runtime.paused = paused;
  return runtime;
}

describe('background entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('queries runtime status from tabs with the dedicated runtime message type', async () => {
    const runtimeListener: Array<RuntimeListener> = [];
    const installedListener: Array<() => void> = [];
    const browserTabsSendMessage = vi.fn(async (_tabId: number, _message: unknown): Promise<TabRuntimeStatus | null> => {
      return {
        supported: true,
        chatId: 'share:test-share',
        routeKind: 'share',
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
        contentScriptInstanceId: 'instance-runtime-test',
        contentScriptStartedAt: 1_700_000_000_000,
        buildSignature: 'test-build',
      };
    });

    vi.doMock('wxt/browser', () => ({
      browser: {
        runtime: {
          onInstalled: {
            addListener(listener: () => void) {
              installedListener.push(listener);
            },
          },
          onMessage: {
            addListener(listener: RuntimeListener) {
              runtimeListener.push(listener);
            },
          },
        },
        scripting: undefined,
        tabs: {
          query: vi.fn().mockResolvedValue([
            {
              id: 5,
              url: 'https://chatgpt.com/share/abc',
              active: true,
              index: 0,
            },
          ]),
          get: vi.fn(),
          sendMessage: browserTabsSendMessage,
        },
      },
    }));

    vi.doMock('../../lib/shared/settings', () => ({
      ensureDefaultSettings: vi.fn().mockResolvedValue(undefined),
      getPausedChats: vi.fn().mockResolvedValue({}),
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setChatPaused: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    }));

    vi.stubGlobal('defineBackground', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/background/index');
    runBackgroundEntrypoint(module);
    expect(installedListener).toHaveLength(1);
    expect(runtimeListener).toHaveLength(1);

    const response = await invokeRuntimeListener(runtimeListener[0]!, { type: 'GET_TAB_STATUS' });
    expect(browserTabsSendMessage).toHaveBeenCalledWith(5, { type: 'GET_RUNTIME_STATUS' });
    expect(response).toMatchObject({
      targetTabId: 5,
      runtime: {
        chatId: 'share:test-share',
      },
    });
  });

  it('keeps the actual active tab when a ChatGPT tab is open elsewhere in the same window', async () => {
    const runtimeListener: Array<RuntimeListener> = [];
    const installedListener: Array<() => void> = [];
    const browserTabsSendMessage = vi.fn(async (tabId: number, _message: unknown): Promise<TabRuntimeStatus | null> => {
      if (tabId === 1) {
        return null;
      }

      throw new Error(`Unexpected runtime query for tab ${tabId}.`);
    });

    vi.doMock('wxt/browser', () => ({
      browser: {
        runtime: {
          onInstalled: {
            addListener(listener: () => void) {
              installedListener.push(listener);
            },
          },
          onMessage: {
            addListener(listener: RuntimeListener) {
              runtimeListener.push(listener);
            },
          },
        },
        scripting: undefined,
        tabs: {
          query: vi.fn().mockResolvedValue([
            {
              id: 1,
              url: 'https://example.com/',
              active: true,
              index: 0,
            },
            {
              id: 2,
              url: 'https://chatgpt.com/share/abc',
              active: false,
              index: 1,
            },
          ]),
          get: vi.fn(),
          sendMessage: browserTabsSendMessage,
        },
      },
    }));

    vi.doMock('../../lib/shared/settings', () => ({
      ensureDefaultSettings: vi.fn().mockResolvedValue(undefined),
      getPausedChats: vi.fn().mockResolvedValue({}),
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setChatPaused: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    }));

    vi.stubGlobal('defineBackground', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/background/index');
    runBackgroundEntrypoint(module);
    expect(installedListener).toHaveLength(1);
    expect(runtimeListener).toHaveLength(1);

    const response = await invokeRuntimeListener(runtimeListener[0]!, { type: 'GET_TAB_STATUS' });
    expect(browserTabsSendMessage).toHaveBeenCalledWith(1, { type: 'GET_RUNTIME_STATUS' });
    expect(browserTabsSendMessage).not.toHaveBeenCalledWith(2, { type: 'GET_RUNTIME_STATUS' });
    expect(response).toMatchObject({
      targetTabId: 1,
      activeTabId: 1,
      activeTabSupportedHost: false,
      activeTabRouteKind: 'home',
      usingWindowFallback: false,
      runtime: null,
    });
  });

  it('keeps the current window tab when the active-tab query is temporarily unavailable', async () => {
    const runtimeListener: Array<RuntimeListener> = [];
    const installedListener: Array<() => void> = [];
    const browserTabsSendMessage = vi.fn(async (tabId: number, _message: unknown): Promise<TabRuntimeStatus | null> => {
      if (tabId !== 5) {
        throw new Error(`Unexpected runtime query for tab ${tabId}.`);
      }

      return createRuntime({
        chatId: 'share:current-window',
        routeKind: 'share',
        active: true,
        paused: false,
        contentScriptInstanceId: 'instance-current-window',
      });
    });
    const browserTabsQuery = vi.fn(async (query: { active?: boolean } = {}) => {
      if (query.active === true) {
        throw new Error('active tab query unavailable');
      }

      return [
        {
          id: 5,
          url: 'https://chatgpt.com/share/current-window',
          active: true,
          index: 0,
        },
      ];
    });

    vi.doMock('wxt/browser', () => ({
      browser: {
        runtime: {
          onInstalled: {
            addListener(listener: () => void) {
              installedListener.push(listener);
            },
          },
          onMessage: {
            addListener(listener: RuntimeListener) {
              runtimeListener.push(listener);
            },
          },
        },
        scripting: undefined,
        tabs: {
          query: browserTabsQuery,
          get: vi.fn(),
          sendMessage: browserTabsSendMessage,
        },
      },
    }));

    vi.doMock('../../lib/shared/settings', () => ({
      ensureDefaultSettings: vi.fn().mockResolvedValue(undefined),
      getPausedChats: vi.fn().mockResolvedValue({}),
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setChatPaused: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    }));

    vi.stubGlobal('defineBackground', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/background/index');
    runBackgroundEntrypoint(module);
    expect(installedListener).toHaveLength(1);
    expect(runtimeListener).toHaveLength(1);

    const response = await invokeRuntimeListener(runtimeListener[0]!, { type: 'GET_TAB_STATUS' });
    expect(browserTabsSendMessage).toHaveBeenCalledWith(5, { type: 'GET_RUNTIME_STATUS' });
    expect(response).toMatchObject({
      targetTabId: 5,
      activeTabId: 5,
      activeTabSupportedHost: true,
      activeTabRouteKind: 'share',
      usingWindowFallback: false,
      runtime: {
        chatId: 'share:current-window',
        supported: true,
      },
    });
  });

  it('keeps the active ChatGPT tab when the current-window query is temporarily unavailable', async () => {
    const runtimeListener: Array<RuntimeListener> = [];
    const installedListener: Array<() => void> = [];
    const browserTabsSendMessage = vi.fn(async (tabId: number, _message: unknown): Promise<TabRuntimeStatus | null> => {
      if (tabId !== 11) {
        throw new Error(`Unexpected runtime query for tab ${tabId}.`);
      }

      return createRuntime({
        chatId: 'chat:fallback-active',
        routeKind: 'chat',
        active: true,
        paused: false,
        contentScriptInstanceId: 'instance-fallback-active',
      });
    });
    const browserTabsQuery = vi.fn(async (query: { active?: boolean } = {}) => {
      if (query.active === true) {
        return [
          {
            id: 11,
            url: 'https://chatgpt.com/c/fallback-active',
            active: true,
            index: 0,
          },
        ];
      }

      throw new Error('current window tab query unavailable');
    });

    vi.doMock('wxt/browser', () => ({
      browser: {
        runtime: {
          onInstalled: {
            addListener(listener: () => void) {
              installedListener.push(listener);
            },
          },
          onMessage: {
            addListener(listener: RuntimeListener) {
              runtimeListener.push(listener);
            },
          },
        },
        scripting: undefined,
        tabs: {
          query: browserTabsQuery,
          get: vi.fn(),
          sendMessage: browserTabsSendMessage,
        },
      },
    }));

    vi.doMock('../../lib/shared/settings', () => ({
      ensureDefaultSettings: vi.fn().mockResolvedValue(undefined),
      getPausedChats: vi.fn().mockResolvedValue({}),
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      setChatPaused: vi.fn().mockResolvedValue(undefined),
      setSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    }));

    vi.stubGlobal('defineBackground', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/background/index');
    runBackgroundEntrypoint(module);
    expect(installedListener).toHaveLength(1);
    expect(runtimeListener).toHaveLength(1);

    const response = await invokeRuntimeListener(runtimeListener[0]!, { type: 'GET_TAB_STATUS' });
    expect(browserTabsSendMessage).toHaveBeenCalledWith(11, { type: 'GET_RUNTIME_STATUS' });
    expect(response).toMatchObject({
      targetTabId: 11,
      activeTabId: 11,
      activeTabSupportedHost: true,
      activeTabRouteKind: 'chat',
      usingWindowFallback: false,
      runtime: {
        chatId: 'chat:fallback-active',
        supported: true,
      },
    });
  });
});
