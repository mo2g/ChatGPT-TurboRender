export class ArchivePager {
  currentPageIndex: number | null = null;

  openNewest(totalPages: number): number | null {
    const pageCount = normalizePageCount(totalPages);
    if (pageCount === 0) {
      this.currentPageIndex = null;
      return null;
    }

    this.currentPageIndex = pageCount - 1;
    return this.currentPageIndex;
  }

  goOlder(totalPages: number): number | null {
    const pageCount = normalizePageCount(totalPages);
    if (pageCount === 0) {
      this.currentPageIndex = null;
      return null;
    }

    if (this.currentPageIndex == null) {
      return this.openNewest(pageCount);
    }

    this.currentPageIndex = Math.max(0, this.currentPageIndex - 1);
    return this.currentPageIndex;
  }

  goNewer(totalPages: number): number | null {
    const pageCount = normalizePageCount(totalPages);
    if (pageCount === 0) {
      this.currentPageIndex = null;
      return null;
    }

    if (this.currentPageIndex == null) {
      return null;
    }

    if (this.currentPageIndex >= pageCount - 1) {
      this.currentPageIndex = null;
      return null;
    }

    this.currentPageIndex += 1;
    return this.currentPageIndex;
  }

  goToRecent(): null {
    this.currentPageIndex = null;
    return null;
  }

  goToPage(pageIndex: number, totalPages: number): number | null {
    const pageCount = normalizePageCount(totalPages);
    if (pageCount === 0) {
      this.currentPageIndex = null;
      return null;
    }

    const normalizedPageIndex = clampPageIndex(pageIndex, pageCount);
    this.currentPageIndex = normalizedPageIndex;
    return normalizedPageIndex;
  }
}

function normalizePageCount(totalPages: number): number {
  if (!Number.isFinite(totalPages)) {
    return 0;
  }

  return Math.max(0, Math.trunc(totalPages));
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  const normalizedPageIndex = Number.isFinite(pageIndex) ? Math.trunc(pageIndex) : 0;
  if (normalizedPageIndex < 0) {
    return 0;
  }

  if (normalizedPageIndex >= pageCount) {
    return pageCount - 1;
  }

  return normalizedPageIndex;
}
