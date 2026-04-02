import { resolveConversationRoute } from '../shared/chat-id';

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const RECOVERY_MESSAGE_TYPES = new Set(['GET_RUNTIME_STATUS', 'RESTORE_NEARBY', 'RESTORE_ALL']);
const RECOVERY_RETRY_DELAY_MS = 120;

export interface RuntimeRecoveryTab {
  id: number;
  url?: string | null;
}

export interface TabMessageRecoveryDeps {
  sendMessage<T>(tabId: number, message: unknown): Promise<T | null>;
  getTab(tabId: number): Promise<RuntimeRecoveryTab | null>;
  injectContentScripts(tabId: number): Promise<boolean>;
  wait(ms: number): Promise<void>;
}

function isChatGptHost(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  try {
    return CHATGPT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isSupportedConversationRoute(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  try {
    const { kind } = resolveConversationRoute(new URL(url).pathname);
    return kind === 'chat' || kind === 'share';
  } catch {
    return false;
  }
}

function getMessageType(message: unknown): string | null {
  if (typeof message !== 'object' || message == null || !('type' in message)) {
    return null;
  }

  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

function shouldAttemptRecovery(message: unknown): boolean {
  const type = getMessageType(message);
  return type != null && RECOVERY_MESSAGE_TYPES.has(type);
}

export async function sendMessageWithRuntimeRecovery<T>(
  deps: TabMessageRecoveryDeps,
  tabId: number,
  message: unknown,
): Promise<T | null> {
  const firstAttempt = await deps.sendMessage<T>(tabId, message);
  if (firstAttempt != null) {
    return firstAttempt;
  }

  if (!shouldAttemptRecovery(message)) {
    return null;
  }

  const tab = await deps.getTab(tabId);
  if (tab == null || !isChatGptHost(tab.url) || !isSupportedConversationRoute(tab.url)) {
    return null;
  }

  const injected = await deps.injectContentScripts(tab.id);
  if (!injected) {
    return null;
  }

  await deps.wait(RECOVERY_RETRY_DELAY_MS);
  return deps.sendMessage<T>(tabId, message);
}
