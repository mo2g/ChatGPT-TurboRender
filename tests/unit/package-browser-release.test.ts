import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error - The helper lives in an executable .mjs script.
import {
  downloadExistingFirefoxSignedArtifact,
  isFirefoxVersionAlreadyExistsError,
} from '../../scripts/package-browser-release.mjs';

describe('browser release packaging', () => {
  it('recognizes Firefox version conflict errors from web-ext', () => {
    expect(
      isFirefoxVersionAlreadyExistsError(
        'WebExtError: Submission failed (2): Conflict\n{"version":["Version 0.1.4 already exists."]}',
      ),
    ).toBe(true);
    expect(isFirefoxVersionAlreadyExistsError('WebExtError: some other failure')).toBe(false);
  });

  it('downloads an existing signed Firefox artifact from AMO', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'turborender-firefox-'));
    const sourceDir = path.join(tempDir, 'firefox-mv2');
    const artifactsDir = path.join(tempDir, 'artifacts');
    const manifestPath = path.join(sourceDir, 'manifest.json');
    const versionDetailUrl =
      'https://addons.mozilla.org/api/v5/addons/addon/chatgpt-turborender%40mo2g.dev/versions/v0.1.4/';
    const signedFileUrl =
      'https://addons.mozilla.org/files/downloads/chatgpt-turborender-0.1.4-firefox.xpi';
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];

    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        browser_specific_settings: {
          gecko: {
            id: 'chatgpt-turborender@mo2g.dev',
          },
        },
      }),
    );

    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(url), headers: init?.headers });

      if (String(url) === versionDetailUrl) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () =>
            JSON.stringify({
              file: {
                status: 'public',
                url: signedFileUrl,
              },
            }),
        } as any;
      }

      if (String(url) === signedFileUrl) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => new TextEncoder().encode('dummy xpi').buffer,
        } as any;
      }

      throw new Error(`Unexpected fetch URL: ${String(url)}`);
    };

    try {
      const signedXpiPath = await downloadExistingFirefoxSignedArtifact({
        sourceDir,
        version: '0.1.4',
        artifactsDir,
        apiKey: 'issuer',
        apiSecret: 'secret',
        fetchImpl,
      });

      expect(signedXpiPath).toBe(path.join(artifactsDir, 'firefox-signed.xpi'));
      expect(readFileSync(signedXpiPath, 'utf8')).toBe('dummy xpi');
      expect(calls).toEqual([
        {
          url: versionDetailUrl,
          headers: {
            Authorization: expect.stringMatching(/^JWT /),
            Accept: 'application/json',
          },
        },
        {
          url: signedFileUrl,
          headers: {
            Authorization: expect.stringMatching(/^JWT /),
          },
        },
      ]);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
