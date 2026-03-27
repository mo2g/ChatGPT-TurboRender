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
          initialHotTurns: 3,
          minFinalizedBlocks: 4,
          coldRestoreMode: 'placeholder',
        },
        },
      }),
    );

    const response = await window.fetch('https://chatgpt.com/backend-api/conversation/abc');
    const payload = (await response.json()) as ReturnType<typeof createConversationPayload>;
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(Object.keys(payload.mapping)).toEqual(['root', 'assistant3', 'user4', 'assistant5']);
    expect(payload.mapping['assistant3']?.parent).toBe('root');
    expect(messages.at(-1)?.payload).toMatchObject({
      applied: true,
      chatId: 'chat:abc',
      coldVisibleTurns: 5,
      hotVisibleTurns: 3,
    });

    cleanup();
  });
});
