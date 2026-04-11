import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { spawnLaunchableChromium, waitForRemoteDebugEndpoint } from '../../scripts/debug-mcp-chrome-lib.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const extensionPath = path.join(repoRoot, '.output', 'chrome-mv3');
const chromeProfileRoot = path.join(repoRoot, '.wxt', 'mcp-chrome-profile');

export interface ControlledBrowserHandle {
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
  debugPort: number;
  userDataDir: string | null;
  cleanup(): Promise<void>;
}

function parseDebugPort(value: string | undefined): number | null {
  if (value == null || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function resolveChromeProfileDir(debugPort: number): Promise<string | null> {
  let entries: Array<Awaited<ReturnType<typeof fs.readdir>>[number]> = [];
  try {
    entries = await fs.readdir(chromeProfileRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.includes(`-${debugPort}`))
    .map((entry) => path.join(chromeProfileRoot, entry.name));

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

export async function resolveExtensionIdFromProfile(userDataDir: string, timeoutMs = 15_000): Promise<string> {
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
      // Keep waiting until Chrome finishes creating the profile entries.
    }

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 200);
    });
  }

  throw new Error(`Timed out waiting for the extension ID under ${extensionSettingsDir}.`);
}

export async function launchControlledBrowser(targetUrl = 'about:blank'): Promise<ControlledBrowserHandle> {
  const explicitDebugPort = parseDebugPort(process.env.CHROME_DEBUG_PORT);
  if (explicitDebugPort != null) {
    await waitForRemoteDebugEndpoint(explicitDebugPort);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${explicitDebugPort}`);
    const userDataDir = await resolveChromeProfileDir(explicitDebugPort);
    return {
      browser,
      debugPort: explicitDebugPort,
      userDataDir,
      async cleanup() {
        // Intentionally keep the connected browser alive so an already logged-in
        // Chrome for Testing profile survives test teardown.
      },
    };
  }

  // Prefer attaching to an already-running local debug Chrome (default 9222)
  // so local signed-in state is preserved during e2e runs.
  const defaultDebugPort = 9222;
  try {
    await waitForRemoteDebugEndpoint(defaultDebugPort, 1_000);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${defaultDebugPort}`);
    const userDataDir = await resolveChromeProfileDir(defaultDebugPort);
    return {
      browser,
      debugPort: defaultDebugPort,
      userDataDir,
      async cleanup() {
        // Keep existing local debug Chrome alive.
      },
    };
  } catch {
    // Fall through to managed launch path.
  }

  const launch = await spawnLaunchableChromium({
    repoRoot,
    targetUrl,
    extensionPath,
  });

  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.debugPort}`);

    return {
      browser,
      debugPort: launch.debugPort,
      userDataDir: launch.userDataDir,
      async cleanup() {
        try {
          await browser.close();
        } finally {
          if (launch.child.exitCode == null && launch.child.signalCode == null) {
            launch.child.kill('SIGTERM');
          }
          await fs.rm(launch.userDataDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (launch.child.exitCode == null && launch.child.signalCode == null) {
      launch.child.kill('SIGTERM');
    }
    await fs.rm(launch.userDataDir, { recursive: true, force: true });
    throw error;
  }
}
