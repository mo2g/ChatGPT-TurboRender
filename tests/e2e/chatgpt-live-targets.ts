import { getRouteIdFromRuntimeId } from '../../lib/shared/chat-id';
import type { ConversationRouteKind } from '../../lib/shared/types';
import { parseExactChatTargetUrl } from '../../scripts/live-targets-lib.mjs';

export type LiveRouteKind = Extract<ConversationRouteKind, 'chat' | 'share'>;

export interface LiveTestInputs {
  chatUrl: string | null;
  useActiveTab: boolean;
}

export interface ResolvedLiveChatTarget {
  url: string;
  routeKind: LiveRouteKind;
  conversationId?: string;
}

function normalizeBooleanEnv(value: string | undefined): boolean {
  if (value == null) {
    return false;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

export function parseLiveTargetUrl(rawUrl: string): ResolvedLiveChatTarget {
  return parseExactChatTargetUrl(rawUrl) as ResolvedLiveChatTarget;
}

export function readConfiguredLiveInputs(
  env: NodeJS.ProcessEnv = process.env,
): LiveTestInputs {
  return {
    chatUrl: env.TURBO_RENDER_LIVE_CHAT_URL?.trim() || null,
    useActiveTab: normalizeBooleanEnv(env.TURBO_RENDER_LIVE_USE_ACTIVE_TAB),
  };
}

export function validateConfiguredLiveInputs(inputs: LiveTestInputs): LiveTestInputs {
  const chatUrl = inputs.chatUrl == null ? null : parseLiveTargetUrl(inputs.chatUrl).url;
  const useActiveTab = inputs.useActiveTab;

  if (chatUrl == null && !useActiveTab) {
    throw new Error('The live chat smoke requires --chat-url or --use-active-tab.');
  }

  if (chatUrl != null && useActiveTab) {
    throw new Error('Use either --chat-url or --use-active-tab for live chat smoke, not both.');
  }

  return {
    chatUrl,
    useActiveTab,
  };
}
