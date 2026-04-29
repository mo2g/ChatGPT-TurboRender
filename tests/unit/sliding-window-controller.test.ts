import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SlidingWindowController } from '../../lib/content/sliding-window';
import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import type { TurboRenderBridgeMessage } from '../../lib/shared/runtime-bridge';
import type { SlidingWindowRuntimeState } from '../../lib/shared/sliding-window';

function createRuntimeState(overrides: Partial<SlidingWindowRuntimeState> = {}): SlidingWindowRuntimeState {
  return {
    conversationId: 'abc',
    totalPairs: 6,
    pairCount: 2,
    range: {
      startPairIndex: 2,
      endPairIndex: 3,
    },
    isLatestWindow: false,
    updatedAt: 1_700_000_000_000,
    dirty: false,
    reason: null,
    ...overrides,
  };
}

function dispatchBridgeMessage(message: TurboRenderBridgeMessage): void {
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: message,
  }));
}

function setDocumentElementClientWidth(value: number): void {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value,
  });
}

function installElementBox(
  element: HTMLElement,
  box: {
    left: number;
    right: number;
    top?: number;
    bottom?: number;
    clientLeft?: number;
    clientWidth: number;
    clientHeight: number;
    offsetWidth: number;
    scrollHeight: number;
  },
): void {
  const top = box.top ?? 0;
  const bottom = box.bottom ?? 730;
  Object.defineProperties(element, {
    clientLeft: {
      configurable: true,
      value: box.clientLeft ?? 0,
    },
    clientWidth: {
      configurable: true,
      value: box.clientWidth,
    },
    clientHeight: {
      configurable: true,
      value: box.clientHeight,
    },
    offsetWidth: {
      configurable: true,
      value: box.offsetWidth,
    },
    scrollHeight: {
      configurable: true,
      value: box.scrollHeight,
    },
  });
  element.getBoundingClientRect = vi.fn(() => ({
    x: box.left,
    y: top,
    left: box.left,
    right: box.right,
    top,
    bottom,
    width: box.right - box.left,
    height: bottom - top,
    toJSON: () => ({}),
  }));
}

function createRightEdgeScrollRoot(): HTMLElement {
  const scrollRoot = document.createElement('div');
  scrollRoot.className = 'group/scroll-root overflow-y-auto';
  installElementBox(scrollRoot, {
    left: 260,
    right: 1589,
    clientLeft: 15,
    clientWidth: 1299,
    clientHeight: 730,
    offsetWidth: 1329,
    scrollHeight: 6427,
  });
  return scrollRoot;
}

