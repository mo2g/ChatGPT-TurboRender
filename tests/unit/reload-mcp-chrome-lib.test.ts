import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildExtensionPageUrl,
  collectReloadableChatgptPageUrls,
  isReloadableChatgptPageUrl,
  resolveChromeProfileDir,
  resolveExtensionIdFromProfile,
} from '../../scripts/reload-mcp-chrome-lib.mjs';

describe('reload Chrome helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters reloadable ChatGPT URLs and builds extension page urls', () => {
    expect(isReloadableChatgptPageUrl('https://chatgpt.com/c/test')).toBe(true);
    expect(isReloadableChatgptPageUrl('https://chat.openai.com/share/test')).toBe(true);
    expect(isReloadableChatgptPageUrl('https://example.com/')).toBe(false);
    expect(isReloadableChatgptPageUrl('not-a-url')).toBe(false);
    expect(
      collectReloadableChatgptPageUrls([
        { url: () => 'https://chatgpt.com/c/test' },
        { url: () => 'https://example.com/' },
        { url: () => 'https://chat.openai.com/share/test' },
      ]),
    ).toEqual(['https://chatgpt.com/c/test', 'https://chat.openai.com/share/test']);
    expect(buildExtensionPageUrl('bdmmikjcpkiibgfjfalpicgchcmahnkc', '/options.html')).toBe(
      'chrome-extension://bdmmikjcpkiibgfjfalpicgchcmahnkc/options.html',
    );
  });

  it('resolves the newest Chrome profile and extension id from a profile tree', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'turbo-render-reload-'));
    const repoRoot = tempRoot;
    const profileRoot = path.join(repoRoot, '.wxt', 'mcp-chrome-profile');
    const olderProfile = path.join(profileRoot, 'chromium-9222');
    const newerProfile = path.join(profileRoot, 'chrome-for-testing-9222');
    const extensionSettingsDir = path.join(newerProfile, 'Default', 'Local Extension Settings');
    try {
      await fs.mkdir(path.join(olderProfile, 'Default', 'Local Extension Settings'), { recursive: true });
      await fs.mkdir(extensionSettingsDir, { recursive: true });
      await fs.mkdir(path.join(extensionSettingsDir, 'bdmmikjcpkiibgfjfalpicgchcmahnkc'));
      await fs.mkdir(path.join(extensionSettingsDir, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'));
      const olderTime = new Date('2020-01-01T00:00:00.000Z');
      const newerTime = new Date('2025-01-01T00:00:00.000Z');
      await fs.utimes(olderProfile, olderTime, olderTime);
      await fs.utimes(newerProfile, newerTime, newerTime);

      await expect(resolveChromeProfileDir(repoRoot, '9222')).resolves.toBe(newerProfile);
      await expect(resolveExtensionIdFromProfile(newerProfile)).resolves.toBe('bdmmikjcpkiibgfjfalpicgchcmahnkc');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
