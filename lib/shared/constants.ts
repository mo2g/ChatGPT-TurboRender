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
  statusBar: 'turbo-render-status-bar',
  statusBarTop: 'turbo-render-status-bar__top',
  statusBarSummary: 'turbo-render-status-bar__summary',
  statusBarPrimary: 'turbo-render-status-bar__primary',
  statusBarDetails: 'turbo-render-status-bar__details',
  statusBarMeta: 'turbo-render-status-bar__meta',
  statusBarActions: 'turbo-render-status-bar__actions',
  placeholder: 'turbo-render-placeholder',
  placeholderSummary: 'turbo-render-placeholder__summary',
  placeholderActions: 'turbo-render-placeholder__actions',
  coldHistory: 'turbo-render-cold-history',
  coldHistoryTurns: 'turbo-render-cold-history__turns',
  coldHistoryTurn: 'turbo-render-cold-history__turn',
  coldHistoryBody: 'turbo-render-cold-history__body',
  coldHistoryHeader: 'turbo-render-cold-history__header',
  softFolded: 'turbo-render-soft-folded',
} as const;
