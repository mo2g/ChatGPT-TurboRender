import { getChatIdFromPathname, resolveConversationRoute } from '../shared/chat-id';
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

function getRouteKindFromUrl(url: string | null | undefined): TabStatusResponse['activeTabRouteKind'] {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  try {
    return resolveConversationRoute(new URL(url).pathname).kind;
  } catch {
    return null;
  }
}

async function findSupportedChatGptTab(
  deps: BackgroundDeps,
  tabs: BackgroundTab[],
  skipTabId: number | null,
): Promise<{ tab: BackgroundTab; runtime: TabRuntimeStatus } | null> {
  const orderedTabs = [...tabs].sort((left, right) => (left.index ?? 999_999) - (right.index ?? 999_999));
  let firstReadableRuntime: { tab: BackgroundTab; runtime: TabRuntimeStatus } | null = null;

  for (const tab of orderedTabs) {
    if (tab.id == null || tab.id === skipTabId || !isChatGptHost(tab.url)) {
      continue;
    }

    const runtime = await deps.getTabStatus(tab.id);
    if (runtime == null) {
      continue;
    }

    if (runtime.supported) {
      return { tab, runtime };
    }

    if (firstReadableRuntime == null) {
      firstReadableRuntime = { tab, runtime };
    }
  }

  return firstReadableRuntime;
}

async function buildTabStatus(
  deps: BackgroundDeps,
  explicitTabId?: number,
): Promise<TabStatusResponse> {
  const settings = await deps.getSettings();
  const tabs = await deps.getCurrentWindowTabs();
  const activeTabFromDeps = await deps.getActiveTab();
  const activeTabFromTabs = tabs.find((tab) => tab.active) ?? null;
  const activeTab = activeTabFromDeps ?? activeTabFromTabs;
  const activeTabSupportedHost = isChatGptHost(activeTab?.url);
  const activeTabRouteKind = getRouteKindFromUrl(activeTab?.url);
  let targetTab = explicitTabId != null
    ? (tabs.find((tab) => tab.id === explicitTabId) ??
      (activeTab?.id === explicitTabId ? activeTab : { id: explicitTabId, active: false, index: 999_999 }))
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

  if (
    explicitTabId == null &&
    runtime == null &&
    tabs.length === 0 &&
    activeTab?.id != null &&
    isChatGptHost(activeTab.url)
  ) {
    const runtimeFromActiveTab = await deps.getTabStatus(activeTab.id);
    if (runtimeFromActiveTab != null) {
      targetTab = activeTab;
      runtime = runtimeFromActiveTab;
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
    activeTabRouteKind,
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
