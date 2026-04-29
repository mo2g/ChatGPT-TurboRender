import type {
  ConversationMappingNode,
  ConversationPayload,
  SlidingWindowPairIndex,
  SlidingWindowRange,
  SlidingWindowSliceResult,
} from './types';
import { resolveSlidingWindowActiveChain } from './active-chain';
import { validateConversationPayload, validateSyntheticPayload } from './payload-validator';

function emptyRange(): SlidingWindowRange {
  return {
    startPairIndex: 0,
    endPairIndex: -1,
  };
}

function getRequestedPairCount(range: SlidingWindowRange, totalPairs: number): number {
  if (!Number.isFinite(range.startPairIndex) || !Number.isFinite(range.endPairIndex)) {
    return Math.min(1, totalPairs);
  }

  return Math.min(
    totalPairs,
    Math.max(1, Math.floor(range.endPairIndex) - Math.floor(range.startPairIndex) + 1),
  );
}

function normalizeRange(range: SlidingWindowRange, totalPairs: number): SlidingWindowRange {
  if (totalPairs <= 0) {
    return emptyRange();
  }

  const pairCount = getRequestedPairCount(range, totalPairs);
  const latestStart = Math.max(0, totalPairs - pairCount);
  const start = Math.min(latestStart, Math.max(0, Math.floor(range.startPairIndex)));
  return {
    startPairIndex: start,
    endPairIndex: start + pairCount - 1,
  };
}

function failedSlice(
  range: SlidingWindowRange,
  reason: string,
  keptNodeCount = 0,
  removedNodeCount = 0,
): SlidingWindowSliceResult {
  return {
    ok: false,
    payload: null,
    range,
    reason,
    keptNodeCount,
    removedNodeCount,
  };
}

function getNodeRole(node: ConversationMappingNode | undefined): string | null {
  return node?.message?.author?.role ?? null;
}

function isHiddenNode(node: ConversationMappingNode | undefined): boolean {
  return node?.message?.metadata?.is_visually_hidden_from_conversation === true;
}

function isNecessaryAncestorSpineNode(node: ConversationMappingNode | undefined): boolean {
  if (node == null) {
    return false;
  }

  return node.message == null || getNodeRole(node) === 'system' || isHiddenNode(node);
}

function cloneRewiredNode(
  node: ConversationMappingNode,
  parent: string | null,
  child: string | null,
): ConversationMappingNode {
  return {
    ...node,
    parent,
    children: child == null ? [] : [child],
  };
}

function buildSyntheticMapping(
  mapping: Record<string, ConversationMappingNode>,
  orderedKeepIds: string[],
): Record<string, ConversationMappingNode> {
  return Object.fromEntries(
    orderedKeepIds.map((nodeId, index) => {
      const previousId = orderedKeepIds[index - 1] ?? null;
      const nextId = orderedKeepIds[index + 1] ?? null;
      return [nodeId, cloneRewiredNode(mapping[nodeId]!, previousId, nextId)];
    }),
  );
}

function findWindowBoundaryIndexes(
  activeNodeIds: string[],
  windowNodeIds: Set<string>,
): { first: number; last: number } | null {
  let first = -1;
  let last = -1;

  for (const [index, nodeId] of activeNodeIds.entries()) {
    if (!windowNodeIds.has(nodeId)) {
      continue;
    }

    if (first === -1) {
      first = index;
    }
    last = index;
  }

  return first === -1 || last === -1 ? null : { first, last };
}

function findCurrentNodeId(
  activeNodeIds: string[],
  mapping: Record<string, ConversationMappingNode>,
  windowNodeIds: Set<string>,
): string | null {
  for (let index = activeNodeIds.length - 1; index >= 0; index -= 1) {
    const nodeId = activeNodeIds[index]!;
    const node = mapping[nodeId];
    if (windowNodeIds.has(nodeId) && node?.message != null) {
      return nodeId;
    }
  }

  return null;
}

