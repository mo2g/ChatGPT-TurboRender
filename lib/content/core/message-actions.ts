import type { ManagedHistoryEntry } from '../../shared/types';
import { UI_CLASS_NAMES } from '../../shared/constants';

export type ArchiveEntryAction = 'copy' | 'like' | 'dislike' | 'share' | 'more';
export type EntryActionLane = 'user' | 'assistant';
export type EntryMoreMenuAction = 'branch' | 'read-aloud' | 'stop-read-aloud';
export type EntryActionAvailabilityMode = 'host-bound' | 'local-fallback' | 'unavailable';
export type EntryActionAvailability = Record<ArchiveEntryAction, EntryActionAvailabilityMode>;
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
  iconHtmlByAction?: Partial<Record<ArchiveEntryAction, string>>;
  edgeInsetPx?: number;
  wrapperClassName?: string;
  wrapperRole?: string;
  slotHint?: 'start' | 'end';
}

export type EntryActionTemplateMap = Partial<Record<EntryActionLane, HostActionTemplateSnapshot>>;

export interface EntryActionRequest {
  groupId: string;
  entryId: string;
  action: ArchiveEntryAction;
  selectedAction?: EntryActionSelection | null;
}

export interface ClipboardCopyPayload {
  text: string;
  html?: string | null;
}

export const ENTRY_ACTION_LANE: Record<EntryActionLane, ArchiveEntryAction[]> = {
  user: ['copy'],
  assistant: ['copy', 'like', 'dislike', 'share', 'more'],
};

export function isEntryActionEnabled(mode: EntryActionAvailabilityMode): boolean {
  return mode !== 'unavailable';
}

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
const ACTION_CANDIDATE_SELECTOR = 'button, [role="button"], a[role="button"], a';

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

function getCandidateElements(root: ParentNode): HTMLElement[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(ACTION_CANDIDATE_SELECTOR)];
  if (root instanceof HTMLElement && root.matches(ACTION_CANDIDATE_SELECTOR)) {
    candidates.unshift(root);
  }
  return candidates;
}

function isMessageBodyControl(candidate: HTMLElement): boolean {
  return candidate.closest('pre, code, .markdown, [data-message-action-bar="false"]') != null;
}

