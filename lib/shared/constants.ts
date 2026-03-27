import type { Settings } from './types';

export const EXTENSION_NAME = 'ChatGPT TurboRender';

export const TURN_ID_DATASET = 'turboRenderTurnId';
export const PLACEHOLDER_GROUP_ATTRIBUTE = 'data-turbo-render-group-id';

export const STORAGE_KEYS = {
  settings: 'turboRender.settings',
  pausedChats: 'turboRender.pausedChats',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  autoEnable: true,
  language: 'auto',
  mode: 'performance',
  minFinalizedBlocks: 120,
  minDescendants: 2500,
  keepRecentTurns: 30,
  viewportBufferTurns: 8,
  groupSize: 20,
  initialTrimEnabled: true,
  initialHotTurns: 18,
  liveHotTurns: 12,
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
