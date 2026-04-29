// @ts-nocheck
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installConversationBootstrap } from '../../lib/main-world/conversation-bootstrap';
import { createSlidingWindowCacheEntry } from '../../lib/main-world/sliding-window/idb-cache';
import { SLIDING_WINDOW_SESSION_STATE_KEY } from '../../lib/main-world/sliding-window/session-state';
import type {
  SlidingWindowStateBridgeMessage,
  TurboRenderSessionStateBridgeMessage,
} from '../../lib/shared/runtime-bridge';

function createConversationPayload() {
  return {
    current_node: 'assistant5',
    mapping: {
      root: { id: 'root', parent: null, children: ['user1'], message: null },
      user1: {
        id: 'user1',
        parent: 'root',
        children: ['assistant1'],
        message: {
          id: 'user1',
          author: { role: 'user', name: null, metadata: {} },
          create_time: 1,
          content: { content_type: 'text', parts: ['user-1'] },
        },
      },
      assistant1: {
        id: 'assistant1',
        parent: 'user1',
        children: ['user2'],
        message: {
          id: 'assistant1',
          author: { role: 'assistant', name: null, metadata: {} },
          create_time: 2,
          content: { content_type: 'text', parts: ['assistant-1'] },
        },
      },
      user2: {
        id: 'user2',
        parent: 'assistant1',
        children: ['assistant2'],
        message: {
          id: 'user2',
          author: { role: 'user', name: null, metadata: {} },
          create_time: 3,
          content: { content_type: 'text', parts: ['user-2'] },
        },
      },
      assistant2: {
        id: 'assistant2',
        parent: 'user2',
        children: ['user3'],
        message: {
          id: 'assistant2',
          author: { role: 'assistant', name: null, metadata: {} },
          create_time: 4,
          content: { content_type: 'text', parts: ['assistant-2'] },
        },
      },
      user3: {
        id: 'user3',
        parent: 'assistant2',
        children: ['assistant3'],
        message: {
          id: 'user3',
          author: { role: 'user', name: null, metadata: {} },
          create_time: 5,
          content: { content_type: 'text', parts: ['user-3'] },
        },
      },
      assistant3: {
        id: 'assistant3',
        parent: 'user3',
        children: ['user4'],
        message: {
          id: 'assistant3',
          author: { role: 'assistant', name: null, metadata: {} },
          create_time: 6,
          content: { content_type: 'text', parts: ['assistant-3'] },
        },
      },
      user4: {
        id: 'user4',
        parent: 'assistant3',
        children: ['assistant5'],
        message: {
          id: 'user4',
          author: { role: 'user', name: null, metadata: {} },
          create_time: 7,
          content: { content_type: 'text', parts: ['user-4'] },
        },
      },
      assistant5: {
        id: 'assistant5',
        parent: 'user4',
        children: [],
        message: {
          id: 'assistant5',
          author: { role: 'assistant', name: null, metadata: {} },
          create_time: 8,
          content: { content_type: 'text', parts: ['assistant-5'] },
        },
      },
    },
  };
}

function createShortConversationPayload() {
  return {
    current_node: 'assistant2',
    mapping: {
      root: { id: 'root', parent: null, children: ['user1'], message: null },
      user1: {
        id: 'user1',
        parent: 'root',
        children: ['assistant1'],
        message: {
          id: 'user1',
          author: { role: 'user', name: null, metadata: {} },
          create_time: 1,
          content: { content_type: 'text', parts: ['user-1'] },
        },
      },
      assistant1: {
        id: 'assistant1',
        parent: 'user1',
        children: ['assistant2'],
        message: {
          id: 'assistant1',
          author: { role: 'assistant', name: null, metadata: {} },
          create_time: 2,
          content: { content_type: 'text', parts: ['assistant-1'] },
        },
      },
      assistant2: {
        id: 'assistant2',
        parent: 'assistant1',
        children: [],
        message: {
          id: 'assistant2',
          author: { role: 'assistant', name: null, metadata: {} },
          create_time: 3,
          content: { content_type: 'text', parts: ['assistant-2'] },
        },
      },
    },
  };
}