function findHostActionButtonInScope(
  root: ParentNode,
  action: ArchiveEntryAction,
  options: { rejectMessageBodyControls?: boolean } = {},
): HTMLElement | null {
  const candidates = getCandidateElements(root);
  for (const candidate of candidates) {
    if (options.rejectMessageBodyControls === true && isMessageBodyControl(candidate)) {
      continue;
    }

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

function getActionButtonCount(scope: HTMLElement): number {
  return getCandidateElements(scope).filter((candidate) => resolveActionFromCandidate(candidate) != null).length;
}

function getElementDepth(element: HTMLElement): number {
  let depth = 0;
  for (let current = element.parentElement; current != null; current = current.parentElement) {
    depth += 1;
  }
  return depth;
}

function isCompleteHostActionScope(scope: HTMLElement, lane: EntryActionLane): boolean {
  if (isMessageBodyControl(scope)) {
    return false;
  }

  return ENTRY_ACTION_LANE[lane].every(
    (action) => findHostActionButtonInScope(scope, action, { rejectMessageBodyControls: true }) != null,
  );
}

function findHostActionTemplateScope(root: ParentNode, lane: EntryActionLane): HTMLElement | null {
  const scopes = new Set<HTMLElement>();
  const rootElement = root instanceof HTMLElement ? root : null;

  if (rootElement != null && isCompleteHostActionScope(rootElement, lane)) {
    scopes.add(rootElement);
  }

  for (const group of root.querySelectorAll<HTMLElement>('[role="group"]')) {
    if (isCompleteHostActionScope(group, lane)) {
      scopes.add(group);
    }
  }

  for (const candidate of getCandidateElements(root)) {
    if (resolveActionFromCandidate(candidate) == null || isMessageBodyControl(candidate)) {
      continue;
    }

    for (let current = candidate.parentElement; current != null; current = current.parentElement) {
      if (rootElement != null && current !== rootElement && !rootElement.contains(current)) {
        break;
      }
      if (isCompleteHostActionScope(current, lane)) {
        scopes.add(current);
        break;
      }
      if (current === rootElement) {
        break;
      }
    }
  }

  return [...scopes]
    .sort((left, right) => {
      const countDelta = getActionButtonCount(left) - getActionButtonCount(right);
      if (countDelta !== 0) {
        return countDelta;
      }
      return getElementDepth(right) - getElementDepth(left);
    })[0] ?? null;
}

const REMOVED_ATTRS = ['id', 'hidden', 'inert', 'aria-hidden'];
const REMOVED_STYLES = ['opacity', 'visibility', 'pointer-events', 'display', 'mask-image', 'mask-size', 'mask-position', '-webkit-mask-image', '-webkit-mask-size', '-webkit-mask-position'];

function sanitizeTemplateButton(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[id]').forEach((el) => el.removeAttribute('id'));
  root.removeAttribute('id');

  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    REMOVED_ATTRS.forEach((attr) => el.removeAttribute(attr));
    REMOVED_STYLES.forEach((prop) => el.style.removeProperty(prop));
    if (el.getAttribute('style')?.trim() === '') el.removeAttribute('style');

    const cls = el.className;
    if (typeof cls === 'string' && cls.trim()) {
      el.className = cls.trim().split(/\s+/).filter(isSafeTemplateClassToken).join(' ');
    }
  }
}

// Blocked CSS class patterns (whitelist approach)
const BLOCKED_CLASS_PATTERNS = [
  /^(?:opacity|pointer-events|visible|invisible|scale|hidden|sr-only)-/,
  /^(?:absolute|relative|fixed|sticky)$/,
  /^(?:inset|top|bottom|left|right|start|end|translate|z)-/,
  /group-hover|group-focus|focus-within|has-data-\[|motion-safe|motion-reduce/,
  /\[mask|mask-/,
];

function isSafeTemplateClassToken(token: string): boolean {
  const base = token.split(':').pop() ?? token;
  return !BLOCKED_CLASS_PATTERNS.some((p) => p.test(base));
}

const LAYOUT_CLASS_PATTERN = /^(?:flex|inline-flex|grid|inline-grid|flow-root|contents)$/;

function sanitizeHostActionWrapperClassName(className: string): string | null {
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  const safeTokens = tokens.filter(isSafeTemplateClassToken);
  const hasLayout = safeTokens.some((t) => LAYOUT_CLASS_PATTERN.test(t.split(':').pop() ?? t));
  return safeTokens.length > 0 && hasLayout ? safeTokens.join(' ') : null;
}

function resolveHostActionTemplateSlotHint(copyButton: HTMLElement): 'start' | 'end' | undefined {
  const slotContainer = copyButton.closest<HTMLElement>(
    'div.justify-start, div.justify-end, div[class*="justify-start"], div[class*="justify-end"]',
  );
  if (slotContainer == null) {
    return undefined;
  }

  const className = slotContainer.className;
  if (typeof className !== 'string') {
    return undefined;
  }
  if (className.includes('justify-start')) {
    return 'start';
  }
  if (className.includes('justify-end')) {
    return 'end';
  }
  return undefined;
}

function resolveHostActionTemplateWrapperMetadata(copyButton: HTMLElement): {
  wrapperClassName?: string;
  wrapperRole?: string;
  slotHint?: 'start' | 'end';
} {
  const wrapper =
    copyButton.closest<HTMLElement>('[role="group"]') ??
    copyButton.parentElement ??
    copyButton.closest<HTMLElement>('div');

  const wrapperRole = wrapper?.getAttribute('role')?.trim() ?? '';
  const className = wrapper?.className;
  const normalizedClassName =
    typeof className === 'string' ? sanitizeHostActionWrapperClassName(className) : null;

  const slotHint = resolveHostActionTemplateSlotHint(copyButton);
  return {
    ...(normalizedClassName != null ? { wrapperClassName: normalizedClassName } : {}),
    ...(wrapperRole.length > 0 ? { wrapperRole } : {}),
    ...(slotHint != null ? { slotHint } : {}),
  };
}

export function findHostActionButton(root: ParentNode, action: ArchiveEntryAction): HTMLElement | null {
  const lanePriority: EntryActionLane[] = action === 'copy' ? ['assistant', 'user'] : ['assistant'];
  for (const lane of lanePriority) {
    const scope = findHostActionTemplateScope(root, lane);
    if (scope == null) {
      continue;
    }

    const scopedButton = findHostActionButtonInScope(scope, action, { rejectMessageBodyControls: true });
    if (scopedButton != null) {
      return scopedButton;
    }
  }

  return findHostActionButtonInScope(root, action);
}

export function captureHostActionTemplate(
  root: ParentNode,
  lane: EntryActionLane,
): HostActionTemplateSnapshot | null {
  const actionScope = findHostActionTemplateScope(root, lane);
  const searchRoot = actionScope ?? root;
  const htmlParts: string[] = [];
  const iconHtmlByAction: Partial<Record<ArchiveEntryAction, string>> = {};
  let copyButton: HTMLElement | null = null;
  for (const action of ENTRY_ACTION_LANE[lane]) {
    const button = findHostActionButtonInScope(searchRoot, action, {
      rejectMessageBodyControls: actionScope != null,
    });
    if (!(button instanceof HTMLElement)) {
      continue;
    }

    const clone = button.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      continue;
    }

    sanitizeTemplateButton(clone);
    const iconHtml = clone.innerHTML.trim();
    if (iconHtml.length > 0) {
      iconHtmlByAction[action] = iconHtml;
    }
    htmlParts.push(clone.outerHTML);
    if (action === 'copy') {
      copyButton = button;
    }
  }

  const hasCompleteTemplate = htmlParts.length === ENTRY_ACTION_LANE[lane].length;
  if (!hasCompleteTemplate && Object.keys(iconHtmlByAction).length === 0) {
    return null;
  }

  const edgeInsetPx = resolveHostActionEdgeInset(root, lane, copyButton);
  const template: HostActionTemplateSnapshot = {
    html: hasCompleteTemplate ? htmlParts.join('') : '',
  };
  if (Object.keys(iconHtmlByAction).length > 0) {
    template.iconHtmlByAction = iconHtmlByAction;
  }
  if (edgeInsetPx != null) {
    template.edgeInsetPx = edgeInsetPx;
  }
  if (copyButton != null) {
    const wrapperMetadata = resolveHostActionTemplateWrapperMetadata(copyButton);
    if (wrapperMetadata.wrapperClassName != null) {
      template.wrapperClassName = wrapperMetadata.wrapperClassName;
    }
    if (wrapperMetadata.wrapperRole != null) {
      template.wrapperRole = wrapperMetadata.wrapperRole;
    }
    if (wrapperMetadata.slotHint != null) {
      template.slotHint = wrapperMetadata.slotHint;
    }
  }
  return template;
}

export function instantiateHostActionTemplate(
  doc: Document,
  template: HostActionTemplateSnapshot,
): DocumentFragment | null {
  const host = doc.createElement('template');
  host.innerHTML = template.html.trim();
  return host.content.childElementCount > 0 ? host.content : null;
}

function escapeClipboardHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToClipboardHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const html = escapeClipboardHtml(block).replace(/\n/g, '<br>');
      return html.length > 0 ? `<p>${html}</p>` : '';
    })
    .filter((block) => block.length > 0)
    .join('');
}

