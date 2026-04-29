import { describe, expect, it } from 'vitest';

import { waitForHostElement } from "../../lib/content/host-integration/host-action-wait";

describe('host action wait', () => {
  it('resolves an already available host element', async () => {
    document.body.innerHTML = '<button data-ready="true">More</button>';

    const result = await waitForHostElement({
      doc: document,
      win: window,
      timeoutMs: 100,
      probe: () => document.querySelector<HTMLElement>('[data-ready="true"]'),
    });

    expect(result).toBe(document.querySelector('[data-ready="true"]'));
  });

  it('observes host DOM changes while waiting', async () => {
    document.body.innerHTML = '<main></main>';

    const resultPromise = waitForHostElement({
      doc: document,
      win: window,
      timeoutMs: 100,
      probe: () => document.querySelector<HTMLElement>('[data-ready="true"]'),
    });

    const button = document.createElement('button');
    button.dataset.ready = 'true';
    document.body.append(button);

    await expect(resultPromise).resolves.toBe(button);
  });
});
