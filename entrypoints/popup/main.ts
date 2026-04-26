import { browser } from 'wxt/browser';

import {
  POPUP_DEMO_SHARE_URL,
  getPopupHelpReadmeUrl,
  getSupportReadmeUrl,
  SUPPORT_ASSET_PATHS,
} from '../../lib/shared/constants';
import {
  createTranslator,
  getExtensionLanguage,
  normalizeLanguagePreference,
  resolveUiLanguage,
  type Translator,
} from '../../lib/shared/i18n';
import type { TabStatusResponse } from '../../lib/shared/types';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
const fallbackLanguage = resolveUiLanguage('auto', navigator.language);
const fallbackTranslator = createTranslator(fallbackLanguage);

let currentSupportUrl = getSupportReadmeUrl('en');
let currentPopupHelpUrl = getPopupHelpReadmeUrl('en');
let currentPopupDemoUrl = POPUP_DEMO_SHARE_URL;
let latestStatus: TabStatusResponse | null = null;

type PopupState =
  | 'unsupported-web'
  | 'unsupported-chatgpt-home'
  | 'unsupported-chatgpt-route'
  | 'unsupported-runtime'
  | 'temporary-unavailable'
  | 'window-fallback'
  | 'paused'
  | 'active'
  | 'monitoring'
  | 'error'
  | 'loading';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function getSupportAssets(): { wechat: string; alipay: string } {
  return {
    wechat: browser.runtime.getURL(SUPPORT_ASSET_PATHS.wechatSponsor),
    alipay: browser.runtime.getURL(SUPPORT_ASSET_PATHS.alipaySponsor),
  };
}

function isSupportedConversationRoute(kind: TabStatusResponse['activeTabRouteKind']): boolean {
  return kind === 'chat' || kind === 'share';
}

function isTabStatusResponse(value: unknown): value is TabStatusResponse {
  return typeof value === 'object' && value !== null && 'settings' in value && 'runtime' in value;
}

function getUnsupportedReasonLabel(
  reason: string | null,
  t: Translator,
): string {
  switch (reason) {
    case 'missing-main':
      return t('statusUnsupportedReasonMissingMain');
    case 'no-turns':
      return t('statusUnsupportedReasonNoTurns');
    case 'split-parents':
      return t('statusUnsupportedReasonSplitParents');
    default:
      return t('statusUnsupportedReasonGeneric');
  }
}

