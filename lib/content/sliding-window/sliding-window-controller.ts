import { browser } from 'wxt/browser';
import { getChatIdFromPathname, getRouteIdFromRuntimeId } from '../../shared/chat-id';
import {
  createTranslator,
  getContentLanguage,
  type Translator,
} from '../../shared/i18n';
import {
  isTurboRenderBridgeMessage,
  postBridgeMessage,
  type SlidingWindowSearchResultsBridgeMessage,
  type SlidingWindowStateBridgeMessage,
} from '../../shared/runtime-bridge';
import type {
  InitialTrimSession,
  Settings,
  TabRuntimeStatus,
} from '../../shared/types';
import type { SlidingWindowRuntimeState } from '../../shared/sliding-window';
import { buildSlidingWindowRuntimeStatus } from './runtime-status';
import { SlidingWindowReadonlyGuard } from './readonly-guard';
import {
  SlidingWindowToolbar,
  type SlidingWindowToolbarNavigationDirection,
} from './toolbar';
import {mwLogger} from "../../main-world/logger";

export interface SlidingWindowControllerOptions {
  document?: Document;
  window?: Window;
  settings: Settings;
  paused: boolean;
  contentScriptInstanceId: string;
  contentScriptStartedAt: number;
}

type RuntimeWithUrl = {
  runtime?: {
    id?: string | null;
    getURL?: (path: string) => string;
  };
};

function resolveExtensionResourceUrl(path: string): string | null {
  const maybeChrome = (globalThis as { chrome?: RuntimeWithUrl }).chrome;
  if (maybeChrome?.runtime?.id != null && maybeChrome.runtime.getURL != null) {
    return maybeChrome.runtime.getURL(path);
  }

  const maybeBrowser = (globalThis as { browser?: RuntimeWithUrl }).browser;
  if (maybeBrowser?.runtime?.id != null && maybeBrowser.runtime.getURL != null) {
    return maybeBrowser.runtime.getURL(path);
  }

  return null;
}

export class SlidingWindowController {
  private readonly doc: Document;
  private readonly win: Window;
  private settings: Settings;
  private paused: boolean;
  private chatId: string;
  private readonly contentScriptInstanceId: string;
  private readonly contentScriptStartedAt: number;
  private t: Translator = createTranslator('en');
  private toolbar: SlidingWindowToolbar | null = null;
  private readonly readonlyGuard: SlidingWindowReadonlyGuard;
  private state: SlidingWindowRuntimeState | null = null;
  private readonly handleMessage = (event: MessageEvent) => this.onMessage(event);
  private readonly handleBroadcastMessage = (event: MessageEvent) => this.onBroadcastMessage(event);
  private readonly searchTimers = new Map<string, number>();
  private latestSearchRequestId: string | null = null;
  private guardInterval: number | null = null;
  private broadcastChannel: BroadcastChannel | null = null;

  constructor(options: SlidingWindowControllerOptions) {
    this.doc = options.document ?? document;
    this.win = options.window ?? window;
    this.settings = options.settings;
    this.paused = options.paused;
    this.chatId = getChatIdFromPathname(this.doc.location?.pathname ?? '/');
    this.contentScriptInstanceId = options.contentScriptInstanceId;
    this.contentScriptStartedAt = options.contentScriptStartedAt;
    this.readonlyGuard = new SlidingWindowReadonlyGuard(this.doc);
  }

