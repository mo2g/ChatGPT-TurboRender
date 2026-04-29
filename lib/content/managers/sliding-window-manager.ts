import type { IndexRange, TurnRecord } from '../../shared/types';
import { computeVisibleRangeFromTurnContainer } from '../utils/visible-range';

export interface SlidingWindowManagerOptions {
  win: Window;
  doc: Document;
  turnContainer: HTMLElement | null;
  getRecords: () => Map<string, TurnRecord>;
}

export class SlidingWindowManager {
  private readonly win: Window;
  private readonly doc: Document;
  private turnContainer: HTMLElement | null = null;
  private readonly getRecords: () => Map<string, TurnRecord>;

  constructor(options: SlidingWindowManagerOptions) {
    this.win = options.win;
    this.doc = options.doc;
    this.turnContainer = options.turnContainer;
    this.getRecords = options.getRecords;
  }

  setTurnContainer(container: HTMLElement | null): void {
    this.turnContainer = container;
  }

  /**
   * 计算当前可见范围
   */
  computeVisibleRange(scrollContainer: HTMLElement): IndexRange | null {
    if (this.turnContainer == null) {
      return null;
    }
    return computeVisibleRangeFromTurnContainer(
      this.turnContainer,
      scrollContainer,
      (turnId) => this.getRecords().get(turnId)?.index ?? null,
    );
  }

}