function getRuntimeLabel(status: TabStatusResponse['runtime'], t: Translator): string {
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

function getStatusCopy(status: TabStatusResponse, t: Translator): string {
  const runtime = status.runtime;

  if (runtime == null) {
    if (status.activeTabSupportedHost && isSupportedConversationRoute(status.activeTabRouteKind)) {
      return t('statusSupportedRouteTemporarilyUnavailable');
    }

    if (status.activeTabSupportedHost) {
      return t('statusNoSupportedConversationPage');
    }

    return t('statusNoSupportedTab');
  }

  if (runtime.archiveOnly) {
    return `${getRuntimeLabel(runtime, t)} • ${runtime.chatId}`;
  }

  if (!runtime.supported) {
    return `${getRuntimeLabel(runtime, t)} • ${getUnsupportedReasonLabel(runtime.reason, t)}`;
  }

  return `${getRuntimeLabel(runtime, t)} • ${runtime.chatId}`;
}

function getRuntimeDetail(status: TabStatusResponse, t: Translator): string {
  const runtime = status.runtime;

  if (runtime == null) {
    if (status.activeTabSupportedHost && status.activeTabRouteKind === 'home') {
      return t('statusPopupHomeUnsupportedLead');
    }

    if (status.activeTabSupportedHost && isSupportedConversationRoute(status.activeTabRouteKind)) {
      return t('statusSupportedRouteTemporarilyUnavailable');
    }

    return t('statusPopupUnsupportedLead');
  }

  if (runtime.archiveOnly) {
    return t('statusShelfMonitoring');
  }

  if (!runtime.supported) {
    return getUnsupportedReasonLabel(runtime.reason, t);
  }

  if (status.usingWindowFallback) {
    return t('statusPopupFallbackLead');
  }

  if (runtime.paused) {
    return t('statusShelfPaused');
  }

  if (!runtime.active) {
    return t('statusInactiveThresholdHint', {
      finalized: status.settings.minFinalizedBlocks,
      nodes: status.settings.minDescendants,
      spikes: status.settings.frameSpikeCount,
      windowMs: status.settings.frameSpikeWindowMs,
    });
  }

  return t('statusShelfMonitoring');
}

function getPopupState(status: TabStatusResponse): PopupState {
  const runtime = status.runtime;

  if (runtime == null) {
    if (status.activeTabSupportedHost && status.activeTabRouteKind === 'home') {
      return 'unsupported-chatgpt-home';
    }

    if (status.activeTabSupportedHost && isSupportedConversationRoute(status.activeTabRouteKind)) {
      return 'temporary-unavailable';
    }

    if (status.activeTabSupportedHost) {
      return 'unsupported-chatgpt-route';
    }

    return 'unsupported-web';
  }

  if (runtime.archiveOnly) {
    return runtime.paused ? 'paused' : runtime.active ? 'active' : 'monitoring';
  }

  if (!runtime.supported) {
    return 'unsupported-runtime';
  }

  if (status.usingWindowFallback) {
    return 'window-fallback';
  }

  if (runtime.paused) {
    return 'paused';
  }

  if (runtime.active) {
    return 'active';
  }

  return 'monitoring';
}

function isUnsupportedPopupState(popupState: string): boolean {
  return (
    popupState === 'unsupported-web' ||
    popupState === 'unsupported-chatgpt-home' ||
    popupState === 'unsupported-chatgpt-route' ||
    popupState === 'unsupported-runtime'
  );
}

function shouldRenderInlineDetails(status: TabStatusResponse): boolean {
  return status.runtime != null && (status.runtime.supported || status.runtime.archiveOnly);
}

function formatStartedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }

  return new Date(timestamp).toLocaleString();
}

function renderSupportRules(t: Translator): string {
  return `
    <div class="popup-rules">
      <h2>${escapeHtml(t('statusPopupRulesTitle'))}</h2>
      <p>${escapeHtml(t('statusPopupRulesLead'))}</p>
      <ul>
        <li><code>${escapeHtml(t('statusPopupRuleChatGpt'))}</code></li>
        <li><code>${escapeHtml(t('statusPopupRuleShareGpt'))}</code></li>
        <li><code>${escapeHtml(t('statusPopupRuleChatOpenAI'))}</code></li>
        <li><code>${escapeHtml(t('statusPopupRuleShareOpenAI'))}</code></li>
      </ul>
    </div>
  `;
}

function renderStatusActions(
  status: TabStatusResponse,
  t: Translator,
  popupState: PopupState,
): string {
  const runtime = status.runtime;
  const canToggle = runtime != null && (runtime.supported || runtime.archiveOnly);

  if (!canToggle) {
    const retryButton = `<button data-variant="primary" id="refresh-status">${escapeHtml(t('statusPopupRetry'))}</button>`;
    if (popupState === 'temporary-unavailable') {
      return retryButton;
    }

    return `
      ${retryButton}
      <button id="open-demo">${escapeHtml(t('statusPopupOpenDemo'))}</button>
      <button id="open-help">${escapeHtml(t('statusPopupOpenHelp'))}</button>
    `;
  }

  return `
    <button data-variant="primary" id="refresh-status">${escapeHtml(t('actionRefreshStatus'))}</button>
    <button id="toggle-chat-mode" ${runtime == null || (!runtime.supported && !runtime.archiveOnly) ? 'disabled' : ''}>
      ${escapeHtml(status.paused ? t('actionTurboRenderThisChat') : t('actionRestoreThisChat'))}
    </button>
  `;
}

