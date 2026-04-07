import { getChatIdFromPathname } from '../shared/chat-id';
import { TURBO_RENDER_UI_ROOT_SELECTOR } from '../shared/constants';
import type { TurnRole } from '../shared/types';

export interface AdapterSnapshot {
  supported: boolean;
  reason: string | null;
  chatId: string;
  main: HTMLElement | null;
  turnContainer: HTMLElement | null;
  historyMountTarget: HTMLElement | null;
  scrollContainer: HTMLElement;
  turnNodes: HTMLElement[];
  descendantCount: number;
  stopButtonVisible: boolean;
}

const PRIMARY_TURN_SELECTORS = [
  '[data-testid^="conversation-turn-"]',
  '[data-message-author-role]',
  '.conversation-turn',
];

const FALLBACK_TURN_SELECTORS = [
  'article',
];

function getOutermostCandidates(candidates: HTMLElement[]): HTMLElement[] {
  return candidates.filter(
    (candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)),
  );
}

export function isTurboRenderUiNode(node: Element): boolean {
  return node.closest(TURBO_RENDER_UI_ROOT_SELECTOR) != null;
}

function getParentGroups(nodes: HTMLElement[]): HTMLElement[][] {
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

  return [...groups.values()].sort((left, right) => right.length - left.length);
}

function resolveCandidates(main: HTMLElement): HTMLElement[] {
  const primaryMatches = PRIMARY_TURN_SELECTORS.flatMap((selector) =>
    Array.from(main.querySelectorAll<HTMLElement>(selector)),
  );

  const uniquePrimary = getOutermostCandidates([...new Set(primaryMatches)].filter((candidate) => !isTurboRenderUiNode(candidate)));
  if (uniquePrimary.length > 0) {
    return uniquePrimary;
  }

  const fallbackMatches = FALLBACK_TURN_SELECTORS.flatMap((selector) =>
    Array.from(main.querySelectorAll<HTMLElement>(selector)),
  );
  return getOutermostCandidates([...new Set(fallbackMatches)].filter((candidate) => !isTurboRenderUiNode(candidate)));
}

function isScrollable(node: HTMLElement): boolean {
  const style = globalThis.getComputedStyle(node);
  return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
}

function resolveScrollContainer(anchor: HTMLElement): HTMLElement {
  const explicit =
    anchor.closest<HTMLElement>('[data-testid="conversation-scroller"]') ??
    anchor.closest<HTMLElement>('[data-overflow-scroll="true"]');

  if (explicit != null) {
    return explicit;
  }

  let current: HTMLElement | null = anchor;
  while (current != null) {
    if (isScrollable(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return (anchor.ownerDocument.scrollingElement as HTMLElement | null) ?? anchor;
}

function resolveHistoryMountTarget(main: HTMLElement, candidates: HTMLElement[]): HTMLElement {
  const firstParent = candidates[0]?.parentElement;
  if (firstParent instanceof HTMLElement) {
    return firstParent;
  }

  const explicitScroller =
    main.querySelector<HTMLElement>('[data-testid="conversation-scroller"]') ??
    main.querySelector<HTMLElement>('[data-overflow-scroll="true"]');

  if (explicitScroller?.firstElementChild instanceof HTMLElement) {
    return explicitScroller.firstElementChild;
  }

  return explicitScroller ?? main;
}

function countDescendants(root: ParentNode | null): number {
  if (root == null || !('querySelectorAll' in root)) {
    return 0;
  }

  return root.querySelectorAll('*').length;
}

export function isTurnNode(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (isTurboRenderUiNode(node)) {
    return false;
  }

  if (node.dataset.turboRenderTurnId != null) {
    return true;
  }

  return [...PRIMARY_TURN_SELECTORS, ...FALLBACK_TURN_SELECTORS].some((selector) => node.matches(selector));
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
      main: null,
      turnContainer: null,
      historyMountTarget: null,
      scrollContainer: (doc.scrollingElement as HTMLElement | null) ?? doc.body,
      turnNodes: [],
      descendantCount: 0,
      stopButtonVisible: false,
    };
  }

  const candidates = resolveCandidates(main);
  const parentGroups = getParentGroups(candidates);
  const turnNodes = parentGroups[0] ?? [];
  const turnParents = [...new Set(candidates.map((candidate) => candidate.parentElement).filter(
    (parent): parent is HTMLElement => parent instanceof HTMLElement,
  ))];
  const turnContainer = turnParents.length === 1 ? turnParents[0] : null;
  const historyMountTarget = resolveHistoryMountTarget(main, candidates);
  const scrollContainer = resolveScrollContainer(turnContainer ?? historyMountTarget);

  if (candidates.length === 0) {
    return {
      supported: false,
      reason: 'no-turns',
      chatId,
      main,
      turnContainer: null,
      historyMountTarget,
      scrollContainer,
      turnNodes: [],
      descendantCount: countDescendants(main),
      stopButtonVisible: doc.querySelector('button[data-testid="stop-button"]') != null,
    };
  }

  if (turnContainer == null) {
    return {
      supported: false,
      reason: 'split-parents',
      chatId,
      main,
      turnContainer: null,
      historyMountTarget,
      scrollContainer,
      turnNodes: candidates,
      descendantCount: countDescendants(historyMountTarget.parentElement ?? historyMountTarget),
      stopButtonVisible: doc.querySelector('button[data-testid="stop-button"]') != null,
    };
  }

  return {
    supported: true,
    reason: null,
    chatId,
    main,
    turnContainer,
    historyMountTarget,
    scrollContainer,
    turnNodes,
    descendantCount: countDescendants(turnContainer),
    stopButtonVisible: doc.querySelector('button[data-testid="stop-button"]') != null,
  };
}
