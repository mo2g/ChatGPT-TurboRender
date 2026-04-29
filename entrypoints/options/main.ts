import { browser } from 'wxt/browser';

import { DEFAULT_SETTINGS, getSupportReadmeUrl, SUPPORT_ASSET_PATHS } from '../../lib/shared/constants';
import { getExtensionLanguage, createTranslator, normalizeLanguagePreference, type TranslationKey } from '../../lib/shared/i18n';
import { getSettings } from '../../lib/shared/settings';
import type { Settings } from '../../lib/shared/types';
import './style.css';



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
    softFallback: document.querySelector<HTMLInputElement>('#softFallback')!.checked,
    enableTimeoutFallback: document.querySelector<HTMLInputElement>('#enableTimeoutFallback')?.checked ?? false,
    minFinalizedBlocks: Number(document.querySelector<HTMLInputElement>('#minFinalizedBlocks')!.value),
    minDescendants: Number(document.querySelector<HTMLInputElement>('#minDescendants')!.value),
    initialHotPairs: Number(document.querySelector<HTMLInputElement>('#initialHotPairs')!.value),
    liveHotPairs: Number(document.querySelector<HTMLInputElement>('#liveHotPairs')!.value),
    slidingWindowPairs: Number(document.querySelector<HTMLInputElement>('#slidingWindowPairs')!.value),
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
    debugEnabled: document.querySelector<HTMLInputElement>('#debugEnabled')?.checked ?? false,
    debugVerbose: document.querySelector<HTMLInputElement>('#debugVerbose')?.checked ?? false,
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
                <option value="sliding-window-inplace" ${settings.mode === 'sliding-window-inplace' ? 'selected' : ''}>${t('labelSlidingWindowInplace')}</option>
              <option value="sliding-window" ${settings.mode === 'sliding-window' ? 'selected' : ''}>${t('labelSlidingWindow')}</option>
              <option value="performance" ${settings.mode === 'performance' ? 'selected' : ''}>${t('labelPerformance')}</option>
            </select>
          </label>
        </div>
        <!-- 所有模式描述 -->
        <div class="options-mode-list">
            <div class="mode-item ${settings.mode === 'sliding-window-inplace' ? 'active' : ''}" data-mode="sliding-window-inplace">
            <strong>${t('labelSlidingWindowInplace')}</strong>
            <span class="mode-desc">${t('descSlidingWindowInplaceMode')}</span>
          </div>
          <div class="mode-item ${settings.mode === 'sliding-window' ? 'active' : ''}" data-mode="sliding-window">
            <strong>${t('labelSlidingWindow')}</strong>
            <span class="mode-desc">${t('descSlidingWindowMode')}</span>
          </div>
          <div class="mode-item ${settings.mode === 'performance' ? 'active' : ''}" data-mode="performance">
            <strong>${t('labelPerformance')}</strong>
            <span class="mode-desc">${t('descPerformanceMode')}</span>
          </div>
        </div>
        <p class="options-note">${t('slidingWindowPrivacyNote')}</p>
      </section>
      <section class="options-card">
        <h2>${t('labelThresholds')}</h2>
        <!-- Performance 模式特定设置 -->
        <div id="performance-specific-settings" class="mode-specific-thresholds" style="margin-top: 0;">
          <h3>${t('labelPerformanceSettings')}</h3>
          <div class="toggle-row">
            <label><input type="checkbox" id="autoEnable" ${settings.autoEnable ? 'checked' : ''} /> ${t('labelAutoEnable')}</label>
            <label><input type="checkbox" id="initialTrimEnabled" ${settings.initialTrimEnabled ? 'checked' : ''} /> ${t('labelInitialTrimEnabled')}</label>
            <label><input type="checkbox" id="softFallback" ${settings.softFallback ? 'checked' : ''} /> ${t('labelSoftFallback')}</label>
          </div>
          <!-- 自动启用阈值设置（仅当 autoEnable 开启时显示） -->
          <div id="auto-enable-thresholds" class="mode-specific-thresholds" style="margin-top: 1rem;">
            <h4>${t('labelAutoEnableThresholds')}</h4>
            <div class="options-grid">
              <label>${t('labelFinalizedTurnsBeforeActivation')}<input type="number" id="minFinalizedBlocks" min="10" value="${settings.minFinalizedBlocks}" /></label>
              <label>${t('labelLiveDescendantsBeforeActivation')}<input type="number" id="minDescendants" min="100" value="${settings.minDescendants}" /></label>
              <label>${t('labelFrameSpikeThreshold')}<input type="number" id="frameSpikeThresholdMs" min="16" value="${settings.frameSpikeThresholdMs}" /></label>
              <label>${t('labelFrameSpikeCount')}<input type="number" id="frameSpikeCount" min="1" value="${settings.frameSpikeCount}" /></label>
              <label>${t('labelFrameSpikeWindow')}<input type="number" id="frameSpikeWindowMs" min="500" value="${settings.frameSpikeWindowMs}" /></label>
            </div>
          </div>
        </div>
        <!-- 滑动窗口模式特定设置 -->
        <div id="sliding-window-thresholds" class="mode-specific-thresholds" style="margin-top: 1.5rem;">
          <h3>${t('labelSlidingWindowThresholds')}</h3>
          <div class="options-grid">
            <label>${t('labelSlidingWindowPairs')}<input type="number" id="slidingWindowPairs" min="1" max="50" value="${settings.slidingWindowPairs}" /></label>
            <label>${t('labelInitialHotPairs')}<input type="number" id="initialHotPairs" min="1" value="${settings.initialHotPairs}" /></label>
            <label>${t('labelLiveHotPairs')}<input type="number" id="liveHotPairs" min="1" value="${settings.liveHotPairs}" /></label>
            <label>${t('labelRecentHotPairs')}<input type="number" id="keepRecentPairs" min="1" value="${settings.keepRecentPairs}" /></label>
            <label>${t('labelViewportBufferTurns')}<input type="number" id="viewportBufferTurns" min="0" value="${settings.viewportBufferTurns}" /></label>
            <label>${t('labelPairsPerBatch')}<input type="number" id="batchPairCount" min="1" value="${settings.batchPairCount}" /></label>
          </div>
        </div>
        <!-- 无刷新模式特定设置 -->
        <div id="inplace-specific-settings" class="mode-specific-thresholds" style="margin-top: 1rem;">
          <div class="toggle-row">
            <label><input type="checkbox" id="enableTimeoutFallback" ${settings.enableTimeoutFallback ? 'checked' : ''} /> ${t('labelEnableTimeoutFallback')}</label>
          </div>
        </div>
        <!-- 调试设置 -->
        <div id="debug-settings" class="mode-specific-thresholds" style="margin-top: 1.5rem;">
          <h3>${t('labelDebugSettings')}</h3>
          <div class="toggle-row">
            <label><input type="checkbox" id="debugEnabled" ${settings.debugEnabled ? 'checked' : ''} /> ${t('labelDebugEnabled')}</label>
            <label><input type="checkbox" id="debugVerbose" ${settings.debugVerbose ? 'checked' : ''} /> ${t('labelDebugVerbose')}</label>
          </div>
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

