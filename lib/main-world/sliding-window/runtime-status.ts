import { postBridgeMessage } from '../../shared/runtime-bridge';
import {
  isLatestWindow,
  type SlidingWindowRange,
  type SlidingWindowRuntimeState,
} from '../../shared/sliding-window';
import type { SlidingWindowCacheEntry } from './idb-cache';
import { mwLogger } from '../logger';

const slidingWindowRuntimeStateByConversation = new Map<string, SlidingWindowRuntimeState>();

export function createSlidingWindowRuntimeState(
  conversationId: string,
  entry: SlidingWindowCacheEntry,
  range: SlidingWindowRange,
  reason: string | null = null,
  timestamp: number = Date.now(),
): SlidingWindowRuntimeState {
  return {
    conversationId,
    totalPairs: entry.pairIndex.totalPairs,
    pairCount: Math.max(0, range.endPairIndex - range.startPairIndex + 1),
    range,
    isLatestWindow: isLatestWindow(range, entry.pairIndex.totalPairs),
    updatedAt: timestamp,
    dirty: entry.meta.dirty,
    reason,
  };
}

export function recordSlidingWindowRuntimeState(state: SlidingWindowRuntimeState): void {
  slidingWindowRuntimeStateByConversation.set(state.conversationId, state);
}

export function readSlidingWindowRuntimeState(conversationId: string, win?: Window): SlidingWindowRuntimeState | null {
  // 首先尝试从内存Map读取
  const memState = slidingWindowRuntimeStateByConversation.get(conversationId);
  if (memState != null) {
    return memState;
  }

  // 如果内存中没有，尝试从DOM标记读取（页面刷新后备选）
  if (win?.document?.documentElement != null) {
    try {
      const html = win.document.documentElement;
      const marker = html.dataset.turborenderSlidingWindowState;
      mwLogger.debug('DOM marker read:', { markerPresent: !!marker, markerLength: marker?.length });
      if (marker != null && marker !== '') {
        const state: SlidingWindowRuntimeState = JSON.parse(marker);
        if (state.conversationId === conversationId) {
          // 恢复到内存Map
          slidingWindowRuntimeStateByConversation.set(conversationId, state);
          mwLogger.debug('DOM marker restored to memory:', { range: state.range });
          return state;
        }
      }
    } catch (e) {
      mwLogger.error('DOM marker read failed:', e);
    }
  }

  mwLogger.debug('No state found for conversation:', conversationId);
  return null;
}

export function clearSlidingWindowRuntimeState(conversationId: string): void {
  slidingWindowRuntimeStateByConversation.delete(conversationId);
}

export function clearAllSlidingWindowRuntimeState(): void {
  slidingWindowRuntimeStateByConversation.clear();
}

export function emitSlidingWindowState(win: Window, state: SlidingWindowRuntimeState): void {
  recordSlidingWindowRuntimeState(state);
  postBridgeMessage(win, {
    namespace: 'chatgpt-turborender',
    type: 'TURBO_RENDER_SLIDING_WINDOW_STATE',
    payload: state,
  });

  // 同时设置DOM标记作为备选同步机制，确保在MCP等跨world通信不可靠环境中状态可访问
  try {
    const html = win.document.documentElement;
    const marker = JSON.stringify(state);
    html.dataset.turborenderSlidingWindowState = marker;
    mwLogger.debug('DOM marker set:', { range: state.range, updatedAt: state.updatedAt });
  } catch (e) {
    mwLogger.error('DOM marker set failed:', e);
  }
}