function sanitizeClipboardHtml(root: HTMLElement): string | null {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, template, noscript').forEach((node) => node.remove());
  clone.querySelectorAll<HTMLElement>(
    [
      `.${UI_CLASS_NAMES.historyEntryActions}`,
      `.${UI_CLASS_NAMES.historyEntryActionMenu}`,
      '[data-turbo-render-action]',
      '[data-turbo-render-menu-action]',
      '[data-turbo-render-entry-menu="true"]',
    ].join(','),
  ).forEach((node) => node.remove());
  clone.querySelectorAll<HTMLElement>('[contenteditable]').forEach((node) => {
    node.removeAttribute('contenteditable');
  });

  const content =
    clone.querySelector<HTMLElement>('.markdown') ??
    clone.querySelector<HTMLElement>('.user-message-bubble-color > div') ??
    clone;
  const html = content.innerHTML.trim();
  return html.length > 0 ? `<div>${html}</div>` : null;
}

export function createArchiveClipboardPayload(
  doc: Document,
  entry: ManagedHistoryEntry,
  renderedBody?: HTMLElement | null,
): ClipboardCopyPayload {
  const text = resolveArchiveCopyText(entry);
  const html = renderedBody != null
    ? sanitizeClipboardHtml(renderedBody)
    : textToClipboardHtml(text);
  return { text, html };
}

