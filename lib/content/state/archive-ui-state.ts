import type {
  ArchivePageMeta,
  ManagedHistoryGroup,
} from '../../shared/types';

export interface ArchiveUiState {
  archivePageCount: number;
  currentArchivePageIndex: number | null;
  currentArchivePageMeta: ArchivePageMeta | null;
  isRecentView: boolean;
  archiveGroups: ManagedHistoryGroup[];
  currentPageGroups: ManagedHistoryGroup[];
  collapsedBatchCount: number;
  expandedBatchCount: number;
}

export function resolveResidentArchivePageIndexes(
  archivePageCount: number,
  currentArchivePageIndex: number | null,
): Set<number> {
  const residentPageIndexes = new Set<number>();
  if (archivePageCount <= 0) {
    return residentPageIndexes;
  }

  if (currentArchivePageIndex == null) {
    residentPageIndexes.add(archivePageCount - 1);
    return residentPageIndexes;
  }

  const start = Math.max(0, currentArchivePageIndex - 1);
  const end = Math.min(archivePageCount - 1, currentArchivePageIndex + 1);
  for (let index = start; index <= end; index += 1) {
    residentPageIndexes.add(index);
  }

  return residentPageIndexes;
}
