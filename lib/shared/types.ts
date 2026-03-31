export type TurnRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';
export type ConversationRouteKind = 'chat' | 'share' | 'home' | 'unknown';

export type ParkingMode = 'hard' | 'soft';
export type TurboRenderMode = 'performance' | 'compatibility';
export type ColdRestoreMode = 'placeholder' | 'readOnly';
export type LanguagePreference = 'auto' | 'en' | 'zh-CN';
export type ManagedHistorySource = 'initial-trim' | 'parked-group';
export type HistoryAnchorMode = 'host-share' | 'safe-top' | 'hidden';
export type ManagedHistoryRenderKind = 'host-snapshot' | 'markdown-text' | 'structured-message';
export type BatchSource = 'initial-trim' | 'parked-dom' | 'mixed';

export interface Settings {
  enabled: boolean;
  autoEnable: boolean;
  language: LanguagePreference;
  mode: TurboRenderMode;
  minFinalizedBlocks: number;
  minDescendants: number;
  keepRecentPairs: number;
  batchPairCount: number;
  initialHotPairs: number;
  liveHotPairs: number;
  keepRecentTurns: number;
  viewportBufferTurns: number;
  groupSize: number;
  initialTrimEnabled: boolean;
  initialHotTurns: number;
  liveHotTurns: number;
  coldRestoreMode: ColdRestoreMode;
  softFallback: boolean;
  frameSpikeThresholdMs: number;
  frameSpikeCount: number;
  frameSpikeWindowMs: number;
}

export interface TurnRecord {
  id: string;
  index: number;
  role: TurnRole;
  isStreaming: boolean;
  parked: boolean;
  node: HTMLElement | null;
}

export interface IndexRange {
  start: number;
  end: number;
}

export interface ParkedGroup {
  id: string;
  mode: ParkingMode;
  startIndex: number;
  endIndex: number;
  turnIds: string[];
  nodes: HTMLElement[];
  parent: HTMLElement;
  anchor: Comment;
  pairStartIndex: number;
  pairEndIndex: number;
  pairCount: number;
}

export interface ParkedGroupSummary {
  id: string;
  mode: ParkingMode;
  startIndex: number;
  endIndex: number;
  count: number;
  pairStartIndex: number;
  pairEndIndex: number;
  pairCount: number;
  matchCount: number;
}

export interface CachedConversationTurn {
  id: string;
  role: TurnRole;
  parts: string[];
  renderKind: ManagedHistoryRenderKind;
  contentType: string | null;
  snapshotHtml: string | null;
  structuredDetails: string | null;
  hiddenFromConversation: boolean;
  createTime: number | null;
}

export interface ManagedHistoryEntry {
  id: string;
  source: ManagedHistorySource;
  role: TurnRole;
  turnIndex: number;
  pairIndex: number;
  turnId: string | null;
  liveTurnId: string | null;
  groupId: string | null;
  parts: string[];
  text: string;
  renderKind: ManagedHistoryRenderKind;
  contentType: string | null;
  snapshotHtml: string | null;
  structuredDetails: string | null;
  hiddenFromConversation: boolean;
}

export interface ManagedHistoryMatch {
  batchId: string;
  source: BatchSource;
  pairStartIndex: number;
  pairEndIndex: number;
  slotPairStartIndex: number;
  slotPairEndIndex: number;
  matchCount: number;
  excerpt: string;
}

export interface ManagedHistoryGroup {
  id: string;
  source: BatchSource;
  pairStartIndex: number;
  pairEndIndex: number;
  slotIndex: number;
  slotPairStartIndex: number;
  slotPairEndIndex: number;
  filledPairCount: number;
  capacity: number;
  turnStartIndex: number;
  turnEndIndex: number;
  pairCount: number;
  collapsed: boolean;
  expanded: boolean;
  entries: ManagedHistoryEntry[];
  userPreview: string;
  assistantPreview: string;
  matchCount: number;
  parkedGroupId: string | null;
}

export interface ResolvedConversationRoute {
  kind: ConversationRouteKind;
  routeId: string | null;
  runtimeId: string;
}

export interface InitialTrimSession {
  chatId: string;
  routeKind: ConversationRouteKind;
  routeId: string | null;
  conversationId: string | null;
  applied: boolean;
  reason: string | null;
  mode: TurboRenderMode;
  totalMappingNodes: number;
  totalVisibleTurns: number;
  activeBranchLength: number;
  hotVisibleTurns: number;
  coldVisibleTurns: number;
  initialHotPairs: number;
  hotPairCount: number;
  archivedPairCount: number;
  initialHotTurns: number;
  hotStartIndex: number;
  hotTurnCount: number;
  archivedTurnCount: number;
  activeNodeId: string | null;
  turns: CachedConversationTurn[];
  coldTurns: CachedConversationTurn[];
  capturedAt: number;
}

export interface TabRuntimeStatus {
  supported: boolean;
  chatId: string;
  routeKind: ConversationRouteKind;
  reason: string | null;
  archiveOnly: boolean;
  active: boolean;
  paused: boolean;
  mode: TurboRenderMode;
  softFallback: boolean;
  initialTrimApplied: boolean;
  initialTrimmedTurns: number;
  totalMappingNodes: number;
  activeBranchLength: number;
  totalTurns: number;
  totalPairs: number;
  hotPairsVisible: number;
  finalizedTurns: number;
  handledTurnsTotal: number;
  historyPanelOpen: boolean;
  archivedTurnsTotal: number;
  expandedArchiveGroups: number;
  historyAnchorMode: HistoryAnchorMode;
  slotBatchCount: number;
  collapsedBatchCount: number;
  expandedBatchCount: number;
  parkedTurns: number;
  parkedGroups: number;
  liveDescendantCount: number;
  visibleRange: IndexRange | null;
  observedRootKind: 'live-turn-container' | 'archive-only-root';
  refreshCount: number;
  spikeCount: number;
  lastError: string | null;
  contentScriptInstanceId: string;
  contentScriptStartedAt: number;
  buildSignature: string;
}

export interface TabStatusResponse {
  settings: Settings;
  paused: boolean;
  runtime: TabRuntimeStatus | null;
  targetTabId: number | null;
  activeTabId: number | null;
  usingWindowFallback: boolean;
  activeTabSupportedHost: boolean;
}

export interface TurnGroupPlan {
  id: string;
  startIndex: number;
  endIndex: number;
  turnIds: string[];
}
