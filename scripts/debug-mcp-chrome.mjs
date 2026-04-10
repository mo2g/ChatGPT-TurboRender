#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildChromeArgs,
  buildLaunchCommand,
  classifyBrowserBinary,
  resolveLaunchableChromiumBinary,
} from './debug-mcp-chrome-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const extensionPath = path.join(repoRoot, '.output', 'chrome-mv3');
const manifestPath = path.join(extensionPath, 'manifest.json');
const debugPort = process.env.CHROME_DEBUG_PORT ?? '9222';
const defaultUrl = 'https://chatgpt.com/';

function printHelp() {
  console.log(`ChatGPT TurboRender controlled Chrome launcher

Usage:
  pnpm debug:mcp-chrome -- [url]

Examples:
  pnpm debug:mcp-chrome
  pnpm debug:mcp-chrome -- https://chatgpt.com/c/abc
  pnpm debug:mcp-chrome -- https://chatgpt.com/share/xyz

Environment:
  CHROME_BIN         Explicit Chromium-compatible binary path.
  CHROME_DEBUG_PORT  Remote debugging port. Default: 9222
  CHROME_DEBUG_FORCE_RESTART=1  Ignore an already-running browser on the debug port and start a fresh instance.
`);
}

function resolveTargetUrl() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const separator = args.indexOf('--');
  const urlArg = separator >= 0 ? args[separator + 1] : args[0];
  return urlArg && urlArg.length > 0 ? urlArg : defaultUrl;
}

async function waitForRemoteDebugEndpoint(port, timeoutMs = 1200) {
  const startedAt = Date.now();
  const statusUrl = `http://127.0.0.1:${port}/json/version`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(statusUrl);
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep waiting until the browser is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

async function openUrlInExistingBrowser(port, url) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`);
  } catch {
    // Reuse still succeeds even if opening a new target is unavailable.
  }
}

function ensureBuildExists() {
  if (fs.existsSync(manifestPath)) {
    return;
  }

  console.log('[TurboRender] build output missing, running pnpm build...');
  const result = spawnSync('pnpm', ['build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function resolveChromeBinary() {
  try {
    return await resolveLaunchableChromiumBinary({ repoRoot });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const targetUrl = resolveTargetUrl();
ensureBuildExists();

const forceRestart = process.env.CHROME_DEBUG_FORCE_RESTART === '1';
const portAlive = !forceRestart && (await waitForRemoteDebugEndpoint(debugPort));
if (portAlive) {
  await openUrlInExistingBrowser(debugPort, targetUrl);
  console.log(`[TurboRender] reusing existing Chrome on http://127.0.0.1:${debugPort}`);
  console.log(`[TurboRender] extension path: ${extensionPath}`);
  console.log('[TurboRender] keep the existing browser/profile open to preserve sign-in state.');
  process.exit(0);
}

const chromeBinary = await resolveChromeBinary();
const browserKind = classifyBrowserBinary(chromeBinary);
const userDataDir = path.join(repoRoot, '.wxt', 'mcp-chrome-profile', `${browserKind}-${debugPort}`);
const browserHomeDir = path.join(userDataDir, 'home');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(path.join(userDataDir, 'Crashpad'), { recursive: true });
fs.mkdirSync(browserHomeDir, { recursive: true });

const chromeArgs = buildChromeArgs({
  debugPort,
  userDataDir,
  extensionPath,
  targetUrl,
});
const launch = buildLaunchCommand({
  platform: process.platform,
  binaryPath: chromeBinary,
  chromeArgs,
});

const child = spawn(launch.command, launch.args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    HOME: browserHomeDir,
    XDG_CONFIG_HOME: path.join(browserHomeDir, '.config'),
    XDG_CACHE_HOME: path.join(browserHomeDir, '.cache'),
  },
  detached: true,
  stdio: 'ignore',
});

child.unref();

console.log(`[TurboRender] launched controlled Chrome on http://127.0.0.1:${debugPort}`);
console.log(`[TurboRender] browser: ${browserKind} (${chromeBinary})`);
console.log(`[TurboRender] extension path: ${extensionPath}`);
console.log(`[TurboRender] profile path: ${userDataDir}`);
console.log('[TurboRender] restart Codex after launching so chrome-devtools MCP reconnects to this browser.');
