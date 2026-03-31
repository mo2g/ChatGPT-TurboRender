import type { TurnRole } from './types';

export interface PairableTurn {
  id: string;
  role: TurnRole;
  turnIndex: number;
  text: string;
}

export interface InteractionPair<T extends PairableTurn> {
  id: string;
  pairIndex: number;
  entries: T[];
  startTurnIndex: number;
  endTurnIndex: number;
  searchText: string;
  userPreview: string;
  assistantPreview: string;
}

export interface InteractionBatch<T extends PairableTurn> {
  id: string;
  slotIndex: number;
  slotPairStartIndex: number;
  slotPairEndIndex: number;
  filledPairCount: number;
  capacity: number;
  pairStartIndex: number;
  pairEndIndex: number;
  turnStartIndex: number;
  turnEndIndex: number;
  pairCount: number;
  entries: T[];
  pairs: InteractionPair<T>[];
  userPreview: string;
  assistantPreview: string;
  searchText: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const LEADING_ROLE_PREFIX_PATTERNS = [
  /^(?:you|you said)\s*[:：]\s*/i,
  /^(?:assistant|chatgpt)(?:\s+(?:said|says))?\s*[:：]\s*/i,
  /^(?:你|你说)\s*[:：]\s*/,
  /^(?:助手|chatgpt)\s*(?:说)?\s*[:：]\s*/i,
];

export function stripLeadingRolePrefix(text: string): string {
  let output = text.trimStart();

  for (let pass = 0; pass < 6; pass += 1) {
    let replaced = false;
    for (const pattern of LEADING_ROLE_PREFIX_PATTERNS) {
      if (!pattern.test(output)) {
        continue;
      }

      output = output.replace(pattern, '').trimStart();
      replaced = true;
      break;
    }
    if (!replaced) {
      break;
    }
  }

  return output.trim();
}

function summarizeText(text: string, maxLength = 72): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function pickPreview<T extends PairableTurn>(entries: T[], roles: TurnRole[]): string {
  for (const entry of entries) {
    if (roles.includes(entry.role)) {
      const preview = summarizeText(entry.text);
      const cleaned = summarizeText(stripLeadingRolePrefix(entry.text));
      if (cleaned.length > 0) {
        return cleaned;
      }
      if (preview.length > 0) {
        return preview;
      }
    }
  }

  for (const entry of entries) {
    const cleaned = summarizeText(stripLeadingRolePrefix(entry.text));
    if (cleaned.length > 0) {
      return cleaned;
    }
    const fallback = summarizeText(entry.text);
    if (fallback.length > 0) {
      return fallback;
    }
  }

  return '';
}

export function buildInteractionPairs<T extends PairableTurn>(entries: T[]): InteractionPair<T>[] {
  if (entries.length === 0) {
    return [];
  }

  const pairs: InteractionPair<T>[] = [];
  let current: T[] = [];
  let hasUserInCurrent = false;

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    const pairIndex = pairs.length;
    pairs.push({
      id: `pair-${pairIndex}`,
      pairIndex,
      entries: [...current],
      startTurnIndex: current[0]!.turnIndex,
      endTurnIndex: current.at(-1)!.turnIndex,
      searchText: normalizeText(current.map((entry) => entry.text).join('\n')),
      userPreview: pickPreview(current, ['user']),
      assistantPreview: pickPreview(current, ['assistant', 'tool', 'system']),
    });
    current = [];
    hasUserInCurrent = false;
  };

  for (const entry of entries) {
    if (entry.role === 'user' && hasUserInCurrent) {
      flush();
    }

    current.push(entry);
    if (entry.role === 'user') {
      hasUserInCurrent = true;
    }
  }

  flush();
  return pairs;
}

export function buildInteractionBatches<T extends PairableTurn>(
  pairs: InteractionPair<T>[],
  batchPairCount: number,
  prefix: string,
): InteractionBatch<T>[] {
  if (pairs.length === 0 || !Number.isFinite(batchPairCount) || batchPairCount <= 0) {
    return [];
  }

  const slots = new Map<number, InteractionPair<T>[]>();
  for (const pair of pairs) {
    const slotIndex = Math.floor(pair.pairIndex / batchPairCount);
    const slotPairs = slots.get(slotIndex) ?? [];
    slotPairs.push(pair);
    slots.set(slotIndex, slotPairs);
  }

  const batches: InteractionBatch<T>[] = [];
  for (const slotIndex of [...slots.keys()].sort((left, right) => left - right)) {
    const chunk = slots.get(slotIndex) ?? [];
    if (chunk.length === 0) {
      continue;
    }
    const entries = chunk.flatMap((pair) => pair.entries);
    const slotPairStartIndex = slotIndex * batchPairCount;
    const slotPairEndIndex = slotPairStartIndex + batchPairCount - 1;
    batches.push({
      id: `${prefix}-slot-${slotIndex}`,
      slotIndex,
      slotPairStartIndex,
      slotPairEndIndex,
      filledPairCount: chunk.length,
      capacity: batchPairCount,
      pairStartIndex: chunk[0]!.pairIndex,
      pairEndIndex: chunk.at(-1)!.pairIndex,
      turnStartIndex: chunk[0]!.startTurnIndex,
      turnEndIndex: chunk.at(-1)!.endTurnIndex,
      pairCount: chunk.length,
      entries,
      pairs: chunk,
      userPreview: pickPreview(entries, ['user']),
      assistantPreview: pickPreview(entries, ['assistant', 'tool', 'system']),
      searchText: normalizeText(chunk.map((pair) => pair.searchText).join('\n')),
    });
  }

  return batches;
}

export function findPairIndexForTurnIndex<T extends PairableTurn>(
  pairs: InteractionPair<T>[],
  turnIndex: number,
): number | null {
  for (const pair of pairs) {
    if (pair.startTurnIndex <= turnIndex && turnIndex <= pair.endTurnIndex) {
      return pair.pairIndex;
    }
  }

  return null;
}
