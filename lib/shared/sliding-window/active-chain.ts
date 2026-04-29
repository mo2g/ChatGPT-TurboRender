import {
  buildActiveChain,
  resolveActiveNodeId,
} from '../conversation-trim';
import type {
  ConversationMappingNode,
  ConversationPayload,
  SlidingWindowActiveChain,
} from './types';

export function resolveSlidingWindowActiveChain(payload: ConversationPayload): SlidingWindowActiveChain {
  const mapping = payload.mapping;
  if (mapping == null) {
    return {
      activeNodeId: null,
      nodeIds: [],
      nodes: [],
    };
  }

  const activeNodeId = resolveActiveNodeId(payload);
  const nodeIds = buildActiveChain(mapping, activeNodeId);
  const nodes = nodeIds
    .map((nodeId): ConversationMappingNode | null => mapping[nodeId] ?? null)
    .filter((node): node is ConversationMappingNode => node != null);

  return {
    activeNodeId,
    nodeIds,
    nodes,
  };
}

