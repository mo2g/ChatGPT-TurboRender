import { describe, expect, it } from 'vitest';

import { ManagedHistoryStore } from '../../lib/content/managed-history';

describe('ManagedHistoryStore', () => {
  it('indexes initial-trim history and parked groups in descending turn order', () => {
    const store = new ManagedHistoryStore();

    store.setInitialTrimSession({
      chatId: 'chat:abc',
      conversationId: 'conversation-1',
      applied: true,
      reason: 'trimmed',
      mode: 'performance',
      totalMappingNodes: 80,
      totalVisibleTurns: 16,
      activeBranchLength: 16,
      hotVisibleTurns: 10,
      coldVisibleTurns: 6,
      initialHotTurns: 10,
      activeNodeId: 'node-1',
      coldTurns: Array.from({ length: 6 }, (_, index) => ({
        id: `cold-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        parts: [`Cold turn ${index}`],
        createTime: index,
      })),
      capturedAt: Date.now(),
    });
    store.upsertParkedGroup('group-1', [
      ManagedHistoryStore.createParkedEntry({
        groupId: 'group-1',
        turnId: 'turn-8',
        turnIndex: 8,
        role: 'assistant',
        parts: ['Turn 8 body'],
      }),
      ManagedHistoryStore.createParkedEntry({
        groupId: 'group-1',
        turnId: 'turn-9',
        turnIndex: 9,
        role: 'user',
        parts: ['Turn 9 body'],
      }),
    ]);

    const entries = store.getEntries();
    expect(entries[0]?.turnIndex).toBe(9);
    expect(entries.at(-1)?.turnIndex).toBe(0);
  });

  it('searches managed history and returns excerpts for matching entries', () => {
    const store = new ManagedHistoryStore();
    store.upsertParkedGroup('group-2', [
      ManagedHistoryStore.createParkedEntry({
        groupId: 'group-2',
        turnId: 'turn-12',
        turnIndex: 12,
        role: 'assistant',
        parts: ['OpenWrt firewall rules overview'],
      }),
    ]);

    const matches = store.search('firewall');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      entryId: 'parked:turn-12',
      groupId: 'group-2',
      turnId: 'turn-12',
    });
    expect(matches[0]?.excerpt.toLowerCase()).toContain('firewall');
  });
});
