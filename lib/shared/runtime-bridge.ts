import type {
  ColdRestoreMode,
  InitialTrimSession,
  Settings,
  TurboRenderMode,
} from './types';

export const TURBO_RENDER_BRIDGE_NAMESPACE = 'chatgpt-turborender';

export interface TurboRenderPageConfig {
  enabled: boolean;
  mode: TurboRenderMode;
  initialTrimEnabled: boolean;
  initialHotTurns: number;
  minFinalizedBlocks: number;
  coldRestoreMode: ColdRestoreMode;
}

export interface TurboRenderConfigBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_CONFIG';
  payload: TurboRenderPageConfig;
}

export interface TurboRenderRequestStateBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_REQUEST_STATE';
  payload: {
    chatId: string | null;
  };
}

export interface TurboRenderSessionStateBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SESSION_STATE';
  payload: InitialTrimSession;
}

export type TurboRenderBridgeMessage =
  | TurboRenderConfigBridgeMessage
  | TurboRenderRequestStateBridgeMessage
  | TurboRenderSessionStateBridgeMessage;

export function toPageConfig(
  settings: Pick<
    Settings,
    'enabled' | 'mode' | 'initialTrimEnabled' | 'initialHotTurns' | 'minFinalizedBlocks' | 'coldRestoreMode'
  >,
): TurboRenderPageConfig {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    initialTrimEnabled: settings.initialTrimEnabled,
    initialHotTurns: settings.initialHotTurns,
    minFinalizedBlocks: settings.minFinalizedBlocks,
    coldRestoreMode: settings.coldRestoreMode,
  };
}

export function postBridgeMessage(win: Window, message: TurboRenderBridgeMessage): void {
  win.postMessage(message, win.location?.origin ?? '*');
}

export function isTurboRenderBridgeMessage(value: unknown): value is TurboRenderBridgeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'namespace' in value &&
    'type' in value &&
    (value as { namespace?: unknown }).namespace === TURBO_RENDER_BRIDGE_NAMESPACE &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
