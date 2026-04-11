import { describe, expect, it } from 'vitest';

import {
  buildChromeArgs,
  buildLaunchCommand,
  classifyBrowserBinary,
  formatUnsupportedChromeMessage,
  getAppBundlePath,
  supportsCommandLineExtensionLoad,
} from '../../scripts/debug-mcp-chrome-lib.mjs';

describe('controlled Chrome launcher helpers', () => {
  it('detects app bundles from macOS browser binaries', () => {
    expect(getAppBundlePath('/Applications/Chromium.app/Contents/MacOS/Chromium')).toBe(
      '/Applications/Chromium.app',
    );
    expect(getAppBundlePath('/Applications/Microsoft Edge.app')).toBe('/Applications/Microsoft Edge.app');
    expect(getAppBundlePath('/usr/bin/chromium')).toBeNull();
  });

  it('classifies supported and unsupported browsers for command-line extension loading', () => {
    expect(
      classifyBrowserBinary(
        '/Users/mo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ),
    ).toBe('chrome-for-testing');
    expect(classifyBrowserBinary('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe(
      'google-chrome',
    );
    expect(classifyBrowserBinary('/Applications/Chromium.app/Contents/MacOS/Chromium')).toBe('chromium');
    expect(classifyBrowserBinary('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')).toBe(
      'microsoft-edge',
    );
    expect(supportsCommandLineExtensionLoad('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')).toBe(
      false,
    );
    expect(
      supportsCommandLineExtensionLoad(
        '/Users/mo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ),
    ).toBe(true);
    expect(supportsCommandLineExtensionLoad('/Applications/Chromium.app/Contents/MacOS/Chromium')).toBe(true);
  });

  it('builds the extension debugging flags for controlled browsers', () => {
    expect(
      buildChromeArgs({
        debugPort: '9222',
        userDataDir: '/tmp/profile',
        extensionPath: '/tmp/ext',
        targetUrl: 'https://chatgpt.com/share/demo',
      }),
    ).toEqual([
      '--disable-crashpad-for-testing',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--remote-debugging-port=9222',
      '--user-data-dir=/tmp/profile',
      '--disable-extensions-except=/tmp/ext',
      '--load-extension=/tmp/ext',
      '--no-first-run',
      '--no-default-browser-check',
      'https://chatgpt.com/share/demo',
    ]);
  });

  it('uses open -na for macOS app bundles so launch flags reach a fresh instance', () => {
    const launch = buildLaunchCommand({
      platform: 'darwin',
      binaryPath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
      chromeArgs: ['--remote-debugging-port=9222', 'https://chatgpt.com/'],
    });

    expect(launch).toEqual({
      command: 'open',
      args: [
        '-na',
        '/Applications/Chromium.app',
        '--args',
        '--remote-debugging-port=9222',
        'https://chatgpt.com/',
      ],
    });
  });

  it('uses open -na for repo-managed Playwright browsers as well', () => {
    const launch = buildLaunchCommand({
      platform: 'darwin',
      binaryPath:
        '/Users/mo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      chromeArgs: ['--remote-debugging-port=9222', 'https://chatgpt.com/'],
    });

    expect(launch).toEqual({
      command: 'open',
      args: [
        '-na',
        '/Users/mo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app',
        '--args',
        '--remote-debugging-port=9222',
        'https://chatgpt.com/',
      ],
    });
  });

  it('explains why Google Chrome is rejected', () => {
    expect(
      formatUnsupportedChromeMessage('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ).toContain('no longer supports loading unpacked extensions');
  });
});
