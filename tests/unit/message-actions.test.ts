import { describe, expect, it, vi } from 'vitest';

import {
  captureHostActionTemplate,
  findHostActionButton,
  instantiateHostActionTemplate,
  isHostActionButtonAvailable,
  resolveArchiveCopyText,
} from '../../lib/content/message-actions';

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
            class="touch:-me-2 -ms-2.5 flex flex-wrap items-center gap-y-4 p-1 pointer-events-none opacity-0 group-hover/turn-messages:pointer-events-auto"
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
});
