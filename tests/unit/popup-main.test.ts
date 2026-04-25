import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import type {
  ConversationRouteKind,
  Settings,
  TabRuntimeStatus,
  TabStatusResponse,
} from '../../lib/shared/types';

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
    totalMappingNodes: 128,
    activeBranchLength: 40,
    totalTurns: 18,
    totalPairs: 9,
    hotPairsVisible: 5,
    finalizedTurns: 18,
    handledTurnsTotal: 6,
    historyPanelOpen: false,
    archivePageCount: 0,
    currentArchivePageIndex: null,
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
  };

  Object.assign(runtime, overrides);
  runtime.active = overrides.active ?? !paused;
  runtime.paused = paused;
  return runtime;
}

function createStatus(overrides: {
  activeTabId?: number | null;
  activeTabRouteKind?: ConversationRouteKind | null;
  activeTabSupportedHost?: boolean;
  paused?: boolean;
  runtime?: Partial<TabRuntimeStatus> | null;
  settings?: Partial<Settings>;
  targetTabId?: number | null;
  usingWindowFallback?: boolean;
} = {}): TabStatusResponse {
  const paused = overrides.paused ?? false;
  const runtime =
    overrides.runtime === undefined
      ? createRuntime({ paused })
      : overrides.runtime === null
        ? null
        : createRuntime({ paused, ...overrides.runtime });

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      language: 'en',
      ...overrides.settings,
    },
    paused: runtime?.paused ?? paused,
    runtime,
    targetTabId: overrides.targetTabId === undefined ? 77 : overrides.targetTabId,
    activeTabId: overrides.activeTabId === undefined ? 77 : overrides.activeTabId,
    usingWindowFallback: overrides.usingWindowFallback ?? false,
    activeTabSupportedHost: overrides.activeTabSupportedHost ?? true,
    activeTabRouteKind: overrides.activeTabRouteKind === undefined ? 'share' : overrides.activeTabRouteKind,
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function installPopupBrowser(sendMessageImpl: (message: { type: string; [key: string]: unknown }) => Promise<unknown> | unknown) {
  const getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);
  const openOptionsPage = vi.fn(async () => undefined);
  const sendMessage = vi.fn(sendMessageImpl);

  vi.doMock('wxt/browser', () => ({
    browser: {
      runtime: {
        getURL,
        openOptionsPage,
        sendMessage,
      },
    },
  }));

  return { getURL, openOptionsPage, sendMessage };
}

async function loadPopup(sendMessageImpl: (message: { type: string; [key: string]: unknown }) => Promise<unknown> | unknown) {
  const mock = installPopupBrowser(sendMessageImpl);
  await import('../../entrypoints/popup/main');
  await nextTick();
  return mock;
}

