import type { Settings, TabRuntimeStatus, TabStatusResponse } from './types';

export interface GetTabStatusMessage {
  type: 'GET_TAB_STATUS';
  tabId?: number;
}

export interface GetRuntimeStatusMessage {
  type: 'GET_RUNTIME_STATUS';
}

export interface ToggleGlobalMessage {
  type: 'TOGGLE_GLOBAL';
  enabled: boolean;
}

export interface PauseChatMessage {
  type: 'PAUSE_CHAT';
  chatId: string;
  paused: boolean;
  tabId?: number;
}

export interface RestoreNearbyMessage {
  type: 'RESTORE_NEARBY';
  tabId?: number;
}

export interface RestoreAllMessage {
  type: 'RESTORE_ALL';
  tabId?: number;
}

export interface UpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  patch: Partial<Settings>;
}

export type RuntimeMessage =
  | GetTabStatusMessage
  | GetRuntimeStatusMessage
  | ToggleGlobalMessage
  | PauseChatMessage
  | RestoreNearbyMessage
  | RestoreAllMessage
  | UpdateSettingsMessage;

export type RuntimeMessageResult =
  | TabStatusResponse
  | TabRuntimeStatus
  | { ok: true }
  | null;

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
