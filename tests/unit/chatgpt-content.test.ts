import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mountTranscriptFixture } from '../../lib/testing/transcript-fixture';

declare global {
  var defineContentScript: (<T>(definition: T) => T) | undefined;
}

describe('chatgpt content entrypoint', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mountTranscriptFixture(document, { turnCount: 12, streaming: false });
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete',
    });
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval() {
        return 1;
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
    vi.doMock('../../lib/content/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        resetForChatChange() {}
        getStatus() {
          return statusPayload;
        }
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval() {
        return 1;
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
    vi.doMock('../../lib/content/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        resetForChatChange() {}
        getStatus() {
          return statusPayload;
        }
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval() {
        return 1;
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval() {
        return 1;
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
    vi.doMock('../../lib/content/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        getStatus() {
          return null;
        }
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval(callback: () => void) {
        poll = callback;
        return 1;
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
    vi.doMock('../../lib/content/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        getStatus() {
          return null;
        }
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval(callback: () => void) {
        poll = callback;
        return 1;
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
    vi.doMock('../../lib/content/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        getStatus() {
          return null;
        }
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval(callback: () => void) {
        poll = callback;
        return 1;
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
    vi.doMock('../../lib/content/turbo-render-controller', () => ({
      TurboRenderController: class {
        start() {}
        stop() {}
        setSettings() {}
        setPaused() {}
        setInitialTrimSession(session: { applied: boolean } | null) {
          if (session != null) {
            sessionAppliedFlags.push(session.applied);
          }
        }
        restoreNearby() {}
        restoreAll() {}
        getStatus() {
          return null;
        }
        resetForChatChange() {}
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
      onInvalidated(callback: () => void) {
        invalidations.push(callback);
      },
      setInterval() {
        return 1;
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
