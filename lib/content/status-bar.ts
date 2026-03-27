import { UI_CLASS_NAMES } from '../shared/constants';
import { createTranslator, type Translator } from '../shared/i18n';
import type { TabRuntimeStatus } from '../shared/types';

export interface StatusBarActions {
  onRestoreNearby(): void;
  onRestoreAll(): void;
  onTogglePause(): void;
  onInspectHistory(): void;
  onCloseHistory(): void;
}

const STYLE_ID = 'turbo-render-style';
const HISTORY_SHELF_ATTRIBUTE = 'data-turbo-render-history-shelf';

const STYLES = `
.${UI_CLASS_NAMES.statusBar} {
  position: sticky;
  top: 10px;
  z-index: 40;
  display: grid;
  gap: 10px;
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
  color: #0f172a;
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.statusBar}[data-state="active"] {
  border-color: rgba(16, 185, 129, 0.35);
}

.${UI_CLASS_NAMES.statusBar}[data-state="paused"] {
  border-color: rgba(245, 158, 11, 0.35);
}

.${UI_CLASS_NAMES.statusBar}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.statusBarTop} {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.${UI_CLASS_NAMES.statusBarSummary} {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.${UI_CLASS_NAMES.statusBarSummary} strong,
.${UI_CLASS_NAMES.coldHistoryHeader} strong {
  font-size: 13px;
}

.${UI_CLASS_NAMES.statusBarSummary} span,
.${UI_CLASS_NAMES.statusBarMeta},
.${UI_CLASS_NAMES.placeholderSummary},
.${UI_CLASS_NAMES.coldHistoryHeader} p {
  color: #475569;
}

.${UI_CLASS_NAMES.statusBarPrimary},
.${UI_CLASS_NAMES.statusBarActions},
.${UI_CLASS_NAMES.placeholderActions} {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.${UI_CLASS_NAMES.statusBarDetails} {
  display: grid;
  gap: 10px;
  padding-top: 2px;
}

.${UI_CLASS_NAMES.statusBarDetails}[hidden] {
  display: none !important;
}

.${UI_CLASS_NAMES.statusBar} button,
.${UI_CLASS_NAMES.placeholder} button {
  appearance: none;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  background: #ffffff;
  color: #0f172a;
  cursor: pointer;
  padding: 6px 10px;
  font: inherit;
}

.${UI_CLASS_NAMES.statusBar} button[data-variant="primary"] {
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}

.${UI_CLASS_NAMES.statusBar} button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.${UI_CLASS_NAMES.placeholder} {
  display: grid;
  gap: 8px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px dashed rgba(15, 23, 42, 0.24);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.9);
}

.${UI_CLASS_NAMES.placeholderSummary} {
  font: 12px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.coldHistoryTurns} {
  display: grid;
  gap: 12px;
  margin: 0 0 12px;
}

.${UI_CLASS_NAMES.coldHistoryHeader} {
  display: grid;
  gap: 4px;
  padding: 4px 2px;
}

.${UI_CLASS_NAMES.coldHistoryHeader} p {
  margin: 0;
}

.${UI_CLASS_NAMES.coldHistoryTurn} {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.88);
}

.${UI_CLASS_NAMES.coldHistoryTurn} header {
  font-weight: 600;
}

.${UI_CLASS_NAMES.coldHistoryTurn} p {
  margin: 0;
  white-space: pre-wrap;
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
  .${UI_CLASS_NAMES.statusBar} {
    top: 8px;
    margin-bottom: 10px;
    padding: 10px 12px;
  }

  .${UI_CLASS_NAMES.statusBarTop} {
    flex-direction: column;
  }
}
`;

export function ensureTurboRenderStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID) != null) {
    return;
  }

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

