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
  placeholder: 'turbo-render-placeholder',
  placeholderSummary: 'turbo-render-placeholder__summary',
  placeholderActions: 'turbo-render-placeholder__actions',
  coldHistory: 'turbo-render-cold-history',
  coldHistoryTurns: 'turbo-render-cold-history__turns',
  coldHistoryTurn: 'turbo-render-cold-history__turn',
  softFolded: 'turbo-render-soft-folded',
} as const;

export const PLACEHOLDER_TEXT = {
  restore: 'Restore',
  restoreHistory: 'Restore history',
  restoreNearby: 'Restore nearby',
  restoreAll: 'Restore all',
  pause: 'Pause chat',
  resume: 'Resume chat',
} as const;
