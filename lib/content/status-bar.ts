import { UI_CLASS_NAMES } from '../shared/constants';
import { createTranslator, type Translator } from '../shared/i18n';
import type { ManagedHistoryEntry, TabRuntimeStatus } from '../shared/types';

export interface StatusBarActions {
  onRestoreNearby(): void;
  onRestoreAll(): void;
  onTogglePause(): void;
  onOpenHistoryPanel(): void;
  onCloseHistoryPanel(): void;
  onActivateHistoryEntry(entryId: string): void;
}

const STYLE_ID = 'turbo-render-style';
const HISTORY_PANEL_ROOT_ATTRIBUTE = 'data-turbo-render-history-panel-root';
const HISTORY_ENTRY_ATTRIBUTE = 'data-turbo-render-history-entry-id';

const STYLES = `
.${UI_CLASS_NAMES.historyOverlay} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 80;
}

.${UI_CLASS_NAMES.historyTrigger},
.${UI_CLASS_NAMES.historyDrawer},
.${UI_CLASS_NAMES.historyHint},
.${UI_CLASS_NAMES.placeholder} button {
  pointer-events: auto;
}

.${UI_CLASS_NAMES.historyTrigger} {
  position: fixed;
  top: var(--turbo-render-history-top, 88px);
  right: var(--turbo-render-history-right, 16px);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  color: #0f172a;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(12px);
  font: 12px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.historyTrigger}[data-state="paused"] {
  border-color: rgba(245, 158, 11, 0.35);
}

.${UI_CLASS_NAMES.historyTrigger}[data-state="active"] {
  border-color: rgba(16, 185, 129, 0.35);
}

.${UI_CLASS_NAMES.historyTriggerBadge} {
  min-width: 20px;
  padding: 2px 6px;
  border-radius: 999px;
  background: #0f172a;
  color: #ffffff;
  text-align: center;
  font-size: 11px;
}

.${UI_CLASS_NAMES.historyTriggerBadge}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.historyHint} {
  position: fixed;
  top: calc(var(--turbo-render-history-top, 88px) + 48px);
  right: var(--turbo-render-history-right, 16px);
  width: min(320px, calc(100vw - 24px));
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.98);
  color: #0f172a;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.historyHint}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.historyHintDismiss} {
  justify-self: end;
}

.${UI_CLASS_NAMES.historyDrawer} {
  position: fixed;
  top: var(--turbo-render-history-top, 88px);
  right: var(--turbo-render-history-right, 16px);
  width: min(420px, calc(100vw - 24px));
  max-height: min(78vh, calc(100vh - var(--turbo-render-history-top, 88px) - 16px));
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.98);
  color: #0f172a;
  box-shadow: 0 28px 60px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(16px);
  overflow: hidden;
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.historyDrawer}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.historyDrawerHeader},
.${UI_CLASS_NAMES.historyDrawerActions},
.${UI_CLASS_NAMES.historyDrawerSearch},
.${UI_CLASS_NAMES.placeholderActions} {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.${UI_CLASS_NAMES.historyDrawerCopy} {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.${UI_CLASS_NAMES.historyDrawerCopy} strong,
.${UI_CLASS_NAMES.coldHistoryHeader} strong {
  font-size: 13px;
}

.${UI_CLASS_NAMES.historyDrawerCopy} p,
.${UI_CLASS_NAMES.historyDrawerMeta},
.${UI_CLASS_NAMES.historyEntryMeta},
.${UI_CLASS_NAMES.placeholderSummary},
.${UI_CLASS_NAMES.coldHistoryHeader} p {
  margin: 0;
  color: #475569;
}

.${UI_CLASS_NAMES.historyDrawerSearch} input {
  flex: 1 1 220px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.95);
  color: #0f172a;
  font: inherit;
}

.${UI_CLASS_NAMES.historyDrawerResults},
.${UI_CLASS_NAMES.historyDrawerCards},
.${UI_CLASS_NAMES.coldHistoryTurns} {
  display: grid;
  gap: 10px;
  overflow: auto;
}

.${UI_CLASS_NAMES.historyDrawerResults}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.historyEntryCard},
.${UI_CLASS_NAMES.placeholder},
.${UI_CLASS_NAMES.coldHistoryTurn} {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.88);
}

.${UI_CLASS_NAMES.historyEntryBody},
.${UI_CLASS_NAMES.coldHistoryBody} {
  display: grid;
  gap: 6px;
}

.${UI_CLASS_NAMES.historyEntryBody} p,
.${UI_CLASS_NAMES.coldHistoryBody} p,
.${UI_CLASS_NAMES.coldHistoryTurn} p {
  margin: 0;
  white-space: pre-wrap;
}

.${UI_CLASS_NAMES.historyEntryAction} {
  justify-self: start;
}

.${UI_CLASS_NAMES.historyEntryHighlight},
.${UI_CLASS_NAMES.transcriptHighlight} {
  outline: 2px solid rgba(59, 130, 246, 0.42);
  outline-offset: 3px;
  background: rgba(219, 234, 254, 0.72) !important;
}

.${UI_CLASS_NAMES.placeholder} {
  margin: 12px 0;
  border-style: dashed;
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

.${UI_CLASS_NAMES.historyDrawer} button,
.${UI_CLASS_NAMES.historyTrigger},
.${UI_CLASS_NAMES.historyHint} button,
.${UI_CLASS_NAMES.placeholder} button {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  padding: 7px 11px;
  font: inherit;
}

.${UI_CLASS_NAMES.historyDrawer} button[data-variant="primary"],
.${UI_CLASS_NAMES.historyTrigger}[data-open="true"] {
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}

.${UI_CLASS_NAMES.historyDrawer} button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 960px) {
  .${UI_CLASS_NAMES.historyTrigger},
  .${UI_CLASS_NAMES.historyDrawer},
  .${UI_CLASS_NAMES.historyHint} {
    right: 12px;
  }

  .${UI_CLASS_NAMES.historyDrawer} {
    top: 76px;
    width: min(440px, calc(100vw - 24px));
    max-height: calc(100vh - 92px);
  }
}

@media (max-width: 720px) {
  .${UI_CLASS_NAMES.historyTrigger} {
    top: 72px;
  }

  .${UI_CLASS_NAMES.historyDrawer} {
    top: 72px;
    left: 12px;
    right: 12px;
    width: auto;
    max-height: calc(100vh - 88px);
  }

  .${UI_CLASS_NAMES.historyHint} {
    top: 120px;
    left: 12px;
    right: 12px;
    width: auto;
  }
}
`;

