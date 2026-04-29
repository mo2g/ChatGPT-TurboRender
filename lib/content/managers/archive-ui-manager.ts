import type { ManagedHistoryGroup, ArchivePageMatch } from '../../shared/types';
import type { ManagedHistoryStore } from '../core/managed-history';
import type { ArchivePager } from './archive-pager';
import type { ArchiveUiState } from '../state/archive-ui-state';
import { resolveResidentArchivePageIndexes } from '../state/archive-ui-state';
import { ARCHIVE_PAGE_PAIR_COUNT } from '../core/turbo-render-controller';

export interface ArchiveUIManagerOptions {
  win: Window;
  managedHistory: ManagedHistoryStore;
  archivePager: ArchivePager;
  getHotPairCount: (totalPairs: number) => number;
  getBatchPairCount: () => number;
  onStateChange: () => void;
  onScheduleUiSync: () => void;
}

export interface ArchiveSearchState {
  open: boolean;
  query: string;
  results: ArchivePageMatch[];
  activePageIndex: number | null;
  activePairIndex: number | null;
}

export interface PendingArchiveToggle {
  groupId: string;
  anchor: HTMLElement | null;
  previousAnchorTop: number | null;
  previousScrollTop: number;
  targetAnchorTop: number | null;
  scrollTarget: HTMLElement | null;
  wasExpanded: boolean;
}

export interface PendingArchiveSearchJump {
  pageIndex: number;
  pairIndex: number;
  attemptCount: number;
}

export class ArchiveUIManager {
  private readonly win: Window;
  private readonly managedHistory: ManagedHistoryStore;
  private readonly archivePager: ArchivePager;
  private readonly getHotPairCount: (totalPairs: number) => number;
  private readonly getBatchPairCount: () => number;
  private readonly onStateChange: () => void;
  private readonly onScheduleUiSync: () => void;

  // State
  private readonly expandedBatchIds = new Set<string>();
  private searchOpen = false;
  private searchQuery = '';
  private searchResults: ArchivePageMatch[] = [];
  private activeSearchPageIndex: number | null = null;
  private activeSearchPairIndex: number | null = null;
  private pendingSearchJump: PendingArchiveSearchJump | null = null;
  private pendingToggle: PendingArchiveToggle | null = null;
  private uiSyncHandle: number | null = null;

  constructor(options: ArchiveUIManagerOptions) {
    this.win = options.win;
    this.managedHistory = options.managedHistory;
    this.archivePager = options.archivePager;
    this.getHotPairCount = options.getHotPairCount;
    this.getBatchPairCount = options.getBatchPairCount;
    this.onStateChange = options.onStateChange;
    this.onScheduleUiSync = options.onScheduleUiSync;
  }

  // Reset
  reset(): void {
    this.expandedBatchIds.clear();
    this.resetSearchState();
    this.pendingSearchJump = null;
    this.pendingToggle = null;
    this.uiSyncHandle = null;
  }

  resetForPageChange(): void {
    this.expandedBatchIds.clear();
    this.resetSearchSelection();
  }

  // Expanded Batch Management
  isBatchExpanded(groupId: string): boolean {
    return this.expandedBatchIds.has(groupId);
  }

  toggleBatch(groupId: string): boolean {
    const wasExpanded = this.expandedBatchIds.has(groupId);
    if (wasExpanded) {
      this.expandedBatchIds.delete(groupId);
    } else {
      this.expandedBatchIds.add(groupId);
    }
    return !wasExpanded;
  }

  expandBatch(groupId: string): void {
    this.expandedBatchIds.add(groupId);
  }

  getExpandedBatchIds(): Set<string> {
    return new Set(this.expandedBatchIds);
  }

  pruneExpandedBatches(totalPairs: number): void {
    const pageIndex = this.resolveArchivePageIndex(totalPairs);
    const validIds = new Set(
      this.getArchiveGroupsForPage(pageIndex, totalPairs, new Set()).map((group) => group.id)
    );
    for (const groupId of [...this.expandedBatchIds]) {
      if (!validIds.has(groupId)) {
        this.expandedBatchIds.delete(groupId);
      }
    }
  }

