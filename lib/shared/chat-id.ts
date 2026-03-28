import type { ConversationRouteKind, ResolvedConversationRoute } from './types';

function buildRuntimeId(kind: ConversationRouteKind, routeId: string | null): string {
  if (kind === 'chat' && routeId != null) {
    return `chat:${routeId}`;
  }
  if (kind === 'share' && routeId != null) {
    return `share:${routeId}`;
  }
  if (kind === 'home') {
    return 'chat:home';
  }
  return 'chat:unknown';
}

export function resolveConversationRoute(pathname: string): ResolvedConversationRoute {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return {
      kind: 'home',
      routeId: null,
      runtimeId: 'chat:home',
    };
  }

  const shareIndex = segments.indexOf('share');
  if (shareIndex !== -1) {
    const shareId = segments[shareIndex + 1] ?? null;
    if (shareId != null && shareId.length > 0) {
      return {
        kind: 'share',
        routeId: shareId,
        runtimeId: buildRuntimeId('share', shareId),
      };
    }
  }

  const chatIndex = segments.indexOf('c');
  if (chatIndex !== -1) {
    const candidate = segments[chatIndex + 1] ?? null;
    if (candidate != null && candidate.length > 0) {
      return {
        kind: 'chat',
        routeId: candidate,
        runtimeId: buildRuntimeId('chat', candidate),
      };
    }
  }

  return {
    kind: 'unknown',
    routeId: null,
    runtimeId: 'chat:unknown',
  };
}

export function getChatIdFromPathname(pathname: string): string {
  return resolveConversationRoute(pathname).runtimeId;
}

export function getRouteKindFromRuntimeId(runtimeId: string): ConversationRouteKind {
  if (runtimeId.startsWith('share:')) {
    return 'share';
  }
  if (runtimeId === 'chat:home') {
    return 'home';
  }
  if (runtimeId.startsWith('chat:') && runtimeId !== 'chat:unknown') {
    return 'chat';
  }
  return 'unknown';
}
