import type { HistoryAnchorMode } from '../shared/types';

export interface HistoryAnchorTarget {
  mode: HistoryAnchorMode;
  shareButton: HTMLElement | null;
  actionBar: HTMLElement | null;
}

const SHARE_PATTERNS = [/^share$/i, /\bshare\b/i, /分享/];
const ACTION_BAR_SELECTORS = [
  '[data-testid="conversation-actions"]',
  '[data-testid*="conversation-actions"]',
  '[data-testid*="action-bar"]',
  'header [role="toolbar"]',
];

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

function isVisible(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return true;
  }

  if (!node.isConnected) {
    return false;
  }

  const style = node.ownerDocument?.defaultView?.getComputedStyle(node);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

function isShareButton(node: HTMLElement): boolean {
  const label = getCandidateLabel(node);
  return SHARE_PATTERNS.some((pattern) => pattern.test(label));
}

export function resolveHistoryAnchor(doc: Document): HistoryAnchorTarget {
  const actionBar =
    ACTION_BAR_SELECTORS.flatMap((selector) =>
      Array.from(doc.querySelectorAll<HTMLElement>(selector)),
    ).find((candidate) => isVisible(candidate)) ?? null;

  const shareCandidates = Array.from(
    (actionBar ?? doc).querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"], a'),
  );

  const shareButton =
    shareCandidates.find((candidate) => isVisible(candidate) && isShareButton(candidate)) ??
    Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"], a')).find(
      (candidate) => isVisible(candidate) && isShareButton(candidate),
    ) ??
    null;

  if (shareButton != null) {
    return {
      mode: 'host-share',
      shareButton,
      actionBar: shareButton.parentElement instanceof HTMLElement ? shareButton.parentElement : actionBar,
    };
  }

  if (actionBar != null) {
    return {
      mode: 'host-share',
      shareButton: null,
      actionBar,
    };
  }

  return {
    mode: 'safe-top',
    shareButton: null,
    actionBar: null,
  };
}
