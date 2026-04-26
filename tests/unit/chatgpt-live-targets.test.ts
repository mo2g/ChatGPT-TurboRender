import { describe, expect, it } from 'vitest';

import {
  parseLiveTargetUrl,
  readConfiguredLiveInputs,
  validateConfiguredLiveInputs,
} from '../e2e/chatgpt-live-targets';

describe('chatgpt live target parsing', () => {
  it('parses a conversation route into a chat target', () => {
    expect(parseLiveTargetUrl('https://chatgpt.com/c/abc-123')).toEqual({
      url: 'https://chatgpt.com/c/abc-123',
      routeKind: 'chat',
      conversationId: 'abc-123',
    });
  });

  it('normalizes search params and hashes from chat target URLs', () => {
    expect(parseLiveTargetUrl('https://chatgpt.com/c/abc-123?view=compact#turn-5')).toEqual({
      url: 'https://chatgpt.com/c/abc-123',
      routeKind: 'chat',
      conversationId: 'abc-123',
    });
  });

  it('parses a share route into a share target', () => {
    expect(parseLiveTargetUrl('https://chatgpt.com/share/demo-id')).toEqual({
      url: 'https://chatgpt.com/share/demo-id',
      routeKind: 'share',
      conversationId: 'demo-id',
    });
  });

  it('rejects unsupported hosts', () => {
    expect(() => parseLiveTargetUrl('https://example.com/c/abc-123')).toThrow(/Unsupported ChatGPT host/);
  });
});

describe('live input validation', () => {
  it('reads a chat URL from env', () => {
    expect(
      readConfiguredLiveInputs({
        TURBO_RENDER_LIVE_CHAT_URL: 'https://chatgpt.com/c/chat-id',
        TURBO_RENDER_LIVE_USE_ACTIVE_TAB: '0',
      }),
    ).toEqual({
      chatUrl: 'https://chatgpt.com/c/chat-id',
      useActiveTab: false,
    });
  });

  it('rejects missing chat inputs when active-tab is disabled', () => {
    expect(() =>
      validateConfiguredLiveInputs({
        chatUrl: null,
        useActiveTab: false,
      }),
    ).toThrow(/requires --chat-url or --use-active-tab/);
  });

  it('accepts a share URL passed into the live chat inputs', () => {
    expect(
      validateConfiguredLiveInputs({
        chatUrl: 'https://chatgpt.com/share/demo-id',
        useActiveTab: false,
      }),
    ).toEqual({
      chatUrl: 'https://chatgpt.com/share/demo-id',
      useActiveTab: false,
    });
  });

  it('rejects ambiguous active-tab plus explicit URL resolution', () => {
    expect(() =>
      validateConfiguredLiveInputs({
        chatUrl: 'https://chatgpt.com/c/chat-id',
        useActiveTab: true,
      }),
    ).toThrow(/Use either --chat-url or --use-active-tab/);
  });
});
