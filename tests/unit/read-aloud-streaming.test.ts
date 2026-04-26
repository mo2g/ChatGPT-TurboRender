import { describe, expect, it, vi } from 'vitest';

import { resolveReadAloudStreamMimeType } from '../../lib/content/read-aloud-streaming';

describe('read aloud streaming', () => {
  it('uses supported response content type for MediaSource streaming', () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/mpeg');
    const win = {
      ...window,
      MediaSource: {
        isTypeSupported,
      },
    } as Window & { MediaSource: typeof MediaSource };
    const response = new Response(null, {
      headers: {
        'content-type': 'audio/mpeg; charset=binary',
      },
    });

    expect(resolveReadAloudStreamMimeType(win, response)).toBe('audio/mpeg');
    expect(isTypeSupported).toHaveBeenCalledWith('audio/mpeg');
  });

  it('falls back to an mp4 AAC codec candidate for AAC-like responses', () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/mp4; codecs="mp4a.40.2"');
    const win = {
      ...window,
      MediaSource: {
        isTypeSupported,
      },
    } as Window & { MediaSource: typeof MediaSource };
    const response = new Response(null, {
      headers: {
        'content-type': 'audio/aac',
      },
    });

    expect(resolveReadAloudStreamMimeType(win, response)).toBe('audio/mp4; codecs="mp4a.40.2"');
  });
});
