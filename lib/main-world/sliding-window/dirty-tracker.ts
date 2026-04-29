import { resolveConversationRoute } from '../../shared/chat-id';
import type { TurboRenderPageConfig } from '../../shared/runtime-bridge';
import { postBridgeMessage } from '../../shared/runtime-bridge';
import { isSlidingWindowMode } from '../../shared/types';
import { getSlidingWindowCache } from './idb-cache';

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof init?.method === 'string' && init.method.length > 0) {
    return init.method.toUpperCase();
  }

  if (input instanceof Request) {
    return input.method.toUpperCase();
  }

  return 'GET';
}

function currentConversationId(win: Window): string | null {
  const route = resolveConversationRoute(win.location?.pathname ?? '/');
  return route.kind === 'chat' ? route.routeId : null;
}

function isConversationWritePath(pathname: string): boolean {
  if (pathname === '/backend-api/conversation/init') {
    return false;
  }

  return (
    pathname.includes('/backend-api/conversation') ||
    pathname.includes('/backend-api/f/conversation') ||
    pathname.includes('/backend-api/message') ||
    pathname.includes('/backend-api/thread') ||
    pathname.includes('/backend-api/completion')
  );
}

export async function markSlidingWindowDirtyForWrite(input: {
  win: Window;
  doc: Document;
  config: TurboRenderPageConfig;
  requestUrl: string;
  requestInput: RequestInfo | URL;
  init: RequestInit | undefined;
}): Promise<void> {
  if (!input.config.enabled || !isSlidingWindowMode(input.config.mode)) {
    return;
  }

  const method = requestMethod(input.requestInput, input.init);
  if (method === 'GET') {
    return;
  }

  let url: URL;
  try {
    url = new URL(input.requestUrl, input.doc.location.origin);
  } catch {
    return;
  }

  if (!isConversationWritePath(url.pathname)) {
    return;
  }

  const conversationId = currentConversationId(input.win);
  if (conversationId == null) {
    return;
  }

  await getSlidingWindowCache(input.win)?.markDirty?.(conversationId);
  postBridgeMessage(input.win, {
    namespace: 'chatgpt-turborender',
    type: 'TURBO_RENDER_SLIDING_WINDOW_WRITE_DETECTED',
    payload: {
      conversationId,
      method,
      path: url.pathname,
    },
  });
}
