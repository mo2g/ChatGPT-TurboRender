import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

// @ts-expect-error - The helper lives in an executable .mjs script.
import { extractOperationId, normalizeTarget, parseArgs } from '../../scripts/publish-stores.mjs';

describe('publish store helpers', () => {
  it('parses the store publish CLI arguments', () => {
    expect(
      parseArgs([
        'node',
        'scripts/publish-stores.mjs',
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
      target: 'firefox',
      version: '1.2.3',
      chromeZip: '',
      edgeZip: '',
      firefoxSourceDir: '.output/firefox-mv2',
      firefoxAmoMetadata: 'store/firefox-amo-metadata.json',
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
});

describe('publish store firefox CLI', () => {
  it('creates a signed firefox artifact without requiring a real pnpm binary', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'turborender-pnpm-'));
    const binDir = path.join(tempDir, 'bin');
    const artifactsDir = path.join(tempDir, 'artifacts');
    const fakePnpm = path.join(binDir, 'pnpm');

    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      fakePnpm,
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const artifactsArg = args.find((arg) => arg.startsWith('--artifacts-dir='));
if (!artifactsArg) {
  console.error('missing --artifacts-dir argument');
  process.exit(1);
}

const artifactsDir = artifactsArg.slice('--artifacts-dir='.length);
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(path.join(artifactsDir, 'signed.xpi'), 'dummy xpi');
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
          path.join(process.cwd(), '.output', 'firefox-mv2'),
          '--firefox-amo-metadata',
          path.join(process.cwd(), 'store', 'firefox-amo-metadata.json'),
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
      expect(result.stderr).not.toContain('ReferenceError: fs is not defined');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
