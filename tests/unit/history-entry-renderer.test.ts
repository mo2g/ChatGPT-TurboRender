import { describe, expect, it } from 'vitest';

import { renderManagedHistoryEntryBody } from '../../lib/content/history-entry-renderer';
import { ManagedHistoryStore } from '../../lib/content/managed-history';
import { createTranslator } from '../../lib/shared/i18n';
import type { ManagedHistoryCitation } from '../../lib/shared/types';

function createMarkdownEntry(
  parts: string[],
  role: 'assistant' | 'user' = 'assistant',
  citations: ManagedHistoryCitation[] = [],
) {
  return ManagedHistoryStore.createEntry({
    id: 'entry-1',
    turnIndex: 0,
    role,
    parts,
    renderKind: 'markdown-text',
    citations,
  });
}

describe('history-entry-renderer', () => {
  it('renders strong and inline code markers without leaking raw markdown delimiters', () => {
    const body = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(['## Open the terminal\nUse **打开终端** with ``bash`` and `pnpm test`.']),
      createTranslator('en'),
      'Assistant',
      false,
    );

    expect(body.dataset.renderKind).toBe('markdown-text');
    expect(body.classList.contains('text-message')).toBe(true);
    expect(body.querySelector('.markdown.prose')).not.toBeNull();
    expect(body.querySelector('h2')?.textContent).toBe('Open the terminal');
    expect(body.querySelector('strong')?.textContent).toBe('打开终端');
    const inlineCodes = [...body.querySelectorAll('code')].map((node) => node.textContent ?? '');
    expect(inlineCodes).toContain('bash');
    expect(inlineCodes).toContain('pnpm test');
    expect(body.textContent).not.toContain('**打开终端**');
    expect(body.textContent).not.toContain('## Open the terminal');
    expect(body.textContent).not.toContain('``bash``');
  });

  it('renders assistant pipe tables and hides raw citation markers', () => {
    const body = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry([
        [
          '对比表',
          '| 维度 | OrbStack 本地镜像 | 本地 Docker registry | |---|---|---| | 上手复杂度 | 最低 | 较高 | | 构建速度 | 快，直接走本地 BuildKit cache \uE200cite\uE202turn117839search2\uE201 | 构建后还要 push |',
        ].join('\n'),
      ]),
      createTranslator('en'),
      'Assistant',
      false,
    );

    const table = body.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('thead th')).toHaveLength(3);
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(table?.querySelector('tbody tr:first-child td:first-child')?.textContent).toBe('上手复杂度');
    expect(body.querySelector('[data-turbo-render-citation="true"]')).not.toBeNull();
    expect(body.textContent).not.toContain('|---|');
    expect(body.textContent).not.toContain('\uE200cite');
    expect(body.textContent).not.toContain('turn117839search2');
  });

  it('renders source citations as links only when citation metadata has a url', () => {
    const body = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(
        ['BuildKit cache \uE200cite\uE202turn117839search2\uE201 is reused.'],
        'assistant',
        [
          {
            marker: 'turn117839search2',
            url: 'https://docs.orbstack.dev/docker/',
            title: 'OrbStack Docker docs',
            source: 'web',
          },
        ],
      ),
      createTranslator('en'),
      'Assistant',
      false,
    );

    const citation = body.querySelector<HTMLElement>('[data-turbo-render-citation="true"]');
    const link = citation?.querySelector<HTMLAnchorElement>('a');
    expect(link).not.toBeNull();
    expect(link?.href).toBe('https://docs.orbstack.dev/docker/');
    expect(link?.target).toBe('_blank');
    expect(citation?.title).toBe('OrbStack Docker docs');
  });

  it('preserves archived user prompts inside the official user bubble structure', () => {
    const body = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(['nginx:\n  root /www/wwwroot;\n- keep this literal\n```not a fence'], 'user'),
      createTranslator('en'),
      'User',
      false,
    );

    expect(body.dataset.renderKind).toBe('markdown-text');
    expect(body.classList.contains('text-message')).toBe(true);
    expect(body.classList.contains('items-end')).toBe(true);
    expect(body.classList.contains('whitespace-normal')).toBe(true);
    const shell = body.querySelector('div.flex.w-full.flex-col');
    expect(shell).not.toBeNull();
    const bubble = body.querySelector<HTMLElement>('.user-message-bubble-color');
    expect(bubble).not.toBeNull();
    const content = bubble?.querySelector<HTMLElement>('div');
    expect(content?.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(body.querySelector('ul')).toBeNull();
    expect(body.querySelector('pre')).toBeNull();
    expect(body.textContent).toContain('nginx:\n  root /www/wwwroot;');
    expect(body.textContent).toContain('- keep this literal');
    expect(body.textContent).toContain('```not a fence');
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
      createMarkdownEntry(['# Title\n```bash\necho "ok"\n```']),
      createTranslator('en'),
      'Assistant',
      false,
    );
    expect(closedFence.querySelector('h1')?.textContent).toBe('Title');
    expect(closedFence.querySelector('.turbo-render-code-block')).not.toBeNull();
    expect(closedFence.querySelector('.turbo-render-code-language')?.textContent).toBe('bash');
    expect(closedFence.querySelector('code[data-language="bash"]')?.textContent).toContain('echo "ok"');

    const unclosedFence = renderManagedHistoryEntryBody(
      document,
      createMarkdownEntry(['# Title\n```bash\necho "missing close"']),
      createTranslator('en'),
      'Assistant',
      false,
    );
    expect(unclosedFence.querySelector('h1')?.textContent).toBe('Title');
    expect(unclosedFence.querySelector('pre')).toBeNull();
    expect(unclosedFence.textContent).toContain('```bash');
    expect(unclosedFence.textContent).toContain('echo "missing close"');
  });
});
