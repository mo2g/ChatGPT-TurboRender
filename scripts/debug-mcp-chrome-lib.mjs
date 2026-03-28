import path from 'node:path';

export function getAppBundlePath(binaryPath) {
  if (!binaryPath) {
    return null;
  }

  if (binaryPath.endsWith('.app')) {
    return binaryPath;
  }

  const marker = '.app/';
  const markerIndex = binaryPath.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return binaryPath.slice(0, markerIndex + '.app'.length);
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

export function buildChromeArgs({ debugPort, userDataDir, extensionPath, targetUrl }) {
  return [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    targetUrl,
  ];
}

export function buildLaunchCommand({ platform, binaryPath, chromeArgs }) {
  const appBundlePath = platform === 'darwin' ? getAppBundlePath(binaryPath) : null;
  if (platform === 'darwin' && appBundlePath != null) {
    return {
      command: 'open',
      args: ['-na', appBundlePath, '--args', ...chromeArgs],
    };
  }

  return {
    command: binaryPath,
    args: chromeArgs,
  };
}

export function formatUnsupportedChromeMessage(binaryPath) {
  const label = path.basename(binaryPath);
  return `[TurboRender] ${label} no longer supports loading unpacked extensions via --load-extension. Use Chromium or the repo-managed Playwright Chromium instead.`;
}
