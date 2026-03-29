import { UI_CLASS_NAMES } from '../shared/constants';
import { buildInteractionPairs } from '../shared/interaction-pairs';
import { createTranslator, type Translator } from '../shared/i18n';
import type { HistoryAnchorMode, ManagedHistoryEntry, ManagedHistoryGroup, TabRuntimeStatus } from '../shared/types';

import { renderManagedHistoryEntryBody } from './history-entry-renderer';

export interface StatusBarState {
  archiveGroups: ManagedHistoryGroup[];
  collapsedBatchCount: number;
  expandedBatchCount: number;
  searchQuery: string;
}

export interface StatusBarActions {
  onSearchQueryChange(query: string): void;
  onToggleArchiveGroup(groupId: string, anchor: HTMLElement | null): void;
}

const STYLE_ID = 'turbo-render-style';
const INLINE_ROOT_ATTRIBUTE = 'data-turbo-render-inline-history-root';

const STYLES = `
.${UI_CLASS_NAMES.inlineHistoryRoot} {
  display: grid;
  gap: 14px;
  margin: 0 0 18px;
}

.${UI_CLASS_NAMES.inlineHistoryRoot} > * {
  width: min(100%, 920px);
  margin-inline: auto;
}

.${UI_CLASS_NAMES.inlineHistoryToolbar} {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.9);
  color: #0f172a;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.inlineHistorySummary},
.${UI_CLASS_NAMES.inlineBatchMeta},
.${UI_CLASS_NAMES.inlineBatchPreview},
.${UI_CLASS_NAMES.inlineBatchMatches},
.${UI_CLASS_NAMES.historyEntryMeta} {
  margin: 0;
  color: #475569;
}

.${UI_CLASS_NAMES.inlineHistorySearch} input {
  width: 100%;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  background: #ffffff;
  color: #0f172a;
  font: inherit;
}

.${UI_CLASS_NAMES.inlineBatchCard} {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.05);
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.inlineBatchMain} {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.${UI_CLASS_NAMES.inlineBatchHeader} {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.${UI_CLASS_NAMES.inlineBatchMeta} {
  display: grid;
  gap: 6px;
}

.${UI_CLASS_NAMES.inlineBatchPreview} {
  display: grid;
  gap: 4px;
}

.${UI_CLASS_NAMES.inlineBatchMatches} {
  color: #1d4ed8;
  font-weight: 600;
}

.${UI_CLASS_NAMES.inlineBatchRail} {
  display: flex;
  justify-content: flex-end;
  align-self: start;
  position: sticky;
  top: 16px;
  height: max-content;
}

.${UI_CLASS_NAMES.inlineBatchAction} {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  padding: 7px 11px;
  font: inherit;
  white-space: nowrap;
}

.${UI_CLASS_NAMES.inlineBatchEntries} {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.${UI_CLASS_NAMES.inlineBatchEntry} {
  display: grid;
  gap: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.${UI_CLASS_NAMES.inlineBatchEntry}:first-child {
  padding-top: 0;
  border-top: 0;
}

.${UI_CLASS_NAMES.historyEntryCard} {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.${UI_CLASS_NAMES.historyEntryCard}[data-lane="user"] {
  justify-items: end;
}

.${UI_CLASS_NAMES.historyEntryCard}[data-lane="assistant"] {
  justify-items: stretch;
}

.${UI_CLASS_NAMES.historyEntryBody} {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.${UI_CLASS_NAMES.historyEntryCard}[data-lane="user"] .${UI_CLASS_NAMES.historyEntryBody} {
  justify-self: end;
  width: fit-content;
  max-width: min(72ch, 100%);
  padding: 12px 16px;
  border-radius: 22px;
  background: #e9ecef;
  color: #0f172a;
}

.${UI_CLASS_NAMES.historyEntryCard}[data-lane="assistant"] .${UI_CLASS_NAMES.historyEntryBody} {
  justify-self: center;
  width: min(82ch, 100%);
}

.${UI_CLASS_NAMES.historyEntryBody} p {
  margin: 0;
  white-space: pre-wrap;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] {
  font-size: 13px;
  line-height: 1.68;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] a {
  color: #2563eb;
  text-decoration: underline;
  word-break: break-word;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] code {
  padding: 1px 5px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.08);
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] pre,
.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="structured-message"] pre {
  margin: 0;
  padding: 12px;
  border-radius: 12px;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] pre code {
  padding: 0;
  background: transparent;
  color: inherit;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] blockquote {
  margin: 0;
  padding-left: 12px;
  border-left: 3px solid rgba(59, 130, 246, 0.3);
  color: #334155;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] ul,
.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] ol {
  margin: 0;
  padding-left: 18px;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"] :is(button, input, textarea, select, a) {
  pointer-events: none !important;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-supplemental-role] {
  padding-top: 8px;
  border-top: 1px dashed rgba(15, 23, 42, 0.08);
}

.${UI_CLASS_NAMES.inlineBatchHighlight},
.${UI_CLASS_NAMES.transcriptHighlight} {
  outline: 2px solid rgba(59, 130, 246, 0.42);
  outline-offset: 3px;
  background: rgba(219, 234, 254, 0.44) !important;
}

.${UI_CLASS_NAMES.softFolded} {
  content-visibility: auto;
  contain: layout style paint;
  max-height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  opacity: 0 !important;
  overflow: hidden !important;
  pointer-events: none !important;
}

@media (max-width: 720px) {
  .${UI_CLASS_NAMES.inlineBatchCard} {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .${UI_CLASS_NAMES.inlineBatchRail} {
    justify-self: end;
    z-index: 1;
  }

  .${UI_CLASS_NAMES.inlineBatchRail} {
    top: 8px;
  }

  .${UI_CLASS_NAMES.historyEntryCard}[data-lane="assistant"] .${UI_CLASS_NAMES.historyEntryBody} {
    width: 100%;
  }
}
`;

function ensureTurboRenderStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID) != null) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

function getSlotSummaryText(t: Translator, group: ManagedHistoryGroup): string {
  return t('historyBatchSummary', {
    start: group.slotPairStartIndex + 1,
    end: group.slotPairEndIndex + 1,
  });
}

function getFilledSummaryText(t: Translator, group: ManagedHistoryGroup): string {
  if (group.filledPairCount >= group.capacity) {
    return getSlotSummaryText(t, group);
  }
  return `${getSlotSummaryText(t, group)} · ${group.filledPairCount}/${group.capacity}`;
}

export class StatusBar {
  private root: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private groupsRoot: HTMLElement | null = null;
  private currentStatus: TabRuntimeStatus | null = null;
  private currentState: StatusBarState | null = null;
  private t: Translator = createTranslator('en');

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  setTranslator(translator: Translator): void {
    this.t = translator;
    this.render();
  }

  getAnchorMode(): HistoryAnchorMode {
    return 'hidden';
  }

  update(status: TabRuntimeStatus, target: HTMLElement | null, state: StatusBarState): HistoryAnchorMode {
    this.currentStatus = status;
    this.currentState = state;
    this.mount(target);
    this.render();
    return 'hidden';
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.searchInput = null;
    this.groupsRoot = null;
  }

  focusArchive(): void {}

  focusEntry(): boolean {
    return false;
  }

  getBatchCardAnchor(groupId: string): HTMLElement | null {
    return this.root?.querySelector<HTMLElement>(
      `[data-turbo-render-batch-anchor="true"][data-group-id="${groupId}"]`,
    ) ?? null;
  }

  private mount(target: HTMLElement | null): void {
    ensureTurboRenderStyles(this.doc);
    if (target == null) {
      return;
    }

    if (this.root == null) {
      this.root = this.doc.createElement('section');
      this.root.className = UI_CLASS_NAMES.inlineHistoryRoot;
      this.root.setAttribute(INLINE_ROOT_ATTRIBUTE, 'true');
      this.root.innerHTML = `
        <div class="${UI_CLASS_NAMES.inlineHistoryToolbar}">
          <p class="${UI_CLASS_NAMES.inlineHistorySummary}"></p>
          <div class="${UI_CLASS_NAMES.inlineHistorySearch}">
            <input type="search" />
          </div>
        </div>
        <div class="${UI_CLASS_NAMES.archiveGroups}"></div>
      `;
      this.searchInput = this.root.querySelector<HTMLInputElement>('input[type="search"]');
      this.groupsRoot = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.archiveGroups}`);
      this.searchInput?.addEventListener('input', () => {
        this.actions.onSearchQueryChange(this.searchInput?.value ?? '');
      });
    }

    if (this.root.parentElement !== target.parentElement || this.root.nextElementSibling !== target) {
      target.parentElement?.insertBefore(this.root, target);
    }
  }

  private render(): void {
    if (this.root == null || this.searchInput == null || this.groupsRoot == null || this.currentState == null) {
      return;
    }

    const visible =
      this.currentState.collapsedBatchCount > 0 ||
      this.currentState.expandedBatchCount > 0 ||
      this.currentState.archiveGroups.length > 0 ||
      this.currentState.searchQuery.length > 0;
    this.root.hidden = !visible;
    if (!visible) {
      return;
    }

    const summary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.inlineHistorySummary}`);
    if (summary != null) {
      summary.textContent = this.t('inlineHistorySummary', {
        collapsed: this.currentState.collapsedBatchCount,
        expanded: this.currentState.expandedBatchCount,
      });
    }

