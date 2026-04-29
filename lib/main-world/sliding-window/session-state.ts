import type { SlidingWindowRange } from '../../shared/sliding-window';

export const SLIDING_WINDOW_SESSION_STATE_KEY = 'chatgpt-turborender:sliding-window:state';

export interface SlidingWindowSessionState {
  conversationId: string;
  targetRange: SlidingWindowRange | null;
  requestedAt: number;
  reloadReason: 'older' | 'newer' | 'latest' | 'search' | 'initial' | string;
  useCache: boolean;
}

function isRange(value: unknown): value is SlidingWindowRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { startPairIndex?: unknown }).startPairIndex === 'number' &&
    typeof (value as { endPairIndex?: unknown }).endPairIndex === 'number'
  );
}

export function readSlidingWindowSessionState(win: Window): SlidingWindowSessionState | null {
  try {
    const raw = win.sessionStorage.getItem(SLIDING_WINDOW_SESSION_STATE_KEY);
    if (raw == null) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SlidingWindowSessionState>;
    if (typeof parsed.conversationId !== 'string' || parsed.conversationId.length === 0) {
      return null;
    }

    return {
      conversationId: parsed.conversationId,
      targetRange: isRange(parsed.targetRange) ? parsed.targetRange : null,
      requestedAt: typeof parsed.requestedAt === 'number' ? parsed.requestedAt : 0,
      reloadReason: typeof parsed.reloadReason === 'string' ? parsed.reloadReason : 'initial',
      useCache: parsed.useCache === true,
    };
  } catch {
    return null;
  }
}

export function writeSlidingWindowSessionState(
  win: Window,
  state: SlidingWindowSessionState,
): void {
  try {
    win.sessionStorage.setItem(SLIDING_WINDOW_SESSION_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures in private or constrained contexts.
  }
}

export function clearSlidingWindowSessionState(win: Window): void {
  try {
    win.sessionStorage.removeItem(SLIDING_WINDOW_SESSION_STATE_KEY);
  } catch {
    // Ignore storage failures in private or constrained contexts.
  }
}

export function consumeSlidingWindowSessionState(win: Window): SlidingWindowSessionState | null {
  const state = readSlidingWindowSessionState(win);
  clearSlidingWindowSessionState(win);
  return state;
}
