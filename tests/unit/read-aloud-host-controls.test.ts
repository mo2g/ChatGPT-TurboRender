import { describe, expect, it, vi } from 'vitest';

import { findHostReadAloudStopButton } from '../../lib/content/read-aloud-host-controls';
import {
  TURBO_RENDER_UI_ROOT_ATTRIBUTE,
  TURBO_RENDER_UI_ROOT_VALUE,
} from '../../lib/shared/constants';

describe('read aloud host controls', () => {
  it('finds exact host stop controls', () => {
    document.body.innerHTML = '<button data-testid="voice-stop-turn-action-button"></button>';
    const button = document.querySelector<HTMLElement>('button');
    if (button == null) {
      throw new Error('Expected test button to exist.');
    }
    mockVisible(button);

    expect(findHostReadAloudStopButton(document)).toBe(button);
  });

  it('falls back to visible stop labels', () => {
    document.body.innerHTML = '<button title="Stop read aloud"></button>';
    const button = document.querySelector<HTMLElement>('button');
    if (button == null) {
      throw new Error('Expected test button to exist.');
    }
    mockVisible(button);

    expect(findHostReadAloudStopButton(document)).toBe(button);
  });

  it('ignores extension-owned controls', () => {
    document.body.innerHTML = `
      <div ${TURBO_RENDER_UI_ROOT_ATTRIBUTE}="${TURBO_RENDER_UI_ROOT_VALUE}">
        <button title="Stop read aloud"></button>
      </div>
      <button aria-label="停止朗读"></button>
    `;
    const buttons = [...document.querySelectorAll<HTMLElement>('button')];
    buttons.forEach(mockVisible);

    expect(findHostReadAloudStopButton(document)).toBe(buttons[1]);
  });
});

function mockVisible(element: HTMLElement): void {
  vi.spyOn(element, 'getClientRects').mockReturnValue({
    length: 1,
    item: () => null,
    [Symbol.iterator]: function* () {
      yield {} as DOMRect;
    },
  } as DOMRectList);
}
