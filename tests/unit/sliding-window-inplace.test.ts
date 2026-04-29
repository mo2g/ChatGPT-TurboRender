import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigateSlidingWindowInPlace } from '../../lib/main-world/sliding-window/inplace-command';
import { createSlidingWindowCacheEntry } from '../../lib/main-world/sliding-window/idb-cache';
import {
  SLIDING_WINDOW_SESSION_STATE_KEY,
  type SlidingWindowSessionState,
} from '../../lib/main-world/sliding-window/session-state';
import { clearAllSlidingWindowRuntimeState } from '../../lib/main-world/sliding-window/runtime-status';
import { clearAllSlidingWindowRenderTickets } from '../../lib/main-world/sliding-window/render-ticket';
import type { SlidingWindowCacheEntry } from '../../lib/main-world/sliding-window/idb-cache';
import { buildBasicSlidingWindowPayload } from '../fixtures/sliding-window';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createFallbackHarness(input: {
  pathname?: string;
  entry?: SlidingWindowCacheEntry | null;
  router?: unknown;
}) {
  const reload = vi.fn();
  const cache = {
    read: vi.fn(async () => input.entry ?? null),
  };
  const pathname = input.pathname ?? '/c/abc';
  const win = {
    location: {
      href: `https://chatgpt.com${pathname}`,
      origin: 'https://chatgpt.com',
      pathname,
      reload,
    },
    sessionStorage: createMemoryStorage(),
    __turboRenderSlidingWindowCache: cache,
    __reactRouterDataRouter: input.router,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    dispatchEvent: vi.fn(),
    postMessage: vi.fn(),
  } as unknown as Window;

  return { win, cache, reload };
}

function readFallbackTicket(win: Window): SlidingWindowSessionState | null {
  const raw = win.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY);
  return raw == null ? null : JSON.parse(raw);
}

describe('sliding-window-inplace fallback', () => {
  afterEach(() => {
    clearAllSlidingWindowRuntimeState();
    clearAllSlidingWindowRenderTickets();
    document.body.innerHTML = '';
  });

  it('renders through the official conversation store without writing a reload ticket', async () => {
    const entry = createSlidingWindowCacheEntry('abc', buildBasicSlidingWindowPayload(4));
    const router = {
      revalidate: vi.fn(),
      navigate: vi.fn(),
    };
    const { win, cache, reload } = createFallbackHarness({ entry, router });
    const updateThreadFromServer = vi.fn((_conversationId, payload) => {
      expect(payload).toMatchObject({
        current_node: 'assistant2',
      });
      document.body.innerHTML = [
        '<article data-message-id="user1">user-1</article>',
        '<article data-message-id="assistant2">assistant-2</article>',
      ].join('');
    });
    const resetThread = vi.fn();
    Object.assign(win, {
      __reactRouterManifest: {
        routes: {
          'routes/_conversation.c.$conversationId': {
            hasLoader: false,
            hasClientLoader: false,
          },
        },
      },
      __turboRenderOfficialConversationModule: {
        i8: { resetThread, updateThreadFromServer },
        w8: { },
        n8: { },
      },
    });
    document.body.innerHTML = [
      '<article data-message-id="user3">user-3</article>',
      '<article data-message-id="assistant4">assistant-4</article>',
    ].join('');

    await navigateSlidingWindowInPlace({
      win,
      doc: document,
      conversationId: 'abc',
      windowPairs: 2,
      direction: 'first',
    });

    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(router.revalidate).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(resetThread).toHaveBeenCalledWith('abc');
    expect(updateThreadFromServer).toHaveBeenCalledWith(
      'abc',
      expect.objectContaining({ current_node: 'assistant2' }),
      expect.objectContaining({ source: 'turbo-render-sliding-window-inplace' }),
    );
    expect(reload).not.toHaveBeenCalled();
    expect(readFallbackTicket(win)).toBeNull();
    expect(win.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TURBO_RENDER_SLIDING_WINDOW_STATE',
        payload: expect.objectContaining({
          conversationId: 'abc',
          range: { startPairIndex: 0, endPairIndex: 1 },
        }),
      }),
      'https://chatgpt.com',
    );
  });

  it('falls back to the reload ticket path when the official router adapter is unavailable', async () => {
    const entry = createSlidingWindowCacheEntry('abc', buildBasicSlidingWindowPayload(4));
    const { win, cache, reload } = createFallbackHarness({ entry });

    await navigateSlidingWindowInPlace({
      win,
      doc: document,
      conversationId: 'abc',
      windowPairs: 2,
      direction: 'first',
    });

    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readFallbackTicket(win)).toMatchObject({
      conversationId: 'abc',
      targetRange: { startPairIndex: 0, endPairIndex: 1 },
      reloadReason: 'inplace-render-failed',
      useCache: true,
    });
  });

  it('falls back before rendering when the current route does not match the target conversation', async () => {
    const entry = createSlidingWindowCacheEntry('abc', buildBasicSlidingWindowPayload(4));
    const { win, cache, reload } = createFallbackHarness({ pathname: '/c/other', entry });

    await navigateSlidingWindowInPlace({
      win,
      doc: document,
      conversationId: 'abc',
      windowPairs: 2,
      direction: 'first',
    });

    expect(cache.read).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readFallbackTicket(win)).toMatchObject({
      conversationId: 'abc',
      targetRange: null,
      reloadReason: 'inplace-route-mismatch',
      useCache: true,
    });
  });

  it('falls back before rendering when the cache is missing', async () => {
    const { win, cache, reload } = createFallbackHarness({ entry: null });

    await navigateSlidingWindowInPlace({
      win,
      doc: document,
      conversationId: 'abc',
      windowPairs: 2,
      direction: 'older',
    });

    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readFallbackTicket(win)).toMatchObject({
      conversationId: 'abc',
      targetRange: null,
      reloadReason: 'inplace-cache-missing',
      useCache: true,
    });
  });

  it('falls back before rendering when the cache is dirty', async () => {
    const entry = createSlidingWindowCacheEntry('abc', buildBasicSlidingWindowPayload(4), { dirty: true });
    const { win, reload } = createFallbackHarness({ entry });

    await navigateSlidingWindowInPlace({
      win,
      doc: document,
      conversationId: 'abc',
      windowPairs: 2,
      direction: 'first',
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(readFallbackTicket(win)).toMatchObject({
      conversationId: 'abc',
      targetRange: { startPairIndex: 0, endPairIndex: 1 },
      reloadReason: 'inplace-cache-unusable',
      useCache: true,
    });
  });

  it('falls back before rendering while the transcript is streaming', async () => {
    const entry = createSlidingWindowCacheEntry('abc', buildBasicSlidingWindowPayload(4));
    const { win, reload } = createFallbackHarness({ entry });
    document.body.innerHTML = '<button data-testid="stop-button">Stop</button>';

    await navigateSlidingWindowInPlace({
      win,
      doc: document,
      conversationId: 'abc',
      windowPairs: 2,
      direction: 'first',
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(readFallbackTicket(win)).toMatchObject({
      conversationId: 'abc',
      targetRange: { startPairIndex: 0, endPairIndex: 1 },
      reloadReason: 'inplace-streaming-unsafe',
      useCache: true,
    });
  });
});
