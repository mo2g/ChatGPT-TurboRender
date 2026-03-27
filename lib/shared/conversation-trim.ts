import type {
  CachedConversationTurn,
  InitialTrimSession,
  TurnRole,
  TurboRenderMode,
} from './types';

export interface ConversationMessageAuthor {
  role?: string | null;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ConversationMessageContent {
  content_type?: string | null;
  parts?: unknown[];
}

export interface ConversationMessage {
  id?: string | null;
  author?: ConversationMessageAuthor | null;
  create_time?: number | null;
  update_time?: number | null;
  content?: ConversationMessageContent | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
  recipient?: string | null;
  channel?: string | null;
  end_turn?: boolean | null;
  weight?: number | null;
}

export interface ConversationMappingNode {
  id: string;
  message?: ConversationMessage | null;
  parent?: string | null;
  children?: string[];
}

export interface ConversationPayload {
  current_node?: string | null;
  mapping?: Record<string, ConversationMappingNode>;
  [key: string]: unknown;
}

export interface TrimConversationOptions {
  chatId: string;
  conversationId: string | null;
  mode: TurboRenderMode;
  initialHotTurns: number;
  minVisibleTurns: number;
}

export interface TrimConversationResult {
  applied: boolean;
  payload: ConversationPayload;
  session: InitialTrimSession | null;
  coldMapping: Record<string, ConversationMappingNode>;
}

const CONVERSATION_PATH_PATTERN = /\/backend-api\/conversation\/([^/?#]+)/;

function normalizeRole(role: string | null | undefined): TurnRole {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
    return role;
  }
  return 'unknown';
}

function isRenderableNode(node: ConversationMappingNode | undefined): boolean {
  return node?.message != null;
}

function getNodeDepth(
  mapping: Record<string, ConversationMappingNode>,
  nodeId: string,
): number {
  let depth = 0;
  let currentId: string | null | undefined = nodeId;
  const seen = new Set<string>();

  while (currentId != null && !seen.has(currentId)) {
    const node = mapping[currentId];
    if (node == null) {
      break;
    }
    seen.add(currentId);
    currentId = node.parent ?? null;
    depth += 1;
  }

  return depth;
}

function getMessageTimestamp(node: ConversationMappingNode): number {
  return node.message?.create_time ?? node.message?.update_time ?? 0;
}

function getLeafNodeIds(mapping: Record<string, ConversationMappingNode>): string[] {
  return Object.values(mapping)
    .filter((node) => {
      const liveChildren = (node.children ?? []).filter((childId) => mapping[childId] != null);
      return liveChildren.length === 0;
    })
    .map((node) => node.id);
}

export function extractConversationIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, 'https://chatgpt.com');
    return parsed.pathname.match(CONVERSATION_PATH_PATTERN)?.[1] ?? null;
  } catch {
    return url.match(CONVERSATION_PATH_PATTERN)?.[1] ?? null;
  }
}

export function isConversationEndpoint(url: string): boolean {
  return extractConversationIdFromUrl(url) != null;
}

export function resolveActiveNodeId(payload: ConversationPayload): string | null {
  const mapping = payload.mapping;
  if (mapping == null) {
    return null;
  }

  if (payload.current_node != null && mapping[payload.current_node] != null) {
    return payload.current_node;
  }

  const leafIds = getLeafNodeIds(mapping);
  if (leafIds.length === 0) {
    return null;
  }

  return leafIds.sort((left, right) => {
    const leftNode = mapping[left]!;
    const rightNode = mapping[right]!;
    const byTimestamp = getMessageTimestamp(rightNode) - getMessageTimestamp(leftNode);
    if (byTimestamp !== 0) {
      return byTimestamp;
    }

    const byDepth = getNodeDepth(mapping, right) - getNodeDepth(mapping, left);
    if (byDepth !== 0) {
      return byDepth;
    }

    return right.localeCompare(left);
  })[0] ?? null;
}

export function buildActiveChain(
  mapping: Record<string, ConversationMappingNode>,
  activeNodeId: string | null,
): string[] {
  if (activeNodeId == null || mapping[activeNodeId] == null) {
    return [];
  }

  const chain: string[] = [];
  const seen = new Set<string>();
  let currentId: string | null | undefined = activeNodeId;

  while (currentId != null && !seen.has(currentId)) {
    const node = mapping[currentId];
    if (node == null) {
      break;
    }

    chain.push(currentId);
    seen.add(currentId);
    currentId = node.parent ?? null;
  }

  return chain.reverse();
}

function extractMessageParts(message: ConversationMessage | null | undefined): string[] {
  const parts = message?.content?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .map((part) => {
      if (typeof part === 'string') {
        return part.trim();
      }

      if (
        typeof part === 'object' &&
        part !== null &&
        'text' in part &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text.trim();
      }

      try {
        return JSON.stringify(part);
      } catch {
        return '';
      }
    })
    .filter((part) => part.length > 0);
}

