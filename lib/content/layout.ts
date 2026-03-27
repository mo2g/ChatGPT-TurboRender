import type { IndexRange, Settings, TurnGroupPlan } from '../shared/types';

export interface ActivationInput {
  finalizedTurns: number;
  descendantCount: number;
  spikeCount: number;
  settings: Settings;
}

export interface ParkingCandidate {
  id: string;
  index: number;
  parked: boolean;
  isStreaming: boolean;
  protected: boolean;
  parentKey: string;
}

export function shouldAutoActivate(input: ActivationInput): boolean {
  return (
    input.finalizedTurns >= input.settings.minFinalizedBlocks ||
    input.descendantCount >= input.settings.minDescendants ||
    input.spikeCount >= input.settings.frameSpikeCount
  );
}

export function computeHotRange(
  totalTurns: number,
  visibleRange: IndexRange | null,
  settings: Pick<Settings, 'keepRecentTurns' | 'viewportBufferTurns'>,
): IndexRange {
  if (totalTurns <= 0) {
    return { start: 0, end: 0 };
  }

  const recentStart = Math.max(0, totalTurns - settings.keepRecentTurns);
  const defaultRange = {
    start: recentStart,
    end: totalTurns - 1,
  };

  if (visibleRange == null) {
    return defaultRange;
  }

  const bufferedVisibleStart = Math.max(0, visibleRange.start - settings.viewportBufferTurns);
  const bufferedVisibleEnd = Math.min(
    totalTurns - 1,
    visibleRange.end + settings.viewportBufferTurns,
  );

  return {
    start: Math.min(recentStart, bufferedVisibleStart),
    end: Math.max(defaultRange.end, bufferedVisibleEnd),
  };
}

export function planTurnGroups(
  turns: ParkingCandidate[],
  hotRange: IndexRange,
  groupSize: number,
): TurnGroupPlan[] {
  const plans: TurnGroupPlan[] = [];
  let segment: ParkingCandidate[] = [];

  const flushSegment = () => {
    const chunkCount = Math.floor(segment.length / groupSize);
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunk = segment.slice(chunkIndex * groupSize, chunkIndex * groupSize + groupSize);
      plans.push({
        id: `group-${chunk[0]!.index}-${chunk.at(-1)!.index}`,
        startIndex: chunk[0]!.index,
        endIndex: chunk.at(-1)!.index,
        turnIds: chunk.map((turn) => turn.id),
      });
    }
    segment = [];
  };

  for (const turn of turns) {
    const isEligible =
      turn.index < hotRange.start && !turn.parked && !turn.isStreaming && !turn.protected;

    if (!isEligible) {
      flushSegment();
      continue;
    }

    const previous = segment.at(-1);
    const joinsPrevious =
      previous != null &&
      previous.parentKey === turn.parentKey &&
      previous.index + 1 === turn.index;

    if (segment.length > 0 && !joinsPrevious) {
      flushSegment();
    }

    segment.push(turn);
  }

  flushSegment();
  return plans;
}
