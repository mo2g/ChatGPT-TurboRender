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

const chromeBinary = await resolveChromeBinary();
const browserKind = classifyBrowserBinary(chromeBinary);
const userDataDir = path.join(repoRoot, '.wxt', 'mcp-chrome-profile', `${browserKind}-${debugPort}`);
fs.mkdirSync(userDataDir, { recursive: true });

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
  detached: true,
  stdio: 'ignore',
});

child.unref();

console.log(`[TurboRender] launched controlled Chrome on http://127.0.0.1:${debugPort}`);
console.log(`[TurboRender] browser: ${browserKind} (${chromeBinary})`);
console.log(`[TurboRender] extension path: ${extensionPath}`);
console.log(`[TurboRender] profile path: ${userDataDir}`);
console.log('[TurboRender] restart Codex after launching so chrome-devtools MCP reconnects to this browser.');