  // Archive Page Navigation

    goToRecent(): void {
    this.archivePager.goToRecent();
    this.resetForPageChange();
    this.onScheduleUiSync();
  }

  goToPage(pageIndex: number, totalPages: number): void {
    this.archivePager.goToPage(pageIndex, totalPages);
  }

  // Search Management
  getSearchState(): ArchiveSearchState {
    return {
      open: this.searchOpen,
      query: this.searchQuery,
      results: this.searchResults,
      activePageIndex: this.activeSearchPageIndex,
      activePairIndex: this.activeSearchPairIndex,
    };
  }

  toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.pendingSearchJump = null;
    }
    this.onScheduleUiSync();
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.performSearch();
    this.onScheduleUiSync();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.performSearch();
    this.onScheduleUiSync();
  }

  openSearchResult(result: ArchivePageMatch, totalPairs: number): void {
    const pageCount = this.getArchivePageCount(totalPairs);
    if (pageCount <= 0) {
      this.goToRecent();
      this.resetSearchSelection();
      this.onScheduleUiSync();
      return;
    }

    const pageIndex = Math.max(0, Math.min(result.pageIndex, pageCount - 1));
    this.searchOpen = true;
    this.activeSearchPageIndex = pageIndex;
    this.activeSearchPairIndex = result.firstMatchPairIndex;
    this.pendingSearchJump = {
      pageIndex,
      pairIndex: result.firstMatchPairIndex,
      attemptCount: 0,
    };

    this.goToPage(pageIndex, pageCount);
    this.resetForPageChange();
    this.onScheduleUiSync();
  }

  performSearch(): void {
    if (this.searchQuery.length === 0) {
      this.searchResults = [];
      return;
    }

    this.searchResults = this.managedHistory.searchArchivedPages(
      this.searchQuery,
      ARCHIVE_PAGE_PAIR_COUNT,
      this.getHotPairCount(this.managedHistory.getTotalPairs())
    );
  }

  resetSearchState(): void {
    this.searchOpen = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.resetSearchSelection();
  }

  resetSearchSelection(): void {
    this.activeSearchPageIndex = null;
    this.activeSearchPairIndex = null;
    this.pendingSearchJump = null;
  }

  // Pending Operations

    // Archive Group Queries

    getArchivePageCount(totalPairs: number): number {
    return this.managedHistory.getArchivedPageCount(ARCHIVE_PAGE_PAIR_COUNT, this.getHotPairCount(totalPairs));
  }

  resolveArchivePageIndex(totalPairs: number): number | null {
    const pageCount = this.getArchivePageCount(totalPairs);
    if (pageCount <= 0) {
      this.archivePager.goToRecent();
      return null;
    }

    const currentPageIndex = this.archivePager.currentPageIndex;
    if (currentPageIndex == null) {
      return null;
    }

    const normalizedPageIndex = Math.max(0, Math.min(currentPageIndex, pageCount - 1));
    if (normalizedPageIndex !== currentPageIndex) {
      this.archivePager.goToPage(normalizedPageIndex, pageCount);
    }

    return normalizedPageIndex;
  }

  getArchiveGroupsForPage(
    pageIndex: number | null,
    totalPairs: number,
    expandedBatchIds: ReadonlySet<string> = this.expandedBatchIds
  ): ManagedHistoryGroup[] {
    if (pageIndex == null) {
      return [];
    }

    return this.managedHistory.getArchiveGroupsForPage(
      pageIndex,
      ARCHIVE_PAGE_PAIR_COUNT,
      this.getHotPairCount(totalPairs),
      this.getBatchPairCount(),
      this.searchQuery,
      expandedBatchIds
    );
  }

  // Resident Page Indexes

    // UI Sync

}
