import type { TurnRole } from '../types';
import type {
  ConversationMappingNode,
  ConversationPayload,
} from '../conversation-trim';

export type {
  ConversationMappingNode,
  ConversationPayload,
} from '../conversation-trim';

export const SLIDING_WINDOW_SCHEMA_VERSION = 1;

export interface SlidingWindowRange {
  startPairIndex: number;
  endPairIndex: number;
}

export interface SlidingWindowState {
  conversationId: string;
  totalPairs: number;
  pairCount: number;
  range: SlidingWindowRange;
  isLatestWindow: boolean;
  updatedAt: number;
}

export type SlidingWindowRuntimeState = SlidingWindowState & {
  dirty: boolean;
  reason: string | null;
};

export interface SlidingWindowSignature {
  conversationId: string;
  currentNodeId: string | null;
  mappingNodeCount: number;
  updateTime: number | null;
  schemaVersion: number;
}

export interface SlidingWindowActiveChain {
  activeNodeId: string | null;
  nodeIds: string[];
  nodes: ConversationMappingNode[];
}

export interface SlidingWindowPair {
  pairIndex: number;
  userNodeId: string | null;
  relatedNodeIds: string[];
  startNodeId: string;
  endNodeId: string;
  searchText: string;
  userPreview: string;
  assistantPreview: string;
}

export interface SlidingWindowPairIndex {
  activeNodeId: string | null;
  activeNodeIds: string[];
  pairs: SlidingWindowPair[];
  nodeIdToPairIndex: Record<string, number>;
  totalPairs: number;
}

export interface SlidingWindowSearchEntry {
  pairIndex: number;
  searchText: string;
  userPreview: string;
  assistantPreview: string;
}

export interface SlidingWindowSearchMatch {
  pairIndex: number;
  userPreview: string;
  assistantPreview: string;
  excerpt: string;
}

export interface SlidingWindowSliceResult {
  ok: boolean;
  payload: ConversationPayload | null;
  range: SlidingWindowRange;
  reason: string | null;
  keptNodeCount: number;
  removedNodeCount: number;
}

export interface SlidingWindowPairableNode {
  id: string;
  nodeId: string;
  messageId: string | null;
  role: TurnRole;
  turnIndex: number;
  text: string;
  rawText: string;
  hiddenFromConversation: boolean;
  node: ConversationMappingNode;
  payload: ConversationPayload;
}
