import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS, getSupportReadmeUrl, SUPPORT_ASSET_PATHS } from '../../lib/shared/constants';
import { getExtensionLanguage, createTranslator, normalizeLanguagePreference, type TranslationKey } from '../../lib/shared/i18n';
import { getSettings } from '../../lib/shared/settings';
import type { Settings } from '../../lib/shared/types';
import './style.css';

const FIELDS = [
  'minFinalizedBlocks',
  'minDescendants',
  'initialHotPairs',
  'liveHotPairs',
  'keepRecentPairs',
  'viewportBufferTurns',
  'batchPairCount',
  'frameSpikeThresholdMs',
  'frameSpikeCount',
  'frameSpikeWindowMs',
] as const;

let currentSupportUrl = getSupportReadmeUrl('en');

function getSupportAssets(): { wechat: string; alipay: string } {
  return {
    wechat: browser.runtime.getURL(SUPPORT_ASSET_PATHS.wechatSponsor),
    alipay: browser.runtime.getURL(SUPPORT_ASSET_PATHS.alipaySponsor),
  };
}

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
    initialHotPairs: Number(document.querySelector<HTMLInputElement>('#initialHotPairs')!.value),
    liveHotPairs: Number(document.querySelector<HTMLInputElement>('#liveHotPairs')!.value),
    keepRecentPairs: Number(document.querySelector<HTMLInputElement>('#keepRecentPairs')!.value),
    viewportBufferTurns: Number(document.querySelector<HTMLInputElement>('#viewportBufferTurns')!.value),
    batchPairCount: Number(document.querySelector<HTMLInputElement>('#batchPairCount')!.value),
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
  currentSupportUrl = getSupportReadmeUrl(language);
  const supportAssets = getSupportAssets();
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
          <label>${t('labelInitialHotPairs')}<input type="number" id="initialHotPairs" min="1" value="${settings.initialHotPairs}" /></label>
          <label>${t('labelLiveHotPairs')}<input type="number" id="liveHotPairs" min="1" value="${settings.liveHotPairs}" /></label>
          <label>${t('labelRecentHotPairs')}<input type="number" id="keepRecentPairs" min="1" value="${settings.keepRecentPairs}" /></label>
          <label>${t('labelViewportBufferTurns')}<input type="number" id="viewportBufferTurns" min="0" value="${settings.viewportBufferTurns}" /></label>
          <label>${t('labelPairsPerBatch')}<input type="number" id="batchPairCount" min="1" value="${settings.batchPairCount}" /></label>
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
      <section class="options-card support-card">
        <h2>${t('supportTitle')}</h2>
        <p class="support-copy">${t('supportLead')}</p>
        <div class="support-gallery">
          <figure class="support-figure">
            <img src="${supportAssets.wechat}" alt="${t('supportWeChatLabel')}" />
            <figcaption>${t('supportWeChatLabel')}</figcaption>
          </figure>
          <figure class="support-figure">
            <img src="${supportAssets.alipay}" alt="${t('supportAlipayLabel')}" />
            <figcaption>${t('supportAlipayLabel')}</figcaption>
          </figure>
        </div>
        <p class="support-note">${t('supportScanHint')}</p>
        <div class="options-actions">
          <button id="open-support">${t('supportAction')}</button>
        </div>
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
    return;
  }

  if (target.id === 'open-support') {
    window.open(currentSupportUrl, '_blank', 'noopener,noreferrer');
  }
});
