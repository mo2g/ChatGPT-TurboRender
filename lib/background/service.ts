import { getChatIdFromPathname } from '../shared/chat-id';
import type { RuntimeMessage } from '../shared/messages';
import type { Settings, TabRuntimeStatus, TabStatusResponse } from '../shared/types';

export interface BackgroundDeps {
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  getPausedChats(): Promise<Record<string, boolean>>;
  setPausedChat(chatId: string, paused: boolean): Promise<void>;
  getActiveTab(): Promise<{ id: number | null; url?: string | null } | null>;
  getTabStatus(tabId: number): Promise<TabRuntimeStatus | null>;
  forwardToTab(
    tabId: number,
    message: Extract<RuntimeMessage, { type: 'RESTORE_NEARBY' | 'RESTORE_ALL' }>,
  ): Promise<TabRuntimeStatus | null>;
}

async function buildTabStatus(
  deps: BackgroundDeps,
  explicitTabId?: number,
): Promise<TabStatusResponse> {
  const settings = await deps.getSettings();
  const tab = explicitTabId != null ? { id: explicitTabId } : await deps.getActiveTab();
  const runtime = tab?.id != null ? await deps.getTabStatus(tab.id) : null;
  const pausedChats = await deps.getPausedChats();
  const chatId =
    runtime?.chatId ??
    (tab?.url ? getChatIdFromPathname(new URL(tab.url).pathname) : 'chat:unknown');

  return {
    settings,
    paused: pausedChats[chatId] ?? false,
    runtime: runtime == null ? null : { ...runtime, paused: pausedChats[chatId] ?? false },
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
