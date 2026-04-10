import type { ManagedHistoryEntry } from '../shared/types';

export type ArchiveEntryAction = 'copy' | 'like' | 'dislike' | 'share' | 'more';
export type EntryActionLane = 'user' | 'assistant';
export type EntryMoreMenuAction = 'branch' | 'read-aloud' | 'stop-read-aloud';
export type EntryActionAvailability = Record<ArchiveEntryAction, boolean>;
export type EntryActionAvailabilityMap = Record<string, EntryActionAvailability>;
export type EntryActionSelection = 'like' | 'dislike';
export type EntryActionSelectionMap = Record<string, EntryActionSelection>;
export interface EntryActionMenuSelection {
  groupId: string;
  entryId: string;
  lane: EntryActionLane;
}

export interface HostActionTemplateSnapshot {
  html: string;
}

export type EntryActionTemplateMap = Partial<Record<EntryActionLane, HostActionTemplateSnapshot>>;

export interface EntryActionRequest {
  groupId: string;
  entryId: string;
  action: ArchiveEntryAction;
  selectedAction?: EntryActionSelection | null;
}

export const ENTRY_ACTION_LANE: Record<EntryActionLane, ArchiveEntryAction[]> = {
  user: ['copy'],
  assistant: ['copy', 'like', 'dislike', 'share', 'more'],
};

const ACTION_LABEL_PATTERNS: Record<ArchiveEntryAction, RegExp[]> = {
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

const ACTION_TESTID_PATTERNS: Record<ArchiveEntryAction, RegExp[]> = {
  copy: [/^copy-turn-action-button$/i],
  like: [/^good-response-turn-action-button$/i, /^like-turn-action-button$/i],
  dislike: [/^bad-response-turn-action-button$/i, /^dislike-turn-action-button$/i],
  share: [/^share-turn-action-button$/i],
  more: [/^more-turn-action-button$/i],
};

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

function resolveActionFromCandidate(candidate: HTMLElement): ArchiveEntryAction | null {
  const testId = candidate.getAttribute('data-testid');
  if (testId != null) {
    for (const [action, patterns] of Object.entries(ACTION_TESTID_PATTERNS) as [
      ArchiveEntryAction,
      RegExp[],
    ][]) {
      if (patterns.some((pattern) => pattern.test(testId))) {
        return action;
      }
    }
  }

  const label = getCandidateLabel(candidate);
  for (const [action, patterns] of Object.entries(ACTION_LABEL_PATTERNS) as [
    ArchiveEntryAction,
    RegExp[],
  ][]) {
    if (patterns.some((pattern) => pattern.test(label))) {
      return action;
    }
  }

  return null;
}

function sanitizeTemplateButton(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[id]').forEach((element) => {
    element.removeAttribute('id');
  });
  root.removeAttribute('id');
}

export function findHostActionButton(root: ParentNode, action: ArchiveEntryAction): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"], a[role="button"], a');
  for (const candidate of candidates) {
    const testId = candidate.getAttribute('data-testid');
    if (testId != null && ACTION_TESTID_PATTERNS[action].some((pattern) => pattern.test(testId))) {
      return candidate;
    }

    const label = getCandidateLabel(candidate);
    if (ACTION_LABEL_PATTERNS[action].some((pattern) => pattern.test(label))) {
      return candidate;
    }
  }
  return null;
}

export function captureHostActionTemplate(
  root: ParentNode,
  lane: EntryActionLane,
): HostActionTemplateSnapshot | null {
  const htmlParts: string[] = [];
  for (const action of ENTRY_ACTION_LANE[lane]) {
    const button = findHostActionButton(root, action);
    if (!(button instanceof HTMLElement)) {
      return null;
    }

    const clone = button.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return null;
    }

    sanitizeTemplateButton(clone);
    htmlParts.push(clone.outerHTML);
  }

  if (htmlParts.length !== ENTRY_ACTION_LANE[lane].length) {
    return null;
  }

  return { html: htmlParts.join('') };
}

export function instantiateHostActionTemplate(
  doc: Document,
  template: HostActionTemplateSnapshot,
): DocumentFragment | null {
  const host = doc.createElement('template');
  host.innerHTML = template.html.trim();
  return host.content.childElementCount > 0 ? host.content : null;
}

export function isHostActionButtonAvailable(root: ParentNode, action: ArchiveEntryAction): boolean {
  const button = findHostActionButton(root, action);
  if (button == null) {
    return false;
  }

  if (button instanceof HTMLButtonElement && button.disabled) {
    return false;
  }

  return button.getAttribute('aria-disabled') !== 'true';
}

export async function copyTextToClipboard(doc: Document, text: string): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (clipboard?.writeText != null) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand.
    }
  }

  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  const parent = doc.body ?? doc.documentElement;
  parent.append(textarea);
  textarea.select();

  try {
    const copied = doc.execCommand?.('copy') ?? false;
    return Boolean(copied);
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function resolveArchiveCopyText(entry: ManagedHistoryEntry): string {
  return entry.text.length > 0 ? entry.text : entry.parts.join('\n\n');
}

export function getArchiveEntrySelectionKey(entry: ManagedHistoryEntry): string {
  return entry.id;
}
