import type {
  ConversationMappingNode,
  ConversationPayload,
  SlidingWindowSignature,
} from './types';
import { SLIDING_WINDOW_SCHEMA_VERSION } from './types';

function getNodeUpdateTime(node: ConversationMappingNode): number | null {
  const updateTime = node.message?.update_time;
  if (typeof updateTime === 'number' && Number.isFinite(updateTime)) {
    return updateTime;
  }

  const createTime = node.message?.create_time;
  if (typeof createTime === 'number' && Number.isFinite(createTime)) {
    return createTime;
  }

  return null;
}

export function createSlidingWindowSignature(
  payload: ConversationPayload,
  conversationId: string,
  schemaVersion = SLIDING_WINDOW_SCHEMA_VERSION,
): SlidingWindowSignature {
  const mapping = payload.mapping ?? {};
  const updateTimes = Object.values(mapping)
    .map(getNodeUpdateTime)
    .filter((value): value is number => value != null);

  return {
    conversationId,
    currentNodeId: typeof payload.current_node === 'string' ? payload.current_node : null,
    mappingNodeCount: Object.keys(mapping).length,
    updateTime: updateTimes.length > 0 ? Math.max(...updateTimes) : null,
    schemaVersion,
  };
}

export function serializeSlidingWindowSignature(signature: SlidingWindowSignature): string {
  return [
    signature.schemaVersion,
    signature.conversationId,
    signature.currentNodeId ?? '',
    signature.mappingNodeCount,
    signature.updateTime ?? '',
  ].join(':');
}
