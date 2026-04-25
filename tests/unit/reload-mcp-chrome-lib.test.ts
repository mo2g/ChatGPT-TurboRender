// @ts-nocheck
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildExtensionPageUrl,
  collectReloadableChatgptPageUrls,
  cloneChromeProfileDir,
  isReloadableChatgptPageUrl,
  resolveChromeProfileDir,
  resolveExtensionIdFromProfile,
  writeActiveChromeProfileHint,
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

  it('prefers hinted and lock-backed profile directories for the active debug port', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'turbo-render-reload-active-'));
    const repoRoot = tempRoot;
    const profileRoot = path.join(repoRoot, '.wxt', 'mcp-chrome-profile');
    const olderProfile = path.join(profileRoot, 'chromium-9222');
    const newerProfile = path.join(profileRoot, 'chrome-for-testing-9222');
    try {
      await fs.mkdir(olderProfile, { recursive: true });
      await fs.mkdir(newerProfile, { recursive: true });
      await fs.writeFile(path.join(olderProfile, 'SingletonLock'), 'lock');
      await fs.writeFile(path.join(newerProfile, 'marker.txt'), 'stale-profile');
      const olderTime = new Date('2020-01-01T00:00:00.000Z');
      const newerTime = new Date('2026-01-01T00:00:00.000Z');
      await fs.utimes(olderProfile, olderTime, olderTime);
      await fs.utimes(newerProfile, newerTime, newerTime);

      await expect(resolveChromeProfileDir(repoRoot, '9222')).resolves.toBe(olderProfile);

      await writeActiveChromeProfileHint(repoRoot, '9222', newerProfile);
      await expect(resolveChromeProfileDir(repoRoot, '9222')).resolves.toBe(newerProfile);

      await fs.rm(newerProfile, { recursive: true, force: true });
      await expect(resolveChromeProfileDir(repoRoot, '9222')).resolves.toBe(olderProfile);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('clones a Chrome profile without singleton lock artifacts', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'turbo-render-reload-clone-'));
    const sourceProfileDir = path.join(tempRoot, 'source-profile');
    const targetProfileDir = path.join(tempRoot, 'target-profile');
    try {
      await fs.mkdir(path.join(sourceProfileDir, 'Default', 'Local Storage'), { recursive: true });
      await fs.writeFile(path.join(sourceProfileDir, 'Local State'), 'profile-state');
      await fs.writeFile(path.join(sourceProfileDir, 'Default', 'Preferences'), 'preferences');
      await fs.writeFile(path.join(sourceProfileDir, 'SingletonLock'), 'lock');
      await fs.writeFile(path.join(sourceProfileDir, 'SingletonCookie'), 'cookie');
      await fs.writeFile(path.join(sourceProfileDir, 'SingletonSocket'), 'socket');
      await fs.writeFile(path.join(sourceProfileDir, 'DevToolsActivePort'), '9222\n/devtools/browser/test');

      await cloneChromeProfileDir(sourceProfileDir, targetProfileDir);

      await expect(fs.readFile(path.join(targetProfileDir, 'Local State'), 'utf8')).resolves.toBe(
        'profile-state',
      );
      await expect(fs.readFile(path.join(targetProfileDir, 'Default', 'Preferences'), 'utf8')).resolves.toBe(
        'preferences',
      );
      await expect(fs.stat(path.join(targetProfileDir, 'SingletonLock'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.stat(path.join(targetProfileDir, 'SingletonCookie'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.stat(path.join(targetProfileDir, 'SingletonSocket'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.stat(path.join(targetProfileDir, 'DevToolsActivePort'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
