import type { ManagedHistoryEntry, ManagedHistoryGroup } from '../shared/types';

import { UI_CLASS_NAMES } from '../shared/constants';
import { isTurboRenderUiNode } from './chatgpt-adapter';
import { isSyntheticMessageId } from './managed-history';
import {
  buildEntryTextSearchCandidates,
  resolveRealMessageId,
  resolveMessageId,
  resolveSyntheticTurnIndex,
} from './turbo-render-controller-utils';

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

  const candidates: string[] = [];
  const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
  if (role != null) {
    for (const descendant of entryRoot.querySelectorAll<HTMLElement>(
      `[data-message-author-role="${role}"][data-host-message-id], [data-message-author-role="${role}"][data-message-id]`,
    )) {
      const messageId =
        descendant.getAttribute('data-host-message-id')?.trim() ??
        descendant.getAttribute('data-message-id')?.trim();
      if (messageId != null && messageId.length > 0) {
        candidates.push(messageId);
      }
    }
  }

  const direct = entryRoot.getAttribute('data-host-message-id')?.trim() ?? entryRoot.getAttribute('data-message-id')?.trim();
  if (direct != null && direct.length > 0) {
    candidates.push(direct);
  }

  for (const descendant of entryRoot.querySelectorAll<HTMLElement>('[data-host-message-id], [data-message-id]')) {
    const messageId =
      descendant.getAttribute('data-host-message-id')?.trim() ??
      descendant.getAttribute('data-message-id')?.trim();
    if (messageId != null && messageId.length > 0) {
      candidates.push(messageId);
    }
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
  const syntheticTurnIndex = resolveSyntheticTurnIndex(
    entry.messageId,
    entry.turnId,
    record?.messageId,
    record?.id,
  );
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

const getCandidateMessageId = (candidate: HTMLElement | null, preferDescendants = false): string | null => {
  if (candidate == null || isTurboRenderUiNode(candidate)) {
    return null;
  }

  const descendantMessageIds = [...candidate.querySelectorAll<HTMLElement>(
    'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id], article[data-message-author-role][data-host-message-id], article[data-message-author-role][data-message-id]',
  )]
    .map((descendant) =>
      descendant.getAttribute('data-host-message-id')?.trim() ??
      descendant.getAttribute('data-message-id')?.trim() ??
      '',
    )
    .filter((messageId) => messageId.length > 0 && !isSyntheticMessageId(messageId));
  const directMessageId = candidate.getAttribute('data-host-message-id')?.trim() ?? candidate.getAttribute('data-message-id')?.trim() ?? '';

  if (preferDescendants) {
    if (descendantMessageIds.length > 0) {
      return descendantMessageIds[0]!;
    }
    if (directMessageId.length > 0 && !isSyntheticMessageId(directMessageId)) {
      return directMessageId;
    }
  } else {
    if (directMessageId.length > 0 && !isSyntheticMessageId(directMessageId)) {
      return directMessageId;
    }
    if (descendantMessageIds.length > 0) {
      return descendantMessageIds[0]!;
    }
  }

  const resolvedMessageId = resolveMessageId(candidate);
  if (resolvedMessageId != null && resolvedMessageId.length > 0 && !isSyntheticMessageId(resolvedMessageId)) {
    return resolvedMessageId;
  }

  return null;
};

if (syntheticTurnIndex != null) {
  const syntheticTurnOffset =
    archiveTurnOffset + (archiveGroup != null ? archiveGroup.pairStartIndex * 2 + syntheticTurnIndex : syntheticTurnIndex);
  const directTurnCandidates = [...scope.querySelectorAll<HTMLElement>(
    '[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn, article',
  )].filter((candidate) => !isTurboRenderUiNode(candidate));
  const indexedCandidate = directTurnCandidates[syntheticTurnOffset] ?? null;
  const indexedMessageId = getCandidateMessageId(indexedCandidate, true);
  if (indexedMessageId != null) {
    setHostReadAloudDebug({
      turnTargetId: indexedMessageId,
      selectedSource: 'turn-index',
      selectedId: indexedMessageId,
    });
    return indexedMessageId;
  }

  const directTextMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
    'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id]',
  )].filter((candidate) => !isTurboRenderUiNode(candidate));
  const indexedTextCandidate = directTextMessageCandidates[syntheticTurnOffset] ?? null;
  const indexedTextMessageId = getCandidateMessageId(indexedTextCandidate, true);
  if (indexedTextMessageId != null) {
    setHostReadAloudDebug({
      turnTargetId: indexedTextMessageId,
      selectedSource: 'turn-index-text',
      selectedId: indexedTextMessageId,
    });
    return indexedTextMessageId;
  }
}

const textMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
  'div.text-message[data-message-author-role][data-host-message-id], div.text-message[data-message-author-role][data-message-id]',
)].filter((candidate) => !isTurboRenderUiNode(candidate));
const articleMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
  'article[data-message-author-role][data-host-message-id], article[data-message-author-role][data-message-id]',
)].filter((candidate) => !isTurboRenderUiNode(candidate));
const genericMessageCandidates = [...scope.querySelectorAll<HTMLElement>(
  '[data-message-author-role][data-host-message-id], [data-message-author-role][data-message-id]',
)].filter((candidate) => !isTurboRenderUiNode(candidate));

const preciseCandidateGroups = [
  textMessageCandidates,
  articleMessageCandidates,
  genericMessageCandidates,
];

for (const candidates of preciseCandidateGroups) {
  const roleSpecificPreciseCandidates =
    role == null
      ? candidates
      : candidates.filter((candidate) => candidate.getAttribute('data-message-author-role') === role);

  const precisePairCandidate = roleSpecificPreciseCandidates[entry.pairIndex] ?? null;
  const precisePairMessageId = getCandidateMessageId(precisePairCandidate);
  if (precisePairMessageId != null) {
    setHostReadAloudDebug({
      precisePairId: precisePairMessageId,
      selectedSource: 'precise-pair',
      selectedId: precisePairMessageId,
    });
    return precisePairMessageId;
  }

  const preciseIndexedCandidate = roleSpecificPreciseCandidates[targetIndex] ?? null;
  const preciseIndexedMessageId = getCandidateMessageId(preciseIndexedCandidate);
  if (preciseIndexedMessageId != null) {
    setHostReadAloudDebug({
      preciseTargetId: preciseIndexedMessageId,
      selectedSource: 'precise-target',
      selectedId: preciseIndexedMessageId,
    });
    return preciseIndexedMessageId;
  }

  for (const candidate of roleSpecificPreciseCandidates) {
    const candidateText = normalizeEntryText(candidate.textContent ?? '');
    if (candidateText.length === 0) {
      continue;
    }

    for (const normalizedEntryText of normalizedEntryTexts) {
      const sharedPrefix = normalizedEntryText.slice(0, 48);
    if (
      candidateText === normalizedEntryText ||
      candidateText.includes(normalizedEntryText) ||
      normalizedEntryText.includes(candidateText) ||
      (sharedPrefix.length > 0 &&
        (candidateText.startsWith(sharedPrefix) || normalizedEntryText.startsWith(candidateText.slice(0, 48))))
    ) {
      const messageId = getCandidateMessageId(candidate);
      if (messageId != null) {
        setHostReadAloudDebug({
          selectedSource: 'precise-text',
          selectedId: messageId,
        });
        return messageId;
      }
    }
  }
  }
}

const turnCandidates = [...scope.querySelectorAll<HTMLElement>(
  '[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn, article',
)].filter((candidate) => !isTurboRenderUiNode(candidate));

const roleSpecificTurnCandidates =
  role == null
    ? turnCandidates
    : turnCandidates.filter((candidate) => candidate.getAttribute('data-message-author-role') === role);

const directTurnCandidate = role != null ? roleSpecificTurnCandidates[entry.pairIndex] ?? null : null;
const directTurnMessageId = getCandidateMessageId(directTurnCandidate, true);
if (directTurnMessageId != null) {
  setHostReadAloudDebug({
    turnPairId: directTurnMessageId,
    selectedSource: 'turn-pair',
    selectedId: directTurnMessageId,
  });
  return directTurnMessageId;
}

const turnIndexedCandidate = roleSpecificTurnCandidates[targetIndex] ?? null;
const turnIndexedMessageId = getCandidateMessageId(turnIndexedCandidate, true);
if (turnIndexedMessageId != null) {
  setHostReadAloudDebug({
    turnTargetId: turnIndexedMessageId,
    selectedSource: 'turn-target',
    selectedId: turnIndexedMessageId,
  });
  return turnIndexedMessageId;
}

for (const candidate of roleSpecificTurnCandidates) {
  const candidateText = normalizeEntryText(candidate.textContent ?? '');
  if (candidateText.length === 0) {
    continue;
  }

  for (const normalizedEntryText of normalizedEntryTexts) {
    const sharedPrefix = normalizedEntryText.slice(0, 48);
    if (
      candidateText === normalizedEntryText ||
      candidateText.includes(normalizedEntryText) ||
      normalizedEntryText.includes(candidateText) ||
      (sharedPrefix.length > 0 &&
        (candidateText.startsWith(sharedPrefix) || normalizedEntryText.startsWith(candidateText.slice(0, 48))))
    ) {
      const messageId = getCandidateMessageId(candidate, true);
      if (messageId != null) {
        setHostReadAloudDebug({
          selectedSource: 'turn-text',
          selectedId: messageId,
        });
        return messageId;
      }
    }
  }
}

setHostReadAloudDebug({});
return null;
}
