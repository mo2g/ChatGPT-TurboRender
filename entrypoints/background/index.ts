import { browser } from 'wxt/browser';

import { createBackgroundService } from '../../lib/background/service';
import { sendMessageWithRuntimeRecovery } from '../../lib/background/tab-message-recovery';
import { isRuntimeMessage } from '../../lib/shared/messages';
import {
  ensureDefaultSettings,
  getPausedChats,
  getSettings,
  setChatPaused,
  setSettings,
} from '../../lib/shared/settings';

const CONTENT_SCRIPT_FILE_CHATGPT = 'content-scripts/chatgpt.js';
const CONTENT_SCRIPT_FILE_BOOTSTRAP = 'content-scripts/chatgpt-bootstrap.js';

async function safeSendMessage<T>(tabId: number, message: unknown): Promise<T | null> {
  return sendMessageWithRuntimeRecovery<T>({
    async sendMessage(targetTabId, payload) {
      try {
        return (await browser.tabs.sendMessage(targetTabId, payload)) as T;
      } catch {
        return null;
      }
    },
    async getTab(targetTabId) {
      try {
        const tab = await browser.tabs.get(targetTabId);
        return {
          id: tab.id ?? targetTabId,
          url: tab.url ?? null,
        };
      } catch {
        return null;
      }
    },
    async injectContentScripts(targetTabId) {
      if (browser.scripting == null) {
        return false;
      }

      try {
        await browser.scripting.executeScript({
          target: { tabId: targetTabId },
          files: [CONTENT_SCRIPT_FILE_CHATGPT],
          world: 'ISOLATED',
        });
      } catch {
        return false;
      }

      try {
        await browser.scripting.executeScript({
          target: { tabId: targetTabId },
          files: [CONTENT_SCRIPT_FILE_BOOTSTRAP],
          world: 'MAIN',
        });
      } catch {
        // Bootstrap is optional for status/command recovery; ignore MAIN-world injection failures.
      }

      return true;
    },
    async wait(ms) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, ms);
      });
    },
  }, tabId, message);
}

export default defineBackground(() => {
  const service = createBackgroundService({
    getSettings,
    setSettings,
    getPausedChats,
    setPausedChat: setChatPaused,
    async getActiveTab() {
      const lastFocusedTabs = await browser.tabs.query({
        active: true,
        lastFocusedWindow: true,
        windowType: 'normal',
      });
      const normalWindowActiveTabs = lastFocusedTabs.length === 0
        ? await browser.tabs.query({
            active: true,
            windowType: 'normal',
          })
        : [];
      const anyWindowActiveTabs = lastFocusedTabs.length === 0 && normalWindowActiveTabs.length === 0
        ? await browser.tabs.query({
            active: true,
          })
        : [];
      const tab = [...lastFocusedTabs, ...normalWindowActiveTabs, ...anyWindowActiveTabs][0] ?? null;
      return {
        id: tab?.id ?? null,
        url: tab?.url ?? null,
        active: tab?.active ?? false,
        index: tab?.index ?? 999_999,
      };
    },
    async getCurrentWindowTabs() {
      const lastFocusedTabs = await browser.tabs.query({
        lastFocusedWindow: true,
        windowType: 'normal',
      });
      const normalWindowTabs = lastFocusedTabs.length > 0
        ? lastFocusedTabs
        : await browser.tabs.query({ windowType: 'normal' });
      const tabs = normalWindowTabs.length > 0 ? normalWindowTabs : await browser.tabs.query({});
      return tabs.map((tab) => ({
        id: tab.id ?? null,
        url: tab.url ?? null,
        active: tab.active ?? false,
        index: tab.index ?? 999_999,
      }));
    },
    async getTabStatus(tabId) {
      return safeSendMessage(tabId, { type: 'GET_RUNTIME_STATUS' });
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
