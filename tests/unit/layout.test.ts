import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../lib/shared/constants';
import { computeHotRange, planTurnGroups, shouldAutoActivate } from '../../lib/content/layout';

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

  it('keeps recent turns and viewport buffer hot', () => {
    expect(
      computeHotRange(200, { start: 20, end: 25 }, { keepRecentTurns: 30, viewportBufferTurns: 8 }),
    ).toEqual({ start: 12, end: 199 });
  });

  it('groups eligible turns into fixed-size cold batches', () => {
    const plans = planTurnGroups(
      Array.from({ length: 15 }, (_, index) => ({
        id: `turn-${index}`,
        index,
        parked: false,
        isStreaming: false,
        protected: false,
        parentKey: 'root',
      })),
      { start: 12, end: 14 },
      5,
    );

    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      startIndex: 0,
      endIndex: 4,
    });
    expect(plans[1]).toMatchObject({
      startIndex: 5,
      endIndex: 9,
    });
  });
});