function getStateLabel(t: Translator, status: TabRuntimeStatus): string {
  if (!status.supported) {
    return t('stateUnsupported');
  }
  if (status.historyInspectionActive) {
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

function shouldShowShelf(status: TabRuntimeStatus): boolean {
  return status.supported && (status.active || status.paused || status.handledTurnsTotal > 0);
}

export class StatusBar {
  private root: HTMLElement | null = null;
  private mountTarget: HTMLElement | null = null;
  private summary: HTMLElement | null = null;
  private meta: HTMLElement | null = null;
  private details: HTMLElement | null = null;
  private inspectButton: HTMLButtonElement | null = null;
  private expandButton: HTMLButtonElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private restoreNearbyButton: HTMLButtonElement | null = null;
  private restoreAllButton: HTMLButtonElement | null = null;
  private expanded = false;
  private t: Translator = createTranslator('en');

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  setTranslator(translator: Translator): void {
    this.t = translator;
  }

  mount(target: HTMLElement | null): void {
    if (target == null) {
      return;
    }

    ensureTurboRenderStyles(this.doc);

    if (this.root == null) {
      this.root = this.doc.createElement('section');
      this.root.className = UI_CLASS_NAMES.statusBar;
      this.root.setAttribute(HISTORY_SHELF_ATTRIBUTE, 'true');
      this.root.innerHTML = `
        <div class="${UI_CLASS_NAMES.statusBarTop}">
          <div class="${UI_CLASS_NAMES.statusBarSummary}">
            <strong></strong>
            <span></span>
          </div>
          <div class="${UI_CLASS_NAMES.statusBarPrimary}">
            <button type="button" data-action="inspect-history" data-variant="primary"></button>
            <button type="button" data-action="toggle-expanded"></button>
          </div>
        </div>
        <div class="${UI_CLASS_NAMES.statusBarDetails}" hidden>
          <div class="${UI_CLASS_NAMES.statusBarMeta}"></div>
          <div class="${UI_CLASS_NAMES.statusBarActions}">
            <button type="button" data-action="restore-nearby"></button>
            <button type="button" data-action="restore-all"></button>
            <button type="button" data-action="toggle-pause"></button>
          </div>
        </div>
      `;

      this.summary = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.statusBarSummary} span`);
      this.meta = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.statusBarMeta}`);
      this.details = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.statusBarDetails}`);
      this.inspectButton = this.root.querySelector<HTMLButtonElement>('button[data-action="inspect-history"]');
      this.expandButton = this.root.querySelector<HTMLButtonElement>('button[data-action="toggle-expanded"]');
      this.pauseButton = this.root.querySelector<HTMLButtonElement>('button[data-action="toggle-pause"]');
      this.restoreNearbyButton = this.root.querySelector<HTMLButtonElement>('button[data-action="restore-nearby"]');
      this.restoreAllButton = this.root.querySelector<HTMLButtonElement>('button[data-action="restore-all"]');

      this.inspectButton?.addEventListener('click', () => {
        if (this.inspectButton?.dataset.mode === 'close') {
          this.actions.onCloseHistory();
          return;
        }
        this.actions.onInspectHistory();
      });
      this.expandButton?.addEventListener('click', () => {
        this.expanded = !this.expanded;
        this.details?.toggleAttribute('hidden', !this.expanded);
      });
      this.pauseButton?.addEventListener('click', () => this.actions.onTogglePause());
      this.restoreNearbyButton?.addEventListener('click', () => this.actions.onRestoreNearby());
      this.restoreAllButton?.addEventListener('click', () => this.actions.onRestoreAll());
    }

    if (this.mountTarget !== target || this.root.parentElement !== target) {
      this.mountTarget = target;
      target.insertBefore(this.root, target.firstChild);
    }
  }

  update(status: TabRuntimeStatus, target: HTMLElement | null): void {
    this.mount(target);
    if (
      this.root == null ||
      this.summary == null ||
      this.meta == null ||
      this.details == null ||
      this.inspectButton == null ||
      this.expandButton == null ||
      this.pauseButton == null ||
      this.restoreNearbyButton == null ||
      this.restoreAllButton == null
    ) {
      return;
    }

    const visible = shouldShowShelf(status);
    this.root.hidden = !visible;
    if (!visible) {
      return;
    }

    const title = this.root.querySelector<HTMLElement>(`.${UI_CLASS_NAMES.statusBarSummary} strong`);
    if (title != null) {
      title.textContent = this.t('appName');
    }

    const state =
      status.historyInspectionActive
        ? 'active'
        : !status.supported
          ? 'unsupported'
          : status.paused
            ? 'paused'
            : status.active
              ? 'active'
              : 'monitoring';
    this.root.dataset.state = state;

    if (status.historyInspectionActive) {
      this.summary.textContent = this.t('statusShelfInspecting', { count: status.handledTurnsTotal });
    } else if (status.handledTurnsTotal > 0) {
      this.summary.textContent = this.t('statusShelfManaged', { count: status.handledTurnsTotal });
    } else if (status.paused) {
      this.summary.textContent = this.t('statusShelfPaused');
    } else {
      this.summary.textContent = this.t('statusShelfMonitoring');
    }

    this.meta.textContent = this.t('statusShelfMeta', {
      state: getStateLabel(this.t, status),
      handled: status.handledTurnsTotal,
      nodes: status.liveDescendantCount,
      spikes: status.spikeCount,
    });

    this.details.toggleAttribute('hidden', !this.expanded);
    this.inspectButton.disabled = status.handledTurnsTotal === 0;
    this.inspectButton.dataset.mode = status.historyInspectionActive ? 'close' : 'open';
    this.inspectButton.textContent = status.historyInspectionActive
      ? this.t('actionHideHistory')
      : this.t('actionViewHistory');

    this.expandButton.textContent = this.expanded ? this.t('actionCollapse') : this.t('actionExpand');
    this.pauseButton.textContent = status.paused ? this.t('actionResumeChat') : this.t('actionPauseChat');
    this.pauseButton.disabled = !status.supported;
    this.restoreNearbyButton.textContent = this.t('actionRestoreNearby');
    this.restoreAllButton.textContent = this.t('actionRestoreAll');
    this.restoreNearbyButton.disabled = status.parkedGroups === 0;
    this.restoreAllButton.disabled = status.parkedGroups === 0;
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.mountTarget = null;
  }
}
