import type { ManagedHistoryEntry, ManagedHistoryGroup } from '../../shared/types';

import { UI_CLASS_NAMES } from '../../shared/constants';
import { isTurboRenderUiNode } from '../utils/chatgpt-adapter';
import { isSyntheticMessageId } from '../core/managed-history';
import {
  buildEntryTextSearchCandidates,
  collectMessageIds,
  getMessageIdFromElement,
  getMessageIdsFromRoot,
  resolveRealMessageId,
  resolveMessageId,
  resolveSyntheticTurnIndex,
} from '../utils/turbo-render-controller-utils';

type HostMessageRecord = {
  index: number;
  messageId: string | null;
  id: string;
};

type ParkedMessageGroup = {
  messageIds: Array<string | null | undefined>;
  nodes: HTMLElement[];
};

export function findRenderedArchiveMessageIdFromActionAnchor(
  entry: ManagedHistoryEntry,
  actionAnchor: HTMLElement | null,
): string | null {
  const entryFrame =
    actionAnchor?.closest<HTMLElement>(`.${UI_CLASS_NAMES.historyEntryFrame}`) ??
    actionAnchor ??
    null;
  const entryRoot =
    entryFrame ??
    actionAnchor?.closest<HTMLElement>(`.${UI_CLASS_NAMES.inlineBatchEntry}`) ??
    null;
  if (entryRoot == null) {
    return null;
  }

  const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
  const candidates: string[] = getMessageIdsFromRoot(entryRoot);

  if (role != null) {
    const roleSelector = `[data-message-author-role="${role}"][data-host-message-id], [data-message-author-role="${role}"][data-message-id]`;
    candidates.push(...collectMessageIds(entryRoot.querySelectorAll(roleSelector)));
  }

  const messageId = resolveRealMessageId(...candidates);
  if (messageId == null || messageId.length === 0 || isSyntheticMessageId(messageId)) {
    return null;
  }

  return messageId;
}

export function findParkedMessageIdForEntryInGroup(
  entry: ManagedHistoryEntry,
  parkedGroup: ParkedMessageGroup | null,
  archiveGroup: ManagedHistoryGroup | null,
): string | null {
  if (parkedGroup == null || parkedGroup.nodes.length === 0 || archiveGroup == null) {
    return null;
  }

  const entryIndex = archiveGroup.entries.findIndex((candidate) => candidate.id === entry.id);
  if (entryIndex >= 0) {
    const indexedMessageId = parkedGroup.messageIds[entryIndex] ?? null;
    if (indexedMessageId != null && indexedMessageId.length > 0 && !isSyntheticMessageId(indexedMessageId)) {
      return indexedMessageId;
    }
  }

  for (const messageId of parkedGroup.messageIds) {
    if (messageId != null && messageId.length > 0 && !isSyntheticMessageId(messageId)) {
      return messageId;
    }
  }

  const candidates: HTMLElement[] = [];
  if (entryIndex >= 0 && entryIndex < parkedGroup.nodes.length) {
    const indexedCandidate = parkedGroup.nodes[entryIndex];
    if (indexedCandidate != null) {
      candidates.push(indexedCandidate);
    }
  }

  candidates.push(...parkedGroup.nodes);
  for (const candidate of candidates) {
    const messageId = resolveMessageId(candidate);
    if (messageId != null && messageId.length > 0 && !isSyntheticMessageId(messageId)) {
      return messageId;
    }
  }

  return null;
}

