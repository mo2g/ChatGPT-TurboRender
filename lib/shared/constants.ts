import type { Settings } from './types';

export const EXTENSION_NAME = 'ChatGPT TurboRender';
export const BUILD_SIGNATURE = '2026-03-28-1650-hot-transcript-archive-zone';
export const TURBO_RENDER_UI_ROOT_ATTRIBUTE = 'data-turbo-render-ui-root';
export const TURBO_RENDER_UI_ROOT_VALUE = 'true';
export const TURBO_RENDER_UI_ROOT_SELECTOR = `[${TURBO_RENDER_UI_ROOT_ATTRIBUTE}="${TURBO_RENDER_UI_ROOT_VALUE}"]`;
export const TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_QUERY = 'turbo-render-debug-actions';
export const TURBO_RENDER_DEBUG_SHOW_SHARE_ACTIONS_STORAGE_KEY = 'turboRenderDebugShowShareActions';

export const TURN_ID_DATASET = 'turboRenderTurnId';
export const PLACEHOLDER_GROUP_ATTRIBUTE = 'data-turbo-render-group-id';

export const STORAGE_KEYS = {
  settings: 'turboRender.settings',
  pausedChats: 'turboRender.pausedChats',
} as const;

export const PROJECT_REPOSITORY_URL = 'https://github.com/mo2g/ChatGPT-TurboRender';
export const POPUP_DEMO_SHARE_URL = 'https://chatgpt.com/share/69cb7947-c818-83e8-9851-1361e4480e08';
export const POPUP_HELP_ANCHOR = 'popup-status-control-panel';
export const SUPPORT_ASSET_PATHS = {
  wechatSponsor: 'assets/wechat-sponsor.jpg',
  alipaySponsor: 'assets/aliapy-sponsor.jpg',
} as const;

export function getSupportReadmeUrl(language: 'en' | 'zh-CN'): string {
  return language === 'zh-CN'
    ? `${PROJECT_REPOSITORY_URL}/blob/main/README.zh-CN.md#support`
    : `${PROJECT_REPOSITORY_URL}/blob/main/README.md#support`;
}

export function getPopupHelpReadmeUrl(language: 'en' | 'zh-CN'): string {
  return language === 'zh-CN'
    ? `${PROJECT_REPOSITORY_URL}/blob/main/README.zh-CN.md#${POPUP_HELP_ANCHOR}`
    : `${PROJECT_REPOSITORY_URL}/blob/main/README.md#${POPUP_HELP_ANCHOR}`;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  autoEnable: true,
  language: 'auto',
  mode: 'performance',
  minFinalizedBlocks: 120,
  minDescendants: 2500,
  keepRecentPairs: 5,
  batchPairCount: 5,
  initialHotPairs: 5,
  liveHotPairs: 5,
  keepRecentTurns: 10,
  viewportBufferTurns: 8,
  groupSize: 10,
  initialTrimEnabled: true,
  initialHotTurns: 10,
  liveHotTurns: 10,
  softFallback: false,
  frameSpikeThresholdMs: 48,
  frameSpikeCount: 4,
  frameSpikeWindowMs: 5000,
};

export const UI_CLASS_NAMES = {
  archiveGroups: 'turbo-render-archive-groups',
  inlineHistoryRoot: 'turbo-render-inline-history',
  inlineHistoryToolbar: 'turbo-render-inline-history__toolbar',
  inlineHistoryBoundary: 'turbo-render-inline-history__boundary',
  inlineHistoryBoundarySummary: 'turbo-render-inline-history__boundary-summary',
  inlineHistoryBoundaryActions: 'turbo-render-inline-history__boundary-actions',
  inlineHistoryBoundaryButton: 'turbo-render-inline-history__boundary-button',
  inlineHistorySearch: 'turbo-render-inline-history__search',
  inlineHistorySearchPanel: 'turbo-render-inline-history__search-panel',
  inlineHistorySearchHeader: 'turbo-render-inline-history__search-header',
  inlineHistorySearchInput: 'turbo-render-inline-history__search-input',
  inlineHistorySearchClear: 'turbo-render-inline-history__search-clear',
  inlineHistorySearchResults: 'turbo-render-inline-history__search-results',
  inlineHistorySearchResult: 'turbo-render-inline-history__search-result',
  inlineHistorySearchResultMeta: 'turbo-render-inline-history__search-result-meta',
  inlineHistorySearchResultExcerpt: 'turbo-render-inline-history__search-result-excerpt',
  inlineHistorySearchResultActive: 'turbo-render-inline-history__search-result--active',
  inlineHistorySummary: 'turbo-render-inline-history__summary',
  inlineBatchCard: 'turbo-render-inline-batch',
  inlineBatchHeader: 'turbo-render-inline-batch__header',
  inlineBatchMain: 'turbo-render-inline-batch__main',
  inlineBatchRail: 'turbo-render-inline-batch__rail',
  inlineBatchMeta: 'turbo-render-inline-batch__meta',
  inlineBatchPreview: 'turbo-render-inline-batch__preview',
  inlineBatchMatches: 'turbo-render-inline-batch__matches',
  inlineBatchAction: 'turbo-render-inline-batch__action',
  inlineBatchEntries: 'turbo-render-inline-batch__entries',
  inlineBatchEntry: 'turbo-render-inline-batch__entry',
  inlineBatchHighlight: 'turbo-render-inline-batch--highlight',
  inlineBatchSearchHighlight: 'turbo-render-inline-batch--search-highlight',
  historyEntryFrame: 'turbo-render-history-entry__frame',
  historyEntryMeta: 'turbo-render-history-entry__meta',
  historyEntryBody: 'turbo-render-history-entry__body',
  historyEntryActions: 'turbo-render-history-entry__actions',
  historyEntryAction: 'turbo-render-history-entry__action',
  historyEntryActionMenuAnchor: 'turbo-render-history-entry__action-menu-anchor',
  historyEntryActionMenu: 'turbo-render-history-entry__action-menu',
  historyEntryActionMenuHeader: 'turbo-render-history-entry__action-menu-header',
  historyEntryActionMenuItem: 'turbo-render-history-entry__action-menu-item',
  historyEntryHighlight: 'turbo-render-history-entry--highlight',
  softFolded: 'turbo-render-soft-folded',
  transcriptHighlight: 'turbo-render-transcript-highlight',
} as const;
