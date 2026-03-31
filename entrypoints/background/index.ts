import { browser } from 'wxt/browser';

import { createBackgroundService } from '../../lib/background/service';
import { isRuntimeMessage } from '../../lib/shared/messages';
import {
  ensureDefaultSettings,
  getPausedChats,
  getSettings,
  setChatPaused,
  setSettings,
} from '../../lib/shared/settings';

async function safeSendMessage<T>(tabId: number, message: unknown): Promise<T | null> {
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

export default defineBackground(() => {
  const service = createBackgroundService({
    getSettings,
    setSettings,
    getPausedChats,
    setPausedChat: setChatPaused,
    async getActiveTab() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return {
        id: tab?.id ?? null,
        url: tab?.url ?? null,
        active: tab?.active ?? false,
        index: tab?.index ?? 999_999,
      };
    },
    async getCurrentWindowTabs() {
      const tabs = await browser.tabs.query({
        currentWindow: true,
      });
      return tabs.map((tab) => ({
        id: tab.id ?? null,
        url: tab.url ?? null,
        active: tab.active ?? false,
        index: tab.index ?? 999_999,
      }));
    },
    async getTabStatus(tabId) {
      return safeSendMessage(tabId, { type: 'GET_TAB_STATUS' });
    },
    async forwardToTab(tabId, message) {
      return safeSendMessage(tabId, message);
    },
  });

  browser.runtime.onInstalled.addListener(() => {
    void ensureDefaultSettings();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (!isRuntimeMessage(message)) {
      return undefined;
    }

    return service.handle(message);
  });
});
