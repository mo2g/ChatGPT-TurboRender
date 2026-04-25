import { describe, expect, it } from 'vitest';

import { ArchivePager } from '../../lib/content/archive-pager';

describe('ArchivePager', () => {
  it('starts in recent view and clamps empty histories to null', () => {
    const pager = new ArchivePager();

    expect(pager.currentPageIndex).toBeNull();
    expect(pager.openNewest(0)).toBeNull();
    expect(pager.goOlder(0)).toBeNull();
    expect(pager.goNewer(0)).toBeNull();
    expect(pager.goToPage(3, 0)).toBeNull();
    expect(pager.currentPageIndex).toBeNull();
  });

  it('opens the newest page and walks older/newer boundaries deterministically', () => {
    const pager = new ArchivePager();

    expect(pager.openNewest(5)).toBe(4);
    expect(pager.goOlder(5)).toBe(3);
    expect(pager.goOlder(5)).toBe(2);
    expect(pager.goNewer(5)).toBe(3);
    expect(pager.goNewer(5)).toBe(4);
    expect(pager.goNewer(5)).toBeNull();
    expect(pager.currentPageIndex).toBeNull();
  });

  it('clamps arbitrary page requests into the valid range', () => {
    const pager = new ArchivePager();

    expect(pager.goToPage(-3, 4)).toBe(0);
    expect(pager.goToPage(99, 4)).toBe(3);
    expect(pager.goToRecent()).toBeNull();
    expect(pager.currentPageIndex).toBeNull();
  });

  it('treats going older from recent as opening the newest cold page', () => {
    const pager = new ArchivePager();

    expect(pager.goOlder(3)).toBe(2);
    expect(pager.currentPageIndex).toBe(2);
    expect(pager.goToRecent()).toBeNull();
    expect(pager.goNewer(3)).toBeNull();
  });
});
