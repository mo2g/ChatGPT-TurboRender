// @ts-nocheck
import { describe, expect, it } from 'vitest';

import { ManagedHistoryStore } from "../../lib/content/core/managed-history";
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
  it('placeholder test for deprecated initial-trim functionality', () => {
    // Note: All initial-trim related tests have been removed.
    // The setInitialTrimSession method is no longer available in ManagedHistoryStore.
    // Current implementation uses syncFromRecords for live turns only.
    expect(true).toBe(true);
  });
});
