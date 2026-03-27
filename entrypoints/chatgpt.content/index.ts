import { browser } from 'wxt/browser';

import { isRuntimeMessage } from '../../lib/shared/messages';
import {
  getCurrentChatId,
  getSettings,
  isChatPaused,
  normalizeSettings,
  setChatPaused,
} from '../../lib/shared/settings';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_idle',
  async main() {
    const [settings, paused] = await Promise.all([getSettings(), isChatPaused(getCurrentChatId())]);
    const controller = new TurboRenderController({
      settings,
      paused,
      onPauseToggle: (nextPaused, chatId) => setChatPaused(chatId, nextPaused),
    });
    controller.start();

    const handleStorageChange: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (areaName !== 'local') {
        return;
      }

      const settingsChange = changes['turboRender.settings'];
      if (settingsChange != null) {
        controller.setSettings(normalizeSettings(settingsChange.newValue));
      }

      const pausedChatsChange = changes['turboRender.pausedChats'];
      if (pausedChatsChange != null) {
        const pausedChats = (pausedChatsChange.newValue as Record<string, boolean> | undefined) ?? {};
        controller.setPaused(pausedChats[getCurrentChatId()] ?? false);
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
          return controller.getStatus();
        case 'RESTORE_NEARBY':
          controller.restoreNearby();
          return controller.getStatus();
        case 'RESTORE_ALL':
          controller.restoreAll();
          return controller.getStatus();
        default:
          return undefined;
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    browser.runtime.onMessage.addListener(handleRuntimeMessage);

    window.addEventListener(
      'pagehide',
      () => {
        browser.storage.onChanged.removeListener(handleStorageChange);
        browser.runtime.onMessage.removeListener(handleRuntimeMessage);
        controller.stop();
      },
      { once: true },
    );
  },
});
