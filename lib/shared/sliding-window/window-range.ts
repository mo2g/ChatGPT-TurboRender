import type { SlidingWindowRange } from './types';

function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function toWindowSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

function createEmptyRange(): SlidingWindowRange {
  return {
    startPairIndex: 0,
    endPairIndex: -1,
  };
}

function normalizeStart(startPairIndex: number, totalPairs: number, windowPairs: number): number {
  const latestStart = Math.max(0, totalPairs - windowPairs);
  return Math.min(latestStart, Math.max(0, Math.floor(startPairIndex)));
}

function rangeFromStart(startPairIndex: number, totalPairs: number, windowPairs: number): SlidingWindowRange {
  const total = toNonNegativeInteger(totalPairs);
  if (total === 0) {
    return createEmptyRange();
  }

  const size = Math.min(toWindowSize(windowPairs), total);
  const start = normalizeStart(startPairIndex, total, size);
  return {
    startPairIndex: start,
    endPairIndex: Math.min(total - 1, start + size - 1),
  };
}

function getWindowPageStarts(totalPairs: number, windowPairs: number): number[] {
  const total = toNonNegativeInteger(totalPairs);
  if (total === 0) {
    return [];
  }

  const size = Math.min(toWindowSize(windowPairs), total);
  const latestStart = Math.max(0, total - size);
  const starts = [0];

  for (let start = size; start < latestStart; start += size) {
    starts.push(start);
  }

  if ((starts.at(-1) ?? -1) !== latestStart) {
    starts.push(latestStart);
  }

  return starts;
}

function getAdjacentWindowRange(
  currentRange: SlidingWindowRange,
  totalPairs: number,
  windowPairs: number,
  direction: -1 | 1,
): SlidingWindowRange {
  const total = toNonNegativeInteger(totalPairs);
  if (total === 0) {
    return createEmptyRange();
  }

  const size = Math.min(toWindowSize(windowPairs), total);
  const currentPage = getWindowPageForRange(currentRange, total, size);
  if (currentPage <= 0) {
    return getLatestWindowRange(total, size);
  }

  const pageCount = getWindowPageCount(total, size);
  const targetPage = Math.max(1, Math.min(pageCount, currentPage + direction));
  return getWindowPageRange(total, size, targetPage);
}

export function getWindowPairCount(range: SlidingWindowRange): number {
  if (range.endPairIndex < range.startPairIndex) {
    return 0;
  }

  return range.endPairIndex - range.startPairIndex + 1;
}

export function getLatestWindowRange(totalPairs: number, windowPairs: number): SlidingWindowRange {
  const total = toNonNegativeInteger(totalPairs);
  if (total === 0) {
    return createEmptyRange();
  }

  const size = Math.min(toWindowSize(windowPairs), total);
  return {
    startPairIndex: total - size,
    endPairIndex: total - 1,
  };
}

export function getFirstWindowRange(totalPairs: number, windowPairs: number): SlidingWindowRange {
  return getWindowPageRange(totalPairs, windowPairs, 1);
}

export function getWindowPageCount(totalPairs: number, windowPairs: number): number {
  return getWindowPageStarts(totalPairs, windowPairs).length;
}

export function getWindowPageRange(
  totalPairs: number,
  windowPairs: number,
  page: number,
): SlidingWindowRange {
  const starts = getWindowPageStarts(totalPairs, windowPairs);
  if (starts.length === 0) {
    return createEmptyRange();
  }

  const pageIndex = Math.min(starts.length - 1, Math.max(0, Math.floor(page) - 1));
  return rangeFromStart(starts[pageIndex] ?? 0, totalPairs, windowPairs);
}

export function getWindowPageForRange(
  range: SlidingWindowRange,
  totalPairs: number,
  windowPairs: number,
): number {
  const starts = getWindowPageStarts(totalPairs, windowPairs);
  if (starts.length === 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  starts.forEach((start, index) => {
    const distance = Math.abs(start - range.startPairIndex);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return bestIndex + 1;
}

export function getOlderWindowRange(
  currentRange: SlidingWindowRange,
  totalPairs: number,
  windowPairs: number,
): SlidingWindowRange {
  return getAdjacentWindowRange(currentRange, totalPairs, windowPairs, -1);
}

export function getNewerWindowRange(
  currentRange: SlidingWindowRange,
  totalPairs: number,
  windowPairs: number,
): SlidingWindowRange {
  return getAdjacentWindowRange(currentRange, totalPairs, windowPairs, 1);
}

export function getCenteredWindowRange(
  targetPairIndex: number,
  totalPairs: number,
  windowPairs: number,
): SlidingWindowRange {
  const total = toNonNegativeInteger(totalPairs);
  if (total === 0) {
    return createEmptyRange();
  }

  const size = Math.min(toWindowSize(windowPairs), total);
  const target = Math.min(total - 1, Math.max(0, Math.floor(targetPairIndex)));
  const start = target - Math.floor((size - 1) / 2);
  return rangeFromStart(start, total, size);
}

export function isLatestWindow(range: SlidingWindowRange, totalPairs: number): boolean {
  const total = toNonNegativeInteger(totalPairs);
  if (total === 0) {
    return true;
  }

  return range.endPairIndex >= total - 1;
}