function getStateLabel(t: Translator, status: TabRuntimeStatus): string {
  if (!status.supported) {
    return t('stateUnsupported');
  }
  if (status.historyPanelOpen) {
    return t('stateInspecting');
  }
  if (status.paused) {
    return t('statePaused');
  }
  if (status.active) {
    return status.softFallback ? t('stateActiveSoft') : t('stateActive');
  }
  return t('stateMonitoring');
}

function getRoleLabel(t: Translator, role: ManagedHistoryEntry['role']): string {
  switch (role) {
    case 'user':
      return t('roleUser');
    case 'assistant':
      return t('roleAssistant');
    case 'system':
      return t('roleSystem');
    case 'tool':
      return t('roleTool');
    default:
      return t('roleUnknown');
  }
}

function getSourceLabel(t: Translator, source: ManagedHistoryEntry['source']): string {
  return source === 'initial-trim' ? t('historySearchInitialTrim') : t('historySearchParkedGroup');
}

function shouldShowControl(status: TabRuntimeStatus): boolean {
  return status.supported && (status.active || status.paused || status.handledTurnsTotal > 0);
}

function matchesEntry(entry: ManagedHistoryEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return entry.text.toLowerCase().includes(normalizedQuery);
}

function createEntryCard(
  doc: Document,
  t: Translator,
  entry: ManagedHistoryEntry,
  highlightedEntryId: string | null,
): HTMLElement {
  const article = doc.createElement('article');
  article.className = UI_CLASS_NAMES.historyEntryCard;
  if (entry.id === highlightedEntryId) {
    article.classList.add(UI_CLASS_NAMES.historyEntryHighlight);
  }
  article.setAttribute(HISTORY_ENTRY_ATTRIBUTE, entry.id);

  const meta = doc.createElement('div');
  meta.className = UI_CLASS_NAMES.historyEntryMeta;
  meta.textContent = `${getRoleLabel(t, entry.role)} • #${entry.turnIndex + 1} • ${getSourceLabel(t, entry.source)}`;
  article.append(meta);

  const body = doc.createElement('div');
  body.className = UI_CLASS_NAMES.historyEntryBody;
  const parts = entry.parts.length === 0 ? [entry.text] : entry.parts;
  for (const part of parts) {
    const paragraph = doc.createElement('p');
    paragraph.textContent = part;
    body.append(paragraph);
  }
  article.append(body);

  if (entry.source === 'parked-group') {
    const action = doc.createElement('button');
    action.type = 'button';
    action.className = UI_CLASS_NAMES.historyEntryAction;
    action.dataset.action = 'open-entry';
    action.dataset.entryId = entry.id;
    action.textContent = t('historySearchOpenChat');
    article.append(action);
  }

  return article;
}

