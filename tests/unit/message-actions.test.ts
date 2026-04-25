// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';

import {
  captureHostActionTemplate,
  copyTextToClipboard,
  createArchiveClipboardPayload,
  findHostActionButton,
  instantiateHostActionTemplate,
  isHostActionButtonAvailable,
  resolveArchiveCopyText,
} from '../../lib/content/message-actions';
import { UI_CLASS_NAMES } from '../../lib/shared/constants';

describe('message actions', () => {
  it('finds host action buttons from visible labels and titles', () => {
    document.body.innerHTML = `
      <main>
        <button data-testid="copy-turn-action-button"></button>
        <button data-testid="good-response-turn-action-button"></button>
        <button data-testid="bad-response-turn-action-button"></button>
        <button data-testid="share-turn-action-button"></button>
        <button data-testid="more-turn-action-button"></button>
      </main>
    `;

    const root = document.body;
    expect(findHostActionButton(root, 'copy')).toBe(root.querySelector('button[data-testid="copy-turn-action-button"]'));
    expect(findHostActionButton(root, 'like')).toBe(root.querySelector('button[data-testid="good-response-turn-action-button"]'));
    expect(findHostActionButton(root, 'dislike')).toBe(root.querySelector('button[data-testid="bad-response-turn-action-button"]'));
    expect(findHostActionButton(root, 'share')).toBe(root.querySelector('button[data-testid="share-turn-action-button"]'));
    expect(findHostActionButton(root, 'more')).toBe(root.querySelector('button[data-testid="more-turn-action-button"]'));
  });

  it('falls back to visible labels when data-testid is unavailable', () => {
    document.body.innerHTML = `
      <main>
        <button aria-label="Copy"></button>
        <button title="Like"></button>
        <button aria-label="不喜欢"></button>
        <button title="Share"></button>
        <button aria-label="More actions"></button>
      </main>
    `;

    const root = document.body;
    expect(findHostActionButton(root, 'copy')).toBe(root.querySelector('button[aria-label="Copy"]'));
    expect(findHostActionButton(root, 'like')).toBe(root.querySelector('button[title="Like"]'));
    expect(findHostActionButton(root, 'dislike')).toBe(root.querySelector('button[aria-label="不喜欢"]'));
    expect(findHostActionButton(root, 'share')).toBe(root.querySelector('button[title="Share"]'));
    expect(findHostActionButton(root, 'more')).toBe(root.querySelector('button[aria-label="More actions"]'));
  });

  it('treats disabled host buttons as unavailable', () => {
    document.body.innerHTML = '<main><button aria-label="Share" disabled></button></main>';

    expect(isHostActionButtonAvailable(document.body, 'share')).toBe(false);
  });

  it('captures and instantiates host action templates', () => {
    document.body.innerHTML = `
      <main>
        <div class="turn-host-actions">
          <button data-testid="copy-turn-action-button" aria-label="Copy"><svg></svg></button>
          <button data-testid="good-response-turn-action-button" aria-label="Like"><svg></svg></button>
          <button data-testid="bad-response-turn-action-button" aria-label="Dislike"><svg></svg></button>
          <button data-testid="share-turn-action-button" aria-label="Share"><svg></svg></button>
          <button data-testid="more-turn-action-button" aria-label="More"><svg></svg></button>
        </div>
      </main>
    `;

    const template = captureHostActionTemplate(document.body, 'assistant');
    expect(template).not.toBeNull();
    expect(template?.html).toContain('copy-turn-action-button');
    expect(template?.html).toContain('good-response-turn-action-button');
    expect(template?.html).toContain('bad-response-turn-action-button');
    expect(template?.html).not.toContain('turn-host-actions');

    const fragment = instantiateHostActionTemplate(document, template!);
    expect(fragment).not.toBeNull();
    const holder = document.createElement('div');
    holder.append(fragment!);
    expect(holder.querySelectorAll('button')).toHaveLength(5);
    expect(holder.querySelector<HTMLButtonElement>('button[data-testid="copy-turn-action-button"]')).not.toBeNull();
  });

  it('captures the turn action row instead of markdown code-block controls', () => {
    document.body.innerHTML = `
      <main>
        <section data-message-author-role="assistant">
          <div class="markdown">
            <pre>
              <code>docker pull example</code>
              <button class="code-copy size-9 rounded-full" aria-label="复制">复制</button>
            </pre>
          </div>
          <div class="z-0 flex justify-start">
            <div class="touch:-me-2 -ms-2.5 flex flex-wrap items-center gap-y-4 p-1 pointer-events-none opacity-0" role="group">
              <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg" data-testid="copy-turn-action-button" aria-label="复制回复"><svg></svg></button>
              <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg" data-testid="good-response-turn-action-button" aria-label="喜欢"><svg></svg></button>
              <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg" data-testid="bad-response-turn-action-button" aria-label="不喜欢"><svg></svg></button>
              <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg" aria-label="分享"><svg></svg></button>
              <button class="text-token-text-secondary hover:bg-token-bg-secondary rounded-lg" aria-label="更多操作"><svg></svg></button>
              <button aria-label="切换模型">切换模型</button>
            </div>
          </div>
        </section>
      </main>
    `;

    const copyButton = findHostActionButton(document.body, 'copy');
    expect(copyButton).toBe(document.querySelector('button[data-testid="copy-turn-action-button"]'));

    const template = captureHostActionTemplate(document.body, 'assistant');
    expect(template).not.toBeNull();
    expect(template?.html).toContain('复制回复');
    expect(template?.html).toContain('hover:bg-token-bg-secondary');
    expect(template?.html).not.toContain('code-copy');
    expect(template?.html).not.toContain('rounded-full');
    expect(template?.html).not.toContain('切换模型');
  });

  it('filters unrelated controls out of captured templates', () => {
    document.body.innerHTML = `
      <main>
        <div class="turn-host-actions">
          <button aria-label="Edit"></button>
          <button data-testid="copy-turn-action-button" aria-label="Copy"><svg></svg></button>
          <button data-testid="good-response-turn-action-button" aria-label="Like"><svg></svg></button>
          <button data-testid="bad-response-turn-action-button" aria-label="Dislike"><svg></svg></button>
          <button data-testid="share-turn-action-button" aria-label="Share"><svg></svg></button>
          <button data-testid="more-turn-action-button" aria-label="More"><svg></svg></button>
        </div>
      </main>
    `;

    const template = captureHostActionTemplate(document.body, 'assistant');
    expect(template).not.toBeNull();
    expect(template?.html).not.toContain('Edit');
  });

  it('captures edge inset metadata from the host action group', () => {
    document.body.innerHTML = `
      <main>
        <div class="turn-host-actions" role="group">
          <button data-testid="copy-turn-action-button" aria-label="Copy"><svg></svg></button>
          <button data-testid="good-response-turn-action-button" aria-label="Like"><svg></svg></button>
          <button data-testid="bad-response-turn-action-button" aria-label="Dislike"><svg></svg></button>
          <button data-testid="share-turn-action-button" aria-label="Share"><svg></svg></button>
          <button data-testid="more-turn-action-button" aria-label="More"><svg></svg></button>
        </div>
      </main>
    `;

    const group = document.querySelector<HTMLElement>('.turn-host-actions');
    const copy = group?.querySelector<HTMLElement>('button[data-testid="copy-turn-action-button"]');
    if (group == null || copy == null) {
      throw new Error('Expected host action fixtures to exist.');
    }

    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({
      top: 80,
      bottom: 120,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
      x: 100,
      y: 80,
      toJSON: () => '',
    } as DOMRect);
    vi.spyOn(copy, 'getBoundingClientRect').mockReturnValue({
      top: 84,
      bottom: 116,
      left: 108,
      right: 140,
      width: 32,
      height: 32,
      x: 108,
      y: 84,
      toJSON: () => '',
    } as DOMRect);

    const template = captureHostActionTemplate(document.body, 'assistant');
    expect(template).not.toBeNull();
    expect(template?.edgeInsetPx).toBe(8);
  });

  it('captures wrapper metadata and slot hints from host action rows', () => {
    document.body.innerHTML = `
      <main>
        <div class="z-0 flex justify-start">
          <div
            class="touch:-me-2 -ms-2.5 flex flex-wrap items-center gap-y-4 p-1 pointer-events-none opacity-0 [mask-image:linear-gradient(to_right,black_33%,transparent_66%)] [mask-size:300%_100%] [mask-position:100%_0%] group-hover/turn-messages:pointer-events-auto"
            role="group"
          >
            <button data-testid="copy-turn-action-button" aria-label="Copy"><svg></svg></button>
            <button data-testid="good-response-turn-action-button" aria-label="Like"><svg></svg></button>
            <button data-testid="bad-response-turn-action-button" aria-label="Dislike"><svg></svg></button>
            <button data-testid="share-turn-action-button" aria-label="Share"><svg></svg></button>
            <button data-testid="more-turn-action-button" aria-label="More"><svg></svg></button>
          </div>
        </div>
      </main>
    `;

    const template = captureHostActionTemplate(document.body, 'assistant');
    expect(template).not.toBeNull();
    expect(template?.wrapperRole).toBe('group');
    expect(template?.slotHint).toBe('start');
    expect(template?.wrapperClassName).toContain('flex');
    expect(template?.wrapperClassName).not.toContain('pointer-events-none');
    expect(template?.wrapperClassName).not.toContain('opacity-0');
    expect(template?.wrapperClassName).not.toContain('mask-');
  });

  it('strips host hover-only visibility classes from cloned action buttons', () => {
    document.body.innerHTML = `
      <main>
        <div class="turn-host-actions" role="group">
          <button data-testid="copy-turn-action-button" aria-label="Copy" class="opacity-0 group-hover/turn-messages:opacity-100 pointer-events-none invisible [mask-image:linear-gradient(to_right,black_33%,transparent_66%)] hover:bg-token-bg-secondary" style="opacity: 0; pointer-events: none; mask-image: linear-gradient(to right, black, transparent);"><svg aria-hidden="true"></svg></button>
          <button data-testid="good-response-turn-action-button" aria-label="Like" class="opacity-0"><svg></svg></button>
          <button data-testid="bad-response-turn-action-button" aria-label="Dislike" class="opacity-0"><svg></svg></button>
          <button data-testid="share-turn-action-button" aria-label="Share" class="opacity-0"><svg></svg></button>
          <button data-testid="more-turn-action-button" aria-label="More" class="opacity-0"><svg></svg></button>
        </div>
      </main>
    `;

    const template = captureHostActionTemplate(document.body, 'assistant');

    expect(template).not.toBeNull();
    expect(template?.html).not.toContain('opacity-0');
    expect(template?.html).not.toContain('group-hover');
    expect(template?.html).not.toContain('pointer-events-none');
    expect(template?.html).not.toContain('invisible');
    expect(template?.html).not.toContain('mask-image');
    expect(template?.html).not.toContain('style=');
    expect(template?.html).toContain('hover:bg-token-bg-secondary');
  });

  it('drops purely positional host wrappers so action rows stay in flow', () => {
    document.body.innerHTML = `
      <main>
        <div class="absolute end-1.5 top-1 z-2 md:end-2 md:top-1" role="group">
          <button data-testid="copy-turn-action-button" aria-label="Copy"><svg></svg></button>
          <button data-testid="good-response-turn-action-button" aria-label="Like"><svg></svg></button>
          <button data-testid="bad-response-turn-action-button" aria-label="Dislike"><svg></svg></button>
          <button data-testid="share-turn-action-button" aria-label="Share"><svg></svg></button>
          <button data-testid="more-turn-action-button" aria-label="More"><svg></svg></button>
        </div>
      </main>
    `;

    const template = captureHostActionTemplate(document.body, 'assistant');
    expect(template).not.toBeNull();
    expect(template?.wrapperRole).toBe('group');
    expect(template?.wrapperClassName).toBeUndefined();
  });

  it('falls back to combined parts text when the flattened entry text is empty', () => {
    const entry = {
      id: 'history-entry',
      source: 'parked-group',
      role: 'assistant' as const,
      turnIndex: 0,
      pairIndex: 0,
      turnId: null,
      liveTurnId: null,
      groupId: null,
      parts: ['First paragraph', 'Second paragraph'],
      text: '',
      renderKind: 'markdown-text' as const,
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    expect(resolveArchiveCopyText(entry)).toBe('First paragraph\n\nSecond paragraph');
  });

  it('writes rich clipboard payloads with text/html when supported', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    class TestClipboardItem {
      constructor(items) {
        this.items = items;
      }
    }
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });

    const copied = await copyTextToClipboard(document, {
      text: 'Title\n\nBody',
      html: '<h2>Title</h2><p>Body</p>',
    });

    expect(copied).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0][0][0];
    expect(Object.keys(item.items)).toEqual(['text/plain', 'text/html']);
  });

  it('prefers rich execCommand copying before plain writeText fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = window.navigator.clipboard;
    const originalClipboardItem = (window as Window & { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      value: undefined,
    });
    const originalExecCommand = document.execCommand;
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    try {
      const copied = await copyTextToClipboard(document, {
        text: 'Title\n\nBody',
        html: '<h2>Title</h2><p>Body</p>',
      });

      expect(copied).toBe(true);
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: originalExecCommand,
      });
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
      Object.defineProperty(window, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
    }
  });

  it('builds archive clipboard html from the rendered message body without action controls', () => {
    const body = document.createElement('div');
    body.className = UI_CLASS_NAMES.historyEntryBody;
    body.innerHTML = `
      <div class="markdown">
        <h2>对比表</h2>
        <table><tbody><tr><td>OrbStack</td><td>Registry</td></tr></tbody></table>
      </div>
      <div class="${UI_CLASS_NAMES.historyEntryActions}">
        <button data-turbo-render-action="copy">Copy</button>
      </div>
    `;
    const entry = {
      id: 'history-entry',
      source: 'parked-group',
      role: 'assistant',
      turnIndex: 0,
      pairIndex: 0,
      turnId: null,
      liveTurnId: null,
      messageId: null,
      groupId: null,
      parts: ['fallback'],
      text: 'fallback',
      renderKind: 'markdown-text',
      contentType: null,
      snapshotHtml: null,
      structuredDetails: null,
      hiddenFromConversation: false,
    };

    const payload = createArchiveClipboardPayload(document, entry, body);

    expect(payload.text).toBe('fallback');
    expect(payload.html).toContain('<h2>对比表</h2>');
    expect(payload.html).toContain('<table>');
    expect(payload.html).not.toContain('data-turbo-render-action');
  });
});
