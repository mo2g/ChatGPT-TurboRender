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
    poll?.();
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
    poll?.();
    expect(resetCalls).toEqual(['chat:abc']);

    now += 2_100;
    poll?.();
    poll?.();
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
    poll?.();
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
