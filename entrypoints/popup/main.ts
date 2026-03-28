import { browser } from 'wxt/browser';

import { createTranslator, getExtensionLanguage, normalizeLanguagePreference } from '../../lib/shared/i18n';
import type { TabStatusResponse } from '../../lib/shared/types';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');

function getRuntimeLabel(status: TabStatusResponse['runtime'], t: ReturnType<typeof createTranslator>): string {
  if (status == null) {
    return t('statusUnavailable');
  }
  if (status.archiveOnly) {
    return t('stateArchiveOnly');
  }
  if (!status.supported) {
    return t('stateUnsupported');
  }
  if (status.paused) {
    return t('statePaused');
  }
  if (status.active) {
    return status.softFallback ? t('stateActiveSoft') : t('stateActive');
  }
  return t('stateMonitoring');
}

function formatStartedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }

  return new Date(timestamp).toLocaleString();
}

function render(status: TabStatusResponse): void {
  if (app == null) {
    return;
  }

  const language = getExtensionLanguage(status.settings);
  const t = createTranslator(language);
  const runtime = status.runtime;
  const initialTrim = runtime?.initialTrimApplied
    ? t('statusHistoryYes', { count: runtime.initialTrimmedTurns })
    : t('statusHistoryNo');

  app.innerHTML = `
    <section class="popup-card">
      <h1>${t('appName')}</h1>
      <p class="popup-status" id="status-copy">${
        runtime == null
          ? t('statusNoSupportedTab')
          : `${getRuntimeLabel(runtime, t)} • ${runtime.chatId}`
      }</p>
      <div class="popup-row">
        <label>
          <input type="checkbox" id="enabled-toggle" ${status.settings.enabled ? 'checked' : ''} />
          ${t('actionEnableTurboRender')}
        </label>
        <label>
          <span>${t('actionLanguage')}</span>
          <select id="language-select">
            <option value="auto" ${status.settings.language === 'auto' ? 'selected' : ''}>${t('languageAuto')}</option>
            <option value="en" ${status.settings.language === 'en' ? 'selected' : ''}>${t('languageEnglish')}</option>
            <option value="zh-CN" ${status.settings.language === 'zh-CN' ? 'selected' : ''}>${t('languageChinese')}</option>
          </select>
        </label>
      </div>
    </section>
    <section class="popup-card">
      <h2>${t('labelCurrentTab')}</h2>
      <p class="popup-status">${t('statusPopupTopShelfHint')}</p>
      <div class="popup-grid">
        ${
          runtime == null
            ? `<span>${t('labelCurrentTab')}</span><span>${t('statusUnavailable')}</span>`
            : `
              <span>${t('labelTotalTurns')}</span><span>${runtime.totalTurns}</span>
              <span>${t('labelTotalPairs')}</span><span>${runtime.totalPairs}</span>
              <span>${t('labelHotPairsVisible')}</span><span>${runtime.hotPairsVisible}</span>
              <span>${t('labelFinalized')}</span><span>${runtime.finalizedTurns}</span>
              <span>${t('labelInitialTrim')}</span><span>${initialTrim}</span>
              <span>${t('labelHandledHistory')}</span><span>${runtime.handledTurnsTotal}</span>
              <span>${t('labelArchivedTurns')}</span><span>${runtime.archivedTurnsTotal}</span>
              <span>${t('labelCollapsedBatches')}</span><span>${runtime.collapsedBatchCount}</span>
              <span>${t('labelExpandedBatches')}</span><span>${runtime.expandedBatchCount}</span>
              <span>${t('labelRouteKind')}</span><span>${runtime.routeKind}</span>
              <span>${t('labelContentScriptInstance')}</span><span>${runtime.contentScriptInstanceId.slice(0, 8)}</span>
              <span>${t('labelContentScriptStarted')}</span><span>${formatStartedAt(runtime.contentScriptStartedAt)}</span>
              <span>${t('labelBuildSignature')}</span><span>${runtime.buildSignature}</span>
              <span>${t('labelParkedTurns')}</span><span>${runtime.parkedTurns}</span>
              <span>${t('labelParkedGroups')}</span><span>${runtime.parkedGroups}</span>
              <span>${t('labelLiveDomNodes')}</span><span>${runtime.liveDescendantCount}</span>
              <span>${t('labelMappingNodes')}</span><span>${runtime.totalMappingNodes}</span>
              <span>${t('labelFrameSpikes')}</span><span>${runtime.spikeCount}</span>
            `
        }
      </div>
      <div class="popup-actions">
        <button id="pause-chat" ${runtime == null || !runtime.supported ? 'disabled' : ''}>
          ${status.paused ? t('actionResumeChat') : t('actionPauseChat')}
        </button>
        <button id="restore-nearby" ${runtime == null || runtime.collapsedBatchCount === 0 ? 'disabled' : ''}>
          ${t('actionRestoreNearby')}
        </button>
        <button id="restore-all" ${runtime == null || runtime.collapsedBatchCount === 0 ? 'disabled' : ''}>
          ${t('actionRestoreAll')}
        </button>
      </div>
    </section>
    <section class="popup-card">
      <h2>${t('labelSettings')}</h2>
      <p class="popup-status">${t('statusPopupSettingsHint')}</p>
      <div class="popup-actions">
        <button data-variant="primary" id="open-options">${t('actionOpenOptions')}</button>
      </div>
    </section>
  `;
}

async function fetchStatus(): Promise<TabStatusResponse> {
  return (await browser.runtime.sendMessage({ type: 'GET_TAB_STATUS' })) as TabStatusResponse;
}

async function refresh(): Promise<void> {
  render(await fetchStatus());
}

void refresh();

document.addEventListener('change', async (event) => {
  const target = event.target as HTMLElement | null;
  if (target instanceof HTMLInputElement && target.id === 'enabled-toggle') {
    await browser.runtime.sendMessage({
      type: 'TOGGLE_GLOBAL',
      enabled: target.checked,
    });
    await refresh();
    return;
  }

  if (target instanceof HTMLSelectElement && target.id === 'language-select') {
    await browser.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      patch: { language: normalizeLanguagePreference(target.value) },
    });
    await refresh();
  }
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
