import type { ManagedHistoryEntry } from '../../shared/types';

import { isTurboRenderUiNode } from '../utils/chatgpt-adapter';
import { buildEntryTextSearchCandidates } from '../utils/turbo-render-controller-utils';

export function normalizeEntryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function doesHostActionButtonMatchEntry(candidate: HTMLElement, entry: ManagedHistoryEntry): boolean {
  if (isTurboRenderUiNode(candidate)) {
    return false;
  }

  const expectedRole =
    entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null;
  const normalizedEntryTexts = buildEntryTextSearchCandidates(entry)
    .map((value) => normalizeEntryText(value))
    .filter((value) => value.length > 0);
  if (normalizedEntryTexts.length === 0) {
    return false;
  }

  const scopes = [
    candidate.closest<HTMLElement>('[data-message-author-role]'),
    candidate.closest<HTMLElement>('[data-testid^="conversation-turn-"]'),
    candidate.closest<HTMLElement>('.agent-turn'),
    candidate.closest<HTMLElement>('article'),
    candidate.parentElement,
  ].filter((value, index, values): value is HTMLElement => value != null && values.indexOf(value) === index);

  for (const scope of scopes) {
    const role = scope.getAttribute('data-message-author-role');
    if (expectedRole != null && role != null && role !== expectedRole) {
      continue;
    }

    const candidateText = normalizeEntryText(scope.textContent ?? '');
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
          (candidateText.startsWith(sharedPrefix) ||
            normalizedEntryText.startsWith(candidateText.slice(0, 48))))
      ) {
        return true;
      }
    }
  }

  return false;
}
