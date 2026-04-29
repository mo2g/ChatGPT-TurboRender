import {
  findHostActionButton,
  type EntryActionSelection,
  type EntryMoreMenuAction,
} from '../core/message-actions';
import { isTurboRenderUiNode } from '../utils/chatgpt-adapter';

export function findHostMoreMenuAction(menu: ParentNode, action: EntryMoreMenuAction): HTMLElement | null {
  const exactSelectors =
    action === 'branch'
      ? [
          'button[data-testid="branch-in-new-chat-turn-action-button"]',
          '[role="menuitem"][data-testid="branch-in-new-chat-turn-action-button"]',
          '[data-testid="branch-in-new-chat-turn-action-button"]',
        ]
      : action === 'stop-read-aloud'
        ? [
            '[role="menuitem"][data-testid="voice-play-turn-action-button"]',
            '[role="menuitem"][aria-label="停止"]',
            'button[data-testid="voice-stop-turn-action-button"]',
            'button[data-testid="stop-read-aloud-turn-action-button"]',
            'div[data-testid="voice-play-turn-action-button"]',
            'div[data-testid="stop-read-aloud-turn-action-button"]',
          ]
        : [
          'button[data-testid="voice-play-turn-action-button"]',
          'button[data-testid="read-aloud-turn-action-button"]',
          '[role="menuitem"][data-testid="voice-play-turn-action-button"]',
          '[role="menuitem"][data-testid="read-aloud-turn-action-button"]',
          'div[data-testid="voice-play-turn-action-button"]',
          'div[data-testid="read-aloud-turn-action-button"]',
        ];
  const exactMatch = exactSelectors
    .map((selector) => menu.querySelector<HTMLElement>(selector))
    .find((candidate): candidate is HTMLElement => candidate != null && !isTurboRenderUiNode(candidate));
  if (exactMatch != null) {
    return exactMatch;
  }

  const labelPatterns =
    action === 'branch'
      ? [/branch in new chat/i, /new chat/i, /分支到新聊天/i]
      : action === 'stop-read-aloud'
        ? [/stop reading/i, /stop read aloud/i, /停止朗读/i]
        : [/read aloud/i, /朗读/i];

  return (
    [...menu.querySelectorAll<HTMLElement>('button, [role="menuitem"], [role="button"], a')].find((candidate) => {
      if (isTurboRenderUiNode(candidate)) {
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

      return labelPatterns.some((pattern) => pattern.test(label));
    }) ?? null
  );
}

export function readHostEntryActionSelection(
  searchRoots: HTMLElement[],
): { matched: boolean; selection: EntryActionSelection | null } {
  if (searchRoots.length === 0) {
    return { matched: false, selection: null };
  }

  const likeButton = searchRoots
    .map((root) => findHostActionButton(root, 'like'))
    .find((candidate): candidate is HTMLElement => candidate != null && !isTurboRenderUiNode(candidate));
  const dislikeButton = searchRoots
    .map((root) => findHostActionButton(root, 'dislike'))
    .find((candidate): candidate is HTMLElement => candidate != null && !isTurboRenderUiNode(candidate));

  if (likeButton == null && dislikeButton == null) {
    return { matched: false, selection: null };
  }

  const isPressed = (candidate: HTMLElement | undefined): boolean => {
    if (candidate == null) {
      return false;
    }

    return (
      candidate.getAttribute('aria-pressed') === 'true' ||
      candidate.classList.contains('text-token-text-primary') ||
      candidate.dataset.state === 'on'
    );
  };

  if (isPressed(likeButton)) {
    return { matched: true, selection: 'like' };
  }
  if (isPressed(dislikeButton)) {
    return { matched: true, selection: 'dislike' };
  }

  return { matched: true, selection: null };
}
