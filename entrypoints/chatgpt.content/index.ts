import { defineContentScript } from 'wxt/utils/define-content-script';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
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
import { createDisposableBag } from '../../lib/content/runtime-disposers';
import { TurboRenderController } from '../../lib/content/turbo-render-controller';
import type { InitialTrimSession, Settings } from '../../lib/shared/types';

type RuntimeMessageEventTarget = {
  addListener(handler: (...args: unknown[]) => unknown): void;
  removeListener(handler: (...args: unknown[]) => unknown): void;
};

function resolveRuntimeMessageEvent(): {
  api: RuntimeMessageEventTarget | null;
  flavor: 'browser' | 'chrome' | null;
} {
  const maybeChrome = (globalThis as {
    chrome?: { runtime?: { id?: string | null; onMessage?: RuntimeMessageEventTarget } };
  }).chrome;
  if (maybeChrome?.runtime?.id != null && maybeChrome.runtime.onMessage != null) {
    return {
      api: maybeChrome.runtime.onMessage,
      flavor: 'chrome',
    };
  }

  const maybeBrowser = (globalThis as {
    browser?: { runtime?: { id?: string | null; onMessage?: RuntimeMessageEventTarget } };
  }).browser;
  if (maybeBrowser?.runtime?.id != null && maybeBrowser.runtime.onMessage != null) {
    return {
      api: maybeBrowser.runtime.onMessage,
      flavor: 'browser',
    };
  }

  return {
    api: null,
    flavor: null,
  };
}

function registerRuntimeMessageListener(
  bag: ReturnType<typeof createDisposableBag>,
  handler: (message: unknown) => unknown,
): boolean {
  const { api, flavor } = resolveRuntimeMessageEvent();
  if (api == null || flavor == null) {
    return false;
  }

  const listener = flavor === 'chrome'
    ? (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
        const result = handler(message);
        if (result === undefined) {
          return undefined;
        }

        void Promise.resolve(result)
          .then((value) => {
            sendResponse(value);
          })
          .catch(() => {
            sendResponse(null);
          });
        return true;
      }
    : (message: unknown) => handler(message);

  try {
    api.addListener(listener as (...args: unknown[]) => unknown);
  } catch {
    return false;
  }

  bag.add(() => {
    try {
      api.removeListener(listener as (...args: unknown[]) => unknown);
    } catch {
      // Ignore teardown failures when the content-script context is already invalid.
    }
  });

  return true;
}

function whenDocumentReady(callback: () => void, ctx?: ContentScriptContext): void {
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

function areSettingsEquivalent(left: Settings, right: Settings): boolean {
  return (
    left.enabled === right.enabled &&
    left.autoEnable === right.autoEnable &&
    left.language === right.language &&
    left.mode === right.mode &&
    left.minFinalizedBlocks === right.minFinalizedBlocks &&
    left.minDescendants === right.minDescendants &&
    left.keepRecentPairs === right.keepRecentPairs &&
    left.batchPairCount === right.batchPairCount &&
    left.initialHotPairs === right.initialHotPairs &&
    left.liveHotPairs === right.liveHotPairs &&
    left.keepRecentTurns === right.keepRecentTurns &&
    left.viewportBufferTurns === right.viewportBufferTurns &&
    left.groupSize === right.groupSize &&
    left.initialTrimEnabled === right.initialTrimEnabled &&
    left.initialHotTurns === right.initialHotTurns &&
    left.liveHotTurns === right.liveHotTurns &&
    left.coldRestoreMode === right.coldRestoreMode &&
    left.softFallback === right.softFallback &&
    left.frameSpikeThresholdMs === right.frameSpikeThresholdMs &&
    left.frameSpikeCount === right.frameSpikeCount &&
    left.frameSpikeWindowMs === right.frameSpikeWindowMs
  );
}

function isHydrationPlaceholderChatId(chatId: string): boolean {
  return chatId === 'chat:unknown';
}

function getRuntimeExtensionId(): string | null {
  const chromeRuntimeId = (globalThis as {
    chrome?: { runtime?: { id?: string | null } };
  }).chrome?.runtime?.id;
  if (typeof chromeRuntimeId === 'string' && chromeRuntimeId.trim().length > 0) {
    return chromeRuntimeId.trim();
  }

  const browserRuntimeId = (globalThis as {
    browser?: { runtime?: { id?: string | null } };
  }).browser?.runtime?.id;
  if (typeof browserRuntimeId === 'string' && browserRuntimeId.trim().length > 0) {
    return browserRuntimeId.trim();
  }

  return null;
}

const contentScript = defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_start',
  async main(ctx: ContentScriptContext) {
    const html = document.documentElement;
    if (html != null) {
      html.dataset.turborenderBuild = BUILD_SIGNATURE;
    }
    const extensionId = getRuntimeExtensionId();
    if (extensionId != null) {
      if (html != null) {
        html.dataset.turboRenderExtensionId = extensionId;
      }
      if (document.body != null) {
        document.body.dataset.turboRenderExtensionId = extensionId;
      }
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

          const settingsChanged = !areSettingsEquivalent(settings, nextSettings);
          settings = nextSettings;
          if (settingsChanged) {
            controller?.setSettings(nextSettings);
            syncPageConfig(nextSettings);
          }

          if (chatIdAtSyncStart !== lastChatId) {
            return;
          }

          if (paused !== nextPaused) {
            paused = nextPaused;
            controller?.setPaused(nextPaused);
          }
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

    const handleExtensionReloadRequest = (event: MessageEvent) => {
      if (!isAlive() || event.source !== window) {
        return;
      }

      const data = event.data as
        | { namespace?: string; type?: string }
        | null
        | undefined;
      if (data?.namespace !== 'chatgpt-turborender' || data.type !== 'TURBO_RENDER_REQUEST_EXTENSION_RELOAD') {
        return;
      }

      const maybeChrome = (globalThis as { chrome?: { runtime?: { reload?: () => void } } }).chrome;
      if (typeof maybeChrome?.runtime?.reload === 'function') {
        maybeChrome.runtime.reload();
      }
    };

    ctx.addEventListener(window, 'message', handlePageMessage as EventListener);
    ctx.addEventListener(window, 'message', handleExtensionReloadRequest as EventListener);
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

      const settingsChanged = !areSettingsEquivalent(settings, nextSettings);
      settings = nextSettings;
      if (chatIdAtLoad === lastChatId) {
        paused = nextPaused;
      }
      if (settingsChanged) {
        syncPageConfig(settings);
        (controller as TurboRenderController | null)?.setSettings(settings);
      }
      if (chatIdAtLoad === lastChatId) {
        (controller as TurboRenderController | null)?.setPaused(paused);
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
        case 'GET_RUNTIME_STATUS':
          return controller?.getStatus() ?? null;
        case 'GET_TAB_STATUS':
          return undefined;
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

    registerRuntimeMessageListener(disposables, handleRuntimeMessage);
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

export default contentScript;
