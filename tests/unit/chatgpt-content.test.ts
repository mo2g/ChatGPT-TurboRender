import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { mountTranscriptFixture } from '../../lib/testing/transcript-fixture';

declare global {
  var defineContentScript: (<T>(definition: T) => T) | undefined;
}

describe('chatgpt content entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.doUnmock('../../lib/shared/settings');
    vi.doUnmock('../../lib/content/sliding-window');
    vi.doUnmock('../../lib/content/core/turbo-render-controller');
    mountTranscriptFixture(document, { turnCount: 12, streaming: false });
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and cleans up without crashing when extension APIs are unavailable', async () => {
    const invalidations: Array<() => void> = [];

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(() => {
      invalidations.forEach((callback) => callback());
      invalidations.forEach((callback) => callback());
    }).not.toThrow();
  });

  it('responds to runtime messages through chrome sendResponse semantics', async () => {
    const invalidations: Array<() => void> = [];
    type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
    let runtimeListener: RuntimeListener | null = null;
    const statusPayload = {
      supported: true,
      chatId: 'share:test-share',
      routeKind: 'share',
      reason: null,
      archiveOnly: false,
      active: true,
      paused: false,
      mode: 'performance' as const,
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
      archivedTurnsTotal: 0,
      expandedArchiveGroups: 0,
      historyAnchorMode: 'hidden' as const,
      slotBatchCount: 0,
      collapsedBatchCount: 0,
      expandedBatchCount: 0,
      parkedTurns: 0,
      parkedGroups: 0,
      liveDescendantCount: 12,
      visibleRange: { start: 0, end: 7 },
      observedRootKind: 'live-turn-container' as const,
      refreshCount: 1,
      spikeCount: 0,
      lastError: null,
      contentScriptInstanceId: 'instance-runtime-test',
      contentScriptStartedAt: 1_700_000_000_000,
      buildSignature: 'test-build',
    };

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext-id',
        onMessage: {
          addListener(listener: typeof runtimeListener) {
            runtimeListener = listener;
          },
          removeListener() {},
        },
      },
    });
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(runtimeListener).not.toBeNull();

    const ignoredResponse = vi.fn();
    if (runtimeListener != null) {
      expect((runtimeListener as any)({ type: 'GET_TAB_STATUS' }, null, ignoredResponse)).toBeUndefined();
    }
    expect(ignoredResponse).not.toHaveBeenCalled();

    const sendResponse = vi.fn();
    if (runtimeListener != null) {
      expect((runtimeListener as any)({ type: 'GET_RUNTIME_STATUS' }, null, sendResponse)).toBe(true);
    }
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith(statusPayload);
    invalidations.forEach((callback) => callback());
  });

  it.each(['sliding-window', 'sliding-window-inplace'] as const)(
    'starts the sliding-window controller when stored settings select %s mode',
    async (mode) => {
    const invalidations: Array<() => void> = [];
    const resetCalls: string[] = [];
    let slidingStartCalls = 0;
    let turboStartCalls = 0;
    let slidingOptions: unknown = null;
    const slidingSettings = {
      ...DEFAULT_SETTINGS,
      mode,
      slidingWindowPairs: 3,
    };

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/shared/settings', () => ({
      getCurrentChatId: () => 'chat:abc',
      getSettings: vi.fn().mockResolvedValue(slidingSettings),
      isChatPaused: vi.fn().mockResolvedValue(false),
      setChatPaused: vi.fn(),
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {
          turboStartCalls += 1;
        }
        stop() {}
        setSettings() {}
      },
    }));
    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class {
        constructor(options: unknown) {
          slidingOptions = options;
        }
        start() {
          slidingStartCalls += 1;
        }
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    history.replaceState({}, '', '/c/abc');

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    expect(slidingStartCalls).toBe(1);
    expect(turboStartCalls).toBe(0);
    expect(resetCalls).toEqual(['chat:abc']);
    expect(slidingOptions).toMatchObject({
      settings: {
        mode,
        slidingWindowPairs: 3,
      },
      paused: false,
    });

    invalidations.forEach((callback) => callback());
  });

  it('falls back to default settings when the initial storage read stalls', async () => {
    vi.useFakeTimers();
    const invalidations: Array<() => void> = [];
    const resetCalls: string[] = [];
    let turboStartCalls = 0;

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/shared/settings', () => ({
      getCurrentChatId: () => 'chat:abc',
      getSettings: vi.fn(() => new Promise(() => undefined)),
      isChatPaused: vi.fn(() => new Promise(() => undefined)),
      setChatPaused: vi.fn(),
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {
          turboStartCalls += 1;
        }
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    history.replaceState({}, '', '/c/abc');

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    const mainPromise = script.main(ctx);
    await vi.advanceTimersByTimeAsync(1_600);
    await expect(mainPromise).resolves.toBeUndefined();

    expect(turboStartCalls).toBe(1);
    expect(resetCalls).toEqual(['chat:abc']);

    invalidations.forEach((callback) => callback());
  });

  it('prefers chrome runtime messaging when browser and chrome globals both exist', async () => {
    const invalidations: Array<() => void> = [];
    let chromeRuntimeListener:
      | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
      | null = null;
    const browserAddListener = vi.fn();
    const statusPayload = {
      supported: true,
      chatId: 'share:test-share',
      routeKind: 'share',
      reason: null,
      archiveOnly: false,
      active: true,
      paused: false,
      mode: 'performance' as const,
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
      archivedTurnsTotal: 0,
      expandedArchiveGroups: 0,
      historyAnchorMode: 'hidden' as const,
      slotBatchCount: 0,
      collapsedBatchCount: 0,
      expandedBatchCount: 0,
      parkedTurns: 0,
      parkedGroups: 0,
      liveDescendantCount: 12,
      visibleRange: { start: 0, end: 7 },
      observedRootKind: 'live-turn-container' as const,
      refreshCount: 1,
      spikeCount: 0,
      lastError: null,
      contentScriptInstanceId: 'instance-runtime-test',
      contentScriptStartedAt: 1_700_000_000_000,
      buildSignature: 'test-build',
    };

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('browser', {
      runtime: {
        id: 'browser-ext-id',
        onMessage: {
          addListener: browserAddListener,
          removeListener() {},
        },
      },
    });
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'chrome-ext-id',
        onMessage: {
          addListener(listener: typeof chromeRuntimeListener) {
            chromeRuntimeListener = listener;
          },
          removeListener() {},
        },
      },
    });
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(browserAddListener).not.toHaveBeenCalled();
    expect(chromeRuntimeListener).not.toBeNull();

    const ignoredResponse = vi.fn();
    expect(chromeRuntimeListener != null ? (chromeRuntimeListener as (...args: unknown[]) => unknown)({ type: 'GET_TAB_STATUS' }, null, ignoredResponse) : undefined).toBeUndefined();
    expect(ignoredResponse).not.toHaveBeenCalled();

    const sendResponse = vi.fn();
    expect(chromeRuntimeListener != null ? (chromeRuntimeListener as (...args: unknown[]) => unknown)({ type: 'GET_RUNTIME_STATUS' }, null, sendResponse) : undefined).toBe(true);
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith(statusPayload);
    invalidations.forEach((callback) => callback());
  });

  it('does not start a stale content-script instance after invalidation', async () => {
    const invalidations: Array<() => void> = [];
    const domReadyListeners: EventListenerOrEventListenerObject[] = [];

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading',
    });

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        if (target === document && type === 'DOMContentLoaded') {
          domReadyListeners.push(listener);
          return;
        }

        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    ctx.isInvalid = true;
    invalidations.forEach((callback) => callback());

    for (const listener of domReadyListeners) {
      if (typeof listener === 'function') {
        listener.call(document, new Event('DOMContentLoaded'));
      } else {
        listener.handleEvent(new Event('DOMContentLoaded'));
      }
    }

    expect(document.querySelector('[data-turbo-render-archive-root="true"]')).toBeNull();
  });

  it('immediately resets to home when pathname changes to /', async () => {
    const invalidations: Array<() => void> = [];
    let poll: (() => void) | null = null;
    const resetCalls: string[] = [];

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    history.replaceState({}, '', '/c/abc');

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(resetCalls).toEqual(['chat:abc']);

    history.replaceState({}, '', '/');
    (poll as (() => void) | null)?.();
    expect(resetCalls).toEqual(['chat:abc', 'chat:home']);

    invalidations.forEach((callback) => callback());
  });

  it('avoids immediate reset when pathname briefly changes to unknown route without a known session', async () => {
    const invalidations: Array<() => void> = [];
    let poll: (() => void) | null = null;
    const resetCalls: string[] = [];
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    history.replaceState({}, '', '/c/abc');

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(resetCalls).toEqual(['chat:abc']);

    history.replaceState({}, '', '/unresolved-route');
    (poll as (() => void) | null)?.();
    expect(resetCalls).toEqual(['chat:abc']);

    now += 2_100;
    (poll as (() => void) | null)?.();
    (poll as (() => void) | null)?.();
    expect(resetCalls).toEqual(['chat:abc']);

    invalidations.forEach((callback) => callback());
    nowSpy.mockRestore();
  });

  it('does not reset when a share route only changes query parameters', async () => {
    const invalidations: Array<() => void> = [];
    let poll: (() => void) | null = null;
    const resetCalls: string[] = [];

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    history.replaceState({}, '', '/share/share-123');

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(resetCalls).toEqual(['share:share-123']);

    history.replaceState({}, '', '/share/share-123?locale=zh-CN');
    (poll as (() => void) | null)?.();
    expect(resetCalls).toEqual(['share:share-123']);

    invalidations.forEach((callback) => callback());
  });

  it('keeps applied session state when transient route receives a non-applied replay', async () => {
    const invalidations: Array<() => void> = [];
    const sessionAppliedFlags: boolean[] = [];

    vi.doMock('wxt/browser', () => ({
      browser: {},
    }));
    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
      },
    }));
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);
    history.replaceState({}, '', '/c/abc');

    const module = await import('../../entrypoints/chatgpt.content/index');
    const script = module.default as {
      main(ctx: {
        addEventListener(
          target: Window | Document,
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions,
        ): void;
        onInvalidated(callback: () => void): void;
        setInterval(callback: () => void, ms: number): number;
        isInvalid: boolean;
      }): Promise<void>;
    };

    const ctx = {
      addEventListener(
        target: Window | Document,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
      ) {
        target.addEventListener(type, listener, options);
      },
      isInvalid: false,
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_SESSION_STATE',
          payload: {
            chatId: 'chat:abc',
            applied: true,
            totalVisibleTurns: 120,
            capturedAt: 100,
          },
        },
      }),
    );

    history.replaceState({}, '', '/');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_SESSION_STATE',
          payload: {
            chatId: 'chat:abc',
            applied: false,
            totalVisibleTurns: 20,
            capturedAt: 120,
          },
        },
      }),
    );

    expect(sessionAppliedFlags).toEqual([true]);
    invalidations.forEach((callback) => callback());
  });
});
