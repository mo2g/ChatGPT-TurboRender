import { BUILD_SIGNATURE } from '../../shared/constants';
import { getRouteKindFromRuntimeId } from '../../shared/chat-id';
import type {
  Settings,
  TabRuntimeStatus,
} from '../../shared/types';
import type { SlidingWindowRuntimeState } from '../../shared/sliding-window';

export function buildSlidingWindowRuntimeStatus(input: {
  chatId: string;
  settings: Settings;
  paused: boolean;
  state: SlidingWindowRuntimeState | null;
  contentScriptInstanceId: string;
  contentScriptStartedAt: number;
}): TabRuntimeStatus {
  const state = input.state;
  const supported = state != null;
  const active = supported && input.settings.enabled && !input.paused;
  return {
    supported,
    chatId: input.chatId,
    routeKind: getRouteKindFromRuntimeId(input.chatId),
    reason: supported ? state.reason : 'sliding-window-waiting-cache',
    archiveOnly: false,
    active,
    paused: input.paused,
    mode: input.settings.mode,
    softFallback: false,
    initialTrimApplied: false,
    initialTrimmedTurns: 0,
    totalMappingNodes: 0,
    activeBranchLength: 0,
    totalTurns: 0,
    totalPairs: state?.totalPairs ?? 0,
    hotPairsVisible: state?.pairCount ?? input.settings.slidingWindowPairs,
    finalizedTurns: 0,
    handledTurnsTotal: 0,
    historyPanelOpen: false,
    archivePageCount: 0,
    currentArchivePageIndex: null,
    archivedTurnsTotal: 0,
    expandedArchiveGroups: 0,
    historyAnchorMode: 'hidden',
    slotBatchCount: 0,
    collapsedBatchCount: 0,
    expandedBatchCount: 0,
    parkedTurns: 0,
    parkedGroups: 0,
    liveDescendantCount: 0,
    visibleRange: null,
    observedRootKind: 'live-turn-container',
    refreshCount: 0,
    spikeCount: 0,
    lastError: state?.dirty === true ? 'sliding-window-cache-dirty' : null,
    contentScriptInstanceId: input.contentScriptInstanceId,
    contentScriptStartedAt: input.contentScriptStartedAt,
    buildSignature: BUILD_SIGNATURE,
  };
}
