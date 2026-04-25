// @ts-nocheck
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

  it('slices archived pairs into stable 20-pair pages from oldest to newest', () => {
    const store = new ManagedHistoryStore();
    store.setInitialTrimSession(createSession(202, 202));

    expect(store.getArchivedPageCount(20, 0)).toBe(6);
    expect(store.getArchivedPairsWindow(0, 20, 0)).toHaveLength(20);
    expect(store.getArchivedPairsWindow(5, 20, 0)).toHaveLength(1);

    expect(store.getArchivedPageMeta(0, 20, 0)).toMatchObject({
      id: 'archive-page-0',
      pageIndex: 0,
      pageCount: 6,
      pagePairCount: 20,
      pairStartIndex: 0,
      pairEndIndex: 19,
      pairCount: 20,
      source: 'initial-trim',
    });

    expect(store.getArchivedPageMeta(5, 20, 0)).toMatchObject({
      id: 'archive-page-5',
      pageIndex: 5,
      pageCount: 6,
      pagePairCount: 20,
      pairStartIndex: 100,
      pairEndIndex: 100,
      pairCount: 1,
      source: 'initial-trim',
    });

    expect(store.getArchivedPage(0, 20, 0)).toMatchObject({
      id: 'archive-page-0',
      entries: expect.any(Array),
    });
    expect(store.getArchivedPage(0, 20, 0)?.entries).toHaveLength(40);
  });

  it('keeps mixed sources visible in page metadata and page-local groups', () => {
    const store = new ManagedHistoryStore();
    const session = createSession(202, 34);
    session.turns[10] = createTurn(10, { parts: ['old archive needle'] });
    session.turns[86] = createTurn(86, { parts: ['middle archive needle'] });
    session.turns[178] = createTurn(178, { parts: ['new archive needle'] });
    store.setInitialTrimSession(session);

    expect(store.getArchivedPageCount(20, 5)).toBe(5);
    expect(store.getArchivedPageMeta(0, 20, 5)).toMatchObject({
      pageIndex: 0,
      pageCount: 5,
      pairStartIndex: 0,
      pairEndIndex: 19,
      pairCount: 20,
      source: 'mixed',
    });

    expect(store.findPageIndexByTurnId('turn-10', 20, 5)).toBe(0);
    expect(store.findPageIndexByTurnId('turn-86', 20, 5)).toBe(2);
    expect(store.findPageIndexByTurnId('turn-178', 20, 5)).toBe(4);
    expect(store.findPageIndexByQueryMatch('middle archive needle', 20, 5)).toBe(2);
    expect(store.findPageIndexByQueryMatch('new archive needle', 20, 5)).toBe(4);
    expect(store.findPageIndexByQueryMatch('', 20, 5)).toBeNull();

    const pageGroups = store.getArchiveGroupsForPage(1, 20, 5, 5, 'archive', new Set());
    expect(pageGroups).toHaveLength(4);
    expect(pageGroups[0]).toMatchObject({
      id: 'archive-slot-4',
      slotIndex: 4,
      pairStartIndex: 20,
      pairEndIndex: 24,
    });
    expect(pageGroups.at(-1)).toMatchObject({
      id: 'archive-slot-7',
      slotIndex: 7,
      pairStartIndex: 35,
      pairEndIndex: 39,
    });
  });

  it('returns archived page search matches from newest to oldest with stable pair targets', () => {
    const store = new ManagedHistoryStore();
    const session = createSession(202, 202);
    session.turns[10] = createTurn(10, { parts: ['old archive localhost:5000 match'] });
    session.turns[86] = createTurn(86, { parts: ['middle archive localhost:5000 match'] });
    session.turns[178] = createTurn(178, { parts: ['new archive localhost:5000 match'] });
    store.setInitialTrimSession(session);

    expect(store.searchArchivedPages('', 20, 0)).toEqual([]);

    const matches = store.searchArchivedPages('localhost:5000', 20, 0);
    expect(matches.map((match) => match.pageIndex)).toEqual([4, 2, 0]);
    expect(matches.map((match) => match.firstMatchPairIndex)).toEqual([89, 43, 5]);
    expect(matches.map((match) => match.matchCount)).toEqual([1, 1, 1]);
    expect(matches.every((match) => match.excerpt.toLowerCase().includes('localhost:5000'))).toBe(true);
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

  it('prefers live host message ids over synthetic initial-trim ids', () => {
    const store = new ManagedHistoryStore();
    const session = createSession(4, 0);
    session.turns[1] = {
      ...session.turns[1],
      id: 'turn-chat:synthetic-message-id',
    };
    store.setInitialTrimSession(session);

    const liveTurn = document.createElement('article');
    liveTurn.setAttribute('data-message-id', 'real-message-id');
    liveTurn.textContent = 'Assistant reply';

    store.syncFromRecords([
      {
        id: 'live-0',
        index: 0,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'User prompt' }),
      },
      {
        id: 'live-1',
        index: 1,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: liveTurn,
      },
    ]);

    const entry = store.getEntries().find((candidate) => candidate.liveTurnId === 'live-1');
    expect(entry?.messageId).toBe('real-message-id');
  });

  it('skips supplemental structured turns when syncing live records and previews the visible reply', () => {
    const store = new ManagedHistoryStore();
    const session = createSession(5, 0);
    session.turns[0] = createTurn(0, {
      role: 'user',
      parts: ['First user question.'],
    });
    session.turns[1] = createTurn(1, {
      role: 'assistant',
      renderKind: 'structured-message',
      contentType: 'thoughts',
      structuredDetails: '{"reasoning":"Working it out"}',
    });
    session.turns[2] = createTurn(2, {
      role: 'assistant',
      parts: ['Final assistant reply after thinking.'],
    });
    session.turns[3] = createTurn(3, {
      role: 'user',
      parts: ['Second user question.'],
    });
    session.turns[4] = createTurn(4, {
      role: 'assistant',
      parts: ['Later assistant reply.'],
    });
    store.setInitialTrimSession(session);

    store.syncFromRecords([
      {
        id: 'live-user-0',
        index: 0,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'First user question.' }),
      },
      {
        id: 'live-assistant-2',
        index: 1,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), {
          textContent: 'Final assistant reply after thinking.',
        }),
      },
      {
        id: 'live-user-3',
        index: 2,
        role: 'user',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Second user question.' }),
      },
      {
        id: 'live-assistant-4',
        index: 3,
        role: 'assistant',
        isStreaming: false,
        parked: false,
        node: Object.assign(document.createElement('article'), { textContent: 'Later assistant reply.' }),
      },
    ]);

    const entries = store.getEntries();
    expect(entries[1]?.renderKind).toBe('structured-message');
    expect(entries[1]?.liveTurnId).toBeNull();
    expect(entries[2]?.liveTurnId).toBe('live-assistant-2');
    expect(entries[3]?.liveTurnId).toBe('live-user-3');
    expect(entries[4]?.liveTurnId).toBe('live-assistant-4');

    const groups = store.getArchiveGroups(0, 5, '', new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.some((entry) => entry.renderKind === 'structured-message')).toBe(true);
    expect(groups[0]?.assistantPreview.startsWith('Final assistant reply after thinking.')).toBe(true);
    expect(groups[0]?.assistantPreview).not.toContain('Working it out');
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