async function copyRichPayloadWithClipboardApi(
  doc: Document,
  payload: ClipboardCopyPayload,
): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator?.clipboard;
  const ClipboardItemCtor = doc.defaultView?.ClipboardItem;
  if (
    clipboard?.write == null ||
    ClipboardItemCtor == null ||
    payload.html == null ||
    payload.html.trim().length === 0
  ) {
    return false;
  }

  try {
    const item = new ClipboardItemCtor({
      'text/plain': new Blob([payload.text], { type: 'text/plain' }),
      'text/html': new Blob([payload.html], { type: 'text/html' }),
    });
    await clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

function copyRichPayloadWithExecCommand(doc: Document, payload: ClipboardCopyPayload): boolean {
  if (payload.html == null || payload.html.trim().length === 0) {
    return false;
  }

  const container = doc.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.top = '-9999px';
  container.style.left = '-9999px';
  container.style.opacity = '0';
  container.contentEditable = 'true';
  container.innerHTML = payload.html;

  const parent = doc.body ?? doc.documentElement;
  parent.append(container);

  const selection = doc.defaultView?.getSelection();
  if (selection == null) {
    container.remove();
    return false;
  }

  const range = doc.createRange();
  range.selectNodeContents(container);
  selection.removeAllRanges();
  selection.addRange(range);

  try {
    return Boolean(doc.execCommand?.('copy') ?? false);
  } catch {
    return false;
  } finally {
    selection.removeAllRanges();
    container.remove();
  }
}

export async function copyTextToClipboard(
  doc: Document,
  input: string | ClipboardCopyPayload,
): Promise<boolean> {
  const payload: ClipboardCopyPayload =
    typeof input === 'string' ? { text: input, html: textToClipboardHtml(input) } : input;
  if (await copyRichPayloadWithClipboardApi(doc, payload)) {
    return true;
  }

  if (copyRichPayloadWithExecCommand(doc, payload)) {
    return true;
  }

  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (clipboard?.writeText != null) {
    try {
      await clipboard.writeText(payload.text);
      return true;
    } catch {
      // Fall through to execCommand.
    }
  }

  const textarea = doc.createElement('textarea');
  textarea.value = payload.text;
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
  const partsText = entry.parts.join('\n\n').trim();
  return partsText.length > 0 ? partsText : entry.text;
}

export function getArchiveEntrySelectionKey(entry: ManagedHistoryEntry): string {
  return entry.id;
}

function resolveHostActionEdgeInset(
  root: ParentNode,
  lane: EntryActionLane,
  copyButton: HTMLElement | null,
): number | null {
  if (copyButton == null) {
    return null;
  }

  const container =
    copyButton.closest<HTMLElement>('[role="group"], [data-message-author-role], [data-testid^="conversation-turn-"], article, section') ??
    (root instanceof HTMLElement ? root : null);
  if (container == null) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const copyRect = copyButton.getBoundingClientRect();
  if (containerRect.width <= 0 || containerRect.height <= 0 || copyRect.width <= 0 || copyRect.height <= 0) {
    return null;
  }

  const rawInset = lane === 'assistant' ? copyRect.left - containerRect.left : containerRect.right - copyRect.right;
  if (!Number.isFinite(rawInset)) {
    return null;
  }

  const roundedInset = Math.round(rawInset);
  if (roundedInset < 0 || roundedInset > 72) {
    return null;
  }

  return roundedInset;
}
