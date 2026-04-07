import { describe, expect, it } from 'vitest';

import { renderManagedHistoryEntryBody } from '../../lib/content/history-entry-renderer';
import { ManagedHistoryStore } from '../../lib/content/managed-history';
import { createTranslator } from '../../lib/shared/i18n';

function createMarkdownEntry(parts: string[]) {
  return ManagedHistoryStore.createEntry({
    id: 'entry-1',
    turnIndex: 0,
    role: 'assistant',
    parts,
    renderKind: 'markdown-text',
  });
}

describe('history-entry-renderer', () => {
  it('renders strong and inline code markers without leaking raw markdown delimiters', () => {
    const body = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(['Use **打开终端** with ``bash`` and `pnpm test`.']),
      createTranslator('en'),
      'Assistant',
      false,
    );

    expect(body.dataset.renderKind).toBe('markdown-text');
    expect(body.querySelector('strong')?.textContent).toBe('打开终端');
    const inlineCodes = [...body.querySelectorAll('code')].map((node) => node.textContent ?? '');
    expect(inlineCodes).toContain('bash');
    expect(inlineCodes).toContain('pnpm test');
    expect(body.textContent).not.toContain('**打开终端**');
    expect(body.textContent).not.toContain('``bash``');
  });

  it('preserves host snapshot markup without wrapping it in a second visible bubble', () => {
    const body = renderManagedHistoryEntryBody(
      document,
      ManagedHistoryStore.createEntry({
        id: 'entry-2',
        turnIndex: 0,
        role: 'user',
        parts: ['Official bubble text'],
        renderKind: 'host-snapshot',
        snapshotHtml: '<div data-message-author-role="user" class="user-turn"><div class="user-bubble">Official bubble text</div></div>',
      }),
      createTranslator('en'),
      'User',
      false,
    );

    expect(body.dataset.renderKind).toBe('host-snapshot');
    expect(body.innerHTML).toContain('data-message-author-role="user"');
    expect(body.innerHTML).toContain('Official bubble text');
  });

  it('renders fenced code blocks and falls back to text when fence is unclosed', () => {
    const closedFence = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(['```bash\necho "ok"\n```']),
      createTranslator('en'),
      'Assistant',
      false,
    );
    expect(closedFence.querySelector('code[data-language="bash"]')?.textContent).toContain('echo "ok"');

    const unclosedFence = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(['```bash\necho "missing close"']),
      createTranslator('en'),
      'Assistant',
      false,
    );
    expect(unclosedFence.querySelector('pre')).toBeNull();
    expect(unclosedFence.textContent).toContain('```bash');
    expect(unclosedFence.textContent).toContain('echo "missing close"');
  });
});
