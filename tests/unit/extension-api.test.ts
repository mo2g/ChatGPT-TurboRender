import { afterEach, describe, expect, it } from 'vitest';

import {
  getRuntimeMessageEvent,
  getStorageChangedEvent,
  getStorageLocalArea,
  safeStorageGet,
  safeStorageSet,
} from '../../lib/shared/extension-api';

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const originalBrowser = (globalThis as { browser?: unknown }).browser;

function restoreGlobals(): void {
  if (originalChrome === undefined) {
    delete (globalThis as { chrome?: unknown }).chrome;
  } else {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
  }

  if (originalBrowser === undefined) {
    delete (globalThis as { browser?: unknown }).browser;
  } else {
    (globalThis as { browser?: unknown }).browser = originalBrowser;
  }
}

describe('extension api safety wrappers', () => {
  afterEach(() => {
    restoreGlobals();
  });

  it('fails closed when extension namespace is unavailable', async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    delete (globalThis as { browser?: unknown }).browser;

    expect(getStorageLocalArea()).toBeNull();
    expect(getStorageChangedEvent()).toBeNull();
    expect(getRuntimeMessageEvent()).toBeNull();
    await expect(safeStorageGet('k')).resolves.toEqual({});
    await expect(safeStorageSet({ k: 1 })).resolves.toBe(false);
  });

  it('returns listeners and storage when chrome extension APIs exist', async () => {
    const onChanged = { addListener() {}, removeListener() {} };
    const onMessage = { addListener() {}, removeListener() {} };
    const local = {
      get: async () => ({ k: 1 }),
      set: async () => undefined,
    };

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: 'ext-id', onMessage },
      storage: { local, onChanged },
    };
    delete (globalThis as { browser?: unknown }).browser;

    expect(getStorageLocalArea()).toBe(local);
    expect(getStorageChangedEvent()).toBe(onChanged);
    expect(getRuntimeMessageEvent()).toBe(onMessage);
    await expect(safeStorageGet('k')).resolves.toEqual({ k: 1 });
    await expect(safeStorageSet({ k: 2 })).resolves.toBe(true);
  });

  it('does not throw when storage accessors explode during context invalidation', async () => {
    const chromeLike: Record<string, unknown> = {
      runtime: { id: 'ext-id', onMessage: { addListener() {}, removeListener() {} } },
    };

    Object.defineProperty(chromeLike, 'storage', {
      configurable: true,
      get() {
        throw new TypeError('context invalidated');
      },
    });

    (globalThis as { chrome?: unknown }).chrome = chromeLike;
    delete (globalThis as { browser?: unknown }).browser;

    expect(() => getStorageChangedEvent()).not.toThrow();
    expect(getStorageChangedEvent()).toBeNull();
    await expect(safeStorageGet('k')).resolves.toEqual({});
    await expect(safeStorageSet({ k: 1 })).resolves.toBe(false);
  });

  it('can read/write local storage even if onChanged accessor is broken', async () => {
    const local = {
      get: async () => ({ k: 'ok' }),
      set: async () => undefined,
    };
    const storage = {
      local,
      get onChanged() {
        throw new TypeError('onChanged unavailable');
      },
    };

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: 'ext-id', onMessage: { addListener() {}, removeListener() {} } },
      storage,
    };
    delete (globalThis as { browser?: unknown }).browser;

    await expect(safeStorageGet('k')).resolves.toEqual({ k: 'ok' });
    await expect(safeStorageSet({ k: 1 })).resolves.toBe(true);
    expect(getStorageChangedEvent()).toBeNull();
  });
});
