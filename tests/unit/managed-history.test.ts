import { describe, expect, it } from 'vitest';

import { ManagedHistoryStore } from '../../lib/content/managed-history';
import type { InitialTrimSession } from '../../lib/shared/types';

function createTurn(
  index: number,
  override: Partial<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    parts: string[];
    renderKind: 'markdown-text' | 'host-snapshot' | 'structured-message';
    contentType: string | null;
    snapshotHtml: string | null;
    structuredDetails: string | null;
    hiddenFromConversation: boolean;
  }> = {},
) {
  return {
    id: `turn-${index}`,
    role: override.role ?? (index % 2 === 0 ? ('user' as const) : ('assistant' as const)),
    parts: override.parts ?? [`Turn ${index}`],
    renderKind: override.renderKind ?? 'markdown-text',
    contentType: override.contentType ?? 'text',
    snapshotHtml: override.snapshotHtml ?? null,
    structuredDetails: override.structuredDetails ?? null,
    hiddenFromConversation: override.hiddenFromConversation ?? false,
    createTime: index,
  };
}

function createSession(totalTurns: number, hotStartIndex: number): InitialTrimSession {
  const turns = Array.from({ length: totalTurns }, (_, index) => createTurn(index));
  const totalPairs = Math.ceil(totalTurns / 2);
  const hotTurnCount = totalTurns - hotStartIndex;
  const hotPairCount = Math.ceil(hotTurnCount / 2);
  const archivedPairCount = totalPairs - hotPairCount;

  return {
    chatId: 'chat:abc',
    routeKind: 'chat',
    routeId: 'abc',
    conversationId: 'conversation-1',
    applied: true,
    reason: 'trimmed',
    mode: 'performance',
    totalMappingNodes: totalTurns + 20,
    totalVisibleTurns: totalTurns,
    activeBranchLength: totalTurns,
    hotVisibleTurns: hotTurnCount,
    coldVisibleTurns: hotStartIndex,
    initialHotPairs: hotPairCount,
    hotPairCount,
    archivedPairCount,
    initialHotTurns: hotPairCount * 2,
    hotStartIndex,
    hotTurnCount,
    archivedTurnCount: hotStartIndex,
    activeNodeId: `turn-${totalTurns - 1}`,
    turns,
    coldTurns: turns.slice(0, hotStartIndex),
    capturedAt: Date.now(),
  };
}

describe('ManagedHistoryStore', () => {
  it('builds fixed 5-pair slots instead of dynamically rebalancing the tail', () => {
    const store = new ManagedHistoryStore();
    store.setInitialTrimSession(createSession(202, 0));

    const groups = store.getArchiveGroups(0, 5, '', new Set());
    expect(groups.at(-2)).toMatchObject({
      slotPairStartIndex: 95,
      slotPairEndIndex: 99,
      filledPairCount: 5,
      capacity: 5,
    });
    expect(groups.at(-1)).toMatchObject({
      slotPairStartIndex: 100,
      slotPairEndIndex: 104,
      filledPairCount: 1,
      capacity: 5,
    });
  });

  it('merges initial-trim and parked-dom pairs into the same fixed slot when needed', () => {
    const store = new ManagedHistoryStore();
    const session = createSession(12, 8);
    session.turns[8] = createTurn(8, { parts: ['iptables-save command'] });
    session.turns[9] = createTurn(9, { parts: ['Assistant tool response'] });
    store.setInitialTrimSession(session);

    store.syncFromRecords([
      {
        id: 'live-8',
        index: 0,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'iptables-save command' }),
      },
      {
        id: 'live-9',
        index: 1,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Assistant tool response' }),
      },
      {
        id: 'live-10',
        index: 2,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Latest user turn' }),
      },
      {
        id: 'live-11',
        index: 3,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Latest assistant turn' }),
      },
    ]);

    const groups = store.getArchiveGroups(1, 5, 'iptables', new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      source: 'mixed',
      slotPairStartIndex: 0,
      slotPairEndIndex: 4,
      filledPairCount: 5,
      matchCount: 1,
    });

    const matches = store.search('iptables', 1, 5);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      source: 'mixed',
      slotPairStartIndex: 0,
      slotPairEndIndex: 4,
      matchCount: 1,
    });
  });

  it('upgrades live turns to host snapshots and excludes hidden messages from search', () => {
    const store = new ManagedHistoryStore();
    const session = createSession(12, 8);
    session.turns[2] = createTurn(2, {
      role: 'tool',
      parts: [],
      renderKind: 'structured-message',
      contentType: 'tool_result',
      structuredDetails: '{"tool":"browser","output":"iptables-save"}',
    });
    session.turns[3] = createTurn(3, {
      role: 'system',
      parts: [],
      renderKind: 'structured-message',
      contentType: 'text',
      structuredDetails: '{"metadata":{"is_visually_hidden_from_conversation":true}}',
      hiddenFromConversation: true,
    });
    store.setInitialTrimSession(session);

    const liveTurn = document.createElement('article');
    liveTurn.innerHTML = '<div><p>Turn 8</p></div>';

    store.syncFromRecords([
      {
        id: 'live-8',
        index: 0,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: liveTurn,
      },
      {
        id: 'live-9',
        index: 1,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Turn 9' }),
      },
      {
        id: 'live-10',
        index: 2,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Turn 10' }),
      },
      {
        id: 'live-11',
        index: 3,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Turn 11' }),
      },
    ]);

    const hotEntry = store.getEntries().find((entry) => entry.liveTurnId === 'live-8');
    expect(hotEntry).toMatchObject({
      renderKind: 'host-snapshot',
    });
    expect(hotEntry?.snapshotHtml).toContain('<div><p>Turn 8</p></div>');

    const visibleMatches = store.search('iptables-save', 1, 5);
    expect(visibleMatches).toHaveLength(1);
    expect(visibleMatches[0]?.matchCount).toBe(1);

    const hiddenMatches = store.search('is_visually_hidden_from_conversation', 1, 5);
    expect(hiddenMatches).toHaveLength(0);
  });

  it('strips leading role prefixes from DOM-extracted previews', () => {
    const store = new ManagedHistoryStore();
    store.setInitialTrimSession(createSession(4, 0));

    store.syncFromRecords([
      {
        id: 'live-u-1',
        index: 0,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), {
          textContent: 'You: 你说：how to build a chatbot for pdf',
        }),
      },
      {
        id: 'live-a-1',
        index: 1,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), {
          textContent: 'Assistant: ChatGPT 说：Building a chatbot for PDF can be useful',
        }),
      },
      {
        id: 'live-u-2',
        index: 2,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'second question' }),
      },
      {
        id: 'live-a-2',
        index: 3,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'second answer' }),
      },
    ]);

    const groups = store.getArchiveGroups(0, 5, '', new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.userPreview.startsWith('how to build a chatbot for pdf')).toBe(true);
    expect(groups[0]?.userPreview).not.toContain('You:');
    expect(groups[0]?.userPreview).not.toContain('你说：');
    expect(groups[0]?.assistantPreview.startsWith('Building a chatbot for PDF can be useful')).toBe(true);
    expect(groups[0]?.assistantPreview).not.toContain('Assistant:');
    expect(groups[0]?.assistantPreview).not.toContain('ChatGPT 说：');
  });
});