function renderCurrentTabGrid(status: TabStatusResponse, t: Translator): string {
  const runtime = status.runtime;

  if (runtime == null || (!runtime.supported && !runtime.archiveOnly)) {
    return '';
  }

  return `
    <div class="popup-grid">
      <span>${escapeHtml(t('labelTotalTurns'))}</span><span>${escapeHtml(String(runtime.totalTurns))}</span>
      <span>${escapeHtml(t('labelTotalPairs'))}</span><span>${escapeHtml(String(runtime.totalPairs))}</span>
      <span>${escapeHtml(t('labelHotPairsVisible'))}</span><span>${escapeHtml(String(runtime.hotPairsVisible))}</span>
      <span>${escapeHtml(t('labelFinalized'))}</span><span>${escapeHtml(String(runtime.finalizedTurns))}</span>
      <span>${escapeHtml(t('labelInitialTrim'))}</span><span>${escapeHtml(runtime.initialTrimApplied ? t('statusHistoryYes', { count: runtime.initialTrimmedTurns }) : t('statusHistoryNo'))}</span>
      <span>${escapeHtml(t('labelHandledHistory'))}</span><span>${escapeHtml(String(runtime.handledTurnsTotal))}</span>
      <span>${escapeHtml(t('labelArchivedTurns'))}</span><span>${escapeHtml(String(runtime.archivedTurnsTotal))}</span>
      <span>${escapeHtml(t('labelCollapsedBatches'))}</span><span>${escapeHtml(String(runtime.collapsedBatchCount))}</span>
      <span>${escapeHtml(t('labelExpandedBatches'))}</span><span>${escapeHtml(String(runtime.expandedBatchCount))}</span>
      <span>${escapeHtml(t('labelRouteKind'))}</span><span>${escapeHtml(runtime.routeKind)}</span>
      <span>${escapeHtml(t('labelContentScriptInstance'))}</span><span>${escapeHtml(runtime.contentScriptInstanceId.slice(0, 8))}</span>
      <span>${escapeHtml(t('labelContentScriptStarted'))}</span><span>${escapeHtml(formatStartedAt(runtime.contentScriptStartedAt))}</span>
      <span>${escapeHtml(t('labelBuildSignature'))}</span><span>${escapeHtml(runtime.buildSignature)}</span>
      <span>${escapeHtml(t('labelParkedTurns'))}</span><span>${escapeHtml(String(runtime.parkedTurns))}</span>
      <span>${escapeHtml(t('labelParkedGroups'))}</span><span>${escapeHtml(String(runtime.parkedGroups))}</span>
      <span>${escapeHtml(t('labelLiveDomNodes'))}</span><span>${escapeHtml(String(runtime.liveDescendantCount))}</span>
      <span>${escapeHtml(t('labelMappingNodes'))}</span><span>${escapeHtml(String(runtime.totalMappingNodes))}</span>
      <span>${escapeHtml(t('labelFrameSpikes'))}</span><span>${escapeHtml(String(runtime.spikeCount))}</span>
    </div>
  `;
}

function renderCurrentTabSection(status: TabStatusResponse, t: Translator): string {
  if (!shouldRenderInlineDetails(status)) {
    return '';
  }

  return `
    <section class="popup-inline-panel" data-popup-section="current-tab">
      <h2>${escapeHtml(t('labelCurrentTab'))}</h2>
      ${renderCurrentTabGrid(status, t)}
    </section>
  `;
}

function renderSettingsSection(status: TabStatusResponse, t: Translator): string {
  if (!shouldRenderInlineDetails(status)) {
    return '';
  }

  return `
    <section class="popup-inline-panel" data-popup-section="settings">
      <h2>${escapeHtml(t('labelSettings'))}</h2>
      <p class="popup-support-note">${escapeHtml(t('statusPopupSettingsHint'))}</p>
      <div class="popup-row">
        <label>
          <input type="checkbox" id="enabled-toggle" ${status.settings.enabled ? 'checked' : ''} />
          ${escapeHtml(t('actionEnableTurboRender'))}
        </label>
        <label>
          <span>${escapeHtml(t('actionLanguage'))}</span>
          <select id="language-select">
            <option value="auto" ${status.settings.language === 'auto' ? 'selected' : ''}>${escapeHtml(t('languageAuto'))}</option>
            <option value="en" ${status.settings.language === 'en' ? 'selected' : ''}>${escapeHtml(t('languageEnglish'))}</option>
            <option value="zh-CN" ${status.settings.language === 'zh-CN' ? 'selected' : ''}>${escapeHtml(t('languageChinese'))}</option>
          </select>
        </label>
      </div>
      <div class="popup-actions popup-actions--secondary">
        <button data-variant="primary" id="open-options">${escapeHtml(t('actionOpenOptions'))}</button>
      </div>
    </section>
  `;
}

