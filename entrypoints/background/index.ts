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

type TabQuery = Parameters<typeof browser.tabs.query>[0];

interface QueryableTab {
  id: number | null;
  url?: string | null;
  active?: boolean;
  index?: number;
}

async function safeQueryTabs(query: TabQuery): Promise<QueryableTab[]> {
  try {
    return (await browser.tabs.query(query)) as QueryableTab[];
  } catch {
    return [];
  }
}

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
      const lastFocusedTabs = await safeQueryTabs({
        active: true,
        lastFocusedWindow: true,
        windowType: 'normal',
      });
      const normalWindowActiveTabs = lastFocusedTabs.length === 0
        ? await safeQueryTabs({
            active: true,
            windowType: 'normal',
          })
        : [];
      const anyWindowActiveTabs = lastFocusedTabs.length === 0 && normalWindowActiveTabs.length === 0
        ? await safeQueryTabs({
            active: true,
          })
        : [];
      const tab = [...lastFocusedTabs, ...normalWindowActiveTabs, ...anyWindowActiveTabs][0] ?? null;
      if (tab == null) {
        return null;
      }

      return {
        id: tab.id ?? null,
        url: tab.url ?? null,
        active: tab.active ?? false,
        index: tab.index ?? 999_999,
      };
    },
    async getCurrentWindowTabs() {
      const lastFocusedTabs = await safeQueryTabs({
        lastFocusedWindow: true,
        windowType: 'normal',
      });
      const normalWindowTabs = lastFocusedTabs.length > 0
        ? lastFocusedTabs
        : await safeQueryTabs({ windowType: 'normal' });
      const tabs = normalWindowTabs.length > 0 ? normalWindowTabs : await safeQueryTabs({});
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

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return undefined;
    }

    void Promise.resolve(service.handle(message))
      .then((response) => {
        sendResponse(response);
      })
      .catch(() => {
        sendResponse(null);
      });
    return true;
  });
});
