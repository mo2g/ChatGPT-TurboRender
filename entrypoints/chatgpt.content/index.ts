import { BUILD_SIGNATURE, DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { isRuntimeMessage } from '../../lib/shared/messages';
import { isTurboRenderBridgeMessage, postBridgeMessage, toPageConfig } from '../../lib/shared/runtime-bridge';
import { shouldReplaceSession } from '../../lib/shared/session-precedence';
import {
  getCurrentChatId,
  getSettings,
  isChatPaused,
  setChatPaused,
} from '../../lib/shared/settings';
import { createDisposableBag, registerOptionalListener } from '../../lib/content/runtime-disposers';
import { getRuntimeMessageEvent } from '../../lib/shared/extension-api';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import type { InitialTrimSession, Settings } from '../../lib/shared/types';

function whenDocumentReady(callback: () => void, ctx?: { addEventListener?: (...args: unknown[]) => void; isInvalid?: boolean }): void {
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    if (ctx?.isInvalid) {
      return;
    }
    callback();
    return;
  }

  if (ctx?.addEventListener != null) {
    ctx.addEventListener(document, 'DOMContentLoaded', () => {
      if (!ctx.isInvalid) {
        callback();
      }
    }, { once: true });
    return;
  }

  document.addEventListener('DOMContentLoaded', () => callback(), { once: true });
}

function createContentScriptInstanceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `turborender-${Math.random().toString(36).slice(2, 10)}`;
}

