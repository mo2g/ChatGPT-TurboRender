export interface ParsedExactChatTarget {
  url: string;
  routeKind: 'chat';
  conversationId: string;
}

export function parseExactChatTargetUrl(rawUrl: string): ParsedExactChatTarget;
