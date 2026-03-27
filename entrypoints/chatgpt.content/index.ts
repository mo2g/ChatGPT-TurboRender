import { browser } from 'wxt/browser';

import { isRuntimeMessage } from '../../lib/shared/messages';
import { isTurboRenderBridgeMessage, postBridgeMessage, toPageConfig } from '../../lib/shared/runtime-bridge';
import {
  getCurrentChatId,
  getSettings,
  isChatPaused,
  normalizeSettings,
  setChatPaused,
} from '../../lib/shared/settings';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import type { InitialTrimSession, Settings } from '../../lib/shared/types';

function whenDocumentReady(callback: () => void): void {
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    callback();
    return;
  }

  document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_start',
  async main() {
    let settings = await getSettings();
    let paused = await isChatPaused(getCurrentChatId());
    let controller: TurboRenderController | null = null;
    const trimSessions = new Map<string, InitialTrimSession>();
    let lastChatId = getCurrentChatId();

    const syncPageConfig = (nextSettings: Settings) => {
      postBridgeMessage(window, {
        namespace: 'chatgpt-turborender',
        type: 'TURBO_RENDER_CONFIG',
        payload: toPageConfig(nextSettings),
      });
    };

    const syncKnownSession = (chatId: string) => {
      controller?.setInitialTrimSession(trimSessions.get(chatId) ?? null);
    };

    const handlePageMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        !isTurboRenderBridgeMessage(event.data) ||
        event.data.type !== 'TURBO_RENDER_SESSION_STATE'
      ) {
        return;
      }

      trimSessions.set(event.data.payload.chatId, event.data.payload);
      if (event.data.payload.chatId === getCurrentChatId()) {
        controller?.setInitialTrimSession(event.data.payload);
      }
    };

    window.addEventListener('message', handlePageMessage);
    syncPageConfig(settings);
    postBridgeMessage(window, {
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_REQUEST_STATE',
      payload: { chatId: lastChatId },
    });

    whenDocumentReady(() => {
      controller = new TurboRenderController({
        settings,
        paused,
        onPauseToggle: (nextPaused, chatId) => setChatPaused(chatId, nextPaused),
      });
      controller.start();
      syncKnownSession(getCurrentChatId());
    });

    const handleStorageChange: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (areaName !== 'local') {
        return;
      }

      const settingsChange = changes['turboRender.settings'];
      if (settingsChange != null) {
        settings = normalizeSettings(settingsChange.newValue);
        controller?.setSettings(settings);
        syncPageConfig(settings);
      }

      const pausedChatsChange = changes['turboRender.pausedChats'];
      if (pausedChatsChange != null) {
        const pausedChats = (pausedChatsChange.newValue as Record<string, boolean> | undefined) ?? {};
        paused = pausedChats[getCurrentChatId()] ?? false;
        controller?.setPaused(paused);
      }
    };

    const handleRuntimeMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
      message,
    ) => {
      if (!isRuntimeMessage(message)) {
        return undefined;
      }

      switch (message.type) {
        case 'GET_TAB_STATUS':
          return controller?.getStatus() ?? null;
        case 'RESTORE_NEARBY':
          controller?.restoreNearby();
          return controller?.getStatus() ?? null;
        case 'RESTORE_ALL':
          controller?.restoreAll();
          return controller?.getStatus() ?? null;
        default:
          return undefined;
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    browser.runtime.onMessage.addListener(handleRuntimeMessage);

    const routePollHandle = window.setInterval(() => {
      const nextChatId = getCurrentChatId();
      if (nextChatId === lastChatId) {
        return;
      }

      lastChatId = nextChatId;
      void isChatPaused(nextChatId).then((nextPaused) => {
        paused = nextPaused;
        controller?.setPaused(nextPaused);
      });
      syncKnownSession(nextChatId);
      postBridgeMessage(window, {
        namespace: 'chatgpt-turborender',
        type: 'TURBO_RENDER_REQUEST_STATE',
        payload: { chatId: nextChatId },
      });
    }, 500);

    window.addEventListener(
      'pagehide',
      () => {
        window.clearInterval(routePollHandle);
        window.removeEventListener('message', handlePageMessage);
        browser.storage.onChanged.removeListener(handleStorageChange);
        browser.runtime.onMessage.removeListener(handleRuntimeMessage);
        controller?.stop();
      },
      { once: true },
    );
  },
});
