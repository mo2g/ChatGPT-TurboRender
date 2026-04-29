import fs from 'node:fs';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

export function getAppBundlePath(binaryPath) {
  // macOS app bundle detection: /Applications/Foo.app/Contents/MacOS/Foo
  if (binaryPath.includes('.app/')) {
    const parts = binaryPath.split('.app/');
    return parts[0] + '.app';
  }
  // Handle paths ending with .app (e.g., /Applications/Microsoft Edge.app)
  if (binaryPath.endsWith('.app')) {
    return binaryPath;
  }
  return null;
}

export function classifyBrowserBinary(binaryPath) {
  const normalized = binaryPath.toLowerCase();
  if (normalized.includes('chrome for testing')) {
    return 'chrome-for-testing';
  }

  if (normalized.includes('google chrome')) {
    return 'google-chrome';
  }

  if (normalized.includes('chromium')) {
    return 'chromium';
  }

  if (normalized.includes('microsoft edge')) {
    return 'microsoft-edge';
  }

  return 'unknown';
}

export function supportsCommandLineExtensionLoad(binaryPath) {
  return classifyBrowserBinary(binaryPath) !== 'google-chrome';
}

export function buildExtensionLoadArgs(extensionPath) {
  return [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

export function buildChromeArgs({ debugPort, userDataDir, extensionPath, targetUrl }) {
  return [
    '--disable-crashpad-for-testing',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--use-mock-keychain',
    '--password-store=basic',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    ...buildExtensionLoadArgs(extensionPath),
    targetUrl,
  ];
}

export function buildLaunchCommand({ binaryPath, chromeArgs }) {
  // Launch the browser executable directly so environment overrides
  // (HOME/XDG paths) take effect. `open -na` discards these overrides.
  return {
    command: binaryPath,
    args: chromeArgs,
  };
}

export function formatUnsupportedChromeMessage(binaryPath) {
  const label = path.basename(binaryPath);
  return `[TurboRender] ${label} no longer supports loading unpacked extensions via --load-extension. Use Chromium or the repo-managed Playwright Chromium instead.`;
}

async function resolvePlaywrightChromiumExecutablePath() {
  try {
    const { chromium } = await import('@playwright/test');
    const executablePath = chromium.executablePath();
    if (typeof executablePath === 'string' && executablePath.length > 0 && fs.existsSync(executablePath)) {
      return executablePath;
    }
  } catch {
    // Fall through to the install path below.
  }

  return null;
}

function installPlaywrightChromium(repoRoot) {
  const result = spawnSync('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Unable to install Playwright Chromium (exit code ${result.status ?? 'unknown'}).`);
  }
}

export async function resolveLaunchableChromiumBinary({ repoRoot = process.cwd() } = {}) {
  const explicitBinary = process.env.CHROME_BIN;
  if (explicitBinary) {
    if (!fs.existsSync(explicitBinary)) {
      throw new Error(`[TurboRender] CHROME_BIN does not exist: ${explicitBinary}`);
    }

    if (!supportsCommandLineExtensionLoad(explicitBinary)) {
      throw new Error(formatUnsupportedChromeMessage(explicitBinary));
    }

    return explicitBinary;
  }

  const localCandidates = [
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ];
  const supportedLocalMatch = localCandidates.find(
    (candidate) => fs.existsSync(candidate) && supportsCommandLineExtensionLoad(candidate),
  );
  if (supportedLocalMatch) {
    return supportedLocalMatch;
  }

  let playwrightChromium = await resolvePlaywrightChromiumExecutablePath();
  if (!playwrightChromium) {
    installPlaywrightChromium(repoRoot);
    playwrightChromium = await resolvePlaywrightChromiumExecutablePath();
  }
  if (playwrightChromium) {
    return playwrightChromium;
  }

  const edgeBinary = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  if (fs.existsSync(edgeBinary) && supportsCommandLineExtensionLoad(edgeBinary)) {
    return edgeBinary;
  }

  const googleChromeBinary = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(googleChromeBinary)) {
    throw new Error(
      `${formatUnsupportedChromeMessage(googleChromeBinary)} Install Chromium or let this script download the repo-managed Playwright Chromium instead.`,
    );
  }

  throw new Error('[TurboRender] No supported Chromium-based browser was found for unpacked extension debugging.');
}

export async function waitForRemoteDebugEndpoint(port, timeoutMs = 60_000) {
  const startedAt = Date.now();
  const statusUrl = `http://127.0.0.1:${port}/json/version`;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(statusUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting until the browser is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for Chrome remote debugging on port ${port}.`);
}

export async function spawnLaunchableChromium({
  repoRoot = process.cwd(),
  targetUrl = 'about:blank',
  debugPort,
  userDataDir,
  waitForReady = true,
  browserBinary,

} = {}) {
  const resolvedBrowserBinary = browserBinary ?? (await resolveLaunchableChromiumBinary({ repoRoot }));
  const browserKind = classifyBrowserBinary(resolvedBrowserBinary);
  const envDebugPort = Number.parseInt(process.env.CHROME_DEBUG_PORT ?? '9222', 10);
  const port = debugPort ?? (Number.isFinite(envDebugPort) ? envDebugPort : 9222);
  const profileDir =
    userDataDir ?? path.join(repoRoot, '.wxt', 'mcp-chrome-profile', `${browserKind}-${port}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const launchEnv = {
    ...process.env,
    CHROME_DEBUG_PORT: String(port),
    ...(browserBinary ? { CHROME_BIN: resolvedBrowserBinary } : {}),
  };
  const child = spawn('pnpm', ['debug:mcp-chrome', '--', targetUrl], {
    cwd: repoRoot,
    env: launchEnv,
    stdio: 'inherit',
  });

  const exitInfo = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  if (exitInfo.code !== 0) {
    throw new Error(`Unable to launch Chrome for debugging (exit code ${exitInfo.code ?? 'unknown'}).`);
  }

  if (waitForReady) {
    try {
      await waitForRemoteDebugEndpoint(port);
    } catch (error) {
      if (child.exitCode == null && child.signalCode == null) {
        child.kill('SIGTERM');
      }
      await fs.promises.rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    browserBinary: resolvedBrowserBinary,
    browserKind,
    child,
    debugPort: port,
    userDataDir: profileDir,
  };
}
