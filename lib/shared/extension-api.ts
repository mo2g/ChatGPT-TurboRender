type MaybeExtensionNamespace = {
  runtime?: {
    id?: string | null;
    onMessage?: unknown;
  };
  storage?: {
    local?: unknown;
    onChanged?: unknown;
  };
};

export interface ExtensionStorageArea {
  get(keys: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ExtensionEvent<Handler> {
  addListener(handler: Handler): void;
  removeListener(handler: Handler): void;
}

function safeAccess<T>(read: () => T | null | undefined): T | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

function resolveExtensionNamespace(): MaybeExtensionNamespace | null {
  return safeAccess(() => {
    const maybeBrowser = (globalThis as { browser?: MaybeExtensionNamespace }).browser;
    if (maybeBrowser?.runtime?.id != null) {
      return maybeBrowser;
    }

    const maybeChrome = (globalThis as { chrome?: MaybeExtensionNamespace }).chrome;
    if (maybeChrome?.runtime?.id != null) {
      return maybeChrome;
    }

    return null;
  });
}

function getStorageNamespace():
  | {
      local: unknown;
      onChanged: unknown;
    }
  | null {
  const extension = resolveExtensionNamespace();
  if (extension == null) {
    return null;
  }

  const storage = safeAccess(() => extension.storage);
  if (storage == null) {
    return null;
  }

  return storage;
}

export function getStorageLocalArea(): ExtensionStorageArea | null {
  const storage = getStorageNamespace();
  if (storage == null) {
    return null;
  }

  return safeAccess(() => storage.local as ExtensionStorageArea | undefined);
}

export function getStorageChangedEvent<Handler>(): ExtensionEvent<Handler> | null {
  const storage = getStorageNamespace();
  if (storage == null) {
    return null;
  }

  return safeAccess(() => storage.onChanged as ExtensionEvent<Handler> | undefined);
}

export function getRuntimeMessageEvent<Handler>(): ExtensionEvent<Handler> | null {
  const extension = resolveExtensionNamespace();
  if (extension == null) {
    return null;
  }

  const runtime = safeAccess(() => extension.runtime);
  if (runtime == null) {
    return null;
  }

  return safeAccess(() => runtime.onMessage as ExtensionEvent<Handler> | undefined);
}

export async function safeStorageGet(
  keys: string | string[] | Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const storage = getStorageLocalArea();
  if (storage == null) {
    return {};
  }

  try {
    return await storage.get(keys);
  } catch {
    return {};
  }
}

export async function safeStorageSet(items: Record<string, unknown>): Promise<boolean> {
  const storage = getStorageLocalArea();
  if (storage == null) {
    return false;
  }

  try {
    await storage.set(items);
    return true;
  } catch {
    return false;
  }
}