describe('conversation bootstrap', () => {
  const originalFetch = window.fetch;

  afterEach(() => {
    window.fetch = originalFetch;
    window.sessionStorage.clear();
    delete (window as typeof window & { __turboRenderSlidingWindowCache?: unknown }).__turboRenderSlidingWindowCache;
    delete (window as typeof window & { __reactRouterDataRouter?: unknown }).__reactRouterDataRouter;
  });

  function dispatchConfig(payload: Record<string, unknown>): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_CONFIG',
          payload,
        },
      }),
    );
  }

  function installFakeSlidingWindowCache(initialEntry = null) {
    let currentEntry = initialEntry;
    const cache = {
      read: vi.fn(async () => currentEntry),
      write: vi.fn(async (entry) => {
        currentEntry = entry;
      }),
      markDirty: vi.fn(async () => {
        if (currentEntry != null) {
          currentEntry = {
            ...currentEntry,
            meta: {
              ...currentEntry.meta,
              dirty: true,
            },
          };
        }
      }),
      clearConversation: vi.fn(async () => {
        currentEntry = null;
      }),
      clearAll: vi.fn(async () => {
        currentEntry = null;
      }),
    };
    (window as typeof window & { __turboRenderSlidingWindowCache?: typeof cache }).__turboRenderSlidingWindowCache = cache;
    return cache;
  }

  function renderPayloadToTranscript(payload: ReturnType<typeof createConversationPayload>) {
    const html = Object.values(payload.mapping)
      .filter((node) => node.message != null)
      .map((node) => {
        const role = node.message.author.role;
        const text = node.message.content.parts.join(' ');
        return `<div data-message-author-role="${role}" data-message-id="${node.message.id}">${text}</div>`;
      })
      .join('');
    document.body.innerHTML = `<main>${html}</main>`;
  }

  it('rewrites long conversation payloads before the page consumes them', async () => {
    const messages: TurboRenderSessionStateBridgeMessage[] = [];
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createConversationPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof window.fetch;

    const cleanup = installConversationBootstrap(window, document);
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'TURBO_RENDER_SESSION_STATE') {
        messages.push(event.data as TurboRenderSessionStateBridgeMessage);
      }
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
        namespace: 'chatgpt-turborender',
        type: 'TURBO_RENDER_CONFIG',
        payload: {
          enabled: true,
          mode: 'performance',
          initialTrimEnabled: true,
          initialHotPairs: 2,
          minFinalizedBlocks: 4,
        },
        },
      }),
    );

    const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const payload = (await response.json()) as ReturnType<typeof createConversationPayload>;
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(Object.keys(payload.mapping)).toEqual(['root', 'user3', 'assistant3', 'user4', 'assistant5']);
    expect(payload.mapping['user3']?.parent).toBe('root');
    expect(messages.at(-1)?.payload).toMatchObject({
      applied: true,
      chatId: 'chat:abc',
      coldVisibleTurns: 4,
      hotVisibleTurns: 4,
      hotStartIndex: 4,
      hotTurnCount: 4,
      archivedTurnCount: 4,
      hotPairCount: 2,
      archivedPairCount: 2,
    });
    expect(messages.at(-1)?.payload.turns.map((turn) => turn.id)).toEqual([
      'user1',
      'assistant1',
      'user2',
      'assistant2',
      'user3',
      'assistant3',
      'user4',
      'assistant5',
    ]);

    cleanup();
  });

  it('serves sliding-window cache hits for the current page load and clears the persisted ticket', async () => {
    const entry = createSlidingWindowCacheEntry('abc', createConversationPayload());
    const cache = installFakeSlidingWindowCache(entry);
    const sessionState = {
      conversationId: 'abc',
      targetRange: { startPairIndex: 0, endPairIndex: 1 },
      requestedAt: Date.now(),
      reloadReason: 'first',
      useCache: true,
    };
    window.sessionStorage.setItem(SLIDING_WINDOW_SESSION_STATE_KEY, JSON.stringify(sessionState));
    const states: SlidingWindowStateBridgeMessage[] = [];
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'TURBO_RENDER_SLIDING_WINDOW_STATE') {
        states.push(event.data as SlidingWindowStateBridgeMessage);
      }
    });
    const nativeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createConversationPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanup = installConversationBootstrap(window, document);
    dispatchConfig({
      enabled: true,
      mode: 'sliding-window',
      initialTrimEnabled: true,
      initialHotPairs: 2,
      slidingWindowPairs: 2,
      minFinalizedBlocks: 4,
    });

    const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const payload = await response.json();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(Object.keys(payload.mapping)).toEqual(['root', 'user1', 'assistant1', 'user2', 'assistant2']);
    expect(payload.current_node).toBe('assistant2');
    expect(window.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY)).toBeNull();

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_SLIDING_WINDOW_REQUEST_STATE',
          payload: { conversationId: 'abc' },
        },
      }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(states.at(-1)?.payload).toMatchObject({
      conversationId: 'abc',
      range: { startPairIndex: 0, endPairIndex: 1 },
      pairCount: 2,
      isLatestWindow: false,
    });

    const sameLoadResponse = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const sameLoadPayload = await sameLoadResponse.json();

    expect(nativeFetch).not.toHaveBeenCalled();
    expect(sameLoadPayload.current_node).toBe('assistant2');
    expect(Object.keys(sameLoadPayload.mapping)).toEqual(['root', 'user1', 'assistant1', 'user2', 'assistant2']);

    cleanup();

    const refreshCleanup = installConversationBootstrap(window, document);
    dispatchConfig({
      enabled: true,
      mode: 'sliding-window',
      initialTrimEnabled: true,
      initialHotPairs: 2,
      slidingWindowPairs: 2,
      minFinalizedBlocks: 4,
    });

    const refreshedResponse = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const refreshedPayload = await refreshedResponse.json();

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(refreshedPayload.current_node).toBe('assistant5');
    expect(Object.keys(refreshedPayload.mapping)).toEqual(['root', 'user3', 'assistant3', 'user4', 'assistant5']);

    refreshCleanup();
  });

  it('renders sliding-window-inplace navigation through router revalidation and synthetic cached fetch', async () => {
    const entry = createSlidingWindowCacheEntry('abc', createConversationPayload());
    const cache = installFakeSlidingWindowCache(entry);
    const states: SlidingWindowStateBridgeMessage[] = [];
    renderPayloadToTranscript({
      ...createConversationPayload(),
      current_node: 'assistant5',
      mapping: {
        root: createConversationPayload().mapping.root,
        user3: createConversationPayload().mapping.user3,
        assistant3: createConversationPayload().mapping.assistant3,
        user4: createConversationPayload().mapping.user4,
        assistant5: createConversationPayload().mapping.assistant5,
      },
    });
    history.replaceState({}, '', '/c/abc');
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'TURBO_RENDER_SLIDING_WINDOW_STATE') {
        states.push(event.data as SlidingWindowStateBridgeMessage);
      }
    });
    const nativeFetch = vi.fn(async () => {
      throw new Error('native conversation fetch should not run during in-place navigation');
    }) as typeof window.fetch;
    window.fetch = nativeFetch;

    const router = {
      revalidate: vi.fn(async () => {
        const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
        renderPayloadToTranscript(await response.json());
      }),
    };
    (window as typeof window & { __reactRouterDataRouter?: typeof router }).__reactRouterDataRouter = router;

    const cleanup = installConversationBootstrap(window, document);
    dispatchConfig({
      enabled: true,
      mode: 'sliding-window-inplace',
      initialTrimEnabled: true,
      initialHotPairs: 2,
      slidingWindowPairs: 2,
      minFinalizedBlocks: 4,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
          payload: { direction: 'first', conversationId: 'abc' },
        },
      }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(router.revalidate).toHaveBeenCalledTimes(1);
    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY)).toBeNull();
    expect(document.body.textContent).toContain('assistant-2');
    expect(document.body.textContent).not.toContain('assistant-5');
    expect(states.at(-1)?.payload).toMatchObject({
      conversationId: 'abc',
      range: { startPairIndex: 0, endPairIndex: 1 },
      pairCount: 2,
      isLatestWindow: false,
    });

    cleanup();
    history.replaceState({}, '', '/');
  });

  it('skips an explicit no-cache ticket and falls back to the live conversation', async () => {
    const entry = createSlidingWindowCacheEntry('abc', createConversationPayload());
    const cache = installFakeSlidingWindowCache(entry);
    const sessionState = {
      conversationId: 'abc',
      targetRange: { startPairIndex: 0, endPairIndex: 1 },
      requestedAt: Date.now(),
      reloadReason: 'refresh',
      useCache: false,
    };
    window.sessionStorage.setItem(SLIDING_WINDOW_SESSION_STATE_KEY, JSON.stringify(sessionState));
    const nativeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createConversationPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanup = installConversationBootstrap(window, document);
    dispatchConfig({
      enabled: true,
      mode: 'sliding-window',
      initialTrimEnabled: true,
      initialHotPairs: 2,
      slidingWindowPairs: 2,
      minFinalizedBlocks: 4,
    });

    const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const payload = await response.json();

    expect(cache.read).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(Object.keys(payload.mapping)).toEqual(['root', 'user3', 'assistant3', 'user4', 'assistant5']);
    expect(window.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY)).toBeNull();

    cleanup();
  });

  it.each(['sliding-window', 'sliding-window-inplace'] as const)(
    'falls back to network before opening a conversation without a reload window in %s mode',
    async (mode) => {
      const cache = installFakeSlidingWindowCache(createSlidingWindowCacheEntry('abc', createConversationPayload()));
      const nativeFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(createConversationPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as typeof window.fetch;
      window.fetch = nativeFetch;

      const cleanup = installConversationBootstrap(window, document);
      dispatchConfig({
        enabled: true,
        mode,
        initialTrimEnabled: true,
        initialHotPairs: 2,
        slidingWindowPairs: 2,
        minFinalizedBlocks: 4,
      });

      const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
      const payload = await response.json();

      expect(cache.clearConversation).not.toHaveBeenCalled();
      expect(cache.read).not.toHaveBeenCalled();
      expect(nativeFetch).toHaveBeenCalledTimes(1);
      expect(cache.write).toHaveBeenCalledTimes(1);
      expect(cache.write.mock.calls[0]?.[0].meta).toMatchObject({
        conversationId: 'abc',
        dirty: false,
        pairCount: 4,
      });
      expect(Object.keys(payload.mapping)).toEqual(['root', 'user3', 'assistant3', 'user4', 'assistant5']);

      cleanup();
    },
  );

  it('bypasses a dirty sliding-window cache entry and refreshes from network', async () => {
    const dirtyEntry = createSlidingWindowCacheEntry('abc', createConversationPayload(), { dirty: true });
    const cache = installFakeSlidingWindowCache(dirtyEntry);
    const sessionState = {
      conversationId: 'abc',
      targetRange: { startPairIndex: 2, endPairIndex: 3 },
      requestedAt: Date.now(),
      reloadReason: 'newer',
      useCache: true,
    };
    window.sessionStorage.setItem(SLIDING_WINDOW_SESSION_STATE_KEY, JSON.stringify(sessionState));
    const nativeFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createConversationPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanup = installConversationBootstrap(window, document);
    dispatchConfig({
      enabled: true,
      mode: 'sliding-window',
      initialTrimEnabled: true,
      initialHotPairs: 2,
      slidingWindowPairs: 2,
      minFinalizedBlocks: 4,
    });

    const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const payload = await response.json();

    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(cache.clearConversation).not.toHaveBeenCalled();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(cache.write).toHaveBeenCalledTimes(1);
    expect(cache.write.mock.calls[0]?.[0].meta.dirty).toBe(false);
    expect(Object.keys(payload.mapping)).toEqual(['root', 'user3', 'assistant3', 'user4', 'assistant5']);
    expect(window.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY)).toBeNull();

    cleanup();
  });

  it('does not mark the sliding-window cache dirty for conversation init reload probes', async () => {
    const entry = createSlidingWindowCacheEntry('abc', createConversationPayload());
    const cache = installFakeSlidingWindowCache(entry);
    const sessionState = {
      conversationId: 'abc',
      targetRange: { startPairIndex: 2, endPairIndex: 3 },
      requestedAt: Date.now(),
      reloadReason: 'newer',
      useCache: true,
    };
    window.sessionStorage.setItem(SLIDING_WINDOW_SESSION_STATE_KEY, JSON.stringify(sessionState));
    const nativeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (requestUrl.endsWith('/backend-api/conversation/init')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`native fetch should not be called for ${requestUrl}`);
    }) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanup = installConversationBootstrap(window, document);
    history.replaceState({}, '', '/c/abc');
    dispatchConfig({
      enabled: true,
      mode: 'sliding-window',
      initialTrimEnabled: true,
      initialHotPairs: 2,
      slidingWindowPairs: 2,
      minFinalizedBlocks: 4,
    });

    await window.fetch('https://chatgpt.com/backend-api/conversation/init', { method: 'POST' });
    expect(cache.markDirty).not.toHaveBeenCalled();

    const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const payload = await response.json();

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(cache.read).toHaveBeenCalledWith('abc');
    expect(Object.keys(payload.mapping)).toEqual(['root', 'user3', 'assistant3', 'user4', 'assistant5']);
    expect(window.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY)).toBeNull();

    cleanup();
    history.replaceState({}, '', '/');
  });

  it('keeps the last applied session when a later replay is non-applied', async () => {
    const messages: TurboRenderSessionStateBridgeMessage[] = [];
    window.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createConversationPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createShortConversationPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as typeof window.fetch;

    const cleanup = installConversationBootstrap(window, document);
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'TURBO_RENDER_SESSION_STATE') {
        messages.push(event.data as TurboRenderSessionStateBridgeMessage);
      }
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_CONFIG',
          payload: {
            enabled: true,
            mode: 'performance',
            initialTrimEnabled: true,
            initialHotPairs: 2,
            minFinalizedBlocks: 4,
          },
        },
      }),
    );

    await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_REQUEST_STATE',
          payload: { chatId: 'chat:abc' },
        },
      }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const appliedStates = messages.map((message) => message.payload.applied);
    expect(appliedStates).toEqual([true, true]);
    expect(messages.at(-1)?.payload).toMatchObject({
      chatId: 'chat:abc',
      applied: true,
      coldVisibleTurns: 4,
    });

    cleanup();
  });

  it('captures share-page loader data and emits a share runtime session', async () => {
    const messages: TurboRenderSessionStateBridgeMessage[] = [];
    history.replaceState({}, '', '/share/share-123');
    (window as typeof window & {
      __reactRouterContext?: {
        state?: {
          loaderData?: Record<string, unknown>;
        };
      };
    }).__reactRouterContext = {
      state: {
        loaderData: {
          'routes/share.$shareId.($action)': {
            sharedConversationId: 'share-123',
            serverResponse: {
              type: 'data',
              data: createConversationPayload(),
            },
          },
        },
      },
    };

    const cleanup = installConversationBootstrap(window, document);
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'TURBO_RENDER_SESSION_STATE') {
        messages.push(event.data as TurboRenderSessionStateBridgeMessage);
      }
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_CONFIG',
          payload: {
            enabled: true,
            mode: 'performance',
            initialTrimEnabled: true,
            initialHotPairs: 2,
            minFinalizedBlocks: 4,
          },
        },
      }),
    );

    await new Promise((resolve) => window.setTimeout(resolve, 50));

    expect(messages.at(-1)?.payload).toMatchObject({
      chatId: 'share:share-123',
      routeKind: 'share',
      routeId: 'share-123',
      conversationId: null,
      applied: true,
      coldVisibleTurns: 4,
    });

    cleanup();
    history.replaceState({}, '', '/');
    delete (window as typeof window & { __reactRouterContext?: unknown }).__reactRouterContext;
  });

  it('rewrites synthetic read aloud ids to the matching host message id by turn order', async () => {
    document.body.innerHTML = `
      <main>
        <div class="text-message min-h-8" data-message-id="real-user-message-id" data-message-author-role="user">
          <div>User prompt for speech.</div>
        </div>
        <div class="text-message min-h-8" data-message-id="real-assistant-message-id" data-message-author-role="assistant">
          <div>Assistant reply for speech.</div>
        </div>
      </main>
    `;

    const nativeFetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 200,
        headers: { 'content-type': 'audio/aac' },
      }),
    ) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanup = installConversationBootstrap(window, document);

    await window.fetch(
      'https://chatgpt.com/backend-api/synthesize?message_id=turn-chat:e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f-1-cwdqxl&conversation_id=e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f&voice=cove&format=aac',
    );

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const forwardedUrl = new URL(nativeFetch.mock.calls[0]![0] as string);
    expect(forwardedUrl.searchParams.get('message_id')).toBe('real-assistant-message-id');
    expect(forwardedUrl.searchParams.get('message_id')).not.toMatch(/^turn-chat:/);

    cleanup();
  });

  it('rewrites synthetic read aloud ids from a cached conversation endpoint payload', async () => {
    const conversationId = 'e77b97e5-a8b7-4380-a2d7-f3f6b775bc5f';
    const bootstrapContext = {
      conversationId,
      entryRole: 'assistant' as const,
      entryText: 'mismatched assistant text',
      entryKey: 'assistant5',
      entryMessageId: 'assistant5',
    };
    (window as typeof window & { __turboRenderReadAloudContext?: typeof bootstrapContext }).__turboRenderReadAloudContext =
      bootstrapContext;

    const nativeFetch = vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input instanceof Request
              ? input.url
              : String(input);

      if (requestUrl.includes(`/backend-api/conversation/${conversationId}`)) {
        return new Response(JSON.stringify(createConversationPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (requestUrl.includes('/backend-api/synthesize')) {
        return new Response('', {
          status: 200,
          headers: { 'content-type': 'audio/aac' },
        });
      }

      throw new Error(`Unexpected fetch request: ${requestUrl}`);
    }) as typeof window.fetch;
    window.fetch = nativeFetch;

    const cleanup = installConversationBootstrap(window, document);

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          namespace: 'chatgpt-turborender',
          type: 'TURBO_RENDER_CONFIG',
          payload: {
            enabled: true,
            mode: 'performance',
            initialTrimEnabled: true,
            initialHotPairs: 2,
            minFinalizedBlocks: 4,
          },
        },
      }),
    );

    await window.fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`);
    const synthesizeResponse = await window.fetch(
      `https://chatgpt.com/backend-api/synthesize?message_id=turn-chat:${conversationId}-5-9ox7ch&conversation_id=${conversationId}&voice=cove&format=aac`,
    );
    expect(synthesizeResponse.ok).toBe(true);

    expect(nativeFetch).toHaveBeenCalledTimes(2);
    const synthesizeCall = nativeFetch.mock.calls[1]![0];
    const synthesizeUrl = new URL(
      typeof synthesizeCall === 'string'
        ? synthesizeCall
        : synthesizeCall instanceof URL
          ? synthesizeCall.toString()
          : synthesizeCall instanceof Request
            ? synthesizeCall.url
            : String(synthesizeCall),
    );

    expect(synthesizeUrl.searchParams.get('conversation_id')).toBe(conversationId);
    expect(synthesizeUrl.searchParams.get('message_id')).toBe('assistant5');
    expect(synthesizeUrl.searchParams.get('message_id')).not.toMatch(/^turn-chat:/);

    cleanup();
  });
});
