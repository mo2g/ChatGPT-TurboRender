import { describe, expect, it } from 'vitest';

// @ts-expect-error - The helper lives in an executable .mjs script.
import { extractOperationId, normalizeTarget, parseArgs } from '../../scripts/publish-stores.mjs';

describe('publish store helpers', () => {
  it('parses the release publish CLI arguments', () => {
    expect(
      parseArgs([
        'node',
        'scripts/publish-stores.mjs',
        '--target',
        'chrome',
        '--version',
        '1.2.3',
        '--chrome-zip',
        '.output/chatgpt-turborender-1.2.3-chrome.zip',
        '--edge-zip',
        '.output/chatgpt-turborender-1.2.3-edge.zip',
      ]),
    ).toEqual({
      target: 'chrome',
      version: '1.2.3',
      chromeZip: '.output/chatgpt-turborender-1.2.3-chrome.zip',
      edgeZip: '.output/chatgpt-turborender-1.2.3-edge.zip',
    });
  });

  it('normalizes operation ids from store response headers', () => {
    expect(extractOperationId('1234-5678')).toBe('1234-5678');
    expect(extractOperationId('/v1/products/demo/submissions/operations/1234-5678')).toBe('1234-5678');
    expect(
      extractOperationId('https://api.addons.microsoftedge.microsoft.com/v1/products/demo/submissions/operations/1234-5678?foo=bar'),
    ).toBe('1234-5678');
  });

  it('rejects invalid targets', () => {
    expect(() => normalizeTarget('firefox')).toThrow('Invalid target: firefox');
  });
});