function collectWindowNodeIds(
  pairIndex: SlidingWindowPairIndex,
  range: SlidingWindowRange,
): Set<string> {
  const windowNodeIds = new Set<string>();
  for (const pair of pairIndex.pairs) {
    if (pair.pairIndex < range.startPairIndex || pair.pairIndex > range.endPairIndex) {
      continue;
    }

    for (const nodeId of pair.relatedNodeIds) {
      windowNodeIds.add(nodeId);
    }
  }

  return windowNodeIds;
}

function collectKeepIds(input: {
  activeNodeIds: string[];
  mapping: Record<string, ConversationMappingNode>;
  boundary: { first: number; last: number };
  windowNodeIds: Set<string>;
}): Set<string> {
  const keepIds = new Set<string>();
  const { activeNodeIds, mapping, boundary, windowNodeIds } = input;

  for (let index = 0; index < activeNodeIds.length; index += 1) {
    const nodeId = activeNodeIds[index]!;
    const node = mapping[nodeId];
    if (node == null) {
      continue;
    }

    if (index < boundary.first) {
      if (isNecessaryAncestorSpineNode(node)) {
        keepIds.add(nodeId);
      }
      continue;
    }

    if (index > boundary.last) {
      continue;
    }

    if (windowNodeIds.has(nodeId) || node.message == null) {
      keepIds.add(nodeId);
    }
  }

  return keepIds;
}

export function sliceConversationToWindow(
  payload: ConversationPayload,
  pairIndex: SlidingWindowPairIndex,
  range: SlidingWindowRange,
): SlidingWindowSliceResult {
  const normalizedRange = normalizeRange(range, pairIndex.totalPairs);

  try {
    const validation = validateConversationPayload(payload);
    if (!validation.ok) {
      return failedSlice(normalizedRange, `invalid-payload:${validation.issues[0]?.code ?? 'unknown'}`);
    }

    const mapping = payload.mapping;
    if (mapping == null) {
      return failedSlice(normalizedRange, 'missing-mapping');
    }

    const activeChain = resolveSlidingWindowActiveChain(payload);
    const activeNodeIds = pairIndex.activeNodeIds.length > 0 ? pairIndex.activeNodeIds : activeChain.nodeIds;
    if (activeNodeIds.length === 0) {
      return failedSlice(normalizedRange, 'missing-active-chain');
    }

    const totalPairs = pairIndex.pairs.length;
    if (totalPairs === 0) {
      return failedSlice(normalizedRange, 'missing-pairs');
    }

    const windowNodeIds = collectWindowNodeIds(pairIndex, normalizedRange);
    if (windowNodeIds.size === 0) {
      return failedSlice(normalizedRange, 'empty-window');
    }

    const boundary = findWindowBoundaryIndexes(activeNodeIds, windowNodeIds);
    if (boundary == null) {
      return failedSlice(normalizedRange, 'window-not-on-active-chain');
    }

    const keepIds = collectKeepIds({
      activeNodeIds,
      mapping,
      boundary,
      windowNodeIds,
    });
    const orderedKeepIds = activeNodeIds.filter((nodeId) => keepIds.has(nodeId));
    const currentNodeId = findCurrentNodeId(orderedKeepIds, mapping, windowNodeIds);
    if (currentNodeId == null) {
      return failedSlice(normalizedRange, 'missing-window-current-node');
    }

    const syntheticPayload: ConversationPayload = {
      ...payload,
      current_node: currentNodeId,
      mapping: buildSyntheticMapping(mapping, orderedKeepIds),
    };

    const syntheticValidation = validateSyntheticPayload(syntheticPayload);
    if (!syntheticValidation.ok) {
      return failedSlice(
        normalizedRange,
        `invalid-synthetic:${syntheticValidation.issues[0]?.code ?? 'unknown'}`,
        orderedKeepIds.length,
        Object.keys(mapping).length - orderedKeepIds.length,
      );
    }

    const keptNodeCount = orderedKeepIds.length;
    return {
      ok: true,
      payload: syntheticPayload,
      range: normalizedRange,
      reason: null,
      keptNodeCount,
      removedNodeCount: Object.keys(mapping).length - keptNodeCount,
    };
  } catch (error) {
    return failedSlice(
      normalizedRange,
      error instanceof Error ? `exception:${error.message}` : 'exception:unknown',
    );
  }
}
