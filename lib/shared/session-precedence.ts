import type { InitialTrimSession } from './types';

function compareCompleteness(left: InitialTrimSession, right: InitialTrimSession): number {
  if (left.totalVisibleTurns !== right.totalVisibleTurns) {
    return left.totalVisibleTurns - right.totalVisibleTurns;
  }

  return left.capturedAt - right.capturedAt;
}

export function shouldReplaceSession(
  current: InitialTrimSession | null | undefined,
  next: InitialTrimSession,
): boolean {
  if (current == null) {
    return true;
  }

  if (next.applied && !current.applied) {
    return true;
  }

  if (current.applied && !next.applied) {
    return false;
  }

  return compareCompleteness(next, current) >= 0;
}
