import {
  cancelAnimationFrameCompat,
  requestAnimationFrameCompat,
} from './turbo-render-controller-utils';

export interface WaitForHostElementOptions {
  doc: Document;
  win: Window;
  timeoutMs: number;
  probe(): HTMLElement | null;
}

export function waitForHostElement(options: WaitForHostElementOptions): Promise<HTMLElement | null> {
  const { doc, win, timeoutMs, probe } = options;
  return new Promise((resolve) => {
    const observeRoot = doc.body ?? doc.documentElement;
    let settled = false;
    let timeoutHandle: number | null = null;
    let frameHandle: number | null = null;
    let observer: MutationObserver | null = null;

    const cleanup = (): void => {
      if (timeoutHandle != null) {
        win.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (frameHandle != null) {
        cancelAnimationFrameCompat(win, frameHandle);
        frameHandle = null;
      }
      observer?.disconnect();
      observer = null;
    };

    const settle = (target: HTMLElement | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(target);
    };

    const probeAndSettle = (): boolean => {
      const target = probe();
      if (target == null) {
        return false;
      }
      settle(target);
      return true;
    };

    const scheduleFrameProbe = (): void => {
      if (settled) {
        return;
      }
      frameHandle = requestAnimationFrameCompat(win, () => {
        frameHandle = null;
        if (!probeAndSettle()) {
          scheduleFrameProbe();
        }
      });
    };

    if (observeRoot != null && typeof win.MutationObserver === 'function') {
      observer = new win.MutationObserver(() => {
        probeAndSettle();
      });
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state'],
      });
    }

    timeoutHandle = win.setTimeout(() => {
      settle(null);
    }, timeoutMs);

    if (!probeAndSettle()) {
      scheduleFrameProbe();
    }
  });
}
