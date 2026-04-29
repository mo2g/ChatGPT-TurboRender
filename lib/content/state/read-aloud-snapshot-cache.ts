import type { ConversationPayload } from '../../shared/conversation-trim';



export interface SnapshotCacheState {
  payloadCache: Map<string, ConversationPayload>;
  primed: Set<string>;
  requests: Map<string, Promise<void>>;
  failures: Map<string, number>;
}

export class ReadAloudSnapshotCache {
  private readonly payloadCache = new Map<string, ConversationPayload>();
  private readonly primed = new Set<string>();
  private readonly requests = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, number>();
  private readonly win: Window;

  constructor(win: Window) {
    this.win = win;
  }

  reset(): void {
    this.payloadCache.clear();
    this.primed.clear();
    this.requests.clear();
    this.failures.clear();
  }

    getState(): SnapshotCacheState {
    return {
      payloadCache: new Map(this.payloadCache),
      primed: new Set(this.primed),
      requests: new Map(this.requests),
      failures: new Map(this.failures),
    };
  }
}
