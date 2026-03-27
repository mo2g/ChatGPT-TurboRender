export type TurnRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';

export type ParkingMode = 'hard' | 'soft';

export interface Settings {
  enabled: boolean;
  autoEnable: boolean;
  minFinalizedBlocks: number;
  minDescendants: number;
  keepRecentTurns: number;
  viewportBufferTurns: number;
  groupSize: number;
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

export interface TabRuntimeStatus {
  supported: boolean;
  chatId: string;
  reason: string | null;
  active: boolean;
  paused: boolean;
  softFallback: boolean;
  totalTurns: number;
  finalizedTurns: number;
  parkedTurns: number;
  parkedGroups: number;
  descendantCount: number;
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
