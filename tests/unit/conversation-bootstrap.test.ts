import { afterEach, describe, expect, it, vi } from 'vitest';

import { installConversationBootstrap } from '../../lib/main-world/conversation-bootstrap';
import type { TurboRenderSessionStateBridgeMessage } from '../../lib/shared/runtime-bridge';

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
  });

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
          coldRestoreMode: 'placeholder',
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
            coldRestoreMode: 'placeholder',
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
            coldRestoreMode: 'placeholder',
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
            coldRestoreMode: 'placeholder',
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
