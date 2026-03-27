import { describe, expect, it, vi } from 'vitest';

import { createDisposableBag, registerOptionalListener } from '../../lib/content/runtime-disposers';

describe('runtime disposers', () => {
  it('ignores missing extension listeners and disposes idempotently', () => {
    const bag = createDisposableBag();

    expect(registerOptionalListener(bag, undefined, vi.fn())).toBe(false);
    expect(() => {
      bag.dispose();
      bag.dispose();
    }).not.toThrow();
  });

  it('removes registered listeners only once during cleanup', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const handler = vi.fn();
    const bag = createDisposableBag();

    expect(
      registerOptionalListener(
        bag,
        {
          addListener,
          removeListener,
        },
        handler,
      ),
    ).toBe(true);

    expect(addListener).toHaveBeenCalledWith(handler);

    bag.dispose();
    bag.dispose();

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith(handler);
  });
});