export function ensureTurboRenderStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID) != null) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

export class StatusBar {
  private root: HTMLElement | null = null;
  private trigger: HTMLButtonElement | null = null;
  private triggerBadge: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private drawer: HTMLElement | null = null;
  private drawerTitle: HTMLElement | null = null;
  private drawerSummary: HTMLElement | null = null;
  private drawerMeta: HTMLElement | null = null;
  private searchWrap: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchResults: HTMLElement | null = null;
  private cards: HTMLElement | null = null;
  private restoreNearbyButton: HTMLButtonElement | null = null;
  private restoreAllButton: HTMLButtonElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private t: Translator = createTranslator('en');
  private currentStatus: TabRuntimeStatus | null = null;
  private currentEntries: ManagedHistoryEntry[] = [];
  private query = '';
  private highlightedEntryId: string | null = null;
  private lastChatId: string | null = null;
  private readonly dismissedHintChatIds = new Set<string>();

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  setTranslator(translator: Translator): void {
    this.t = translator;
    this.render();
  }

  update(
    status: TabRuntimeStatus,
    anchor: HTMLElement | null,
    entries: ManagedHistoryEntry[],
    highlightedEntryId: string | null,
  ): void {
    this.currentStatus = status;
    this.currentEntries = entries;
    this.highlightedEntryId = highlightedEntryId;

    if (this.lastChatId !== status.chatId) {
      this.lastChatId = status.chatId;
      this.query = '';
      this.highlightedEntryId = null;
    }

    this.mount(anchor);
    this.render();
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.trigger = null;
    this.triggerBadge = null;
    this.hint = null;
    this.drawer = null;
    this.drawerTitle = null;
    this.drawerSummary = null;
    this.drawerMeta = null;
    this.searchWrap = null;
    this.searchInput = null;
    this.searchResults = null;
    this.cards = null;
    this.restoreNearbyButton = null;
    this.restoreAllButton = null;
    this.pauseButton = null;
    this.closeButton = null;
  }

