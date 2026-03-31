import { describe, expect, it, vi } from 'vitest';

import { sendMessageWithRuntimeRecovery } from '../../lib/background/tab-message-recovery';

describe('tab message runtime recovery', () => {
  it('retries once after content scripts are injected on supported ChatGPT routes', async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: true } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: true });
    const injectContentScripts = vi.fn().mockResolvedValue(true);
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await sendMessageWithRuntimeRecovery(
      {
        sendMessage,
        injectContentScripts,
        wait,
        getTab: vi.fn().mockResolvedValue({
          id: 7,
          url: 'https://chatgpt.com/share/abc',
        }),
      },
      7,
      { type: 'GET_TAB_STATUS' },
    );

    expect(result).toEqual({ ok: true });
    expect(injectContentScripts).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not inject for unsupported hosts or routes', async () => {
    const sendMessage = vi.fn<(tabId: number, message: unknown) => Promise<null>>().mockResolvedValue(null);
    const injectContentScripts = vi.fn().mockResolvedValue(true);

    const result = await sendMessageWithRuntimeRecovery(
      {
        sendMessage,
        injectContentScripts,
        wait: vi.fn().mockResolvedValue(undefined),
        getTab: vi.fn().mockResolvedValue({
          id: 9,
          url: 'https://example.com/c/abc',
        }),
      },
      9,
      { type: 'GET_TAB_STATUS' },
    );

    expect(result).toBeNull();
    expect(injectContentScripts).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns null when injection fails after first null response', async () => {
    const sendMessage = vi.fn<(tabId: number, message: unknown) => Promise<null>>().mockResolvedValue(null);
    const injectContentScripts = vi.fn().mockResolvedValue(false);

    const result = await sendMessageWithRuntimeRecovery(
      {
        sendMessage,
        injectContentScripts,
        wait: vi.fn().mockResolvedValue(undefined),
        getTab: vi.fn().mockResolvedValue({
          id: 12,
          url: 'https://chat.openai.com/c/abc',
        }),
      },
      12,
      { type: 'RESTORE_ALL' },
    );

    expect(result).toBeNull();
    expect(injectContentScripts).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
