export interface DisposableBag {
  add(disposer: () => void): void;
  dispose(): void;
}

export function createDisposableBag(): DisposableBag {
  const disposers: Array<() => void> = [];
  let disposed = false;

  return {
    add(disposer) {
      if (disposed) {
        disposer();
        return;
      }

      disposers.push(disposer);
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      while (disposers.length > 0) {
        const disposer = disposers.pop();
        try {
          disposer?.();
        } catch {
          // Ignore teardown failures when the content-script context is already invalid.
        }
      }
    },
  };
}

export interface EventTargetLike {
  addListener: (handler: () => void) => void;
  removeListener: (handler: () => void) => void;
}

export function registerOptionalListener(
  bag: DisposableBag,
  target: EventTargetLike | undefined,
  handler: () => void,
): boolean {
  if (!target) {
    return false;
  }
  try {
    target.addListener(handler);
  } catch {
    return false;
  }
  bag.add(() => {
    try {
      target.removeListener(handler);
    } catch {
      // Ignore teardown failures
    }
  });
  return true;
}
