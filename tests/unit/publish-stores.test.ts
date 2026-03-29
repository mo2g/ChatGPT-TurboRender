import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// @ts-expect-error - The helper lives in an executable .mjs script.
import {
  extractOperationId,
  isBenignEdgePublishFailure,
  resolveChromeResourceIds,
  isFirefoxVersionAlreadyExistsError,
  preflightChrome,
  normalizeTarget,
  parseArgs,
} from '../../scripts/publish-stores.mjs';

describe('publish store helpers', () => {
  it('parses the store publish CLI arguments', () => {
    expect(
      parseArgs([
        'node',
        'scripts/publish-stores.mjs',
        '--',
        '--target',
        'firefox',
        '--version',
        '1.2.3',
        '--firefox-source-dir',
        '.output/firefox-mv2',
        '--firefox-amo-metadata',
        'store/firefox-amo-metadata.json',
      ]),
    ).toEqual({
      checkChrome: false,
      target: 'firefox',
      version: '1.2.3',
      chromeZip: '',
      edgeZip: '',
      firefoxSourceDir: '.output/firefox-mv2',
      firefoxAmoMetadata: 'store/firefox-amo-metadata.json',
      firefoxArtifactsDir: '',
    });
  });

  it('parses the Chrome preflight flag', () => {
    expect(parseArgs(['node', 'scripts/publish-stores.mjs', '--check-chrome'])).toEqual({
      checkChrome: true,
      target: 'all',
      version: '',
      chromeZip: '',
      edgeZip: '',
      firefoxSourceDir: '',
      firefoxAmoMetadata: '',
      firefoxArtifactsDir: '',
    });
  });

  it('normalizes operation ids from store response headers', () => {
    expect(extractOperationId('1234-5678')).toBe('1234-5678');
    expect(extractOperationId('/v1/products/demo/submissions/operations/1234-5678')).toBe('1234-5678');
    expect(
      extractOperationId(
        'https://api.addons.microsoftedge.microsoft.com/v1/products/demo/submissions/operations/1234-5678?foo=bar',
      ),
    ).toBe('1234-5678');
  });

  it('accepts the supported targets', () => {
    expect(normalizeTarget('chrome')).toBe('chrome');
    expect(normalizeTarget('edge')).toBe('edge');
    expect(normalizeTarget('firefox')).toBe('firefox');
    expect(normalizeTarget('all')).toBe('all');
    expect(normalizeTarget('both')).toBe('all');
  });

  it('rejects invalid targets', () => {
    expect(() => normalizeTarget('safari')).toThrow('Invalid target: safari');
  });

  it('recognizes benign edge publish failures that should be treated as no-ops', () => {
    expect(isBenignEdgePublishFailure('InProgressSubmission')).toBe(true);
    expect(isBenignEdgePublishFailure('NoModulesUpdated')).toBe(true);
    expect(isBenignEdgePublishFailure('SubmissionValidationError')).toBe(false);
  });

  it('recognizes firefox version conflicts that should be treated as no-ops', () => {
    expect(
      isFirefoxVersionAlreadyExistsError(
        'WebExtError: Submission failed (2): Conflict\n{"version":["Version 0.1.3.1 already exists."]}',
      ),
    ).toBe(true);
    expect(isFirefoxVersionAlreadyExistsError('WebExtError: some other failure')).toBe(false);
  });

  it('resolves chrome resource ids with the new extension-id env name and the legacy alias', () => {
    expect(
      resolveChromeResourceIds({
        CHROME_WEB_STORE_PUBLISHER_ID: 'publisher',
        CHROME_WEB_STORE_EXTENSION_ID: 'extension',
      }),
    ).toEqual({
      publisherId: 'publisher',
      extensionId: 'extension',
    });

    expect(
      resolveChromeResourceIds({
        CHROME_WEB_STORE_PUBLISHER_ID: 'publisher',
        CHROME_WEB_STORE_ITEM_ID: 'legacy-extension',
      }),
    ).toEqual({
      publisherId: 'publisher',
      extensionId: 'legacy-extension',
    });
  });

  it('preflights chrome credentials with a read-only fetchStatus call', async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(url), headers: init?.headers });

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ itemState: 'PUBLISHED' }),
      } as any;
    };

    const payload = await preflightChrome({
      env: {
        CHROME_WEB_STORE_PUBLISHER_ID: 'publisher',
        CHROME_WEB_STORE_EXTENSION_ID: 'extension',
      },
      getAccessToken: async () => 'access-token',
      fetchImpl,
    });

    expect(payload).toEqual({ itemState: 'PUBLISHED' });
    expect(calls).toEqual([
      {
        url: 'https://chromewebstore.googleapis.com/v2/publishers/publisher/items/extension:fetchStatus',
        headers: {
          Authorization: 'Bearer access-token',
        },
      },
    ]);
  });

  it('reports chrome permission issues during preflight', async () => {
    const fetchImpl = async () =>
      ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => '{"error":"denied"}',
      }) as any;

    await expect(
      preflightChrome({
        env: {
          CHROME_WEB_STORE_PUBLISHER_ID: 'publisher',
          CHROME_WEB_STORE_EXTENSION_ID: 'extension',
        },
        getAccessToken: async () => 'access-token',
        fetchImpl,
      }),
    ).rejects.toThrow(/Chrome Web Store denied access to publishers\/publisher\/items\/extension/);
  });
});

describe('publish store firefox CLI', () => {
  it('accepts a firefox publish even when approval-timeout skips the local xpi download', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'turborender-pnpm-'));
    const binDir = path.join(tempDir, 'bin');
    const sourceDir = path.join(tempDir, 'firefox-mv2');
    const metadataFile = path.join(tempDir, 'firefox-amo-metadata.json');
    const artifactsDir = path.join(tempDir, 'artifacts');
    const fakePnpm = path.join(binDir, 'pnpm');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(metadataFile, '{"id":"dummy@example.com"}');
    writeFileSync(
      fakePnpm,
      `#!/usr/bin/env node
process.exit(0);
`,
    );
    chmodSync(fakePnpm, 0o755);

    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), 'scripts', 'publish-stores.mjs'),
          '--target',
          'firefox',
          '--version',
          '1.2.3',
          '--firefox-source-dir',
          sourceDir,
          '--firefox-amo-metadata',
          metadataFile,
          '--firefox-artifacts-dir',
          artifactsDir,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AMO_JWT_ISSUER: 'issuer',
            AMO_JWT_SECRET: 'secret',
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
          },
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Firefox publish accepted for version 1.2.3');
      expect(result.stdout).toContain('approval wait was skipped so no signed XPI was downloaded locally');
      expect(result.stderr).not.toContain('ReferenceError: fs is not defined');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
