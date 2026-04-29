
export interface ViewportManagerOptions {
  win: Window;
  doc: Document;
  onScrollRefresh: () => void;
  getPaused: () => boolean;
}

export class ViewportManager {

  private scrollTarget: HTMLElement | null = null;


  constructor(options: ViewportManagerOptions) {
  }

  // Cleanup

  // Scroll Target Management

  getScrollTarget(): HTMLElement | null {
    return this.scrollTarget;
  }

  // Ignore Scroll
  setIgnoreScroll(durationMs: number): void {
  }

}