describe('SlidingWindowController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState({}, '', '/c/abc');
    sessionStorage.clear();
    document.body.innerHTML = `
      <main>
        <textarea aria-label="Message"></textarea>
        <button type="button" data-testid="send-button">Send</button>
      </main>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    history.replaceState({}, '', '/');
  });

  it('requests runtime state and toggles readonly controls for historical windows', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const controller = new SlidingWindowController({
      settings: {
        ...DEFAULT_SETTINGS,
        mode: 'sliding-window',
      },
      paused: false,
      contentScriptInstanceId: 'instance-test',
      contentScriptStartedAt: 1_700_000_000_000,
    });

    controller.start();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TURBO_RENDER_SLIDING_WINDOW_REQUEST_STATE',
        payload: {
          conversationId: 'abc',
        },
      }),
      window.location.origin,
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    const sendButton = document.querySelector('[data-testid="send-button"]') as HTMLButtonElement;
    expect(textarea.disabled).toBe(false);
    expect(sendButton.disabled).toBe(false);

    dispatchBridgeMessage({
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_STATE',
      payload: createRuntimeState(),
    });

    expect(textarea.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
    expect(document.querySelector('[data-turbo-render-sliding-window-root="true"]')?.textContent).toContain('3-4 / 6');
    const toolbarStyle = document.querySelector('#turbo-render-sliding-window-style')?.textContent;
    expect(toolbarStyle).toContain('top: 50%');
    expect(toolbarStyle).toContain('right: var(--turbo-render-sliding-window-scrollbar-gutter, 0px)');
    expect(toolbarStyle).toContain('right: calc(0px - var(--turbo-render-sliding-window-trigger-overhang, 20px))');
    expect(toolbarStyle).not.toContain('right: -20px');
    expect(toolbarStyle).not.toContain('bottom: 16px');
    expect(document.querySelector('button[data-action="clear-cache"]')).toBeNull();
    expect(document.querySelector('button[data-action="clear-all-cache"]')).toBeNull();

    const toggleButton = document.querySelector<HTMLButtonElement>('button[data-action="toggle"]');
    expect(toggleButton?.getAttribute('aria-expanded')).toBe('false');
    toggleButton?.click();
    expect(toggleButton?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-turbo-render-sliding-window-root="true"]')?.getAttribute('data-open')).toBe('true');

    document.querySelector<HTMLButtonElement>('button[data-action="first"]')?.click();
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
        payload: {
          conversationId: 'abc',
          direction: 'first',
          useCache: true,
        },
      }),
      window.location.origin,
    );

    const pageInput = document.querySelector<HTMLInputElement>('input[data-action="page"]');
    expect(pageInput?.value).toBe('2');
    pageInput!.value = '3';
    pageInput!.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[data-action="page-go"]')?.click();
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
        payload: {
          conversationId: 'abc',
          direction: 'page',
          targetPage: 3,
          useCache: true,
        },
      }),
      window.location.origin,
    );

    const latestButton = document.querySelector<HTMLButtonElement>('button[data-action="latest"]:not(:disabled)');
    latestButton?.click();

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
        payload: {
          conversationId: 'abc',
          direction: 'latest',
          useCache: true,
        },
      }),
      window.location.origin,
    );

    dispatchBridgeMessage({
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_STATE',
      payload: createRuntimeState({
        range: {
          startPairIndex: 4,
          endPairIndex: 5,
        },
        isLatestWindow: true,
      }),
    });

    expect(textarea.disabled).toBe(false);
    expect(sendButton.disabled).toBe(false);

    controller.stop();
    expect(document.querySelector('[data-turbo-render-sliding-window-root="true"]')).toBeNull();
  });

  it('debounces search and navigates to a selected result', async () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const controller = new SlidingWindowController({
      settings: {
        ...DEFAULT_SETTINGS,
        mode: 'sliding-window',
      },
      paused: false,
      contentScriptInstanceId: 'instance-test',
      contentScriptStartedAt: 1_700_000_000_000,
    });

    controller.start();
    dispatchBridgeMessage({
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_STATE',
      payload: createRuntimeState(),
    });

    const input = document.querySelector<HTMLInputElement>('input[data-action="search"]');
    expect(input).not.toBeNull();
    document.querySelector<HTMLButtonElement>('button[data-action="toggle"]')?.click();
    input!.focus();
    input!.value = 'needle';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    await vi.advanceTimersByTimeAsync(170);

    const searchCall = postMessage.mock.calls.find(([message]) => {
      return (message as TurboRenderBridgeMessage).type === 'TURBO_RENDER_SLIDING_WINDOW_SEARCH';
    });
    expect(searchCall).toBeDefined();
    const searchMessage = searchCall?.[0] as TurboRenderBridgeMessage;
    expect(searchMessage).toMatchObject({
      type: 'TURBO_RENDER_SLIDING_WINDOW_SEARCH',
      payload: {
        conversationId: 'abc',
        query: 'needle',
      },
    });

    if (searchMessage.type !== 'TURBO_RENDER_SLIDING_WINDOW_SEARCH') {
      throw new Error('expected sliding-window search message');
    }

    dispatchBridgeMessage({
      namespace: 'chatgpt-turborender',
      type: 'TURBO_RENDER_SLIDING_WINDOW_SEARCH_RESULTS',
      payload: {
        requestId: searchMessage.payload.requestId,
        conversationId: 'abc',
        query: 'needle',
        results: [
          {
            pairIndex: 1,
            userPreview: 'needle prompt',
            assistantPreview: 'needle answer',
            excerpt: 'needle answer excerpt',
          },
        ],
      },
    });

    expect(document.querySelector('[data-turbo-render-sliding-window-root="true"]')?.getAttribute('data-open')).toBe('true');
    expect(document.activeElement?.getAttribute('data-action')).toBe('search');

    document.querySelector<HTMLButtonElement>('button[data-action="search-result"]')?.click();

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'TURBO_RENDER_SLIDING_WINDOW_NAVIGATE',
        payload: {
          conversationId: 'abc',
          direction: 'search',
          targetPairIndex: 1,
          useCache: true,
        },
      }),
      window.location.origin,
    );

    controller.stop();
  });

  it('tracks the viewport scrollbar gutter for the half-visible trigger edge', () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200);
    setDocumentElementClientWidth(1183);
    let controller: SlidingWindowController | null = null;

    try {
      controller = new SlidingWindowController({
        settings: {
          ...DEFAULT_SETTINGS,
          mode: 'sliding-window',
        },
        paused: false,
        contentScriptInstanceId: 'instance-test',
        contentScriptStartedAt: 1_700_000_000_000,
      });

      controller.start();

      const root = document.querySelector<HTMLElement>('[data-turbo-render-sliding-window-root="true"]');
      expect(root?.style.getPropertyValue('--turbo-render-sliding-window-scrollbar-gutter')).toBe('17px');

      setDocumentElementClientWidth(1200);
      window.dispatchEvent(new Event('resize'));

      expect(root?.style.getPropertyValue('--turbo-render-sliding-window-scrollbar-gutter')).toBe('0px');
    } finally {
      controller?.stop();
      if (originalClientWidth == null) {
        Reflect.deleteProperty(document.documentElement, 'clientWidth');
      } else {
        Object.defineProperty(document.documentElement, 'clientWidth', originalClientWidth);
      }
    }
  });

  it('tracks delayed right-edge scroll containers used by ChatGPT', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(document.documentElement, 'clientWidth');
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1589);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(730);
    setDocumentElementClientWidth(1589);
    let controller: SlidingWindowController | null = null;

    try {
      controller = new SlidingWindowController({
        settings: {
          ...DEFAULT_SETTINGS,
          mode: 'sliding-window',
        },
        paused: false,
        contentScriptInstanceId: 'instance-test',
        contentScriptStartedAt: 1_700_000_000_000,
      });

      controller.start();
      const root = document.querySelector<HTMLElement>('[data-turbo-render-sliding-window-root="true"]');
      expect(root?.style.getPropertyValue('--turbo-render-sliding-window-scrollbar-gutter')).toBe('0px');

      document.body.append(createRightEdgeScrollRoot());
      await vi.advanceTimersByTimeAsync(0);

      expect(root?.style.getPropertyValue('--turbo-render-sliding-window-scrollbar-gutter')).toBe('15px');
    } finally {
      controller?.stop();
      if (originalClientWidth == null) {
        Reflect.deleteProperty(document.documentElement, 'clientWidth');
      } else {
        Object.defineProperty(document.documentElement, 'clientWidth', originalClientWidth);
      }
    }
  });
});