function renderHeroPanels(status: TabStatusResponse, t: Translator): string {
  if (!shouldRenderInlineDetails(status)) {
    return '';
  }

  return `
    <div class="popup-hero-details">
      ${renderSettingsSection(status, t)}
      ${renderCurrentTabSection(status, t)}
    </div>
  `;
}

function renderStatusCard(status: TabStatusResponse, t: Translator): string {
  const popupState = getPopupState(status);
  const statusCopy = getStatusCopy(status, t);
  const runtimeDetail = getRuntimeDetail(status, t);
  const shouldShowRules = isUnsupportedPopupState(popupState);

  return `
    <section class="popup-card popup-hero" data-popup-state="${escapeHtml(popupState)}">
      <div class="popup-kicker">${escapeHtml(t('statusPopupPanelLead'))}</div>
      <h1>${escapeHtml(t('appName'))}</h1>
      <p class="popup-status">${escapeHtml(statusCopy)}</p>
      <p class="popup-support-note">${escapeHtml(runtimeDetail)}</p>
      <div class="popup-actions">
        ${renderStatusActions(status, t, popupState)}
      </div>
      ${renderHeroPanels(status, t)}
      ${shouldShowRules ? renderSupportRules(t) : ''}
    </section>
  `;
}

function renderSupportCard(t: Translator): string {
  const supportAssets = getSupportAssets();

  return `
    <section class="popup-card support-card" data-popup-section="support">
      <h2>${escapeHtml(t('supportTitle'))}</h2>
      <p class="popup-status">${escapeHtml(t('supportLead'))}</p>
      <div class="support-gallery">
        <figure class="support-figure">
          <img src="${escapeHtml(supportAssets.wechat)}" alt="${escapeHtml(t('supportWeChatLabel'))}" />
          <figcaption>${escapeHtml(t('supportWeChatLabel'))}</figcaption>
        </figure>
        <figure class="support-figure">
          <img src="${escapeHtml(supportAssets.alipay)}" alt="${escapeHtml(t('supportAlipayLabel'))}" />
          <figcaption>${escapeHtml(t('supportAlipayLabel'))}</figcaption>
        </figure>
      </div>
      <p class="popup-support-note">${escapeHtml(t('supportScanHint'))}</p>
      <div class="popup-actions">
        <button id="open-support">${escapeHtml(t('supportAction'))}</button>
      </div>
    </section>
  `;
}

function renderLoading(): void {
  if (app == null) {
    return;
  }

  latestStatus = null;
  currentSupportUrl = getSupportReadmeUrl(fallbackLanguage);
  currentPopupHelpUrl = getPopupHelpReadmeUrl(fallbackLanguage);
  currentPopupDemoUrl = POPUP_DEMO_SHARE_URL;

  app.innerHTML = `
    <section class="popup-card popup-hero" data-popup-state="loading">
      <div class="popup-kicker">${escapeHtml(fallbackTranslator('statusPopupPanelLead'))}</div>
      <h1>${escapeHtml(fallbackTranslator('appName'))}</h1>
      <p class="popup-status">${escapeHtml(fallbackTranslator('statusPopupLoading'))}</p>
      <p class="popup-support-note">${escapeHtml(fallbackTranslator('statusPopupPanelLead'))}</p>
      <div class="popup-actions">
        <button data-variant="primary" id="refresh-status" disabled>${escapeHtml(fallbackTranslator('statusPopupRetry'))}</button>
      </div>
    </section>
    ${renderSupportCard(fallbackTranslator)}
  `;
}

