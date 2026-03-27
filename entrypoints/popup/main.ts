import { browser } from 'wxt/browser';

import type { TabStatusResponse } from '../../lib/shared/types';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');

function renderShell(): void {
  if (app == null) {
    return;
  }

  app.innerHTML = `
    <section class="popup-card">
      <h1>ChatGPT TurboRender</h1>
      <p class="popup-status" id="status-copy">Loading…</p>
      <div class="popup-row">
        <label>
          <input type="checkbox" id="enabled-toggle" />
          Enable TurboRender
        </label>
      </div>
    </section>
    <section class="popup-card">
      <h2>Current tab</h2>
      <div class="popup-grid" id="runtime-grid"></div>
      <div class="popup-actions">
        <button id="pause-chat"></button>
        <button id="restore-nearby">Restore nearby</button>
        <button id="restore-all">Restore all</button>
      </div>
    </section>
    <section class="popup-card">
      <h2>Settings</h2>
      <p class="popup-status">Fine-tune thresholds and fallback behavior.</p>
      <div class="popup-actions">
        <button data-variant="primary" id="open-options">Open options</button>
      </div>
    </section>
  `;
}

function renderRuntime(status: TabStatusResponse): void {
  const statusCopy = document.querySelector<HTMLElement>('#status-copy');
  const enabledToggle = document.querySelector<HTMLInputElement>('#enabled-toggle');
  const runtimeGrid = document.querySelector<HTMLElement>('#runtime-grid');
  const pauseButton = document.querySelector<HTMLButtonElement>('#pause-chat');
  const restoreNearbyButton = document.querySelector<HTMLButtonElement>('#restore-nearby');
  const restoreAllButton = document.querySelector<HTMLButtonElement>('#restore-all');

  if (
    statusCopy == null ||
    enabledToggle == null ||
    runtimeGrid == null ||
    pauseButton == null ||
    restoreNearbyButton == null ||
    restoreAllButton == null
  ) {
    return;
  }

  enabledToggle.checked = status.settings.enabled;

  if (status.runtime == null) {
    statusCopy.textContent = 'No supported ChatGPT tab was found in the active window.';
    runtimeGrid.innerHTML = '<span>State</span><span>Unavailable</span>';
    pauseButton.disabled = true;
    restoreNearbyButton.disabled = true;
    restoreAllButton.disabled = true;
    return;
  }

  const runtime = status.runtime;
  const label = !runtime.supported
    ? 'Unsupported'
    : runtime.paused
      ? 'Paused'
      : runtime.active
        ? runtime.softFallback
          ? 'Active (soft fallback)'
          : 'Active'
        : 'Monitoring';

  statusCopy.textContent = `${label} on ${runtime.chatId} (${runtime.mode} mode)`;
  runtimeGrid.innerHTML = `
    <span>Total turns</span><span>${runtime.totalTurns}</span>
    <span>Finalized</span><span>${runtime.finalizedTurns}</span>
    <span>Initial trim</span><span>${runtime.initialTrimApplied ? `Yes (${runtime.initialTrimmedTurns} cold)` : 'No'}</span>
    <span>Parked turns</span><span>${runtime.parkedTurns}</span>
    <span>Parked groups</span><span>${runtime.parkedGroups}</span>
    <span>Live DOM nodes</span><span>${runtime.liveDescendantCount}</span>
    <span>Mapping nodes</span><span>${runtime.totalMappingNodes}</span>
    <span>Frame spikes</span><span>${runtime.spikeCount}</span>
  `;

  pauseButton.disabled = !runtime.supported;
  pauseButton.textContent = status.paused ? 'Resume this chat' : 'Pause this chat';
  restoreNearbyButton.disabled = runtime.parkedGroups === 0;
  restoreAllButton.disabled = runtime.parkedGroups === 0;
}

async function fetchStatus(): Promise<TabStatusResponse> {
  return (await browser.runtime.sendMessage({ type: 'GET_TAB_STATUS' })) as TabStatusResponse;
}

async function refresh(): Promise<void> {
  renderRuntime(await fetchStatus());
}

renderShell();
void refresh();

document.addEventListener('change', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLInputElement) || target.id !== 'enabled-toggle') {
    return;
  }

  await browser.runtime.sendMessage({
    type: 'TOGGLE_GLOBAL',
    enabled: target.checked,
  });
  await refresh();
});

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.id === 'restore-nearby') {
    await browser.runtime.sendMessage({ type: 'RESTORE_NEARBY' });
    await refresh();
    return;
  }

  if (target.id === 'restore-all') {
    await browser.runtime.sendMessage({ type: 'RESTORE_ALL' });
    await refresh();
    return;
  }

  if (target.id === 'open-options') {
    await browser.runtime.openOptionsPage();
    return;
  }

  if (target.id === 'pause-chat') {
    const status = await fetchStatus();
    if (status.runtime == null) {
      return;
    }

    await browser.runtime.sendMessage({
      type: 'PAUSE_CHAT',
      chatId: status.runtime.chatId,
      paused: !status.paused,
    });
    await refresh();
  }
});
