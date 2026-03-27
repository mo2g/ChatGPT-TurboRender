export interface DisposableBag {
  add(disposer: () => void): void;
  dispose(): void;
}

export interface ListenerApi<Handler> {
  addListener(handler: Handler): void;
  removeListener(handler: Handler): void;
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

export function registerOptionalListener<Handler>(
  bag: DisposableBag,
  api: ListenerApi<Handler> | null | undefined,
  handler: Handler,
): boolean {
  if (api == null) {
    return false;
  }

  api.addListener(handler);
  bag.add(() => {
    api.removeListener(handler);
  });
  return true;
}
