import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { getSettings } from '../../lib/shared/settings';
import './style.css';

const FIELDS = [
  'minFinalizedBlocks',
  'minDescendants',
  'initialHotTurns',
  'liveHotTurns',
  'keepRecentTurns',
  'viewportBufferTurns',
  'groupSize',
  'frameSpikeThresholdMs',
  'frameSpikeCount',
  'frameSpikeWindowMs',
] as const;

function render(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app == null) {
    return;
  }

  app.innerHTML = `
    <div class="options-shell">
      <section class="options-card">
        <h1>ChatGPT TurboRender</h1>
        <p>Adjust the early trim policy, hot-window retention, and the fallback mode used when the host page re-renders aggressively.</p>
      </section>
      <section class="options-card">
        <h2>Behavior</h2>
        <div class="toggle-row">
          <label><input type="checkbox" id="enabled" /> Enabled</label>
          <label><input type="checkbox" id="autoEnable" /> Auto-enable when thresholds trip</label>
          <label><input type="checkbox" id="initialTrimEnabled" /> Trim long conversations before the official render</label>
          <label><input type="checkbox" id="softFallback" /> Start in soft-fold mode</label>
        </div>
        <div class="options-grid">
          <label>
            Mode
            <select id="mode">
              <option value="performance">Performance</option>
              <option value="compatibility">Compatibility</option>
            </select>
          </label>
          <label>
            Cold restore mode
            <select id="coldRestoreMode">
              <option value="placeholder">Placeholder first</option>
              <option value="readOnly">Read-only restore</option>
            </select>
          </label>
        </div>
      </section>
      <section class="options-card">
        <h2>Thresholds</h2>
        <div class="options-grid">
          <label>Finalized turns before activation<input type="number" id="minFinalizedBlocks" min="10" /></label>
          <label>Live descendants before activation<input type="number" id="minDescendants" min="100" /></label>
          <label>Initial hot turns for payload trim<input type="number" id="initialHotTurns" min="4" /></label>
          <label>Live hot turns after initial load<input type="number" id="liveHotTurns" min="4" /></label>
          <label>Recent turns to keep hot<input type="number" id="keepRecentTurns" min="4" /></label>
          <label>Viewport buffer turns<input type="number" id="viewportBufferTurns" min="0" /></label>
          <label>Turns per cold group<input type="number" id="groupSize" min="2" /></label>
          <label>Frame spike threshold (ms)<input type="number" id="frameSpikeThresholdMs" min="16" /></label>
          <label>Frame spikes required<input type="number" id="frameSpikeCount" min="1" /></label>
          <label>Frame spike window (ms)<input type="number" id="frameSpikeWindowMs" min="500" /></label>
        </div>
      </section>
      <section class="options-card">
        <div class="options-actions">
          <button data-variant="primary" id="save">Save</button>
          <button id="reset">Reset defaults</button>
        </div>
        <p id="save-status">Settings are stored locally in your browser profile.</p>
      </section>
    </div>
  `;
}

async function loadSettingsIntoForm(): Promise<void> {
  const settings = await getSettings();
  (document.querySelector<HTMLInputElement>('#enabled')!).checked = settings.enabled;
  (document.querySelector<HTMLInputElement>('#autoEnable')!).checked = settings.autoEnable;
  (document.querySelector<HTMLInputElement>('#initialTrimEnabled')!).checked = settings.initialTrimEnabled;
  (document.querySelector<HTMLInputElement>('#softFallback')!).checked = settings.softFallback;
  (document.querySelector<HTMLSelectElement>('#mode')!).value = settings.mode;
  (document.querySelector<HTMLSelectElement>('#coldRestoreMode')!).value = settings.coldRestoreMode;

  for (const field of FIELDS) {
    (document.querySelector<HTMLInputElement>(`#${field}`)!).value = String(settings[field]);
  }
}

function readPatchFromForm() {
  return {
    enabled: document.querySelector<HTMLInputElement>('#enabled')!.checked,
    autoEnable: document.querySelector<HTMLInputElement>('#autoEnable')!.checked,
    mode: document.querySelector<HTMLSelectElement>('#mode')!.value,
    initialTrimEnabled: document.querySelector<HTMLInputElement>('#initialTrimEnabled')!.checked,
    coldRestoreMode: document.querySelector<HTMLSelectElement>('#coldRestoreMode')!.value,
    softFallback: document.querySelector<HTMLInputElement>('#softFallback')!.checked,
    minFinalizedBlocks: Number(document.querySelector<HTMLInputElement>('#minFinalizedBlocks')!.value),
    minDescendants: Number(document.querySelector<HTMLInputElement>('#minDescendants')!.value),
    initialHotTurns: Number(document.querySelector<HTMLInputElement>('#initialHotTurns')!.value),
    liveHotTurns: Number(document.querySelector<HTMLInputElement>('#liveHotTurns')!.value),
    keepRecentTurns: Number(document.querySelector<HTMLInputElement>('#keepRecentTurns')!.value),
    viewportBufferTurns: Number(document.querySelector<HTMLInputElement>('#viewportBufferTurns')!.value),
    groupSize: Number(document.querySelector<HTMLInputElement>('#groupSize')!.value),
    frameSpikeThresholdMs: Number(
      document.querySelector<HTMLInputElement>('#frameSpikeThresholdMs')!.value,
    ),
    frameSpikeCount: Number(document.querySelector<HTMLInputElement>('#frameSpikeCount')!.value),
    frameSpikeWindowMs: Number(
      document.querySelector<HTMLInputElement>('#frameSpikeWindowMs')!.value,
    ),
  };
}

render();
void loadSettingsIntoForm();

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const status = document.querySelector<HTMLElement>('#save-status');
  if (status == null) {
    return;
  }

  if (target.id === 'save') {
    await browser.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      patch: readPatchFromForm(),
    });
    status.textContent = 'Saved locally.';
    return;
  }

  if (target.id === 'reset') {
    await browser.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      patch: DEFAULT_SETTINGS,
    });
    await loadSettingsIntoForm();
    status.textContent = 'Reset to defaults.';
  }
});
