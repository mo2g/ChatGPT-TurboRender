import { buildInteractionPairs } from '../interaction-pairs';
import type { TurnRole } from '../types';
import type {
  ConversationMappingNode,
  ConversationMessage,
  ConversationPayload,
} from '../conversation-trim';
import type {
  SlidingWindowPair,
  SlidingWindowPairIndex,
  SlidingWindowPairableNode,
} from './types';
import { resolveSlidingWindowActiveChain } from './active-chain';

function normalizeRole(role: string | null | undefined): TurnRole {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
    return role;
  }

  return 'unknown';
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractMessageText(message: ConversationMessage | null | undefined): string {
  const fragments: string[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5 || value == null) {
      return;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        fragments.push(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      visit(record.text, depth + 1);
    }
    if (Array.isArray(record.parts)) {
      visit(record.parts, depth + 1);
    }
    if (Array.isArray(record.content)) {
      visit(record.content, depth + 1);
    }
    if (typeof record.title === 'string') {
      visit(record.title, depth + 1);
    }
  };

  visit(message?.content?.parts ?? []);
  return fragments.join('\n').trim();
}

function isHiddenFromConversation(node: ConversationMappingNode): boolean {
  return node.message?.metadata?.is_visually_hidden_from_conversation === true;
}

function isThinkingMessage(message: ConversationMessage | null | undefined): boolean {
  const contentType = message?.content?.content_type;
  return contentType === 'thinking' || contentType === 'thoughts';
}

function getSearchableText(role: TurnRole, node: ConversationMappingNode, rawText: string): string {
  if (isHiddenFromConversation(node) || rawText.length === 0) {
    return '';
  }

  if (role === 'user') {
    return rawText;
  }

  if (role === 'assistant' && !isThinkingMessage(node.message)) {
    return rawText;
  }

  return '';
}

function toPairableNode(
  payload: ConversationPayload,
  node: ConversationMappingNode,
  turnIndex: number,
): SlidingWindowPairableNode | null {
  const message = node.message ?? null;
  if (message == null) {
    return null;
  }

  const role = normalizeRole(message.author?.role);
  const rawText = extractMessageText(message);
  const text = getSearchableText(role, node, rawText);

  return {
    id: node.id,
    nodeId: node.id,
    messageId: message.id?.trim() || null,
    role,
    turnIndex,
    text,
    rawText,
    hiddenFromConversation: isHiddenFromConversation(node),
    node,
    payload,
  };
}

function uniqueNodeIds(entries: SlidingWindowPairableNode[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.nodeId)) {
      continue;
    }
    seen.add(entry.nodeId);
    output.push(entry.nodeId);
  }
  return output;
}

function createSearchText(entries: SlidingWindowPairableNode[]): string {
  return normalizeText(
    entries
      .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .map((entry) => entry.text)
      .filter((text) => text.length > 0)
      .join('\n'),
  );
}

function toSlidingWindowPair(pair: ReturnType<typeof buildInteractionPairs<SlidingWindowPairableNode>>[number]): SlidingWindowPair {
  const relatedNodeIds = uniqueNodeIds(pair.entries);
  return {
    pairIndex: pair.pairIndex,
    userNodeId: pair.entries.find((entry) => entry.role === 'user')?.nodeId ?? null,
    relatedNodeIds,
    startNodeId: pair.entries[0]?.nodeId ?? '',
    endNodeId: pair.entries.at(-1)?.nodeId ?? '',
    searchText: createSearchText(pair.entries),
    userPreview: pair.userPreview,
    assistantPreview: pair.assistantPreview,
  };
}

export function buildSlidingWindowPairIndex(payload: ConversationPayload): SlidingWindowPairIndex {
  const activeChain = resolveSlidingWindowActiveChain(payload);
  const entries = activeChain.nodes
    .map((node, index) => toPairableNode(payload, node, index))
    .filter((entry): entry is SlidingWindowPairableNode => entry != null);

  const pairs = buildInteractionPairs(entries).map(toSlidingWindowPair);
  const nodeIdToPairIndex: Record<string, number> = {};
  for (const pair of pairs) {
    for (const nodeId of pair.relatedNodeIds) {
      nodeIdToPairIndex[nodeId] = pair.pairIndex;
    }
  }

  return {
    activeNodeId: activeChain.activeNodeId,
    activeNodeIds: activeChain.nodeIds,
    pairs,
    nodeIdToPairIndex,
    totalPairs: pairs.length,
  };
}
