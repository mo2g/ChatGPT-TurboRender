import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { shouldAutoActivate } from "../../lib/content/utils/layout";

describe('layout helpers', () => {
  it('activates when any threshold trips', () => {
    expect(
      shouldAutoActivate({
        finalizedTurns: 10,
        descendantCount: 50,
        spikeCount: 5,
        settings: DEFAULT_SETTINGS,
      }),
    ).toBe(true);

    expect(
      shouldAutoActivate({
        finalizedTurns: 10,
        descendantCount: 50,
        spikeCount: 0,
        settings: DEFAULT_SETTINGS,
      }),
    ).toBe(false);
  });
});
