import type { ManagedHistoryEntry, Settings, TurnRole } from '../../shared/types';

import { isTurnNode, isTurboRenderUiNode } from './chatgpt-adapter';
import { resolveArchiveCopyText, type ArchiveEntryAction } from '../core/message-actions';
import { isSyntheticMessageId, resolvePreferredMessageId } from '../core/managed-history';

export function requestAnimationFrameCompat(win: Window, callback: FrameRequestCallback): number {
  return win.requestAnimationFrame?.(callback) ?? win.setTimeout(() => callback(win.performance.now()), 16);
}

export function cancelAnimationFrameCompat(win: Window, handle: number): void {
  if (win.cancelAnimationFrame != null) {
    win.cancelAnimationFrame(handle);
  } else {
    win.clearTimeout(handle);
  }
}

export function requestIdleCallbackCompat(win: Window, callback: IdleRequestCallback): number {
  return (
    win.requestIdleCallback?.(callback, { timeout: 250 }) ??
    win.setTimeout(
      () =>
        callback({
          didTimeout: false,
          timeRemaining: () => 0,
        }),
      16,
    )
  );
}

export function cancelIdleCallbackCompat(win: Window, handle: number): void {
  if (win.cancelIdleCallback != null) {
    win.cancelIdleCallback(handle);
  } else {
    win.clearTimeout(handle);
  }
}

const DESCENDANT_COUNT_CAP = 4_000;
export function countLiveDescendants(root: ParentNode | null): number {
  if (root == null || !('ownerDocument' in root)) {
    return 0;
  }

  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc == null) {
    return 0;
  }

  const showElement = doc.defaultView?.NodeFilter?.SHOW_ELEMENT ?? 1;
  const walker = doc.createTreeWalker(root, showElement);
  let count = 0;
  while (walker.nextNode()) {
    count += 1;
    if (count >= DESCENDANT_COUNT_CAP) {
      return DESCENDANT_COUNT_CAP;
    }
  }
  return count;
}

export function toSet(values: string[]): Set<string> {
  return new Set(values);
}

export function areSettingsEquivalent(left: Settings, right: Settings): boolean {
  return (
    left.enabled === right.enabled &&
    left.autoEnable === right.autoEnable &&
    left.language === right.language &&
    left.mode === right.mode &&
    left.minFinalizedBlocks === right.minFinalizedBlocks &&
    left.minDescendants === right.minDescendants &&
    left.keepRecentPairs === right.keepRecentPairs &&
    left.batchPairCount === right.batchPairCount &&
    left.slidingWindowPairs === right.slidingWindowPairs &&
    left.initialHotPairs === right.initialHotPairs &&
    left.liveHotPairs === right.liveHotPairs &&
    left.keepRecentTurns === right.keepRecentTurns &&
    left.viewportBufferTurns === right.viewportBufferTurns &&
    left.groupSize === right.groupSize &&
    left.initialTrimEnabled === right.initialTrimEnabled &&
    left.initialHotTurns === right.initialHotTurns &&
    left.liveHotTurns === right.liveHotTurns &&
    left.softFallback === right.softFallback &&
    left.frameSpikeThresholdMs === right.frameSpikeThresholdMs &&
    left.frameSpikeCount === right.frameSpikeCount &&
    left.frameSpikeWindowMs === right.frameSpikeWindowMs
  );
}

const HOST_ACTION_LABEL_PATTERNS: Record<ArchiveEntryAction, RegExp[]> = {
  copy: [/^copy\b/i, /\bcopy\b/i, /复制/],
  like: [/^like\b/i, /\blike\b/i, /thumbs?\s*up/i, /upvote/i, /喜欢/, /赞/],
  dislike: [/^dislike\b/i, /\bdislike\b/i, /thumbs?\s*down/i, /downvote/i, /不喜欢/, /踩/],
  share: [/^share\b/i, /\bshare\b/i, /分享/],
  more: [
    /^more\b/i,
    /\bmore\s+actions?\b/i,
    /\bmore\s+options?\b/i,
    /\boptions?\b/i,
    /\bmenu\b/i,
    /更多操作/,
    /更多/,
    /⋯/,
    /…/,
  ],
};

const HOST_ACTION_TESTID_PATTERNS: Record<ArchiveEntryAction, RegExp[]> = {
  copy: [/^copy-turn-action-button$/i],
  like: [/^good-response-turn-action-button$/i, /^like-turn-action-button$/i],
  dislike: [/^bad-response-turn-action-button$/i, /^dislike-turn-action-button$/i],
  share: [/^share-turn-action-button$/i],
  more: [/^more-turn-action-button$/i],
};

