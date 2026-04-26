import { isTurboRenderUiNode } from './chatgpt-adapter';

const STOP_READ_ALOUD_EXACT_SELECTORS = [
  'button[data-testid="voice-stop-turn-action-button"]',
  'button[data-testid="stop-read-aloud-turn-action-button"]',
  '[role="menuitem"][data-testid="voice-play-turn-action-button"]',
  '[role="menuitem"][aria-label="停止"]',
];

const STOP_READ_ALOUD_LABEL_PATTERNS = [
  /stop reading/i,
  /stop read aloud/i,
  /停止朗读/i,
  /停止阅读/i,
];

export function findHostReadAloudStopButton(doc: Document): HTMLElement | null {
  const exactMatch = STOP_READ_ALOUD_EXACT_SELECTORS
    .flatMap((selector) => [...doc.querySelectorAll<HTMLElement>(selector)])
    .find(isVisibleNonTurboRenderNode);
  if (exactMatch != null) {
    return exactMatch;
  }

  return [...doc.querySelectorAll<HTMLElement>('button, [role="button"], [role="menuitem"], a')]
    .find((candidate) => {
      if (!isVisibleNonTurboRenderNode(candidate)) {
        return false;
      }

      const label = [
        candidate.getAttribute('aria-label'),
        candidate.getAttribute('title'),
        candidate.textContent,
      ]
        .filter((value): value is string => value != null && value.trim().length > 0)
        .join(' ')
        .trim();

      return STOP_READ_ALOUD_LABEL_PATTERNS.some((pattern) => pattern.test(label));
    }) ?? null;
}

function isVisibleNonTurboRenderNode(candidate: HTMLElement): boolean {
  return !isTurboRenderUiNode(candidate) && candidate.getClientRects().length > 0;
}
