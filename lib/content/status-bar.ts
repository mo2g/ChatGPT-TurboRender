import { TURBO_RENDER_UI_ROOT_ATTRIBUTE, UI_CLASS_NAMES } from '../shared/constants';
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

interface BatchCardView {
  root: HTMLElement;
  main: HTMLElement;
  header: HTMLElement;
  meta: HTMLElement;
  summary: HTMLElement;
  rail: HTMLElement;
  button: HTMLButtonElement;
  preview: HTMLElement;
  entries: HTMLElement;
  previewKey: string;
  entriesKey: string;
  entriesRendered: boolean;
  expanded: boolean;
}

const STYLE_ID = 'turbo-render-style';
const INLINE_ROOT_ATTRIBUTE = 'data-turbo-render-inline-history-root';

const STYLES = `
.${UI_CLASS_NAMES.inlineHistoryRoot} {
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
  padding: 0 8px 0 0;
}

.${UI_CLASS_NAMES.inlineHistoryRoot} > * {
  width: min(100%, 920px);
  margin-inline: auto;
}

.${UI_CLASS_NAMES.inlineHistoryToolbar} {
  display: grid;
  gap: 6px;
  padding: 10px 0 8px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: transparent;
  color: #0f172a;
  box-shadow: none;
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.inlineHistorySummary},
.${UI_CLASS_NAMES.inlineBatchMeta},
.${UI_CLASS_NAMES.inlineBatchPreview},
.${UI_CLASS_NAMES.inlineBatchMatches},
.${UI_CLASS_NAMES.historyEntryMeta} {
  margin: 0;
  color: #64748b;
}

.${UI_CLASS_NAMES.inlineHistorySearch} input {
  width: 100%;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.92);
  color: #0f172a;
  font: inherit;
}

.${UI_CLASS_NAMES.inlineBatchCard} {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
  padding: 14px 16px 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.inlineBatchCard}[data-state="expanded"] {
  background: transparent;
  box-shadow: none;
  padding-top: 12px;
  padding-bottom: 4px;
}

.${UI_CLASS_NAMES.inlineBatchMain} {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.${UI_CLASS_NAMES.inlineBatchHeader} {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.${UI_CLASS_NAMES.inlineBatchMeta} {
  display: grid;
  gap: 4px;
}

.${UI_CLASS_NAMES.inlineBatchMeta} strong {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}

.${UI_CLASS_NAMES.inlineBatchPreview} {
  display: grid;
  gap: 2px;
  color: #475569;
}

.${UI_CLASS_NAMES.inlineBatchPreview}[hidden],
.${UI_CLASS_NAMES.inlineBatchEntries}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.inlineBatchMatches} {
  color: #2563eb;
  font-weight: 600;
}

.${UI_CLASS_NAMES.inlineBatchRail} {
  display: flex;
  justify-content: flex-end;
  align-self: start;
  position: sticky;
  top: 12px;
  height: max-content;
  padding-top: 2px;
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
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.${UI_CLASS_NAMES.inlineBatchEntries} {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding-top: 2px;
}

.${UI_CLASS_NAMES.inlineBatchEntry} {
  display: grid;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.${UI_CLASS_NAMES.inlineBatchEntry}:first-child {
  padding-top: 0;
  border-top: 0;
}

.${UI_CLASS_NAMES.historyEntryCard} {
  display: contents;
}

.${UI_CLASS_NAMES.historyEntryBody} {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-lane="user"] {
  justify-self: end;
  align-self: start;
  width: fit-content;
  max-width: min(68ch, 100%);
  padding: 12px 16px;
  border-radius: 18px;
  background: rgba(243, 244, 246, 0.96);
  border: 0;
  box-shadow: none;
  color: #0f172a;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-lane="assistant"] {
  justify-self: stretch;
  align-self: stretch;
  width: 100%;
  max-width: none;
  color: #0f172a;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="host-snapshot"] {
  display: block;
  gap: 0;
  justify-self: stretch;
  align-self: stretch;
  width: 100%;
  max-width: none;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
}

.${UI_CLASS_NAMES.historyEntryBody} p {
  margin: 0;
  white-space: pre-wrap;
}

.${UI_CLASS_NAMES.historyEntryBody}[data-render-kind="markdown-text"] {
  font-size: 13px;
  line-height: 1.72;
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
  display: none !important;
  pointer-events: none !important;
}

@media (max-width: 720px) {
  .${UI_CLASS_NAMES.inlineBatchCard} {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .${UI_CLASS_NAMES.inlineBatchRail} {
    justify-self: end;
    z-index: 1;
  }

  .${UI_CLASS_NAMES.inlineBatchRail} {
    top: 8px;
  }

  .${UI_CLASS_NAMES.historyEntryBody}[data-lane="assistant"] {
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
  private readonly groupViews = new Map<string, BatchCardView>();
  private forceRender = true;
  private t: Translator = createTranslator('en');

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  setTranslator(translator: Translator): void {
    this.t = translator;
    this.forceRender = true;
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
    this.groupViews.clear();
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
      this.root.setAttribute(TURBO_RENDER_UI_ROOT_ATTRIBUTE, 'true');
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
    const nextSummary = this.t('inlineHistorySummary', {
      collapsed: this.currentState.collapsedBatchCount,
      expanded: this.currentState.expandedBatchCount,
    });
    if (summary != null) {
      if (summary.textContent !== nextSummary) {
        summary.textContent = nextSummary;
      }
    }

    const nextPlaceholder = this.t('historySearchPlaceholder');
    if (this.searchInput.placeholder !== nextPlaceholder) {
      this.searchInput.placeholder = nextPlaceholder;
    }

    if (this.searchInput.value !== this.currentState.searchQuery) {
      this.searchInput.value = this.currentState.searchQuery;
    }

    this.syncGroupCards(this.currentState.archiveGroups);
    this.forceRender = false;
  }

  private syncGroupCards(groups: ManagedHistoryGroup[]): void {
    const nextIds = new Set(groups.map((group) => group.id));
    for (const [groupId, view] of [...this.groupViews.entries()]) {
      if (nextIds.has(groupId)) {
        continue;
      }

      view.root.remove();
      this.groupViews.delete(groupId);
    }

    const query = this.currentState?.searchQuery.trim().toLowerCase() ?? '';
    let anchor: ChildNode | null = this.groupsRoot.firstChild;
    for (const group of groups) {
      const previewKey = this.buildPreviewKey(group);
      let view = this.groupViews.get(group.id);
      const shouldBuildEntriesKey = group.expanded || (view?.entriesRendered ?? false);
      const entriesKey = shouldBuildEntriesKey ? this.buildEntriesKey(group, query) : '';
      if (view == null) {
        view = this.createBatchCardView(group, query, previewKey, entriesKey);
        this.groupViews.set(group.id, view);
      } else if (
        this.forceRender ||
        view.expanded !== group.expanded ||
        view.previewKey !== previewKey ||
        (view.entriesRendered && view.entriesKey !== entriesKey)
      ) {
        this.updateBatchCardView(view, group, query, previewKey, entriesKey);
      }

      if (view.root.parentNode !== this.groupsRoot || view.root !== anchor) {
        this.groupsRoot.insertBefore(view.root, anchor);
      }
      anchor = view.root.nextSibling;
    }
  }

  private buildPreviewKey(group: ManagedHistoryGroup): string {
    return [
      group.matchCount,
      group.userPreview,
      group.assistantPreview,
      group.slotPairStartIndex,
      group.slotPairEndIndex,
      group.filledPairCount,
      group.capacity,
    ].join('||');
  }

  private buildEntriesKey(group: ManagedHistoryGroup, query: string): string {
    const entriesKey = group.entries
      .map((entry) =>
        [
          entry.id,
          entry.role,
          entry.renderKind,
          entry.hiddenFromConversation ? '1' : '0',
          entry.liveTurnId ?? '',
          entry.text,
          entry.contentType ?? '',
          entry.snapshotHtml ?? '',
          entry.structuredDetails ?? '',
        ].join(':'),
      )
      .join('|');

    return [
      query,
      group.slotPairStartIndex,
      group.slotPairEndIndex,
      group.filledPairCount,
      group.capacity,
      group.userPreview,
      group.assistantPreview,
      entriesKey,
    ].join('||');
  }

  private createBatchCardView(
    group: ManagedHistoryGroup,
    query: string,
    previewKey: string,
    entriesKey: string,
  ): BatchCardView {
    const root = this.doc.createElement('section');
    root.className = UI_CLASS_NAMES.inlineBatchCard;
    root.dataset.groupId = group.id;
    root.dataset.turboRenderBatchAnchor = 'true';
    root.dataset.state = group.expanded ? 'expanded' : 'collapsed';

    const main = this.doc.createElement('div');
    main.className = UI_CLASS_NAMES.inlineBatchMain;

    const header = this.doc.createElement('div');
    header.className = UI_CLASS_NAMES.inlineBatchHeader;

    const meta = this.doc.createElement('div');
    meta.className = UI_CLASS_NAMES.inlineBatchMeta;

    const summary = this.doc.createElement('strong');
    meta.append(summary);
    header.append(meta);
    main.append(header);

    const preview = this.doc.createElement('div');
    preview.className = UI_CLASS_NAMES.inlineBatchPreview;

    const entries = this.doc.createElement('div');
    entries.className = UI_CLASS_NAMES.inlineBatchEntries;

    const rail = this.doc.createElement('div');
    rail.className = UI_CLASS_NAMES.inlineBatchRail;
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = UI_CLASS_NAMES.inlineBatchAction;
    button.dataset.action = 'toggle-archive-group';
    button.dataset.turboRenderAction = 'toggle-archive-group';
    button.dataset.groupId = group.id;
    button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    button.setAttribute('aria-expanded', String(group.expanded));
    button.addEventListener('click', () => this.actions.onToggleArchiveGroup(group.id, root));
    rail.append(button);

    main.append(preview, entries);
    root.append(main, rail);

    const view: BatchCardView = {
      root,
      main,
      header,
      meta,
      summary,
      rail,
      button,
      preview,
      entries,
      previewKey: '',
      entriesKey: '',
      entriesRendered: false,
      expanded: !group.expanded,
    };
    this.updateBatchCardView(view, group, query, previewKey, entriesKey, true);
    return view;
  }

  private updateBatchCardView(
    view: BatchCardView,
    group: ManagedHistoryGroup,
    query: string,
    previewKey: string,
    entriesKey: string,
    force = false,
  ): void {
    const nextExpanded = group.expanded;
    const previewChanged = view.previewKey !== previewKey;
    const entriesChanged = view.entriesRendered && view.entriesKey !== entriesKey;
    if (!force && !previewChanged && !entriesChanged && view.expanded === nextExpanded) {
      return;
    }

    view.root.classList.toggle(UI_CLASS_NAMES.inlineBatchHighlight, group.matchCount > 0);
    view.root.dataset.groupId = group.id;
    view.root.dataset.state = nextExpanded ? 'expanded' : 'collapsed';
    view.summary.textContent = getFilledSummaryText(this.t, group);
    view.button.textContent = group.expanded ? this.t('actionCollapseBatch') : this.t('actionExpandBatch');
    view.button.setAttribute('aria-expanded', String(group.expanded));

    if (force || previewChanged) {
      this.renderCollapsedPreview(view.preview, group);
      view.previewKey = previewKey;
    }
    view.preview.hidden = nextExpanded;

    const shouldRenderEntries = nextExpanded
      ? force || entriesChanged || !view.entriesRendered
      : view.entriesRendered && (force || entriesChanged);
    if (shouldRenderEntries) {
      this.renderExpandedEntries(view.entries, group, query);
      view.entriesKey = entriesKey;
      view.entriesRendered = true;
    }
    view.entries.hidden = !nextExpanded;
    view.expanded = nextExpanded;
  }

  private renderCollapsedPreview(preview: HTMLElement, group: ManagedHistoryGroup): void {
    preview.replaceChildren();

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
  }

  private renderExpandedEntries(entries: HTMLElement, group: ManagedHistoryGroup, query: string): void {
    entries.replaceChildren();
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

      for (const entry of visibleEntries) {
        article.append(this.createEntryBody(entry));
      }
      entries.append(article);
    }
  }

  private createEntryBody(entry: ManagedHistoryEntry): HTMLElement {
    const lane = entry.role === 'user' ? 'user' : 'assistant';
    const body = renderManagedHistoryEntryBody(
      this.doc,
      entry,
      this.t,
      lane === 'user' ? this.t('roleUser') : this.t('roleAssistant'),
      false,
    );
    body.classList.add(UI_CLASS_NAMES.historyEntryBody);
    body.dataset.lane = lane;
    if (lane === 'assistant' && entry.role !== 'assistant') {
      body.dataset.supplementalRole = entry.role;
    }
    return body;
  }
}
