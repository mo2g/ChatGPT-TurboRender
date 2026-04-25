export const DEFAULT_LIVE_CHAT_URL: string;

export type LiveTargetRouteKind = 'chat' | 'share' | 'other';

export interface ParsedExactChatTarget {
  url: string;
  routeKind: 'chat';
  conversationId: string;
}

export function normalizeLiveTargetPathname(pathname: string): string;
export function normalizeLiveTargetUrl(rawUrl: string): URL;
export function isChatgptHostUrl(rawUrl: string): boolean;
export function classifyChatgptRouteKind(rawUrl: string): LiveTargetRouteKind;
export function isSupportedChatgptConversationUrl(rawUrl: string): boolean;
export function parseExactChatTargetUrl(rawUrl: string): ParsedExactChatTarget;
export function matchesExactChatTargetUrl(candidateUrl: string, targetUrl: string): boolean;