export function findHostMessageIdForEntryInScope(input: {
  doc: Document;
  scope: HTMLElement | null;
  entry: ManagedHistoryEntry;
  record: HostMessageRecord | null;
  archiveGroup: ManagedHistoryGroup | null;
  archiveTurnOffset: number;
  normalizeEntryText(text: string): string;
}): string | null {
  const { doc, scope, entry, record, archiveGroup, archiveTurnOffset, normalizeEntryText } = input;
  if (scope == null) {
    return null;
  }

  const targetIndex = record?.index ?? entry.turnIndex;
  const normalizedEntryTexts = buildEntryTextSearchCandidates(entry).map((candidate) => normalizeEntryText(candidate));
  if (normalizedEntryTexts.length === 0) {
    return null;
  }

  const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;

  const setHostReadAloudDebug = (debug: {
  precisePairId?: string | null;
  preciseTargetId?: string | null;
  turnPairId?: string | null;
  turnTargetId?: string | null;
  selectedSource?: string | null;
  selectedId?: string | null;
}): void => {
  const fields: Array<[string, string | null | undefined]> = [
    ['turboRenderDebugReadAloudHostPrecisePairId', debug.precisePairId],
    ['turboRenderDebugReadAloudHostPreciseTargetId', debug.preciseTargetId],
    ['turboRenderDebugReadAloudHostTurnPairId', debug.turnPairId],
    ['turboRenderDebugReadAloudHostTurnTargetId', debug.turnTargetId],
    ['turboRenderDebugReadAloudHostSelectedSource', debug.selectedSource],
    ['turboRenderDebugReadAloudHostSelectedId', debug.selectedId],
  ];

  if (doc.body != null) {
    for (const [key, value] of fields) {
      doc.body.dataset[key] = value ?? '';
    }
  }
  if (doc.documentElement != null) {
    for (const [key, value] of fields) {
      doc.documentElement.dataset[key] = value ?? '';
    }
  }
};

// Strategy-based resolvers for finding message IDs
type ResolveContext = {
  scope: HTMLElement;
  entry: ManagedHistoryEntry;
  targetIndex: number;
  role: 'user' | 'assistant' | null;
  normalizedEntryTexts: string[];
  archiveTurnOffset: number;
  archiveGroup: ManagedHistoryGroup | null;
};

type MessageIdResolver = (ctx: ResolveContext) => string | null;

const getCandidateMessageId = (candidate: HTMLElement | null, preferDescendants = false): string | null => {
  if (candidate == null || isTurboRenderUiNode(candidate)) return null;

  const selector = '[data-message-author-role][data-host-message-id], [data-message-author-role][data-message-id]';
  const descendantIds = collectMessageIds(candidate.querySelectorAll(selector)).filter((id) => !isSyntheticMessageId(id));
  const directId = getMessageIdFromElement(candidate);

  if (!preferDescendants && directId && !isSyntheticMessageId(directId)) return directId;
  if (descendantIds.length > 0) return descendantIds[0]!;
  if (preferDescendants && directId && !isSyntheticMessageId(directId)) return directId;

  return resolveRealMessageId(resolveMessageId(candidate));
};

const matchesEntryText = (candidateText: string, entryTexts: string[]): boolean => {
  if (candidateText.length === 0 || entryTexts.length === 0) return false;
  for (const entryText of entryTexts) {
    if (candidateText === entryText) return true;
    if (candidateText.includes(entryText)) return true;
    if (entryText.includes(candidateText)) return true;
    const prefix = entryText.slice(0, 48);
    if (prefix.length > 0 && (candidateText.startsWith(prefix) || entryText.startsWith(candidateText.slice(0, 48)))) return true;
  }
  return false;
};

const resolveBySyntheticIndex: MessageIdResolver = (ctx) => {
  const { entry, archiveTurnOffset, archiveGroup, scope } = ctx;
  const syntheticIndex = resolveSyntheticTurnIndex(entry.messageId, entry.turnId, null, null);
  if (syntheticIndex == null) return null;

  const offset = archiveTurnOffset + (archiveGroup ? archiveGroup.pairStartIndex * 2 + syntheticIndex : syntheticIndex);
  const candidates = [...scope.querySelectorAll<HTMLElement>(
    '[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn, article'
  )].filter((c) => !isTurboRenderUiNode(c));

  return getCandidateMessageId(candidates[offset] ?? null, true);
};

const resolveByPairIndex: MessageIdResolver = (ctx) => {
  const { scope, entry, role } = ctx;
  const selector = 'div.text-message, article';
  const candidates = [...scope.querySelectorAll<HTMLElement>(selector)].filter((c) => !isTurboRenderUiNode(c));
  const roleCandidates = role ? candidates.filter((c) => c.getAttribute('data-message-author-role') === role) : candidates;

  return getCandidateMessageId(roleCandidates[entry.pairIndex] ?? null, false);
};

const resolveByTargetIndex: MessageIdResolver = (ctx) => {
  const { scope, role, targetIndex } = ctx;
  const selector = 'div.text-message, article';
  const candidates = [...scope.querySelectorAll<HTMLElement>(selector)].filter((c) => !isTurboRenderUiNode(c));
  const roleCandidates = role ? candidates.filter((c) => c.getAttribute('data-message-author-role') === role) : candidates;

  return getCandidateMessageId(roleCandidates[targetIndex] ?? null, false);
};

const resolveByTextContent: MessageIdResolver = (ctx) => {
  const { scope, role, normalizedEntryTexts } = ctx;
  const selector = '[data-message-author-role]';
  const candidates = [...scope.querySelectorAll<HTMLElement>(selector)].filter((c) => !isTurboRenderUiNode(c));
  const roleCandidates = role ? candidates.filter((c) => c.getAttribute('data-message-author-role') === role) : candidates;

  for (const candidate of roleCandidates) {
    const text = normalizeEntryText(candidate.textContent ?? '');
    if (matchesEntryText(text, normalizedEntryTexts)) {
      const id = getCandidateMessageId(candidate, true);
      if (id) return id;
    }
  }
  return null;
};

// Execute resolvers in priority order
const ctx: ResolveContext = { scope, entry, targetIndex, role, normalizedEntryTexts, archiveTurnOffset, archiveGroup };
const resolvers: MessageIdResolver[] = [
  resolveBySyntheticIndex,
  resolveByPairIndex,
  resolveByTargetIndex,
  resolveByTextContent,
];

for (const resolve of resolvers) {
  const id = resolve(ctx);
  if (id && !isSyntheticMessageId(id)) {
    setHostReadAloudDebug({ selectedId: id, selectedSource: resolve.name });
    return id;
  }
}

setHostReadAloudDebug({});
return null;
}