  start(): void {
    this.refreshLanguage();
    this.toolbar = new SlidingWindowToolbar(this.doc, this.t, {
      onNavigate: (direction) => this.navigate(direction),
      onNavigateToPage: (page) => this.navigateToPage(page),
      onSearch: (query) => this.queueSearch(query),
      onOpenSearchResult: (pairIndex) => this.navigateToSearchResult(pairIndex),
      onOpenSettings: () => this.openSettings(),
    }, {
      iconUrl: resolveExtensionResourceUrl('favicon.png'),
    });
    this.toolbar?.mount();
    this.win.addEventListener('message', this.handleMessage);

    // 使用BroadcastChannel作为备选通信渠道，确保在MCP等环境中可靠
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('chatgpt-turborender-bridge');
        this.broadcastChannel.addEventListener('message', this.handleBroadcastMessage);
      } catch {
        // BroadcastChannel不支持时忽略
      }
    }

    this.guardInterval = this.win.setInterval(() => this.applyReadonlyGuard(), 1000);
    this.requestState();
  }

  stop(): void {
    this.win.removeEventListener('message', this.handleMessage);

    // 清理BroadcastChannel
    if (this.broadcastChannel != null) {
      this.broadcastChannel.removeEventListener('message', this.handleBroadcastMessage);
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    for (const timer of this.searchTimers.values()) {
      this.win.clearTimeout(timer);
    }
    this.searchTimers.clear();
    if (this.guardInterval != null) {
      this.win.clearInterval(this.guardInterval);
      this.guardInterval = null;
    }
    this.readonlyGuard.apply(false);
    this.toolbar?.destroy();
    this.toolbar = null;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    this.refreshLanguage();
    this.toolbar?.setTranslator(this.t);
    this.requestState();
    this.applyReadonlyGuard();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyReadonlyGuard();
  }

  setInitialTrimSession(_session: InitialTrimSession | null): void {
    // Sliding window mode does not use trim sessions
  }

  getStatus(): TabRuntimeStatus | null {
    return buildSlidingWindowRuntimeStatus({
      chatId: this.chatId,
      settings: this.settings,
      paused: this.paused,
      state: this.state,
      contentScriptInstanceId: this.contentScriptInstanceId,
      contentScriptStartedAt: this.contentScriptStartedAt,
    });
  }

  resetForChatChange(chatId: string): void {
    this.chatId = chatId;
    this.state = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.start();
  }

  restoreNearby(): void {
    // Sliding window mode does not support manual restore
  }

  restoreAll(): void {
    // Sliding window mode does not support manual restore
  }

  private refreshLanguage(): void {
    this.t = createTranslator(getContentLanguage(this.settings, this.doc));
  }

  private conversationId(): string | null {
    return getRouteIdFromRuntimeId(this.chatId);
  }

  private requestState(): void {
    postBridgeMessage(this.win, {
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_REQUEST_STATE',
      payload: {
        conversationId: this.conversationId(),
      },
    });
  }

  private navigate(direction: SlidingWindowToolbarNavigationDirection): void {
    postBridgeMessage(this.win, {
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
      payload: {
        conversationId: this.conversationId(),
        direction,
        useCache: true,
      },
    });
  }

  private navigateToPage(targetPage: number): void {
    postBridgeMessage(this.win, {
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
      payload: {
        conversationId: this.conversationId(),
        direction: 'page',
        targetPage,
        useCache: true,
      },
    });
  }

  private navigateToSearchResult(targetPairIndex: number): void {
    postBridgeMessage(this.win, {
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
      payload: {
        conversationId: this.conversationId(),
        direction: 'search',
        targetPairIndex,
        useCache: true,
      },
    });
  }

  private queueSearch(query: string): void {
    const existing = this.searchTimers.get('search');
    if (existing != null) {
      this.win.clearTimeout(existing);
    }

    const requestId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.latestSearchRequestId = requestId;
    const timer = this.win.setTimeout(() => {
      this.searchTimers.delete('search');
      postBridgeMessage(this.win, {
        namespace: 'chatgpt-turborender',
        type: 'TURBO_RENDER_SLIDING_WINDOW_SEARCH',
        payload: {
          requestId,
          conversationId: this.conversationId(),
          query,
        },
      });
    }, 160);
    this.searchTimers.set('search', timer);
  }

  private onMessage(event: MessageEvent): void {
    if (event.source !== this.win || !isTurboRenderBridgeMessage(event.data)) {
      return;
    }

    if (event.data.type === 'TURBO_RENDER_SLIDING_WINDOW_STATE') {
      this.applyState(event.data);
      return;
    }

    if (event.data.type === 'TURBO_RENDER_SLIDING_WINDOW_SEARCH_RESULTS') {
      this.applySearchResults(event.data);
      return;
    }

    if (event.data.type === 'TURBO_RENDER_SLIDING_WINDOW_WRITE_DETECTED') {
      this.requestState();
    }
  }

  private onBroadcastMessage(event: MessageEvent): void {
    // BroadcastChannel消息直接使用event.data，不需要检查event.source
    if (!isTurboRenderBridgeMessage(event.data)) {
      return;
    }

    if (event.data.type === 'TURBO_RENDER_SLIDING_WINDOW_STATE') {
      this.applyState(event.data);
      return;
    }

    if (event.data.type === 'TURBO_RENDER_SLIDING_WINDOW_SEARCH_RESULTS') {
      this.applySearchResults(event.data);
      return;
    }

    if (event.data.type === 'TURBO_RENDER_SLIDING_WINDOW_WRITE_DETECTED') {
      this.requestState();
    }
  }

  private applyState(message: SlidingWindowStateBridgeMessage): void {
    if (message.payload.conversationId !== this.conversationId()) {
      mwLogger.info('[TurboRender:Controller] applyState ignored: conversationId mismatch');
      return;
    }

    // Ignore outdated state messages (timestamp check)
    if (this.state != null && message.payload.updatedAt < this.state.updatedAt) {
      mwLogger.debug('[TurboRender:Controller] applyState ignored: outdated timestamp', {
        messageUpdatedAt: message.payload.updatedAt,
        currentUpdatedAt: this.state.updatedAt,
        diff: message.payload.updatedAt - this.state.updatedAt,
      });
      return;
    }

    this.state = message.payload;
    this.toolbar?.setState(message.payload);
    this.applyReadonlyGuard();
  }

  private applySearchResults(message: SlidingWindowSearchResultsBridgeMessage): void {
    if (message.payload.requestId !== this.latestSearchRequestId) {
      return;
    }

    this.toolbar?.setSearchResults(message.payload.query, message.payload.results);
  }

  private applyReadonlyGuard(): void {
    // 检查DOM标记作为备选状态同步机制
    this.checkDomStateMarker();

    const readonly = this.settings.enabled && !this.paused && this.state != null && !this.state.isLatestWindow;
    this.readonlyGuard.apply(readonly);
  }

  private checkDomStateMarker(): void {
    try {
      const html = this.win.document.documentElement;
      const marker = html.dataset.turborenderSlidingWindowState;
      if (marker == null || marker === '') {
        return;
      }

      const state: SlidingWindowRuntimeState = JSON.parse(marker);
      if (state.conversationId !== this.conversationId()) {
        return;
      }

      // 检查时间戳，只接受更新的状态
      if (this.state != null && state.updatedAt <= this.state.updatedAt) {
        return;
      }

      // 清除标记以避免重复处理
      html.dataset.turborenderSlidingWindowState = '';

      // 更新状态
      this.state = state;
      this.toolbar?.setState(state);
    } catch {
      // DOM读取失败时忽略
    }
  }

  private async openSettings(): Promise<void> {
    try {
      await browser.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    } catch {
      // Ignore errors if background is unavailable
    }
  }
}
