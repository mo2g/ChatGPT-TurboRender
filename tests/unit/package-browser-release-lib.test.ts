import { describe, expect, it } from 'vitest';

import {
  assertSupportedBrowser,
  buildArtifactFileName,
  buildArtifactPath,
  buildFirefoxSignArgs,
  buildStoreZipFileName,
  buildStoreZipPath,
  getSourceDir,
  isSupportedBrowser,
} from '../../scripts/package-browser-release-lib.mjs';

describe('browser release packaging helpers', () => {
  it('recognizes the supported browsers', () => {
    expect(isSupportedBrowser('chrome')).toBe(true);
    expect(isSupportedBrowser('edge')).toBe(true);
    expect(isSupportedBrowser('firefox')).toBe(true);
    expect(isSupportedBrowser('safari')).toBe(false);
  });

  it('builds browser-specific release file names and paths', () => {
    expect(buildArtifactFileName('1.2.3', 'chrome')).toBe('chatgpt-turborender-1.2.3-chrome.zip');
    expect(buildArtifactFileName('1.2.3', 'edge')).toBe('chatgpt-turborender-1.2.3-edge.zip');
    expect(buildArtifactFileName('1.2.3', 'firefox')).toBe('chatgpt-turborender-1.2.3-firefox.xpi');
    expect(buildArtifactPath('/tmp/release', '1.2.3', 'chrome')).toBe(
      '/tmp/release/chatgpt-turborender-1.2.3-chrome.zip',
    );
    expect(buildArtifactPath('/tmp/release', '1.2.3', 'firefox')).toBe(
      '/tmp/release/chatgpt-turborender-1.2.3-firefox.xpi',
    );
    expect(buildStoreZipFileName('1.2.3', 'chrome')).toBe('chatgpt-turborender-1.2.3-chrome.zip');
    expect(buildStoreZipPath('/tmp/output', '1.2.3', 'edge')).toBe(
      '/tmp/output/chatgpt-turborender-1.2.3-edge.zip',
    );
  });

  it('maps browsers to the expected WXT output directories', () => {
    expect(getSourceDir('/repo', 'chrome')).toBe('/repo/.output/chrome-mv3');
    expect(getSourceDir('/repo', 'edge')).toBe('/repo/.output/edge-mv3');
    expect(getSourceDir('/repo', 'firefox')).toBe('/repo/.output/firefox-mv2');
  });

  it('builds the Firefox packaging command arguments', () => {
    expect(
      buildFirefoxSignArgs({
        sourceDir: '/repo/.output/firefox-mv2',
        artifactsDir: '/tmp/release/.firefox-artifacts',
        apiKey: 'user:12345:67',
        apiSecret: 'secret',
      }),
    ).toEqual([
      'exec',
      'web-ext',
      'sign',
      '--channel=unlisted',
      '--source-dir=/repo/.output/firefox-mv2',
      '--artifacts-dir=/tmp/release/.firefox-artifacts',
      '--api-key=user:12345:67',
      '--api-secret=secret',
    ]);
  });

  it('rejects unsupported browsers', () => {
    expect(() => assertSupportedBrowser('safari')).toThrow(/Unsupported browser/);
  });
});