export function findClosestTurnNode(target: Node | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  if (isTurboRenderUiNode(target)) {
    return null;
  }

  const candidate =
    (isTurnNode(target) ? target : null) ??
    target.closest<HTMLElement>('[data-testid^="conversation-turn-"], [data-message-author-role], .conversation-turn');

  return candidate != null && !isTurboRenderUiNode(candidate) ? candidate : null;
}

export function resolveMessageId(node: HTMLElement | null): string | null {
  if (node == null || isTurboRenderUiNode(node)) {
    return null;
  }

  const turnContainer =
    node.closest<HTMLElement>('[data-testid^="conversation-turn-"], .conversation-turn, article') ??
    node.parentElement;

  const candidates: string[] = getMessageIdsFromRoot(node);
  if (turnContainer != null && turnContainer !== node) {
    candidates.push(...getMessageIdsFromRoot(turnContainer, false));
  }

  let current = node.parentElement;
  while (current != null) {
    const ancestorId = getMessageIdFromElement(current);
    if (ancestorId != null) {
      candidates.push(ancestorId);
    }
    candidates.push(...collectMessageIds(current.querySelectorAll('[data-host-message-id], [data-message-id]')));
    current = current.parentElement;
  }

  return resolvePreferredMessageId(...candidates);
}

export function resolveRealMessageId(...candidates: Array<string | null | undefined>): string | null {
  const resolved = resolvePreferredMessageId(...candidates);
  if (resolved == null || isSyntheticMessageId(resolved)) {
    return null;
  }

  return resolved;
}

// Unified message ID extraction helpers (replaces ~90 lines of duplicated code)
export function getMessageIdFromElement(element: Element | null, preferHostId = true): string | null {
  if (element == null) return null;
  if (preferHostId) {
    return element.getAttribute('data-host-message-id')?.trim() ??
           element.getAttribute('data-message-id')?.trim() ?? null;
  }
  return element.getAttribute('data-message-id')?.trim() ??
         element.getAttribute('data-host-message-id')?.trim() ?? null;
}

export function collectMessageIds(elements: Iterable<Element>): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    const id = getMessageIdFromElement(el);
    if (id != null && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}

export function getMessageIdsFromRoot(root: HTMLElement | null, includeDescendants = true): string[] {
  if (root == null) return [];
  const ids: string[] = [];
  const direct = getMessageIdFromElement(root);
  if (direct != null) ids.push(direct);
  if (includeDescendants) {
    ids.push(...collectMessageIds(root.querySelectorAll('[data-host-message-id], [data-message-id]')));
  }
  return ids;
}

export function resolveSyntheticTurnIndex(...candidates: Array<string | null | undefined>): number | null {
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

function getCandidateLabel(node: HTMLElement): string {
  return [
    node.getAttribute('aria-label'),
    node.getAttribute('title'),
    node.textContent,
  ]
    .filter((value): value is string => value != null && value.trim().length > 0)
    .join(' ')
    .trim();
}

export function computeTurnContentRevision(
  node: HTMLElement,
  role: TurnRole,
  messageId: string | null,
  isStreaming: boolean,
): string {
  const hostMessageId = node.getAttribute('data-host-message-id')?.trim() ?? '';
  const busy = node.getAttribute('aria-busy') === 'true' ? '1' : '0';
  const childCount = node.childElementCount;
  const firstTag = node.firstElementChild?.tagName ?? '';
  const lastTag = node.lastElementChild?.tagName ?? '';
  return [role, messageId ?? '', hostMessageId, busy, isStreaming ? '1' : '0', String(childCount), firstTag, lastTag]
    .join('|');
}

export function matchesHostActionCandidate(candidate: HTMLElement, action: ArchiveEntryAction): boolean {
  const testId = candidate.getAttribute('data-testid');
  if (testId != null && HOST_ACTION_TESTID_PATTERNS[action].some((pattern) => pattern.test(testId))) {
    return true;
  }

  const label = getCandidateLabel(candidate);
  return HOST_ACTION_LABEL_PATTERNS[action].some((pattern) => pattern.test(label));
}

export function buildEntryTextSearchCandidates(entry: ManagedHistoryEntry): string[] {
  const rawCandidates = [
    resolveArchiveCopyText(entry),
    entry.text,
    ...entry.parts,
  ];

  const normalized = new Set<string>();
  for (const candidate of rawCandidates) {
    const text = candidate.replace(/\s+/g, ' ').trim();
    if (text.length === 0) {
      continue;
    }

    normalized.add(text);
    normalized.add(text.slice(0, 192).trim());
    normalized.add(text.slice(0, 128).trim());
    normalized.add(text.slice(0, 80).trim());
  }

  return [...normalized].filter((candidate) => candidate.length > 0);
}