describe('popup entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('renders an explicit unsupported-web state with the supported URL rules', async () => {
    await loadPopup(async () =>
      createStatus({
        activeTabSupportedHost: false,
        activeTabRouteKind: null,
        runtime: null,
      }),
    );

    const hero = document.querySelector<HTMLElement>('[data-popup-state="unsupported-web"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain('No supported ChatGPT tab was found in the active window.');
    expect(hero?.textContent).toContain('https://chatgpt.com/c/<id>');
    expect(document.querySelector<HTMLButtonElement>('#open-demo')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#open-help')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#refresh-status')?.textContent).toContain('Retry status');
    expect(document.querySelector('[data-popup-section="current-tab"]')).toBeNull();
    expect(document.querySelector('[data-popup-section="settings"]')).toBeNull();
  });

  it('renders an explicit unsupported-chatgpt-home state when ChatGPT home is active', async () => {
    await loadPopup(async () =>
      createStatus({
        activeTabSupportedHost: true,
        activeTabRouteKind: 'home',
        runtime: null,
      }),
    );

    const hero = document.querySelector<HTMLElement>('[data-popup-state="unsupported-chatgpt-home"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain('ChatGPT is open, but the home page is not a supported conversation route.');
    expect(hero?.textContent).toContain('https://chat.openai.com/share/<id>');
    expect(document.querySelector<HTMLButtonElement>('#open-demo')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#open-help')).not.toBeNull();
    expect(document.querySelector('[data-popup-section="current-tab"]')).toBeNull();
    expect(document.querySelector('[data-popup-section="settings"]')).toBeNull();
  });

  it('renders a supported share conversation and toggles it without an extra refresh', async () => {
    let currentStatus = createStatus({
      activeTabSupportedHost: true,
      activeTabRouteKind: 'share',
      runtime: createRuntime({
        chatId: 'share:test-share',
        routeKind: 'share',
        active: true,
        paused: false,
      }),
    });

    const mock = await loadPopup(async (message) => {
      if (message.type === 'GET_TAB_STATUS') {
        return currentStatus;
      }

      if (message.type === 'PAUSE_CHAT') {
        const paused = Boolean(message.paused);
        currentStatus = {
          ...currentStatus,
          paused,
          runtime:
            currentStatus.runtime == null
              ? null
              : {
                  ...currentStatus.runtime,
                  paused,
                  active: !paused,
                },
        };
        return currentStatus;
      }

      return currentStatus;
    });

    const hero = document.querySelector<HTMLElement>('[data-popup-state="active"]');
    expect(hero).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#toggle-chat-mode')?.textContent).toContain('Restore this chat');
    expect(document.querySelector('[data-popup-section="current-tab"]')).not.toBeNull();
    expect(document.querySelector('[data-popup-section="settings"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('#enabled-toggle')).not.toBeNull();
    expect(document.querySelector<HTMLSelectElement>('#language-select')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('#toggle-chat-mode')?.click();
    await nextTick();

    expect(mock.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PAUSE_CHAT',
        chatId: 'share:test-share',
        paused: true,
        tabId: 77,
      }),
    );
    expect(mock.sendMessage.mock.calls.map(([message]) => (message as { type: string }).type)).toEqual([
      'GET_TAB_STATUS',
      'PAUSE_CHAT',
    ]);
    expect(document.querySelector<HTMLButtonElement>('#toggle-chat-mode')?.textContent).toContain('TurboRender this chat');
  });

  it('shows the recovery copy when status comes from another supported tab', async () => {
    await loadPopup(async () =>
      createStatus({
        activeTabSupportedHost: true,
        activeTabRouteKind: 'share',
        runtime: createRuntime({
          chatId: 'share:fallback',
          routeKind: 'share',
          active: true,
          paused: false,
        }),
        targetTabId: 88,
        activeTabId: 11,
        usingWindowFallback: true,
      }),
    );

    const hero = document.querySelector<HTMLElement>('[data-popup-state="window-fallback"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain('This popup is showing the status from another supported ChatGPT tab in the same window.');
    expect(document.querySelector('[data-popup-section="current-tab"]')).not.toBeNull();
    expect(document.querySelector('[data-popup-section="settings"]')).not.toBeNull();
    expect(
      (document.body.textContent ?? '').match(
        /This popup is showing the status from another supported ChatGPT tab in the same window\./g,
      ) ?? [],
    ).toHaveLength(1);
  });

  it('renders a readable error state when the initial sendMessage fails', async () => {
    await loadPopup(async () => {
      throw new Error('background unavailable');
    });

    const hero = document.querySelector<HTMLElement>('[data-popup-state="error"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain('Could not load popup status');
    expect(hero?.textContent).toContain('background unavailable');
    expect(document.querySelector<HTMLButtonElement>('#open-demo')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('#open-help')).not.toBeNull();
    expect(document.querySelector('[data-popup-section="current-tab"]')).toBeNull();
    expect(document.querySelector('[data-popup-section="settings"]')).toBeNull();
  });

  it('renders a readable error state when a refresh fails', async () => {
    let callCount = 0;

    await loadPopup(async (message) => {
      if (message.type !== 'GET_TAB_STATUS') {
        return createStatus({ runtime: null, activeTabSupportedHost: false, activeTabRouteKind: null });
      }

      callCount += 1;
      if (callCount === 1) {
        return createStatus({ runtime: null, activeTabSupportedHost: false, activeTabRouteKind: null });
      }

      throw new Error('refresh failed');
    });

    expect(document.querySelector<HTMLElement>('[data-popup-state="unsupported-web"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('#refresh-status')?.click();
    await nextTick();

    const hero = document.querySelector<HTMLElement>('[data-popup-state="error"]');
    expect(hero).not.toBeNull();
    expect(hero?.textContent).toContain('refresh failed');
    expect(hero?.textContent).toContain('Retry status');
    expect(document.querySelector('[data-popup-section="current-tab"]')).toBeNull();
    expect(document.querySelector('[data-popup-section="settings"]')).toBeNull();
  });
});
