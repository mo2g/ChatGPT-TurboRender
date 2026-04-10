import type {
  CachedConversationTurn,
  ConversationRouteKind,
  InitialTrimSession,
  ManagedHistoryRenderKind,
  TurnRole,
  TurboRenderMode,
} from './types';
import { buildInteractionPairs } from './interaction-pairs';

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

export interface ReadAloudMessageResolutionContext {
  entryRole: TurnRole | null;
  entryText: string | null;
  entryMessageId?: string | null;
  syntheticMessageId?: string | null;
}

export interface ShareLoaderDataPayload {
  sharedConversationId?: string | null;
  serverResponse?: {
    type?: string | null;
    data?: ConversationPayload | null;
  } | null;
}

export interface TrimConversationOptions {
  chatId: string;
  routeKind: ConversationRouteKind;
  routeId: string | null;
  conversationId: string | null;
  mode: TurboRenderMode;
  initialHotPairs: number;
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

export function extractShareConversationPayload(source: unknown): {
  shareId: string | null;
  payload: ConversationPayload | null;
} {
  if (typeof source !== 'object' || source == null) {
    return { shareId: null, payload: null };
  }

  const record = source as ShareLoaderDataPayload;
  const payload =
    typeof record.serverResponse === 'object' &&
    record.serverResponse != null &&
    typeof record.serverResponse.data === 'object' &&
    record.serverResponse.data != null
      ? (record.serverResponse.data as ConversationPayload)
      : null;

  return {
    shareId: record.sharedConversationId ?? null,
    payload,
  };
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

function normalizeConversationText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolveSyntheticTurnIndex(...candidates: Array<string | null | undefined>): number | null {
  for (const candidate of candidates) {
    const messageId = candidate?.trim() ?? '';
    if (messageId.length === 0 || !messageId.startsWith('turn-')) {
      continue;
    }

    const syntheticBody = messageId.slice('turn-'.length);
    const syntheticParts = syntheticBody.split('-');
    if (syntheticParts.length < 3) {
      continue;
    }

    const turnIndexText = syntheticParts.at(-2) ?? '';
    if (!/^\d+$/.test(turnIndexText)) {
      continue;
    }

    const turnIndex = Number.parseInt(turnIndexText, 10);
    if (Number.isSafeInteger(turnIndex) && turnIndex >= 0) {
      return turnIndex;
    }
  }

  return null;
}

function extractConversationMessageText(message: ConversationMessage | null | undefined): string {
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
      value.forEach((part) => visit(part, depth + 1));
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

function collectConversationMessageCandidates(payload: ConversationPayload): Array<{
  id: string;
  role: TurnRole;
  text: string;
  normalizedText: string;
}> {
  const mapping = payload.mapping;
  if (mapping == null) {
    return [];
  }

  const activeNodeId = resolveActiveNodeId(payload);
  const orderedNodeIds = buildActiveChain(mapping, activeNodeId);
  const sourceIds = orderedNodeIds.length > 0 ? orderedNodeIds : Object.keys(mapping);
  const candidates: Array<{
    id: string;
    role: TurnRole;
    text: string;
    normalizedText: string;
  }> = [];
  const seen = new Set<string>();

  for (const nodeId of sourceIds) {
    if (seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);

    const node = mapping[nodeId];
    const message = node?.message ?? null;
    if (message == null) {
      continue;
    }

    const role =
      message.author?.role === 'user' ||
      message.author?.role === 'assistant' ||
      message.author?.role === 'system' ||
      message.author?.role === 'tool'
        ? message.author.role
        : 'unknown';
    const text = extractConversationMessageText(message);
    const normalizedText = normalizeConversationText(text);
    if (text.length === 0) {
      continue;
    }

    candidates.push({
      id: message.id?.trim() || node.id,
      role,
      text,
      normalizedText,
    });
  }

  return candidates;
}

export function resolveReadAloudMessageIdFromPayload(
  payload: ConversationPayload | null | undefined,
  context: ReadAloudMessageResolutionContext,
): string | null {
  if (payload == null) {
    return null;
  }

  const candidates = collectConversationMessageCandidates(payload);
  if (candidates.length === 0) {
    return null;
  }

  const directEntryMessageId = context.entryMessageId?.trim() ?? '';
  if (directEntryMessageId.length > 0) {
    const exactMatch = candidates.find((candidate) => candidate.id === directEntryMessageId);
    if (exactMatch != null) {
      return exactMatch.id;
    }
  }

  const syntheticTurnIndex = resolveSyntheticTurnIndex(context.syntheticMessageId);
  const requestedText = normalizeConversationText(context.entryText ?? '');
  const roleCandidates =
    context.entryRole == null ? candidates : candidates.filter((candidate) => candidate.role === context.entryRole);

  const tryCandidatesByText = (
    pool: typeof candidates,
    normalizedQuery: string,
  ): string | null => {
    if (normalizedQuery.length === 0) {
      return null;
    }

    const exact = pool.filter((candidate) => candidate.normalizedText === normalizedQuery);
    if (exact.length === 1) {
      return exact[0]!.id;
    }
    if (exact.length > 1 && syntheticTurnIndex != null) {
      return exact[Math.min(syntheticTurnIndex, exact.length - 1)]?.id ?? null;
    }

    const contains = pool.find((candidate) => {
      return (
        candidate.normalizedText.includes(normalizedQuery) ||
        normalizedQuery.includes(candidate.normalizedText)
      );
    });
    return contains?.id ?? null;
  };

  const exactRoleMatch = tryCandidatesByText(roleCandidates, requestedText);
  if (exactRoleMatch != null) {
    return exactRoleMatch;
  }

  const exactAnyMatch = tryCandidatesByText(candidates, requestedText);
  if (exactAnyMatch != null) {
    return exactAnyMatch;
  }

  if (syntheticTurnIndex != null) {
    const indexedRoleCandidate = roleCandidates[syntheticTurnIndex] ?? null;
    if (indexedRoleCandidate != null) {
      return indexedRoleCandidate.id;
    }

    const indexedCandidate = candidates[syntheticTurnIndex] ?? null;
    if (indexedCandidate != null) {
      return indexedCandidate.id;
    }
  }

  return null;
}

function extractMessageParts(message: ConversationMessage | null | undefined): string[] {
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
      value.forEach((part) => visit(part, depth + 1));
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
  return fragments;
}

function stringifyStructuredPayload(message: ConversationMessage | null | undefined): string | null {
  if (message?.content == null && message?.metadata == null) {
    return null;
  }

  try {
    return JSON.stringify(
      {
        content: message?.content ?? null,
        metadata: message?.metadata ?? null,
      },
      null,
      2,
    );
  } catch {
    return null;
  }
}

function isStructuredRole(role: TurnRole): boolean {
  return role === 'system' || role === 'tool';
}

function isHiddenFromConversation(message: ConversationMessage | null | undefined): boolean {
  return message?.metadata?.is_visually_hidden_from_conversation === true;
}

function createUnsupportedContentPlaceholder(role: TurnRole, contentType: string | null): string {
  const typeLabel = contentType?.trim() || 'unknown';
  return `[${role}] Unsupported ${typeLabel} message`;
}

function createCachedTurnContent(message: ConversationMessage | null | undefined): Pick<
  CachedConversationTurn,
  'parts' | 'renderKind' | 'contentType' | 'snapshotHtml' | 'structuredDetails' | 'hiddenFromConversation'
> {
  const role = normalizeRole(message?.author?.role);
  const hiddenFromConversation = isHiddenFromConversation(message);
  const parts = extractMessageParts(message);
  const contentType = message?.content?.content_type ?? null;
  const structuredDetails = hiddenFromConversation ? null : stringifyStructuredPayload(message);
  const hasText = parts.length > 0;
  const renderKind: ManagedHistoryRenderKind =
    isStructuredRole(role) || (!hasText && structuredDetails != null)
      ? 'structured-message'
      : 'markdown-text';

  return {
    parts:
      hiddenFromConversation
        ? []
        : hasText
          ? parts
          : renderKind === 'structured-message'
            ? []
            : [createUnsupportedContentPlaceholder(role, contentType)],
    renderKind,
    contentType,
    snapshotHtml: null,
    structuredDetails: renderKind === 'structured-message' ? structuredDetails : null,
    hiddenFromConversation,
  };
}

function createCachedTurn(node: ConversationMappingNode): CachedConversationTurn | null {
  if (node.message == null) {
    return null;
  }

  const role = normalizeRole(node.message.author?.role);
  const content = createCachedTurnContent(node.message);
  return {
    id: node.id,
    role,
    parts: content.parts,
    renderKind: content.renderKind,
    contentType: content.contentType,
    snapshotHtml: content.snapshotHtml,
    structuredDetails: content.structuredDetails,
    hiddenFromConversation: content.hiddenFromConversation,
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
        routeKind: options.routeKind,
        routeId: options.routeId,
        conversationId: options.conversationId,
        applied: false,
        reason: 'missing-mapping',
        mode: options.mode,
        totalMappingNodes: 0,
        totalVisibleTurns: 0,
        activeBranchLength: 0,
        hotVisibleTurns: 0,
        coldVisibleTurns: 0,
        initialHotPairs: options.initialHotPairs,
        hotPairCount: 0,
        archivedPairCount: 0,
        initialHotTurns: options.initialHotPairs * 2,
        hotStartIndex: 0,
        hotTurnCount: 0,
        archivedTurnCount: 0,
        activeNodeId: null,
        turns: [],
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
    routeKind: options.routeKind,
    routeId: options.routeId,
    conversationId: options.conversationId,
    applied: false,
    reason: null,
    mode: options.mode,
    totalMappingNodes,
    totalVisibleTurns,
    activeBranchLength: activeChain.length,
    hotVisibleTurns: totalVisibleTurns,
    coldVisibleTurns: 0,
    initialHotPairs: options.initialHotPairs,
    hotPairCount: 0,
    archivedPairCount: 0,
    initialHotTurns: options.initialHotPairs * 2,
    hotStartIndex: 0,
    hotTurnCount: totalVisibleTurns,
    archivedTurnCount: 0,
    activeNodeId,
    turns: [],
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

  const turns = visibleChainIds
    .map((nodeId) => createCachedTurn(mapping[nodeId]!))
    .filter((turn): turn is CachedConversationTurn => turn != null);
  baseSession.turns = turns;
  const pairs = buildInteractionPairs(
    turns.map((turn, index) => ({
      ...turn,
      turnIndex: index,
      text: turn.parts.join('\n'),
    })),
  );
  const totalVisiblePairs = pairs.length;

  const thresholdReached =
    totalVisibleTurns >= options.minVisibleTurns || totalMappingNodes >= options.minVisibleTurns;
  if (!thresholdReached || totalVisiblePairs <= options.initialHotPairs) {
    return {
      applied: false,
      payload,
      session: {
        ...baseSession,
        hotPairCount: totalVisiblePairs,
        reason: thresholdReached ? 'already-hot' : 'below-threshold',
      },
      coldMapping: {},
    };
  }

  const hotPairs = pairs.slice(-options.initialHotPairs);
  const recentVisibleIds = new Set(hotPairs.flatMap((pair) => pair.entries.map((entry) => visibleChainIds[entry.turnIndex]!)));
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

    if (recentVisibleIds.has(nodeId)) {
      keepIds.add(nodeId);
    }
  }

  const coldTurns = activeChain
    .filter((nodeId) => isRenderableNode(mapping[nodeId]) && !keepIds.has(nodeId))
    .map((nodeId) => createCachedTurn(mapping[nodeId]!))
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
      hotPairCount: hotPairs.length,
      archivedPairCount: totalVisiblePairs - hotPairs.length,
      hotVisibleTurns: totalVisibleTurns - coldTurns.length,
      coldVisibleTurns: coldTurns.length,
      hotStartIndex: coldTurns.length,
      hotTurnCount: totalVisibleTurns - coldTurns.length,
      archivedTurnCount: coldTurns.length,
      turns,
      coldTurns,
    },
    coldMapping,
  };
}
