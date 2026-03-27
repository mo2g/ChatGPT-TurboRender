export type TurnRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';

export type ParkingMode = 'hard' | 'soft';
export type TurboRenderMode = 'performance' | 'compatibility';
export type ColdRestoreMode = 'placeholder' | 'readOnly';
export type LanguagePreference = 'auto' | 'en' | 'zh-CN';

export interface Settings {
  enabled: boolean;
  autoEnable: boolean;
  language: LanguagePreference;
  mode: TurboRenderMode;
  minFinalizedBlocks: number;
  minDescendants: number;
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
  placeholder: HTMLElement;
}

export interface ParkedGroupSummary {
  id: string;
  mode: ParkingMode;
  startIndex: number;
  endIndex: number;
  count: number;
}

export interface CachedConversationTurn {
  id: string;
  role: TurnRole;
  parts: string[];
  createTime: number | null;
}

export interface InitialTrimSession {
  chatId: string;
  conversationId: string | null;
  applied: boolean;
  reason: string | null;
  mode: TurboRenderMode;
  totalMappingNodes: number;
  totalVisibleTurns: number;
  activeBranchLength: number;
  hotVisibleTurns: number;
  coldVisibleTurns: number;
  initialHotTurns: number;
  activeNodeId: string | null;
  coldTurns: CachedConversationTurn[];
  capturedAt: number;
}

export interface TabRuntimeStatus {
  supported: boolean;
  chatId: string;
  reason: string | null;
  active: boolean;
  paused: boolean;
  mode: TurboRenderMode;
  softFallback: boolean;
  initialTrimApplied: boolean;
  initialTrimmedTurns: number;
  totalMappingNodes: number;
  activeBranchLength: number;
  totalTurns: number;
  finalizedTurns: number;
  handledTurnsTotal: number;
  historyInspectionActive: boolean;
  parkedTurns: number;
  parkedGroups: number;
  liveDescendantCount: number;
  visibleRange: IndexRange | null;
  spikeCount: number;
  lastError: string | null;
}

export interface TabStatusResponse {
  settings: Settings;
  paused: boolean;
  runtime: TabRuntimeStatus | null;
}

export interface TurnGroupPlan {
  id: string;
  startIndex: number;
  endIndex: number;
  turnIds: string[];
}
