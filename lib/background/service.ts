import { getChatIdFromPathname } from '../shared/chat-id';
import type { RuntimeMessage } from '../shared/messages';
import type { Settings, TabRuntimeStatus, TabStatusResponse } from '../shared/types';

interface BackgroundTab {
  id: number | null;
  url?: string | null;
  active?: boolean;
  index?: number;
}

export interface BackgroundDeps {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getPausedChats(): Promise<Record<string, boolean>>;
  setPausedChat(chatId: string, paused: boolean): Promise<void>;
  getActiveTab(): Promise<BackgroundTab | null>;
  getCurrentWindowTabs(): Promise<BackgroundTab[]>;
  getTabStatus(tabId: number): Promise<TabRuntimeStatus | null>;
  forwardToTab(
    tabId: number,
    message: Extract<RuntimeMessage, { type: 'RESTORE_NEARBY' | 'RESTORE_ALL' }>,
  ): Promise<TabRuntimeStatus | null>;
}

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

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

function getChatIdFromUrl(url: string | null | undefined): string {
  if (typeof url !== 'string' || url.length === 0) {
    return 'chat:unknown';
  }

  try {
    return getChatIdFromPathname(new URL(url).pathname);
  } catch {
    return 'chat:unknown';
  }
}

async function findSupportedChatGptTab(
  deps: BackgroundDeps,
  tabs: BackgroundTab[],
  skipTabId: number | null,
): Promise<{ tab: BackgroundTab; runtime: TabRuntimeStatus } | null> {
  const orderedTabs = [...tabs].sort((left, right) => (left.index ?? 999_999) - (right.index ?? 999_999));

  for (const tab of orderedTabs) {
    if (tab.id == null || tab.id === skipTabId || !isChatGptHost(tab.url)) {
      continue;
    }

    const runtime = await deps.getTabStatus(tab.id);
    if (runtime?.supported) {
      return { tab, runtime };
    }
  }

  return null;
}

async function buildTabStatus(
  deps: BackgroundDeps,
  explicitTabId?: number,
): Promise<TabStatusResponse> {
  const settings = await deps.getSettings();
  const tabs = await deps.getCurrentWindowTabs();
  const activeTab = tabs.find((tab) => tab.active) ?? null;
  const activeTabSupportedHost = isChatGptHost(activeTab?.url);
  let targetTab = explicitTabId != null
    ? (tabs.find((tab) => tab.id === explicitTabId) ?? { id: explicitTabId, active: false, index: 999_999 })
    : activeTab;
  let runtime = targetTab?.id != null ? await deps.getTabStatus(targetTab.id) : null;
  let usingWindowFallback = false;

  if (explicitTabId == null && runtime == null) {
    const fallback = await findSupportedChatGptTab(deps, tabs, activeTab?.id ?? null);
    if (fallback != null) {
      targetTab = fallback.tab;
      runtime = fallback.runtime;
      usingWindowFallback = true;
    }
  }

  const pausedChats = await deps.getPausedChats();
  const chatId =
    runtime?.chatId ??
    getChatIdFromUrl(targetTab?.url);

  return {
    settings,
    paused: pausedChats[chatId] ?? false,
    runtime: runtime == null ? null : { ...runtime, paused: pausedChats[chatId] ?? false },
    targetTabId: targetTab?.id ?? null,
    activeTabId: activeTab?.id ?? null,
    usingWindowFallback,
    activeTabSupportedHost,
  };
}

export function createBackgroundService(deps: BackgroundDeps) {
  return {
    async handle(message: RuntimeMessage): Promise<TabStatusResponse | TabRuntimeStatus | { ok: true } | null> {
      switch (message.type) {
        case 'GET_TAB_STATUS':
          return buildTabStatus(deps, message.tabId);

        case 'TOGGLE_GLOBAL':
          await deps.setSettings({ enabled: message.enabled });
          return buildTabStatus(deps);

        case 'UPDATE_SETTINGS':
          await deps.setSettings(message.patch);
          return buildTabStatus(deps);

        case 'PAUSE_CHAT':
          await deps.setPausedChat(message.chatId, message.paused);
          return buildTabStatus(deps, message.tabId);

        case 'RESTORE_NEARBY':
        case 'RESTORE_ALL': {
          const tab = message.tabId != null ? { id: message.tabId } : await deps.getActiveTab();
          if (tab?.id == null) {
            return null;
          }
          return deps.forwardToTab(tab.id, message);
        }

        default:
          return null;
      }
    },
  };
}
