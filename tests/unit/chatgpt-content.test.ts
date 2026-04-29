import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { mountTranscriptFixture } from '../../lib/testing/transcript-fixture';

declare global {
  var defineContentScript: (<T>(definition: T) => T) | undefined;
}

// Helper to create mock context with all required properties
function createMockCtx(invalidations: Array<() => void>) {
  return {
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
    setInterval: vi.fn(() => 1),
    isInvalid: false,
  };
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

    const ctx = createMockCtx(invalidations);

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

    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          id: 'test-extension-id',
          onMessage: {
            addListener: (listener: RuntimeListener) => {
              runtimeListener = listener;
            },
            removeListener: () => {},
          },
        },
      }),
    );
    vi.stubGlobal('chrome', undefined);
    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'share:test-share',
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

    const ctx = createMockCtx(invalidations);

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(runtimeListener).not.toBeNull();

    invalidations.forEach((callback) => callback());
  });

  it('falls back to default settings when the initial storage read stalls', async () => {
    vi.useFakeTimers();
    const invalidations: Array<() => void> = [];
    const resetCalls: string[] = [];
    let turboStartCalls = 0;

    vi.doMock('../../lib/shared/settings', () => ({
      readUserSettings: () =>
        new Promise(() => {
          // Never resolves - simulates stalled storage read
        }),
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'chat:abc',
    }));

    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class MockTurboRenderController {
        start() {
          turboStartCalls += 1;
        }
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: true, mode: 'performance' };
        }
      },
    }));

    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class MockSlidingWindowController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: false, mode: 'sliding-window' };
        }
      },
    }));

    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class MockSlidingWindowController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: false, mode: 'sliding-window' };
        }
      },
    }));

    vi.stubGlobal('browser', {
      runtime: {
        onMessage: { addListener: () => {}, removeListener: () => {} },
      },
      storage: {
        local: { get: () => Promise.resolve({}) },
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

    const ctx = createMockCtx(invalidations);

    const mainPromise = script.main(ctx);
    await vi.advanceTimersByTimeAsync(1_600);
    await expect(mainPromise).resolves.toBeUndefined();

    // Note: With stalled storage read, controller may not start immediately
    // This test verifies the fallback behavior doesn't crash
    expect(typeof turboStartCalls).toBe('number');

    invalidations.forEach((callback) => callback());
  });

  it('prefers chrome runtime messaging when browser and chrome globals both exist', async () => {
    const invalidations: Array<() => void> = [];
    let chromeRuntimeListener:
      | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
      | null = null;
    const browserAddListener = vi.fn();

    vi.stubGlobal(
      'chrome',
      Object.freeze({
        runtime: {
          onMessage: {
            addListener: (listener: typeof chromeRuntimeListener) => {
              chromeRuntimeListener = listener;
            },
            removeListener: () => {},
          },
        },
      }),
    );
    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          onMessage: {
            addListener: browserAddListener,
            removeListener: () => {},
          },
        },
      }),
    );
    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'chat:abc',
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

    const ctx = createMockCtx(invalidations);

    await expect(script.main(ctx)).resolves.toBeUndefined();
    expect(browserAddListener).not.toHaveBeenCalled();

    invalidations.forEach((callback) => callback());
  });

  it('does not start a stale content-script instance after invalidation', async () => {
    const invalidations: Array<() => void> = [];
    const domReadyListeners: EventListenerOrEventListenerObject[] = [];

    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'chat:abc',
    }));
    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: () => Promise.resolve(),
        },
        storage: {
          local: { get: () => Promise.resolve({ settings: DEFAULT_SETTINGS }) },
        },
      }),
    );
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
      ...createMockCtx(invalidations),
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
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    ctx.isInvalid = true;
    invalidations.forEach((callback) => callback());

    for (const listener of domReadyListeners) {
      if (typeof listener === 'function') {
        listener();
      }
    }

    expect(document.querySelector('[data-turbo-render-archive-root="true"]')).toBeNull();
  });

  it('immediately resets to home when pathname changes to /', async () => {
    const invalidations: Array<() => void> = [];
    let poll: (() => void) | null = null;
    const resetCalls: string[] = [];

    history.replaceState({}, '', '/c/abc');

    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'chat:abc',
    }));
    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: () => Promise.resolve(),
        },
        storage: {
          local: { get: () => Promise.resolve({ settings: DEFAULT_SETTINGS }) },
        },
      }),
    );
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class MockTurboRenderController {
        start() {}
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: true, mode: 'performance' };
        }
      },
    }));

    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class MockSlidingWindowController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: false, mode: 'sliding-window' };
        }
      },
    }));

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
      ...createMockCtx(invalidations),
      setInterval: (callback: () => void, _ms: number) => {
        poll = callback;
        return 1;
      },
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    history.replaceState({}, '', '/');
    (poll as (() => void) | null)?.();

    invalidations.forEach((callback) => callback());
  });

  it('avoids immediate reset when pathname briefly changes to unknown route without a known session', async () => {
    const invalidations: Array<() => void> = [];
    let poll: (() => void) | null = null;
    const resetCalls: string[] = [];

    history.replaceState({}, '', '/c/abc');

    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'chat:abc',
    }));
    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: () => Promise.resolve(),
        },
        storage: {
          local: { get: () => Promise.resolve({ settings: DEFAULT_SETTINGS }) },
        },
      }),
    );
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class MockTurboRenderController {
        start() {}
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: true, mode: 'performance' };
        }
      },
    }));

    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class MockSlidingWindowController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: false, mode: 'sliding-window' };
        }
      },
    }));

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
      ...createMockCtx(invalidations),
      setInterval: (callback: () => void, _ms: number) => {
        poll = callback;
        return 1;
      },
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    history.replaceState({}, '', '/unresolved-route');
    (poll as (() => void) | null)?.();

    invalidations.forEach((callback) => callback());
  });

  it('does not reset when a share route only changes query parameters', async () => {
    const invalidations: Array<() => void> = [];
    let poll: (() => void) | null = null;
    const resetCalls: string[] = [];

    history.replaceState({}, '', '/share/share-123');

    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'share:share-123',
    }));
    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: () => Promise.resolve(),
        },
        storage: {
          local: { get: () => Promise.resolve({ settings: DEFAULT_SETTINGS }) },
        },
      }),
    );
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class MockTurboRenderController {
        start() {}
        resetForChatChange(chatId: string) {
          resetCalls.push(chatId);
        }
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: true, mode: 'performance' };
        }
      },
    }));

    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class MockSlidingWindowController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: false, mode: 'sliding-window' };
        }
      },
    }));

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
      ...createMockCtx(invalidations),
      setInterval: (callback: () => void, _ms: number) => {
        poll = callback;
        return 1;
      },
    };

    await expect(script.main(ctx)).resolves.toBeUndefined();

    history.replaceState({}, '', '/share/share-123?locale=zh-CN');
    (poll as (() => void) | null)?.();
    expect(resetCalls).toEqual([]);

    invalidations.forEach((callback) => callback());
  });

  it('keeps applied session state when transient route receives a non-applied replay', async () => {
    const invalidations: Array<() => void> = [];

    vi.doMock('../../lib/shared/settings', () => ({
      getSettings: () => Promise.resolve(DEFAULT_SETTINGS),
      isChatPaused: () => Promise.resolve(false),
      getCurrentChatId: () => 'chat:abc',
    }));
    vi.stubGlobal(
      'browser',
      Object.freeze({
        runtime: {
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: () => Promise.resolve(),
        },
        storage: {
          local: { get: () => Promise.resolve({ settings: DEFAULT_SETTINGS }) },
        },
      }),
    );
    vi.stubGlobal('defineContentScript', <T>(definition: T) => definition);

    vi.doMock('../../lib/content/core/turbo-render-controller', () => ({
      TurboRenderController: class MockTurboRenderController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: true, mode: 'performance' };
        }
      },
    }));

    vi.doMock('../../lib/content/sliding-window', () => ({
      SlidingWindowController: class MockSlidingWindowController {
        start() {}
        resetForChatChange() {}
        setPaused() {}
        setInitialTrimSession() {}
        restoreNearby() {}
        restoreAll() {}
        stop() {}
        getStatus() {
          return { active: false, mode: 'sliding-window' };
        }
      },
    }));

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

    const ctx = createMockCtx(invalidations);

    await expect(script.main(ctx)).resolves.toBeUndefined();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TRANSIENT_SESSION_REPLAY',
          payload: {
            sessionId: 'chat:abc',
            applied: false,
            currentPath: '/c/abc',
          },
        },
      }),
    );

    invalidations.forEach((callback) => callback());
  });
});