  private mount(anchor: HTMLElement | null): void {
    ensureTurboRenderStyles(this.doc);

    if (this.root == null) {
      this.root = this.doc.createElement('div');
      this.root.className = UI_CLASS_NAMES.historyOverlay;
      this.root.setAttribute(HISTORY_PANEL_ROOT_ATTRIBUTE, 'true');
      this.root.innerHTML = `
        <button type="button" class="${UI_CLASS_NAMES.historyTrigger}" data-action="toggle-panel">
          <span data-slot="label"></span>
          <span class="${UI_CLASS_NAMES.historyTriggerBadge}" data-slot="badge"></span>
        </button>
        <div class="${UI_CLASS_NAMES.historyHint}" hidden>
          <button type="button" class="${UI_CLASS_NAMES.historyHintDismiss}" data-action="dismiss-hint"></button>
          <p data-slot="hint-copy"></p>
        </div>
        <aside class="${UI_CLASS_NAMES.historyDrawer}" hidden>
          <div class="${UI_CLASS_NAMES.historyDrawerHeader}">
            <div class="${UI_CLASS_NAMES.historyDrawerCopy}">
              <strong></strong>
              <p></p>
            </div>
            <button type="button" data-action="close-panel"></button>
          </div>
          <div class="${UI_CLASS_NAMES.historyDrawerMeta}"></div>
          <div class="${UI_CLASS_NAMES.historyDrawerActions}">
            <button type="button" data-action="restore-nearby"></button>
            <button type="button" data-action="restore-all"></button>
            <button type="button" data-action="toggle-pause"></button>
          </div>
          <div class="${UI_CLASS_NAMES.historyDrawerSearch}">
            <input type="search" data-slot="search" />
          </div>
          <div class="${UI_CLASS_NAMES.historyDrawerResults}" hidden></div>
          <div class="${UI_CLASS_NAMES.historyDrawerCards}"></div>
        </aside>
      `;

      this.trigger = this.root.querySelector<HTMLButtonElement>(`.${UI_CLASS_NAMES.historyTrigger}`);
      this.triggerBadge = this.root.querySelector<HTMLElement>('[data-slot="badge"]');
      this.hint = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyHint}`);
      this.drawer = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawer}`);
      this.drawerTitle = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawerCopy} strong`);
      this.drawerSummary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawerCopy} p`);
      this.drawerMeta = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawerMeta}`);
      this.searchWrap = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawerSearch}`);
      this.searchInput = this.root.querySelector<HTMLInputElement>('input[data-slot="search"]');
      this.searchResults = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawerResults}`);
      this.cards = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.historyDrawerCards}`);
      this.restoreNearbyButton = this.root.querySelector<HTMLButtonElement>('button[data-action="restore-nearby"]');
      this.restoreAllButton = this.root.querySelector<HTMLButtonElement>('button[data-action="restore-all"]');
      this.pauseButton = this.root.querySelector<HTMLButtonElement>('button[data-action="toggle-pause"]');
      this.closeButton = this.root.querySelector<HTMLButtonElement>('button[data-action="close-panel"]');

      this.root.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest<HTMLButtonElement>('button[data-action]');
        if (button == null) {
          return;
        }

        const action = button.dataset.action;
        switch (action) {
          case 'toggle-panel':
            if (this.currentStatus?.historyPanelOpen) {
              this.actions.onCloseHistoryPanel();
            } else {
              this.actions.onOpenHistoryPanel();
            }
            break;
          case 'close-panel':
            this.actions.onCloseHistoryPanel();
            break;
          case 'restore-nearby':
            this.actions.onRestoreNearby();
            break;
          case 'restore-all':
            this.actions.onRestoreAll();
            break;
          case 'toggle-pause':
            this.actions.onTogglePause();
            break;
          case 'dismiss-hint':
            if (this.currentStatus != null) {
              this.dismissedHintChatIds.add(this.currentStatus.chatId);
              this.render();
            }
            break;
          case 'open-entry':
            if (button.dataset.entryId != null) {
              this.actions.onActivateHistoryEntry(button.dataset.entryId);
            }
            break;
          default:
            break;
        }
      });

      this.searchInput?.addEventListener('input', () => {
        this.query = this.searchInput?.value ?? '';
        this.renderEntrySections();
      });

      this.doc.body.append(this.root);
    }

    this.updatePosition(anchor);
  }

  private updatePosition(anchor: HTMLElement | null): void {
    if (this.root == null) {
      return;
    }

    const headerBottom = this.doc.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const mainTop = anchor?.closest('main')?.getBoundingClientRect().top ?? 72;
    const anchorRight = anchor?.getBoundingClientRect().right ?? this.doc.documentElement.clientWidth - 16;
    const gutterRight = Math.max(16, this.winWidth() - anchorRight);
    const top = Math.max(16, headerBottom + 12, mainTop + 12);
    const right = gutterRight >= 96 ? Math.max(12, gutterRight - 56) : 16;

    this.root.style.setProperty('--turbo-render-history-top', `${Math.round(top)}px`);
    this.root.style.setProperty('--turbo-render-history-right', `${Math.round(right)}px`);
  }

  private winWidth(): number {
    return this.doc.defaultView?.innerWidth ?? this.doc.documentElement.clientWidth ?? 1280;
  }

  private render(): void {
    if (
      this.root == null ||
      this.trigger == null ||
      this.triggerBadge == null ||
      this.hint == null ||
      this.drawer == null ||
      this.drawerTitle == null ||
      this.drawerSummary == null ||
      this.drawerMeta == null ||
      this.searchWrap == null ||
      this.searchInput == null ||
      this.searchResults == null ||
      this.cards == null ||
      this.restoreNearbyButton == null ||
      this.restoreAllButton == null ||
      this.pauseButton == null ||
      this.closeButton == null ||
      this.currentStatus == null
    ) {
      return;
    }

    const status = this.currentStatus;
    const visible = shouldShowControl(status);
    this.root.hidden = !visible;
    if (!visible) {
      return;
    }

    const state =
      !status.supported
        ? 'unsupported'
        : status.paused
          ? 'paused'
          : status.active
            ? 'active'
            : 'monitoring';

    this.trigger.dataset.state = state;
    this.trigger.dataset.open = status.historyPanelOpen ? 'true' : 'false';
    this.trigger.querySelector<HTMLElement>('[data-slot="label"]')!.textContent = this.t('historyTriggerLabel');
    this.triggerBadge.hidden = status.handledTurnsTotal === 0;
    this.triggerBadge.textContent = String(status.handledTurnsTotal);

    const showHint =
      status.handledTurnsTotal > 0 &&
      !status.historyPanelOpen &&
      !this.dismissedHintChatIds.has(status.chatId);
    this.hint.hidden = !showHint;
    this.hint.querySelector<HTMLButtonElement>('button[data-action="dismiss-hint"]')!.textContent =
      this.t('actionClose');
    this.hint.querySelector<HTMLElement>('[data-slot="hint-copy"]')!.textContent =
      this.t('historyDrawerHint');

    this.drawer.hidden = !status.historyPanelOpen;
    this.drawerTitle.textContent = this.t('historyDrawerTitle');
    this.drawerSummary.textContent =
      status.paused && this.currentEntries.length === 0
        ? this.t('historyDrawerPaused')
        : this.currentEntries.length > 0
          ? this.t('historyDrawerSummary', { count: status.handledTurnsTotal })
          : this.t('historyDrawerEmpty');
    this.drawerMeta.textContent = this.t('statusShelfMeta', {
      state: getStateLabel(this.t, status),
      handled: status.handledTurnsTotal,
      nodes: status.liveDescendantCount,
      spikes: status.spikeCount,
    });

    this.closeButton.textContent = this.t('actionHideHistory');
    this.restoreNearbyButton.textContent = this.t('actionRestoreNearby');
    this.restoreAllButton.textContent = this.t('actionRestoreAll');
    this.pauseButton.textContent = status.paused ? this.t('actionResumeChat') : this.t('actionPauseChat');
    this.pauseButton.disabled = !status.supported;
    this.restoreNearbyButton.disabled = status.parkedGroups === 0;
    this.restoreAllButton.disabled = status.parkedGroups === 0;

    this.searchWrap.hidden = this.currentEntries.length === 0;
    this.searchInput.placeholder = this.t('historySearchPlaceholder');
    if (this.searchInput.value !== this.query) {
      this.searchInput.value = this.query;
    }

    this.renderEntrySections();

    if (status.historyPanelOpen) {
      this.searchInput.focus();
      this.scrollHighlightedEntryIntoView();
    }
  }

  private renderEntrySections(): void {
    if (this.searchResults == null || this.cards == null || this.currentStatus == null) {
      return;
    }

    const entries = this.currentEntries.filter((entry) => matchesEntry(entry, this.query));

    this.searchResults.replaceChildren();
    this.cards.replaceChildren();

    if (this.query.trim().length > 0) {
      this.searchResults.hidden = false;
      const heading = this.doc.createElement('div');
      heading.className = UI_CLASS_NAMES.historyEntryMeta;
      heading.textContent =
        entries.length > 0
          ? this.t('historySearchResults', { count: entries.length })
          : this.t('historySearchNoMatches');
      this.searchResults.append(heading);

      for (const entry of entries) {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.dataset.action = 'open-entry';
        button.dataset.entryId = entry.id;
        button.textContent = `${getRoleLabel(this.t, entry.role)} • #${entry.turnIndex + 1} • ${
          entry.text.slice(0, 72) || getSourceLabel(this.t, entry.source)
        }`;
        this.searchResults.append(button);
      }
    } else {
      this.searchResults.hidden = true;
    }

    const cardsToRender = this.query.trim().length > 0 ? entries : this.currentEntries;
    if (cardsToRender.length === 0) {
      const empty = this.doc.createElement('div');
      empty.className = UI_CLASS_NAMES.historyEntryMeta;
      empty.textContent =
        this.query.trim().length > 0 ? this.t('historySearchNoMatches') : this.t('historyDrawerEmpty');
      this.cards.append(empty);
      return;
    }

    const summary = this.doc.createElement('div');
    summary.className = UI_CLASS_NAMES.historyEntryMeta;
    summary.textContent = this.t('historySearchSummary', { count: cardsToRender.length });
    this.cards.append(summary);

    for (const entry of cardsToRender) {
      this.cards.append(createEntryCard(this.doc, this.t, entry, this.highlightedEntryId));
    }
  }

  private scrollHighlightedEntryIntoView(): void {
    if (this.highlightedEntryId == null || this.cards == null) {
      return;
    }

    const target = this.cards.querySelector<HTMLElement>(`[${HISTORY_ENTRY_ATTRIBUTE}="${this.highlightedEntryId}"]`);
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}