function renderError(message: string): void {
  if (app == null) {
    return;
  }

  latestStatus = null;
  currentSupportUrl = getSupportReadmeUrl(fallbackLanguage);
  currentPopupHelpUrl = getPopupHelpReadmeUrl(fallbackLanguage);
  currentPopupDemoUrl = POPUP_DEMO_SHARE_URL;

  app.innerHTML = `
    <section class="popup-card popup-hero" data-popup-state="error">
      <div class="popup-kicker">${escapeHtml(fallbackTranslator('statusPopupPanelLead'))}</div>
      <h1>${escapeHtml(fallbackTranslator('statusPopupErrorTitle'))}</h1>
      <p class="popup-status">${escapeHtml(fallbackTranslator('statusPopupErrorBody'))}</p>
      <p class="popup-error-detail">
        <span>${escapeHtml(fallbackTranslator('statusPopupErrorDetailPrefix'))}:</span>
        <code>${escapeHtml(message)}</code>
      </p>
      <div class="popup-actions">
        <button data-variant="primary" id="refresh-status">${escapeHtml(fallbackTranslator('statusPopupRetry'))}</button>
        <button id="open-demo">${escapeHtml(fallbackTranslator('statusPopupOpenDemo'))}</button>
        <button id="open-help">${escapeHtml(fallbackTranslator('statusPopupOpenHelp'))}</button>
      </div>
      ${renderSupportRules(fallbackTranslator)}
    </section>
    ${renderSupportCard(fallbackTranslator)}
  `;
}

function renderStatus(status: TabStatusResponse): void {
  if (app == null) {
    return;
  }

  latestStatus = status;

  const language = getExtensionLanguage(status.settings);
  const t = createTranslator(language);
  currentSupportUrl = getSupportReadmeUrl(language);
  currentPopupHelpUrl = getPopupHelpReadmeUrl(language);
  currentPopupDemoUrl = POPUP_DEMO_SHARE_URL;

  app.innerHTML = `
    ${renderStatusCard(status, t)}
    ${renderSupportCard(t)}
  `;
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallbackTranslator('statusPopupErrorBody');
}

async function fetchStatus(): Promise<TabStatusResponse> {
  return (await browser.runtime.sendMessage({ type: 'GET_TAB_STATUS' })) as TabStatusResponse;
}

async function loadStatus(): Promise<void> {
  renderLoading();

  try {
    const status = await fetchStatus();
    if (!isTabStatusResponse(status)) {
      throw new Error(fallbackTranslator('statusPopupErrorBody'));
    }

    renderStatus(status);
  } catch (error) {
    renderError(formatRuntimeError(error));
  }
}

async function sendActionAndRenderStatus(message: Record<string, unknown>): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage(message);
    if (!isTabStatusResponse(response)) {
      throw new Error(fallbackTranslator('statusPopupErrorBody'));
    }

    renderStatus(response);
  } catch (error) {
    renderError(formatRuntimeError(error));
  }
}

void loadStatus();

document.addEventListener('change', async (event) => {
  const target = event.target as HTMLElement | null;
  if (target instanceof HTMLInputElement && target.id === 'enabled-toggle') {
    await sendActionAndRenderStatus({
      type: 'TOGGLE_GLOBAL',
      enabled: target.checked,
    });
    return;
  }

  if (target instanceof HTMLSelectElement && target.id === 'language-select') {
    await sendActionAndRenderStatus({
      type: 'UPDATE_SETTINGS',
      patch: { language: normalizeLanguagePreference(target.value) },
    });
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target as HTMLElement | null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.id === 'open-options') {
    await browser.runtime.openOptionsPage();
    return;
  }

  if (target.id === 'open-support') {
    window.open(currentSupportUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  if (target.id === 'open-help') {
    window.open(currentPopupHelpUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  if (target.id === 'open-demo') {
    window.open(currentPopupDemoUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  if (target.id === 'refresh-status') {
    await loadStatus();
    return;
  }

  if (target.id === 'toggle-chat-mode') {
    const status = latestStatus ?? (await fetchStatus());
    if (status.runtime == null) {
      renderError(fallbackTranslator('statusPopupErrorBody'));
      return;
    }

    await sendActionAndRenderStatus({
      type: 'PAUSE_CHAT',
      chatId: status.runtime.chatId,
      paused: !status.paused,
      ...(status.targetTabId == null ? {} : { tabId: status.targetTabId }),
    });
  }
});
