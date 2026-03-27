import { PLACEHOLDER_TEXT, UI_CLASS_NAMES } from '../shared/constants';
import type { TabRuntimeStatus } from '../shared/types';

export interface StatusBarActions {
  onRestoreNearby(): void;
  onRestoreAll(): void;
  onTogglePause(): void;
}

const STYLE_ID = 'turbo-render-style';

const STYLES = `
.${UI_CLASS_NAMES.statusBar} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  display: grid;
  gap: 10px;
  min-width: 260px;
  max-width: 360px;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(12px);
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.12);
  color: #0f172a;
  font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.statusBar}[data-state="active"] {
  border-color: rgba(16, 185, 129, 0.35);
}

.${UI_CLASS_NAMES.statusBar}[data-state="paused"],
.${UI_CLASS_NAMES.statusBar}[data-state="unsupported"] {
  border-color: rgba(245, 158, 11, 0.35);
}

.${UI_CLASS_NAMES.statusBar} strong {
  font-size: 13px;
}

.${UI_CLASS_NAMES.statusBar} .turbo-render-status-bar__meta {
  color: #475569;
}

.${UI_CLASS_NAMES.statusBar} .turbo-render-status-bar__actions,
.${UI_CLASS_NAMES.placeholderActions} {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  color: #334155;
  font: 12px/1.4 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.${UI_CLASS_NAMES.coldHistoryTurns} {
  display: grid;
  gap: 12px;
  margin: 12px 0;
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

function getStateLabel(status: TabRuntimeStatus): string {
  if (!status.supported) {
    return 'Unsupported';
  }
  if (status.paused) {
    return 'Paused';
  }
  if (status.active) {
    return status.softFallback ? 'Active (soft)' : 'Active';
  }
  return 'Monitoring';
}

export class StatusBar {
  private root: HTMLElement | null = null;
  private metrics: HTMLElement | null = null;
  private meta: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private restoreNearbyButton: HTMLButtonElement | null = null;
  private restoreAllButton: HTMLButtonElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly actions: StatusBarActions,
  ) {}

  mount(): void {
    if (this.root != null) {
      return;
    }

    ensureTurboRenderStyles(this.doc);

    this.root = this.doc.createElement('section');
    this.root.className = UI_CLASS_NAMES.statusBar;
    this.root.innerHTML = `
      <div>
        <strong>ChatGPT TurboRender</strong>
      </div>
      <div class="turbo-render-status-bar__metrics"></div>
      <div class="turbo-render-status-bar__meta"></div>
      <div class="turbo-render-status-bar__actions">
        <button type="button" data-action="restore-nearby">${PLACEHOLDER_TEXT.restoreNearby}</button>
        <button type="button" data-action="restore-all">${PLACEHOLDER_TEXT.restoreAll}</button>
        <button type="button" data-action="toggle-pause">${PLACEHOLDER_TEXT.pause}</button>
      </div>
    `;

    this.metrics = this.root.querySelector<HTMLElement>('.turbo-render-status-bar__metrics');
    this.meta = this.root.querySelector<HTMLElement>('.turbo-render-status-bar__meta');
    this.pauseButton = this.root.querySelector<HTMLButtonElement>('button[data-action="toggle-pause"]');
    this.restoreNearbyButton = this.root.querySelector<HTMLButtonElement>(
      'button[data-action="restore-nearby"]',
    );
    this.restoreAllButton = this.root.querySelector<HTMLButtonElement>('button[data-action="restore-all"]');

    this.pauseButton?.addEventListener('click', () => this.actions.onTogglePause());
    this.restoreNearbyButton?.addEventListener('click', () => this.actions.onRestoreNearby());
    this.restoreAllButton?.addEventListener('click', () => this.actions.onRestoreAll());

    this.doc.body.append(this.root);
  }

  update(status: TabRuntimeStatus): void {
    this.mount();
    if (this.root == null || this.metrics == null || this.meta == null || this.pauseButton == null) {
      return;
    }

    const state =
      !status.supported ? 'unsupported' : status.paused ? 'paused' : status.active ? 'active' : 'monitoring';
    this.root.dataset.state = state;

    this.metrics.textContent = `${getStateLabel(status)} • ${status.parkedTurns}/${status.totalTurns} parked • ${status.liveDescendantCount} live nodes`;
    this.meta.textContent = status.reason
      ? `Reason: ${status.reason}`
      : `Chat ${status.chatId} • ${status.mode} mode • ${status.parkedGroups} groups • ${status.spikeCount} recent frame spikes`;

    this.pauseButton.textContent = status.paused ? PLACEHOLDER_TEXT.resume : PLACEHOLDER_TEXT.pause;
    this.pauseButton.disabled = !status.supported;
    if (this.restoreNearbyButton != null) {
      this.restoreNearbyButton.disabled = status.parkedGroups === 0;
    }
    if (this.restoreAllButton != null) {
      this.restoreAllButton.disabled = status.parkedGroups === 0;
    }
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
  }
}
