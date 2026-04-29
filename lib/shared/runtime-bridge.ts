import type {
  InitialTrimSession,
  Settings,
  TurboRenderMode,
} from './types';
import type {
  SlidingWindowRange,
  SlidingWindowRuntimeState,
  SlidingWindowSearchMatch,
} from './sliding-window';

export const TURBO_RENDER_BRIDGE_NAMESPACE = 'chatgpt-turborender';

export interface TurboRenderPageConfig {
  enabled: boolean;
  mode: TurboRenderMode;
  initialTrimEnabled: boolean;
  initialHotPairs: number;
  slidingWindowPairs: number;
  minFinalizedBlocks: number;
  enableTimeoutFallback: boolean;
  debugEnabled: boolean;
  debugVerbose: boolean;
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

export interface SlidingWindowStateBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_STATE';
  payload: SlidingWindowRuntimeState;
}

export interface SlidingWindowRequestStateBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_REQUEST_STATE';
  payload: {
    conversationId: string | null;
  };
}

export interface SlidingWindowNavigateBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE';
  payload:
    | {
        direction: 'first' | 'older' | 'newer' | 'latest';
        conversationId: string | null;
        useCache?: boolean;
      }
    | { direction: 'page'; conversationId: string | null; targetPage: number; useCache?: boolean }
    | {
        direction: 'search';
        conversationId: string | null;
        targetPairIndex: number;
        useCache?: boolean;
      };
}

export interface SlidingWindowSearchBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_SEARCH';
  payload: {
    requestId: string;
    conversationId: string | null;
    query: string;
  };
}

export interface SlidingWindowSearchResultsBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_SEARCH_RESULTS';
  payload: {
    requestId: string;
    conversationId: string | null;
    query: string;
    results: SlidingWindowSearchMatch[];
  };
}

export interface SlidingWindowClearCacheBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_CLEAR_CACHE';
  payload: {
    conversationId: string | null;
    scope: 'conversation' | 'all';
  };
}

export interface SlidingWindowWriteDetectedBridgeMessage {
  namespace: typeof TURBO_RENDER_BRIDGE_NAMESPACE;
  type: 'TURBO_RENDER_SLIDING_WINDOW_WRITE_DETECTED';
  payload: {
    conversationId: string | null;
    method: string;
    path: string;
  };
}

export type TurboRenderBridgeMessage =
  | TurboRenderConfigBridgeMessage
  | TurboRenderRequestStateBridgeMessage
  | TurboRenderSessionStateBridgeMessage
  | SlidingWindowStateBridgeMessage
  | SlidingWindowRequestStateBridgeMessage
  | SlidingWindowNavigateBridgeMessage
  | SlidingWindowSearchBridgeMessage
  | SlidingWindowSearchResultsBridgeMessage
  | SlidingWindowClearCacheBridgeMessage
  | SlidingWindowWriteDetectedBridgeMessage;

export function toPageConfig(
  settings: Pick<
    Settings,
    'enabled' | 'mode' | 'initialTrimEnabled' | 'initialHotPairs' | 'slidingWindowPairs' | 'minFinalizedBlocks' | 'enableTimeoutFallback' | 'debugEnabled' | 'debugVerbose'
  >,
): TurboRenderPageConfig {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    initialTrimEnabled: settings.initialTrimEnabled,
    initialHotPairs: settings.initialHotPairs,
    slidingWindowPairs: settings.slidingWindowPairs,
    minFinalizedBlocks: settings.minFinalizedBlocks,
    enableTimeoutFallback: settings.enableTimeoutFallback,
    debugEnabled: settings.debugEnabled,
    debugVerbose: settings.debugVerbose,
  };
}

const BROADCAST_CHANNEL_NAME = 'chatgpt-turborender-bridge';

export function postBridgeMessage(win: Window, message: TurboRenderBridgeMessage): void {
  // 使用postMessage进行标准通信
  win.postMessage(message, win.location?.origin ?? '*');

  // 使用BroadcastChannel作为备选，确保在MCP等环境中跨world通信可靠
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // BroadcastChannel不支持时忽略错误
  }
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
