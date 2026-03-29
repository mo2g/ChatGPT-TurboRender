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
