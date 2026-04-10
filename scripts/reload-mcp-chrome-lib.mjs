import fs from 'node:fs/promises';
import path from 'node:path';

export function isReloadableChatgptPageUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === 'chatgpt.com' ||
        parsed.hostname.endsWith('.chatgpt.com') ||
        parsed.hostname === 'chat.openai.com' ||
        parsed.hostname.endsWith('.chat.openai.com')) &&
      (parsed.protocol === 'https:' || parsed.protocol === 'http:')
    );
  } catch {
    return false;
  }
}

export function collectReloadableChatgptPageUrls(pages) {
  return pages.map((page) => page.url()).filter((url) => isReloadableChatgptPageUrl(url));
}

export function buildExtensionPageUrl(extensionId, pagePath = 'options.html') {
  const normalizedPath = pagePath.replace(/^\/+/, '');
  return `chrome-extension://${extensionId}/${normalizedPath}`;
}

export async function resolveChromeProfileDir(repoRoot, debugPort) {
  const profileRoot = path.join(repoRoot, '.wxt', 'mcp-chrome-profile');
  let entries = [];
  try {
    entries = await fs.readdir(profileRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${debugPort}`))
    .map((entry) => path.join(profileRoot, entry.name));

  if (candidates.length === 0) {
    return null;
  }

  const stats = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      stat: await fs.stat(candidate),
    })),
  );

  stats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  return stats[0]?.candidate ?? null;
}

export async function resolveExtensionIdFromProfile(userDataDir, timeoutMs = 15_000) {
  const extensionSettingsDir = path.join(userDataDir, 'Default', 'Local Extension Settings');
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const entries = await fs.readdir(extensionSettingsDir, { withFileTypes: true });
      const extensionIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      if (extensionIds.length > 0) {
        return extensionIds[0];
      }
    } catch {
      // Keep waiting until Chrome has materialized the extension settings directory.
    }

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 200);
    });
  }

  throw new Error(`Timed out waiting for the extension ID under ${extensionSettingsDir}.`);
}