function isHydrationPlaceholderChatId(chatId: string): boolean {
  return chatId === 'chat:unknown';
}

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_start',
  async main(ctx) {
    const html = document.documentElement;
    if (html != null) {
      html.dataset.turborenderBuild = BUILD_SIGNATURE;
    }
    console.info(`[TurboRender] content-script build ${BUILD_SIGNATURE}`);

    const contentScriptStartedAt = Date.now();
    const contentScriptInstanceId = createContentScriptInstanceId();
    let settings = DEFAULT_SETTINGS;
    let paused = false;
    let controller: TurboRenderController | null = null;
    const trimSessions = new Map<string, InitialTrimSession>();
    let lastChatId = getCurrentChatId();
    let pendingChatId: string | null = null;
    let pendingChatSince = 0;
    let storageSyncInFlight = false;
    let destroyed = false;
    const disposables = createDisposableBag();
    const isAlive = () => !destroyed && !ctx.isInvalid;

    const syncPageConfig = (nextSettings: Settings) => {
      if (!isAlive()) {
        return;
      }
      postBridgeMessage(window, {
        namespace: 'chatgpt-turborender',
        type: 'TURBO_RENDER_CONFIG',
        payload: toPageConfig(nextSettings),
      });
    };

    const syncKnownSession = (chatId: string) => {
      if (!isAlive()) {
        return;
      }
      controller?.setInitialTrimSession(trimSessions.get(chatId) ?? null);
    };

    const syncPausedState = (chatId: string) => {
      void isChatPaused(chatId).then((nextPaused) => {
        if (!isAlive() || chatId !== lastChatId) {
          return;
        }
        paused = nextPaused;
        controller?.setPaused(nextPaused);
      });
    };

    const requestSessionReplay = (chatId: string) => {
      if (!isAlive()) {
        return;
      }
      postBridgeMessage(window, {
        namespace: 'chatgpt-turborender',
        type: 'TURBO_RENDER_REQUEST_STATE',
        payload: { chatId },
      });
    };

    const syncSettingsSnapshot = () => {
      if (!isAlive() || storageSyncInFlight) {
        return;
      }

      storageSyncInFlight = true;
      const chatIdAtSyncStart = lastChatId;
      void Promise.all([getSettings(), isChatPaused(chatIdAtSyncStart)])
        .then(([nextSettings, nextPaused]) => {
          if (!isAlive()) {
            return;
          }

          settings = nextSettings;
          controller?.setSettings(nextSettings);
          syncPageConfig(nextSettings);

          if (chatIdAtSyncStart !== lastChatId) {
            return;
          }

          paused = nextPaused;
          controller?.setPaused(nextPaused);
        })
        .finally(() => {
          storageSyncInFlight = false;
        });
    };

    const commitChatSwitch = (nextChatId: string, options?: { requestReplay?: boolean }) => {
      if (!isAlive() || nextChatId === lastChatId) {
        return;
      }

      lastChatId = nextChatId;
      pendingChatId = null;
      pendingChatSince = 0;
      controller?.resetForChatChange(nextChatId);
      syncPausedState(nextChatId);
      syncKnownSession(nextChatId);
      if (options?.requestReplay !== false) {
        requestSessionReplay(nextChatId);
      }
    };

    const cleanup = () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      disposables.dispose();
      controller?.stop();
      controller = null;
    };

    ctx.onInvalidated(cleanup);
    ctx.addEventListener(window, 'pagehide', cleanup, { once: true });

    const handlePageMessage = (event: MessageEvent) => {
      if (!isAlive()) {
        return;
      }
      if (
        event.source !== window ||
        !isTurboRenderBridgeMessage(event.data) ||
        event.data.type !== 'TURBO_RENDER_SESSION_STATE'
      ) {
        return;
      }

      const incomingSession = event.data.payload;
      const currentSession = trimSessions.get(incomingSession.chatId);
      const accepted = shouldReplaceSession(currentSession, incomingSession);
      if (accepted) {
        trimSessions.set(incomingSession.chatId, incomingSession);
      }

      if (!accepted) {
        return;
      }

      const routeChatId = getCurrentChatId();
      const targetChatId = isHydrationPlaceholderChatId(routeChatId) ? lastChatId : routeChatId;
      if (incomingSession.chatId === targetChatId) {
        if (incomingSession.chatId !== lastChatId) {
          commitChatSwitch(incomingSession.chatId, { requestReplay: false });
        } else {
          pendingChatId = null;
          pendingChatSince = 0;
        }
        controller?.setInitialTrimSession(incomingSession);
      }
    };

    ctx.addEventListener(window, 'message', handlePageMessage);
    syncPageConfig(settings);
    requestSessionReplay(lastChatId);

    const ensureController = () => {
      if (!isAlive() || controller != null) {
        return;
      }

      controller = new TurboRenderController({
        settings,
        paused,
        contentScriptInstanceId,
        contentScriptStartedAt,
        onPauseToggle: (nextPaused, chatId) => setChatPaused(chatId, nextPaused),
      });
      controller.start();
      controller.resetForChatChange(lastChatId);
      syncKnownSession(lastChatId);
    };

    whenDocumentReady(() => {
      ensureController();
    }, ctx);

    void (async () => {
      const chatIdAtLoad = lastChatId;
      const [nextSettings, nextPaused] = await Promise.all([
        getSettings(),
        isChatPaused(chatIdAtLoad),
      ]);

      if (!isAlive()) {
        return;
      }

      settings = nextSettings;
      if (chatIdAtLoad === lastChatId) {
        paused = nextPaused;
      }
      syncPageConfig(settings);
      controller?.setSettings(settings);
      if (chatIdAtLoad === lastChatId) {
        controller?.setPaused(paused);
      }
    })();

    const handleRuntimeMessage = (message: unknown) => {
      if (!isAlive()) {
        return undefined;
      }
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

    registerOptionalListener(disposables, getRuntimeMessageEvent<typeof handleRuntimeMessage>(), handleRuntimeMessage);
    ctx.setInterval(() => {
      syncSettingsSnapshot();
    }, 2000);

    ctx.setInterval(() => {
      if (!isAlive()) {
        return;
      }
      const nextChatId = getCurrentChatId();
      if (nextChatId === lastChatId) {
        pendingChatId = null;
        pendingChatSince = 0;
        return;
      }

      // Treat a confirmed `/` route as an intentional switch to a new chat.
      // Clear previous chat history immediately to avoid cross-chat leakage.
      if (nextChatId === 'chat:home') {
        commitChatSwitch(nextChatId, { requestReplay: false });
        return;
      }

      if (trimSessions.has(nextChatId)) {
        commitChatSwitch(nextChatId, { requestReplay: false });
        return;
      }

      const currentHasKnownSession = trimSessions.has(lastChatId);

      if (pendingChatId !== nextChatId) {
        pendingChatId = nextChatId;
        pendingChatSince = Date.now();
        requestSessionReplay(nextChatId);
        return;
      }

      const stableMs = Date.now() - pendingChatSince;
      if (stableMs < 1500) {
        return;
      }

      // Keep polling state replay, but do not switch to hydration placeholder ids.
      if (isHydrationPlaceholderChatId(nextChatId)) {
        requestSessionReplay(nextChatId);
        return;
      }

      // If the current chat has a known session, keep it until the next chat has
      // concrete session data. This avoids archive flicker/disappearance on route churn.
      if (currentHasKnownSession && !trimSessions.has(nextChatId)) {
        requestSessionReplay(nextChatId);
        return;
      }

      commitChatSwitch(nextChatId, { requestReplay: false });
    }, 500);
  },
});
