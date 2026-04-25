import fs from 'node:fs/promises';
import path from 'node:path';

function isEphemeralChromeProfileEntry(entryPath) {
  const entryName = path.basename(entryPath);
  return entryName.startsWith('Singleton') || entryName === 'DevToolsActivePort';
}

function resolveProfileRoot(repoRoot) {
  return path.join(repoRoot, '.wxt', 'mcp-chrome-profile');
}

function resolveActiveProfileHintPath(repoRoot, debugPort) {
  return path.join(resolveProfileRoot(repoRoot), `active-${debugPort}.json`);
}

async function safeStat(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

async function hasActiveLockArtifacts(profileDir) {
  const probes = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
  for (const probe of probes) {
    const stat = await safeStat(path.join(profileDir, probe));
    if (stat != null) {
      return true;
    }
  }

  return false;
}

async function resolveHintedProfileDir(repoRoot, debugPort) {
  const hintPath = resolveActiveProfileHintPath(repoRoot, debugPort);
  let payload = null;
  try {
    const text = await fs.readFile(hintPath, 'utf8');
    payload = JSON.parse(text);
  } catch {
    return null;
  }

  const hintedProfileDir = typeof payload?.profileDir === 'string' ? payload.profileDir : '';
  if (hintedProfileDir.length === 0 || !path.basename(hintedProfileDir).endsWith(`-${debugPort}`)) {
    return null;
  }

  const stat = await safeStat(hintedProfileDir);
  if (stat == null || !stat.isDirectory()) {
    return null;
  }

  return hintedProfileDir;
}

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
  const normalizedPort = String(debugPort);
  const hintedProfileDir = await resolveHintedProfileDir(repoRoot, normalizedPort);
  if (hintedProfileDir != null) {
    return hintedProfileDir;
  }

  const profileRoot = resolveProfileRoot(repoRoot);
  let entries = [];
  try {
    entries = await fs.readdir(profileRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${normalizedPort}`))
    .map((entry) => path.join(profileRoot, entry.name));

  if (candidates.length === 0) {
    return null;
  }

  const stats = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      stat: await fs.stat(candidate),
      hasActiveLock: await hasActiveLockArtifacts(candidate),
    })),
  );

  stats.sort((left, right) => {
    if (left.hasActiveLock !== right.hasActiveLock) {
      return Number(right.hasActiveLock) - Number(left.hasActiveLock);
    }

    return right.stat.mtimeMs - left.stat.mtimeMs;
  });
  return stats[0]?.candidate ?? null;
}

export async function writeActiveChromeProfileHint(repoRoot, debugPort, profileDir) {
  const normalizedPort = String(debugPort);
  const hintPath = resolveActiveProfileHintPath(repoRoot, normalizedPort);
  await fs.mkdir(path.dirname(hintPath), { recursive: true });
  await fs.writeFile(
    hintPath,
    JSON.stringify(
      {
        debugPort: normalizedPort,
        profileDir,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  return hintPath;
}

export async function cloneChromeProfileDir(sourceProfileDir, targetProfileDir) {
  await fs.rm(targetProfileDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetProfileDir), { recursive: true });
  await fs.cp(sourceProfileDir, targetProfileDir, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: (src) => !isEphemeralChromeProfileEntry(src),
  });

  return targetProfileDir;
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
