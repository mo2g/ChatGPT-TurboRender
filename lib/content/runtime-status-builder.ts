import { BUILD_SIGNATURE } from '../shared/constants';
import { getRouteKindFromRuntimeId } from '../shared/chat-id';
import type {
  IndexRange,
  InitialTrimSession,
  TabRuntimeStatus,
  TurboRenderMode,
} from '../shared/types';
import type { ArchiveUiState } from './archive-ui-state';

export function buildRuntimeStatus(input: {
  supported: boolean;
  reason: string | null;
  totalTurns: number;
  totalPairs: number;
  finalizedTurns: number;
  liveDescendantCount: number;
  visibleRange: IndexRange | null;
  hotPairCount: number;
  handledTurnsTotal: number;
  archivedTurnsTotal: number;
  active: boolean;
  paused: boolean;
  mode: TurboRenderMode;
  softFallback: boolean;
  initialTrimSession: InitialTrimSession | null;
  chatId: string;
  observedRootKind: 'live-turn-container' | 'archive-only-root';
  refreshCount: number;
  spikeCount: number;
  lastError: string | null;
  contentScriptInstanceId: string;
  contentScriptStartedAt: number;
  parkedTurns: number;
  parkedGroups: number;
  residentParkedGroups: number;
  serializedParkedGroups: number;
  archiveState: ArchiveUiState;
}): TabRuntimeStatus {
  return {
    supported: input.supported,
    chatId: input.chatId,
    routeKind: getRouteKindFromRuntimeId(input.chatId),
    reason: input.reason,
    archiveOnly: !input.supported && input.totalTurns > 0,
    active: input.active,
    paused: input.paused,
    mode: input.mode,
    softFallback: input.softFallback,
    initialTrimApplied: input.initialTrimSession?.applied ?? false,
    initialTrimmedTurns: input.initialTrimSession?.coldVisibleTurns ?? 0,
    totalMappingNodes: input.initialTrimSession?.totalMappingNodes ?? 0,
    activeBranchLength: input.initialTrimSession?.activeBranchLength ?? 0,
    totalTurns: input.totalTurns,
    totalPairs: input.totalPairs,
    hotPairsVisible: input.hotPairCount,
    finalizedTurns: input.finalizedTurns,
    handledTurnsTotal: input.handledTurnsTotal,
    historyPanelOpen: false,
    archivePageCount: input.archiveState.archivePageCount,
    currentArchivePageIndex: input.archiveState.currentArchivePageIndex,
    archivedTurnsTotal: input.archivedTurnsTotal,
    expandedArchiveGroups: input.archiveState.currentPageGroups.filter((group) => group.expanded).length,
    historyAnchorMode: 'hidden',
    slotBatchCount: input.archiveState.currentPageGroups.length,
    collapsedBatchCount: input.archiveState.currentPageGroups.filter((group) => !group.expanded).length,
    expandedBatchCount: input.archiveState.currentPageGroups.filter((group) => group.expanded).length,
    parkedTurns: input.parkedTurns,
    parkedGroups: input.parkedGroups,
    residentParkedGroups: input.residentParkedGroups,
    serializedParkedGroups: input.serializedParkedGroups,
    liveDescendantCount: input.liveDescendantCount,
    visibleRange: input.visibleRange,
    observedRootKind: input.observedRootKind,
    refreshCount: input.refreshCount,
    spikeCount: input.spikeCount,
    lastError: input.lastError,
    contentScriptInstanceId: input.contentScriptInstanceId,
    contentScriptStartedAt: input.contentScriptStartedAt,
    buildSignature: BUILD_SIGNATURE,
  };
}
