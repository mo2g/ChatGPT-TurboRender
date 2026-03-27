import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { getExtensionLanguage, createTranslator, normalizeLanguagePreference, type TranslationKey } from '../../lib/shared/i18n';
import { getSettings } from '../../lib/shared/settings';
import type { Settings } from '../../lib/shared/types';
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

function readPatchFromForm() {
  return {
    enabled: document.querySelector<HTMLInputElement>('#enabled')!.checked,
    autoEnable: document.querySelector<HTMLInputElement>('#autoEnable')!.checked,
    language: normalizeLanguagePreference(document.querySelector<HTMLSelectElement>('#language')!.value),
    mode: document.querySelector<HTMLSelectElement>('#mode')!.value as Settings['mode'],
    initialTrimEnabled: document.querySelector<HTMLInputElement>('#initialTrimEnabled')!.checked,
    coldRestoreMode: document.querySelector<HTMLSelectElement>('#coldRestoreMode')!.value as Settings['coldRestoreMode'],
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

function render(settings: Settings, statusKey?: TranslationKey): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app == null) {
    return;
  }

  const language = getExtensionLanguage(settings);
  const t = createTranslator(language);
  const statusText = statusKey != null ? t(statusKey) : t('statusStoredLocally');

  app.innerHTML = `
    <div class="options-shell">
      <section class="options-card">
        <h1>${t('appName')}</h1>
        <p>${t('statusOptionsIntro')}</p>
      </section>
      <section class="options-card">
        <h2>${t('labelBehavior')}</h2>
        <div class="toggle-row">
          <label><input type="checkbox" id="enabled" ${settings.enabled ? 'checked' : ''} /> ${t('labelEnabled')}</label>
          <label><input type="checkbox" id="autoEnable" ${settings.autoEnable ? 'checked' : ''} /> ${t('labelAutoEnable')}</label>
          <label><input type="checkbox" id="initialTrimEnabled" ${settings.initialTrimEnabled ? 'checked' : ''} /> ${t('labelInitialTrimEnabled')}</label>
          <label><input type="checkbox" id="softFallback" ${settings.softFallback ? 'checked' : ''} /> ${t('labelSoftFallback')}</label>
        </div>
        <div class="options-grid">
          <label>
            ${t('actionLanguage')}
            <select id="language">
              <option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>${t('languageAuto')}</option>
              <option value="en" ${settings.language === 'en' ? 'selected' : ''}>${t('languageEnglish')}</option>
              <option value="zh-CN" ${settings.language === 'zh-CN' ? 'selected' : ''}>${t('languageChinese')}</option>
            </select>
          </label>
          <label>
            ${t('labelMode')}
            <select id="mode">
              <option value="performance" ${settings.mode === 'performance' ? 'selected' : ''}>${t('labelPerformance')}</option>
              <option value="compatibility" ${settings.mode === 'compatibility' ? 'selected' : ''}>${t('labelCompatibility')}</option>
            </select>
          </label>
          <label>
            ${t('labelColdRestoreMode')}
            <select id="coldRestoreMode">
              <option value="placeholder" ${settings.coldRestoreMode === 'placeholder' ? 'selected' : ''}>${t('labelColdRestorePlaceholder')}</option>
              <option value="readOnly" ${settings.coldRestoreMode === 'readOnly' ? 'selected' : ''}>${t('labelColdRestoreReadOnly')}</option>
            </select>
          </label>
        </div>
      </section>
      <section class="options-card">
        <h2>${t('labelThresholds')}</h2>
        <div class="options-grid">
          <label>${t('labelFinalizedTurnsBeforeActivation')}<input type="number" id="minFinalizedBlocks" min="10" value="${settings.minFinalizedBlocks}" /></label>
          <label>${t('labelLiveDescendantsBeforeActivation')}<input type="number" id="minDescendants" min="100" value="${settings.minDescendants}" /></label>
          <label>${t('labelInitialHotTurns')}<input type="number" id="initialHotTurns" min="4" value="${settings.initialHotTurns}" /></label>
          <label>${t('labelLiveHotTurns')}<input type="number" id="liveHotTurns" min="4" value="${settings.liveHotTurns}" /></label>
          <label>${t('labelRecentHotTurns')}<input type="number" id="keepRecentTurns" min="4" value="${settings.keepRecentTurns}" /></label>
          <label>${t('labelViewportBufferTurns')}<input type="number" id="viewportBufferTurns" min="0" value="${settings.viewportBufferTurns}" /></label>
          <label>${t('labelTurnsPerColdGroup')}<input type="number" id="groupSize" min="2" value="${settings.groupSize}" /></label>
          <label>${t('labelFrameSpikeThreshold')}<input type="number" id="frameSpikeThresholdMs" min="16" value="${settings.frameSpikeThresholdMs}" /></label>
          <label>${t('labelFrameSpikeCount')}<input type="number" id="frameSpikeCount" min="1" value="${settings.frameSpikeCount}" /></label>
          <label>${t('labelFrameSpikeWindow')}<input type="number" id="frameSpikeWindowMs" min="500" value="${settings.frameSpikeWindowMs}" /></label>
        </div>
      </section>
      <section class="options-card">
        <div class="options-actions">
          <button data-variant="primary" id="save">${t('actionSave')}</button>
          <button id="reset">${t('actionResetDefaults')}</button>
        </div>
        <p id="save-status">${statusText}</p>
      </section>
    </div>
  `;
}

async function refresh(statusKey?: TranslationKey): Promise<void> {
  render(await getSettings(), statusKey);
}

void refresh();

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.id === 'save') {
    await browser.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      patch: readPatchFromForm(),
    });
    await refresh('statusSavedLocally');
    return;
  }

  if (target.id === 'reset') {
    await browser.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      patch: DEFAULT_SETTINGS,
    });
    await refresh('statusResetToDefaults');
  }
});
