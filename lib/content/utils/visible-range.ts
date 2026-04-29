import { TURN_ID_DATASET } from '../../shared/constants';
import type { IndexRange } from '../../shared/types';

export function computeVisibleRangeFromTurnContainer(
  turnContainer: HTMLElement | null,
  scrollContainer: HTMLElement,
  getRecordIndex: (turnId: string) => number | null,
): IndexRange | null {
  if (turnContainer == null) {
    return null;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  let hasRealLayout = false;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let encounteredVisible = false;

  for (const child of turnContainer.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    const rect = child.getBoundingClientRect();
    if (rect.height > 0 || rect.width > 0 || rect.top !== 0 || rect.bottom !== 0) {
      hasRealLayout = true;
    }

    if (rect.bottom < containerRect.top) {
      continue;
    }

    if (rect.top > containerRect.bottom) {
      if (encounteredVisible) {
        break;
      }
      continue;
    }

    const intersects = rect.bottom >= containerRect.top && rect.top <= containerRect.bottom;
    if (!intersects) {
      continue;
    }
    encounteredVisible = true;

    const turnId = child.dataset[TURN_ID_DATASET];
    if (turnId == null) {
      continue;
    }
    const index = getRecordIndex(turnId);
    if (index != null) {
      if (index < start) {
        start = index;
      }
      if (index > end) {
        end = index;
      }
    }
  }

  if (!hasRealLayout && containerRect.height === 0 && containerRect.width === 0) {
    return null;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return {
    start,
    end,
  };
}
