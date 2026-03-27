export function getChatIdFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const chatIndex = segments.indexOf('c');

  if (chatIndex >= 0 && segments[chatIndex + 1]) {
    return `chat:${segments[chatIndex + 1]}`;
  }

  if (segments.length === 0) {
    return 'chat:home';
  }

  return `chat:${segments.join('/')}`;
}