    this.searchInput.placeholder = this.t('historySearchPlaceholder');
    this.searchInput.value = this.currentState.searchQuery;

    this.groupsRoot.replaceChildren();

    for (const group of this.currentState.archiveGroups) {
      this.groupsRoot.append(this.createBatchCard(group));
    }
  }

  private createBatchCard(group: ManagedHistoryGroup): HTMLElement {
    const section = this.doc.createElement('section');
    section.className = UI_CLASS_NAMES.inlineBatchCard;
    section.dataset.groupId = group.id;
    section.dataset.turboRenderBatchAnchor = 'true';
    if (group.matchCount > 0) {
      section.classList.add(UI_CLASS_NAMES.inlineBatchHighlight);
    }

    const main = this.doc.createElement('div');
    main.className = UI_CLASS_NAMES.inlineBatchMain;

    const header = this.doc.createElement('div');
    header.className = UI_CLASS_NAMES.inlineBatchHeader;

    const meta = this.doc.createElement('div');
    meta.className = UI_CLASS_NAMES.inlineBatchMeta;
    meta.innerHTML = `<strong>${getFilledSummaryText(this.t, group)}</strong>`;

    if (!group.expanded) {
      const preview = this.doc.createElement('div');
      preview.className = UI_CLASS_NAMES.inlineBatchPreview;
      if (group.userPreview.length > 0) {
        const user = this.doc.createElement('p');
        user.textContent = this.t('historyBatchPreviewUser', { text: group.userPreview });
        preview.append(user);
      }
      if (group.assistantPreview.length > 0) {
        const assistant = this.doc.createElement('p');
        assistant.textContent = this.t('historyBatchPreviewAssistant', { text: group.assistantPreview });
        preview.append(assistant);
      }
      if (group.matchCount > 0) {
        const matches = this.doc.createElement('p');
        matches.className = UI_CLASS_NAMES.inlineBatchMatches;
        matches.textContent = this.t('historyBatchMatches', { count: group.matchCount });
        preview.append(matches);
      }

      meta.append(preview);
    }
    header.append(meta);
    main.append(header);

    const rail = this.doc.createElement('div');
    rail.className = UI_CLASS_NAMES.inlineBatchRail;
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = UI_CLASS_NAMES.inlineBatchAction;
    button.dataset.action = 'toggle-archive-group';
    button.dataset.turboRenderAction = 'toggle-archive-group';
    button.dataset.groupId = group.id;
    button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    button.addEventListener('click', () => this.actions.onToggleArchiveGroup(group.id, section));
    rail.append(button);

    section.append(main, rail);

    if (!group.expanded) {
      return section;
    }

    const entries = this.doc.createElement('div');
    entries.className = UI_CLASS_NAMES.inlineBatchEntries;
    const query = this.currentState?.searchQuery.trim().toLowerCase() ?? '';
    let highlighted = false;

    for (const pair of buildInteractionPairs(
      group.entries.map((entry) => ({
        ...entry,
        text: entry.text,
      })),
    )) {
      const visibleEntries = pair.entries.filter((entry) => !entry.hiddenFromConversation);
      if (visibleEntries.length === 0) {
        continue;
      }

      const article = this.doc.createElement('article');
      article.className = UI_CLASS_NAMES.inlineBatchEntry;
      if (!highlighted && query.length > 0 && pair.searchText.toLowerCase().includes(query)) {
        article.classList.add(UI_CLASS_NAMES.inlineBatchHighlight);
        highlighted = true;
      }

      const userEntries = visibleEntries.filter((entry) => entry.role === 'user');
      const assistantEntries = visibleEntries.filter((entry) => entry.role !== 'user');

      if (userEntries.length > 0) {
        article.append(this.createEntryLane(userEntries, 'user'));
      }
      if (assistantEntries.length > 0) {
        article.append(this.createEntryLane(assistantEntries, 'assistant'));
      }
      entries.append(article);
    }

    main.append(entries);
    return section;
  }

  private createEntryLane(entries: ManagedHistoryEntry[], lane: 'user' | 'assistant'): HTMLElement {
    const laneEl = this.doc.createElement('section');
    laneEl.className = UI_CLASS_NAMES.historyEntryCard;
    laneEl.dataset.lane = lane;

    for (const entry of entries) {
      const body = renderManagedHistoryEntryBody(
        this.doc,
        entry,
        this.t,
        lane === 'user' ? this.t('roleUser') : this.t('roleAssistant'),
        false,
      );
      body.classList.add(UI_CLASS_NAMES.historyEntryBody);
      if (lane === 'assistant' && entry.role !== 'assistant') {
        body.dataset.supplementalRole = entry.role;
      }
      laneEl.append(body);
    }

    return laneEl;
  }
}