function updateAutoEnableThresholdsVisibility(): void {
  const autoEnableThresholds = document.getElementById('auto-enable-thresholds');
  const autoEnableCheckbox = document.querySelector<HTMLInputElement>('#autoEnable');
  if (autoEnableThresholds && autoEnableCheckbox) {
    autoEnableThresholds.style.display = autoEnableCheckbox.checked ? 'block' : 'none';
  }
}

function updateDebugVerboseDisabled(debugEnabled: boolean): void {
  const debugVerboseCheckbox = document.querySelector<HTMLInputElement>('#debugVerbose');
  if (debugVerboseCheckbox) {
    debugVerboseCheckbox.disabled = !debugEnabled;
  }
}

async function refresh(statusKey?: TranslationKey): Promise<void> {
  const settings = await getSettings();
  render(settings, statusKey);
  // 设置模式特定设置的初始显示状态
  requestAnimationFrame(() => {
    const performanceSettings = document.getElementById('performance-specific-settings');
    const slidingWindowThresholds = document.getElementById('sliding-window-thresholds');
    const inplaceSpecificSettings = document.getElementById('inplace-specific-settings');
    
    const isPerformance = settings.mode === 'performance';
    const isSlidingWindow = settings.mode === 'sliding-window' || settings.mode === 'sliding-window-inplace';
    const isInplaceMode = settings.mode === 'sliding-window-inplace';
    
    if (performanceSettings) {
      performanceSettings.style.display = isPerformance ? 'block' : 'none';
    }
    if (slidingWindowThresholds) {
      slidingWindowThresholds.style.display = isSlidingWindow ? 'block' : 'none';
    }
    if (inplaceSpecificSettings) {
      inplaceSpecificSettings.style.display = isInplaceMode ? 'block' : 'none';
    }
    
    // 根据 autoEnable 状态显示/隐藏阈值设置
    updateAutoEnableThresholdsVisibility();
    
    // 初始化 debugVerbose 禁用状态
    updateDebugVerboseDisabled(settings.debugEnabled);
  });
}

void refresh();

// 动态显示/隐藏模式特定设置
document.addEventListener('change', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.id === 'mode') {
    const mode = (target as HTMLSelectElement).value as Settings['mode'];
    const performanceSettings = document.getElementById('performance-specific-settings');
    const slidingWindowThresholds = document.getElementById('sliding-window-thresholds');
    const inplaceSpecificSettings = document.getElementById('inplace-specific-settings');
    
    const isPerformance = mode === 'performance';
    const isSlidingWindow = mode === 'sliding-window' || mode === 'sliding-window-inplace';
    const isInplaceMode = mode === 'sliding-window-inplace';
    
    if (performanceSettings) {
      performanceSettings.style.display = isPerformance ? 'block' : 'none';
    }
    if (slidingWindowThresholds) {
      slidingWindowThresholds.style.display = isSlidingWindow ? 'block' : 'none';
    }
    if (inplaceSpecificSettings) {
      inplaceSpecificSettings.style.display = isInplaceMode ? 'block' : 'none';
    }
    
    // 更新模式列表中的 active 状态
    const modeItems = document.querySelectorAll('.mode-item');
    modeItems.forEach((item) => {
      const itemMode = item.getAttribute('data-mode');
      item.classList.toggle('active', itemMode === mode);
    });
    
    // 当切换到 Performance 模式时，根据 autoEnable 状态更新阈值显示
    if (isPerformance) {
      updateAutoEnableThresholdsVisibility();
    }
  }
  
  // autoEnable 复选框变化时，显示/隐藏阈值设置
  if (target?.id === 'autoEnable') {
    updateAutoEnableThresholdsVisibility();
  }
  
  // debugEnabled 复选框变化时，启用/禁用 debugVerbose
  if (target?.id === 'debugEnabled') {
    const debugEnabled = (target as HTMLInputElement).checked;
    const debugVerboseCheckbox = document.querySelector<HTMLInputElement>('#debugVerbose');
    if (debugVerboseCheckbox) {
      debugVerboseCheckbox.disabled = !debugEnabled;
      if (!debugEnabled) {
        debugVerboseCheckbox.checked = false;
      }
    }
  }
});

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
