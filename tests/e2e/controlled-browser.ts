import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

// @ts-expect-error The shared ESM helper is runtime-tested but does not ship TypeScript declarations.
import { spawnLaunchableChromium, waitForRemoteDebugEndpoint } from '../../scripts/debug-mcp-chrome-lib.mjs';
// @ts-expect-error The shared ESM helper is runtime-tested but does not ship TypeScript declarations.
import { resolveChromeProfileDir } from '../../scripts/reload-mcp-chrome-lib.mjs';

function resolveRepoRoot(): string {
  const metaUrl = import.meta.url;
  if (metaUrl.startsWith('file://')) {
    return path.resolve(fileURLToPath(new URL('../..', metaUrl)));
  }

  return path.resolve(process.cwd());
}

const repoRoot = resolveRepoRoot();
const extensionPath = path.join(repoRoot, '.output', 'chrome-mv3');

export interface ControlledBrowserHandle {
  browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
  debugPort: number;
  userDataDir: string | null;
  cleanup(): Promise<void>;
}

export type ControlledBrowserLaunchMode = 'managed' | 'prefer-existing' | 'require-existing';

export interface ControlledBrowserLaunchOptions {
  debugPort?: number;
  mode?: ControlledBrowserLaunchMode;
}

interface LaunchableChromiumInstance {
  child: {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill(signal?: NodeJS.Signals | number): boolean;
  };
  debugPort: number;
  userDataDir: string;
}

function parseDebugPort(value: string | undefined): number | null {
  if (value == null || value.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function findFreeDebugPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        reject(new Error('Unable to reserve a local debugging port.'));
        return;
      }

      server.close((error) => {
        if (error != null) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function attachToExistingDebugBrowser(debugPort: number): Promise<ControlledBrowserHandle> {
  await waitForRemoteDebugEndpoint(debugPort);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const userDataDir = await resolveChromeProfileDir(repoRoot, debugPort);
  return {
    browser,
    debugPort,
    userDataDir,
    async cleanup() {
      // Keep the externally managed debug browser alive.
    },
  };
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

      const [firstExtensionId] = extensionIds;
      if (firstExtensionId != null) {
        return firstExtensionId;
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

export async function launchControlledBrowser(
  targetUrl = 'about:blank',
  options: ControlledBrowserLaunchOptions = {},
): Promise<ControlledBrowserHandle> {
  const mode = options.mode ?? 'managed';
  const requestedDebugPort = options.debugPort ?? parseDebugPort(process.env.CHROME_DEBUG_PORT) ?? 9222;

  if (mode === 'require-existing') {
    return await attachToExistingDebugBrowser(requestedDebugPort);
  }

  if (mode === 'prefer-existing') {
    try {
      return await attachToExistingDebugBrowser(requestedDebugPort);
    } catch {
      // Fall through to a repo-managed launch.
    }
  }

  const managedDebugPort = options.debugPort ?? (await findFreeDebugPort());
  const launch = (await spawnLaunchableChromium({
    repoRoot,
    targetUrl,
    extensionPath,
    debugPort: managedDebugPort,
  })) as LaunchableChromiumInstance;

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
