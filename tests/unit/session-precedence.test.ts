import { describe, expect, it } from 'vitest';

import { shouldReplaceSession } from '../../lib/shared/session-precedence';
import type { InitialTrimSession } from '../../lib/shared/types';

function createSession(partial: Partial<InitialTrimSession>): InitialTrimSession {
  return {
    chatId: 'chat:abc',
    routeKind: 'chat',
    routeId: 'abc',
    conversationId: 'abc',
    applied: false,
    reason: 'below-threshold',
    mode: 'performance',
    totalMappingNodes: 10,
    totalVisibleTurns: 10,
    activeBranchLength: 10,
    hotVisibleTurns: 10,
    coldVisibleTurns: 0,
    initialHotPairs: 5,
    hotPairCount: 5,
    archivedPairCount: 0,
    initialHotTurns: 10,
    hotStartIndex: 0,
    hotTurnCount: 10,
    archivedTurnCount: 0,
    activeNodeId: 'node-10',
    turns: [],
    coldTurns: [],
    capturedAt: 1,
    ...partial,
  };
}

describe('session precedence', () => {
  it('prefers applied sessions over non-applied sessions', () => {
    const current = createSession({ applied: false, totalVisibleTurns: 40, capturedAt: 5 });
    const next = createSession({ applied: true, totalVisibleTurns: 20, capturedAt: 1 });

    expect(shouldReplaceSession(current, next)).toBe(true);
    expect(shouldReplaceSession(next, current)).toBe(false);
  });

  it('prefers more complete sessions within the same applied state', () => {
    const current = createSession({ applied: true, totalVisibleTurns: 80, capturedAt: 5 });
    const worse = createSession({ applied: true, totalVisibleTurns: 60, capturedAt: 6 });
    const better = createSession({ applied: true, totalVisibleTurns: 100, capturedAt: 1 });

    expect(shouldReplaceSession(current, worse)).toBe(false);
    expect(shouldReplaceSession(current, better)).toBe(true);
  });

  it('uses capturedAt as tie-breaker when completeness is equal', () => {
    const current = createSession({ applied: false, totalVisibleTurns: 30, capturedAt: 100 });
    const newer = createSession({ applied: false, totalVisibleTurns: 30, capturedAt: 120 });
    const older = createSession({ applied: false, totalVisibleTurns: 30, capturedAt: 90 });

    expect(shouldReplaceSession(current, newer)).toBe(true);
    expect(shouldReplaceSession(current, older)).toBe(false);
  });
});
