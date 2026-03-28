import { describe, expect, it } from 'vitest';

import { getChatIdFromPathname, resolveConversationRoute } from '../../lib/shared/chat-id';

describe('chat id parser', () => {
  it('maps root path to home', () => {
    expect(getChatIdFromPathname('/')).toBe('chat:home');
    expect(resolveConversationRoute('/')).toMatchObject({
      kind: 'home',
      routeId: null,
      runtimeId: 'chat:home',
    });
  });

  it('extracts conversation id from /c/:id routes', () => {
    expect(getChatIdFromPathname('/c/abc123')).toBe('chat:abc123');
    expect(getChatIdFromPathname('/x/c/xyz789')).toBe('chat:xyz789');
    expect(resolveConversationRoute('/c/abc123')).toMatchObject({
      kind: 'chat',
      routeId: 'abc123',
      runtimeId: 'chat:abc123',
    });
  });

  it('extracts share ids from /share/:id routes', () => {
    expect(getChatIdFromPathname('/share/abc123')).toBe('share:abc123');
    expect(resolveConversationRoute('/share/abc123')).toMatchObject({
      kind: 'share',
      routeId: 'abc123',
      runtimeId: 'share:abc123',
    });
  });

  it('treats incomplete /c routes and non-chat routes as transient unknown', () => {
    expect(getChatIdFromPathname('/c')).toBe('chat:unknown');
    expect(getChatIdFromPathname('/c/')).toBe('chat:unknown');
    expect(getChatIdFromPathname('/gpts')).toBe('chat:unknown');
  });
});
