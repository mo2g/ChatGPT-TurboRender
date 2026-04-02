import type { Settings } from './types';

export const EXTENSION_NAME = 'ChatGPT TurboRender';
export const BUILD_SIGNATURE = '2026-03-28-1650-hot-transcript-archive-zone';

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
  coldRestoreMode: 'placeholder',
  softFallback: false,
  frameSpikeThresholdMs: 48,
  frameSpikeCount: 4,
  frameSpikeWindowMs: 5000,
};

export const UI_CLASS_NAMES = {
  historyOverlay: 'turbo-render-history-overlay',
  historyTrigger: 'turbo-render-history-trigger',
  historyTriggerBadge: 'turbo-render-history-trigger__badge',
  archiveRoot: 'turbo-render-archive-root',
  archiveControls: 'turbo-render-archive-controls',
  archiveSummary: 'turbo-render-archive-summary',
  archiveActions: 'turbo-render-archive-actions',
  archiveSearch: 'turbo-render-archive-search',
  archiveResults: 'turbo-render-archive-results',
  archiveGroups: 'turbo-render-archive-groups',
  archiveGroup: 'turbo-render-archive-group',
  archiveGroupSummary: 'turbo-render-archive-group__summary',
  archiveGroupCards: 'turbo-render-archive-group__cards',
  archiveGroupMeta: 'turbo-render-archive-group__meta',
  archiveGroupExpand: 'turbo-render-archive-group__expand',
  inlineHistoryRoot: 'turbo-render-inline-history',
  inlineHistoryToolbar: 'turbo-render-inline-history__toolbar',
  inlineHistorySearch: 'turbo-render-inline-history__search',
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
  historyDrawer: 'turbo-render-history-drawer',
  historyDrawerHeader: 'turbo-render-history-drawer__header',
  historyDrawerCopy: 'turbo-render-history-drawer__copy',
  historyDrawerActions: 'turbo-render-history-drawer__actions',
  historyDrawerMeta: 'turbo-render-history-drawer__meta',
  historyDrawerSearch: 'turbo-render-history-drawer__search',
  historyDrawerResults: 'turbo-render-history-drawer__results',
  historyDrawerCards: 'turbo-render-history-drawer__cards',
  historyHint: 'turbo-render-history-hint',
  historyHintDismiss: 'turbo-render-history-hint__dismiss',
  historyEntryCard: 'turbo-render-history-entry',
  historyEntryMeta: 'turbo-render-history-entry__meta',
  historyEntryBody: 'turbo-render-history-entry__body',
  historyEntryAction: 'turbo-render-history-entry__action',
  historyEntryHighlight: 'turbo-render-history-entry--highlight',
  placeholder: 'turbo-render-placeholder',
  placeholderSummary: 'turbo-render-placeholder__summary',
  placeholderActions: 'turbo-render-placeholder__actions',
  coldHistory: 'turbo-render-cold-history',
  coldHistoryTurns: 'turbo-render-cold-history__turns',
  coldHistoryTurn: 'turbo-render-cold-history__turn',
  coldHistoryBody: 'turbo-render-cold-history__body',
  coldHistoryHeader: 'turbo-render-cold-history__header',
  softFolded: 'turbo-render-soft-folded',
  transcriptHighlight: 'turbo-render-transcript-highlight',
} as const;
