const LIVE_HOSTNAMES = new Set(['chatgpt.com', 'chat.openai.com']);

export const DEFAULT_LIVE_CHAT_URL = 'https://chatgpt.com/c/ceb4ea77-5357-49fb-b35c-607b533846f1';

export function normalizeLiveTargetPathname(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function normalizeLiveTargetUrl(rawUrl) {
  const normalized = new URL(rawUrl);
  normalized.hash = '';
  normalized.search = '';
  normalized.pathname = normalizeLiveTargetPathname(normalized.pathname);
  return normalized;
}

export function isChatgptHostUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return LIVE_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function classifyChatgptRouteKind(rawUrl) {
  try {
    const normalized = normalizeLiveTargetUrl(rawUrl);
    if (!LIVE_HOSTNAMES.has(normalized.hostname)) {
      return 'other';
    }

    const match = normalized.pathname.match(/^\/(c|share)\/[^/]+$/);
    if (match == null) {
      return 'other';
    }

    return match[1] === 'c' ? 'chat' : 'share';
  } catch {
    return 'other';
  }
}

export function isSupportedChatgptConversationUrl(rawUrl) {
  try {
    const normalized = normalizeLiveTargetUrl(rawUrl);
    return LIVE_HOSTNAMES.has(normalized.hostname) && /^\/(c|share)\/[^/]+$/.test(normalized.pathname);
  } catch {
    return false;
  }
}

export function parseExactChatTargetUrl(rawUrl) {
  const normalized = normalizeLiveTargetUrl(rawUrl);
  if (!LIVE_HOSTNAMES.has(normalized.hostname)) {
    throw new Error(`Unsupported ChatGPT host for live testing: ${normalized.hostname}`);
  }

  const match = normalized.pathname.match(/^\/c\/([^/]+)$/);
  if (match == null) {
    throw new Error(`Unsupported ChatGPT route for live testing: ${normalized.pathname}`);
  }

  return {
    url: normalized.href,
    routeKind: 'chat',
    conversationId: match[1],
  };
}

export function matchesExactChatTargetUrl(candidateUrl, targetUrl) {
  try {
    const candidate = normalizeLiveTargetUrl(candidateUrl);
    const target = normalizeLiveTargetUrl(targetUrl);

    return (
      LIVE_HOSTNAMES.has(candidate.hostname) &&
      LIVE_HOSTNAMES.has(target.hostname) &&
      candidate.origin === target.origin &&
      candidate.pathname === target.pathname
    );
  } catch {
    return false;
  }
}
