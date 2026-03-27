import { getChatIdFromPathname } from '../shared/chat-id';
import type { TurnRole } from '../shared/types';

export interface AdapterSnapshot {
  supported: boolean;
  reason: string | null;
  chatId: string;
  turnContainer: HTMLElement | null;
  scrollContainer: HTMLElement;
  turnNodes: HTMLElement[];
  descendantCount: number;
  stopButtonVisible: boolean;
}

const TURN_SELECTORS = [
  '[data-testid^="conversation-turn-"]',
  '[data-message-author-role]',
  '.conversation-turn',
  'article',
];

function getOutermostCandidates(candidates: HTMLElement[]): HTMLElement[] {
  return candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)),
  );
}

function pickLargestParentGroup(nodes: HTMLElement[]): HTMLElement[] {
  const groups = new Map<HTMLElement, HTMLElement[]>();

  for (const node of nodes) {
    const parent = node.parentElement;
    if (parent == null) {
      continue;
    }
    const group = groups.get(parent) ?? [];
    group.push(node);
    groups.set(parent, group);
  }

  const sortedGroups = [...groups.values()].sort((left, right) => right.length - left.length);
  return sortedGroups[0] ?? [];
}

function resolveCandidates(main: HTMLElement): HTMLElement[] {
  const matches = TURN_SELECTORS.flatMap((selector) =>
    Array.from(main.querySelectorAll<HTMLElement>(selector)),
  );

  const unique = [...new Set(matches)];
  return getOutermostCandidates(unique);
}

function isScrollable(node: HTMLElement): boolean {
  const style = globalThis.getComputedStyle(node);
  return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
}

function resolveScrollContainer(turnContainer: HTMLElement): HTMLElement {
  const explicit =
    turnContainer.closest<HTMLElement>('[data-testid="conversation-scroller"]') ??
    turnContainer.closest<HTMLElement>('[data-overflow-scroll="true"]');

  if (explicit != null) {
    return explicit;
  }

  let current: HTMLElement | null = turnContainer;
  while (current != null) {
    if (isScrollable(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return (turnContainer.ownerDocument.scrollingElement as HTMLElement | null) ?? turnContainer;
}

export function isTurnNode(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (node.dataset.turboRenderTurnId != null) {
    return true;
  }

  return TURN_SELECTORS.some((selector) => node.matches(selector));
}

export function detectTurnRole(node: HTMLElement): TurnRole {
  const explicit =
    node.getAttribute('data-message-author-role') ??
    node.querySelector<HTMLElement>('[data-message-author-role]')?.getAttribute(
      'data-message-author-role',
    );

  if (explicit === 'user' || explicit === 'assistant' || explicit === 'system' || explicit === 'tool') {
    return explicit;
  }

  const label = node.getAttribute('aria-label')?.toLowerCase() ?? '';
  if (label.includes('assistant')) {
    return 'assistant';
  }
  if (label.includes('user')) {
    return 'user';
  }

  return 'unknown';
}

export function isStreamingTurn(
  node: HTMLElement,
  options: {
    isLastTurn: boolean;
    stopButtonVisible: boolean;
  },
): boolean {
  if (
    node.matches('[aria-busy="true"]') ||
    node.querySelector('[aria-busy="true"], .result-streaming, [data-is-streaming="true"]') != null
  ) {
    return true;
  }

  return options.isLastTurn && options.stopButtonVisible;
}

export function scanChatPage(doc: Document = document): AdapterSnapshot {
  const chatId = getChatIdFromPathname(doc.location?.pathname ?? '/');
  const main = doc.querySelector<HTMLElement>('main');

  if (main == null) {
    return {
      supported: false,
      reason: 'missing-main',
      chatId,
      turnContainer: null,
      scrollContainer: (doc.scrollingElement as HTMLElement | null) ?? doc.body,
      turnNodes: [],
      descendantCount: 0,
      stopButtonVisible: false,
    };
  }

  const candidates = resolveCandidates(main);
  const turnNodes = pickLargestParentGroup(candidates);
  const turnContainer = turnNodes[0]?.parentElement ?? null;

  if (turnContainer == null || turnNodes.length === 0) {
    return {
      supported: false,
      reason: 'no-turns',
      chatId,
      turnContainer: null,
      scrollContainer: (doc.scrollingElement as HTMLElement | null) ?? doc.body,
      turnNodes: [],
      descendantCount: main.querySelectorAll('*').length,
      stopButtonVisible: doc.querySelector('button[data-testid="stop-button"]') != null,
    };
  }

  if (turnNodes.some((node) => node.parentElement !== turnContainer)) {
    return {
      supported: false,
      reason: 'split-parents',
      chatId,
      turnContainer,
      scrollContainer: resolveScrollContainer(turnContainer),
      turnNodes,
      descendantCount: turnContainer.querySelectorAll('*').length,
      stopButtonVisible: doc.querySelector('button[data-testid="stop-button"]') != null,
    };
  }

  return {
    supported: true,
    reason: null,
    chatId,
    turnContainer,
    scrollContainer: resolveScrollContainer(turnContainer),
    turnNodes,
    descendantCount: turnContainer.querySelectorAll('*').length,
    stopButtonVisible: doc.querySelector('button[data-testid="stop-button"]') != null,
  };
}