function createColdTurn(node: ConversationMappingNode): CachedConversationTurn | null {
  if (node.message == null) {
    return null;
  }

  const role = normalizeRole(node.message.author?.role);
  const parts = extractMessageParts(node.message);
  return {
    id: node.id,
    role,
    parts:
      parts.length > 0
        ? parts
        : [`[${role}] Message available in cold cache but the original content was not plain text.`],
    createTime: node.message.create_time ?? null,
  };
}

function cloneNode(
  node: ConversationMappingNode,
  keepIds: Set<string>,
): ConversationMappingNode {
  return {
    ...node,
    children: (node.children ?? []).filter((childId) => keepIds.has(childId)),
  };
}

export function trimConversationPayload(
  payload: ConversationPayload,
  options: TrimConversationOptions,
): TrimConversationResult {
  const mapping = payload.mapping;
  if (mapping == null || Object.keys(mapping).length === 0) {
    return {
      applied: false,
      payload,
      session: {
        chatId: options.chatId,
        conversationId: options.conversationId,
        applied: false,
        reason: 'missing-mapping',
        mode: options.mode,
        totalMappingNodes: 0,
        totalVisibleTurns: 0,
        activeBranchLength: 0,
        hotVisibleTurns: 0,
        coldVisibleTurns: 0,
        initialHotTurns: options.initialHotTurns,
        activeNodeId: null,
        coldTurns: [],
        capturedAt: Date.now(),
      },
      coldMapping: {},
    };
  }

  const activeNodeId = resolveActiveNodeId(payload);
  const activeChain = buildActiveChain(mapping, activeNodeId);
  const visibleChainIds = activeChain.filter((nodeId) => isRenderableNode(mapping[nodeId]));
  const totalMappingNodes = Object.keys(mapping).length;
  const totalVisibleTurns = visibleChainIds.length;

  const baseSession: InitialTrimSession = {
    chatId: options.chatId,
    conversationId: options.conversationId,
    applied: false,
    reason: null,
    mode: options.mode,
    totalMappingNodes,
    totalVisibleTurns,
    activeBranchLength: activeChain.length,
    hotVisibleTurns: totalVisibleTurns,
    coldVisibleTurns: 0,
    initialHotTurns: options.initialHotTurns,
    activeNodeId,
    coldTurns: [],
    capturedAt: Date.now(),
  };

  if (activeChain.length === 0) {
    return {
      applied: false,
      payload,
      session: {
        ...baseSession,
        reason: 'missing-active-branch',
      },
      coldMapping: {},
    };
  }

  const thresholdReached =
    totalVisibleTurns >= options.minVisibleTurns || totalMappingNodes >= options.minVisibleTurns;
  if (!thresholdReached || totalVisibleTurns <= options.initialHotTurns) {
    return {
      applied: false,
      payload,
      session: {
        ...baseSession,
        reason: thresholdReached ? 'already-hot' : 'below-threshold',
      },
      coldMapping: {},
    };
  }

  const recentVisibleIds = visibleChainIds.slice(-options.initialHotTurns);
  const keepIds = new Set<string>();

  for (const [index, nodeId] of activeChain.entries()) {
    const node = mapping[nodeId];
    if (node == null) {
      continue;
    }

    if (index === 0 || node.message == null) {
      keepIds.add(nodeId);
      continue;
    }

    const role = normalizeRole(node.message.author?.role);
    if (recentVisibleIds.includes(nodeId) || role === 'system' || role === 'tool') {
      keepIds.add(nodeId);
    }
  }

  const coldTurns = activeChain
    .filter((nodeId) => isRenderableNode(mapping[nodeId]) && !keepIds.has(nodeId))
    .map((nodeId) => createColdTurn(mapping[nodeId]!))
    .filter((turn): turn is CachedConversationTurn => turn != null);

  if (coldTurns.length === 0) {
    return {
      applied: false,
      payload,
      session: {
        ...baseSession,
        reason: 'nothing-to-trim',
      },
      coldMapping: {},
    };
  }

  const keptChain = activeChain.filter((nodeId) => keepIds.has(nodeId));
  const trimmedMapping = Object.fromEntries(
    keptChain.map((nodeId, index) => {
      const previousId = keptChain[index - 1] ?? null;
      const nextId = keptChain[index + 1] ?? null;
      return [
        nodeId,
        {
          ...mapping[nodeId]!,
          parent: previousId,
          children: nextId == null ? [] : [nextId],
        },
      ];
    }),
  );

  const coldMapping = Object.fromEntries(
    Object.entries(mapping)
      .filter(([nodeId]) => !keepIds.has(nodeId))
      .map(([nodeId, node]) => [nodeId, cloneNode(node, new Set(Object.keys(mapping)))]),
  );

  const trimmedPayload: ConversationPayload = {
    ...payload,
    current_node: activeNodeId,
    mapping: trimmedMapping,
  };

  return {
    applied: true,
    payload: trimmedPayload,
    session: {
      ...baseSession,
      applied: true,
      reason: 'trimmed',
      hotVisibleTurns: totalVisibleTurns - coldTurns.length,
      coldVisibleTurns: coldTurns.length,
      coldTurns,
    },
    coldMapping,
  };
}
