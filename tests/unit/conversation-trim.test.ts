import { describe, expect, it } from 'vitest';

import {
  extractShareConversationPayload,
  resolveActiveNodeId,
  trimConversationPayload,
  type ConversationMappingNode,
  type ConversationPayload,
} from '../../lib/shared/conversation-trim';

function createNode(
  id: string,
  role: string | null,
  parent: string | null,
  createTime: number,
): ConversationMappingNode {
  return {
    id,
    parent,
    children: [],
    message:
      role == null
        ? null
        : {
            id,
            author: { role, name: null, metadata: {} },
            create_time: createTime,
            update_time: null,
            content: {
              content_type: 'text',
              parts: [`${role}-${id}`],
            },
            status: 'finished_successfully',
            metadata: {},
          },
  };
}

function connect(mapping: Record<string, ConversationMappingNode>, parent: string, child: string): void {
  mapping[parent]!.children = [...(mapping[parent]!.children ?? []), child];
}

function buildPayload(): ConversationPayload {
  const mapping: Record<string, ConversationMappingNode> = {
    root: createNode('root', null, null, 0),
    system: createNode('system', 'system', 'root', 1),
    user1: createNode('user1', 'user', 'system', 2),
    assistant1: createNode('assistant1', 'assistant', 'user1', 3),
    user2: createNode('user2', 'user', 'assistant1', 4),
    assistant2: createNode('assistant2', 'assistant', 'user2', 5),
    user3: createNode('user3', 'user', 'assistant2', 6),
    assistant3: createNode('assistant3', 'assistant', 'user3', 7),
    branchUser: createNode('branchUser', 'user', 'assistant1', 4),
  };

  connect(mapping, 'root', 'system');
  connect(mapping, 'system', 'user1');
  connect(mapping, 'user1', 'assistant1');
  connect(mapping, 'assistant1', 'user2');
  connect(mapping, 'assistant1', 'branchUser');
  connect(mapping, 'user2', 'assistant2');
  connect(mapping, 'assistant2', 'user3');
  connect(mapping, 'user3', 'assistant3');

  return {
    current_node: 'assistant3',
    mapping,
  };
}

describe('conversation trim', () => {
  it('falls back to the newest leaf when current_node is absent', () => {
    const payload = buildPayload();
    delete payload.current_node;

    expect(resolveActiveNodeId(payload)).toBe('assistant3');
  });

  it('trims the active branch to the recent visible window and rewires parents', () => {
    const payload = buildPayload();
    const result = trimConversationPayload(payload, {
      chatId: 'chat:abc',
      routeKind: 'chat',
      routeId: 'abc',
      conversationId: 'abc',
      mode: 'performance',
      initialHotPairs: 2,
      minVisibleTurns: 4,
    });

    expect(result.applied).toBe(true);
    expect(result.session).toMatchObject({
      applied: true,
      totalVisibleTurns: 7,
      coldVisibleTurns: 3,
      hotVisibleTurns: 4,
      hotStartIndex: 3,
      hotPairCount: 2,
      archivedPairCount: 1,
      hotTurnCount: 4,
      archivedTurnCount: 3,
    });

    const trimmedMapping = result.payload.mapping ?? {};
    expect(Object.keys(trimmedMapping)).toEqual(['root', 'user2', 'assistant2', 'user3', 'assistant3']);
    expect(trimmedMapping['user2']).toMatchObject({
      parent: 'root',
      children: ['assistant2'],
    });
    expect(trimmedMapping['assistant2']).toMatchObject({
      parent: 'user2',
      children: ['user3'],
    });
    expect(result.coldMapping['branchUser']).toBeDefined();
    expect(result.session?.coldTurns.map((turn) => turn.id)).toEqual(['system', 'user1', 'assistant1']);
    expect(result.session?.turns.map((turn) => turn.id)).toEqual([
      'system',
      'user1',
      'assistant1',
      'user2',
      'assistant2',
      'user3',
      'assistant3',
    ]);
    expect(result.session?.turns[0]).toMatchObject({
      renderKind: 'structured-message',
      contentType: 'text',
    });
    expect(result.session?.turns[1]).toMatchObject({
      renderKind: 'markdown-text',
      contentType: 'text',
      snapshotHtml: null,
      structuredDetails: null,
    });
  });

  it('returns the original payload when the conversation is already within the hot window', () => {
    const payload = buildPayload();
    const result = trimConversationPayload(payload, {
      chatId: 'chat:abc',
      routeKind: 'chat',
      routeId: 'abc',
      conversationId: 'abc',
      mode: 'performance',
      initialHotPairs: 8,
      minVisibleTurns: 4,
    });

    expect(result.applied).toBe(false);
    expect(result.payload).toBe(payload);
    expect(result.session?.reason).toBe('already-hot');
  });

  it('keeps structured tool messages searchable without falling back to the old placeholder', () => {
    const payload = buildPayload();
    payload.mapping!['assistant2']!.message = {
      id: 'assistant2',
      author: { role: 'tool', name: null, metadata: {} },
      create_time: 5,
      update_time: null,
      content: {
        content_type: 'tool_result',
        parts: [{ type: 'tool_result', payload: { stdout: 'iptables-save' } }],
      },
      status: 'finished_successfully',
      metadata: { tool_name: 'browser' },
    };

    const result = trimConversationPayload(payload, {
      chatId: 'chat:abc',
      routeKind: 'chat',
      routeId: 'abc',
      conversationId: 'abc',
      mode: 'performance',
      initialHotPairs: 2,
      minVisibleTurns: 4,
    });

    const toolTurn = result.session?.turns.find((turn) => turn.id === 'assistant2');
    expect(toolTurn).toMatchObject({
      renderKind: 'structured-message',
      contentType: 'tool_result',
    });
    expect(toolTurn?.parts).toEqual([]);
    expect(toolTurn?.structuredDetails).toContain('iptables-save');
  });

  it('marks visually hidden messages so they can stay out of the restored chat flow', () => {
    const payload = buildPayload();
    payload.mapping!['system']!.message = {
      id: 'system',
      author: { role: 'system', name: null, metadata: {} },
      create_time: 1,
      update_time: null,
      content: {
        content_type: 'text',
        parts: ['hidden system scaffold'],
      },
      status: 'finished_successfully',
      metadata: { is_visually_hidden_from_conversation: true },
    };

    const result = trimConversationPayload(payload, {
      chatId: 'chat:abc',
      routeKind: 'chat',
      routeId: 'abc',
      conversationId: 'abc',
      mode: 'performance',
      initialHotPairs: 2,
      minVisibleTurns: 4,
    });

    expect(result.session?.turns[0]).toMatchObject({
      renderKind: 'structured-message',
      hiddenFromConversation: true,
    });
    expect(result.session?.turns[0]?.parts).toEqual([]);
    expect(result.session?.turns[0]?.structuredDetails).toBeNull();
  });

  it('extracts share conversation payloads from react-router loader data', () => {
    const payload = buildPayload();
    const extracted = extractShareConversationPayload({
      sharedConversationId: 'share-123',
      serverResponse: {
        type: 'data',
        data: payload,
      },
    });

    expect(extracted).toMatchObject({
      shareId: 'share-123',
      payload,
    });
  });
});
