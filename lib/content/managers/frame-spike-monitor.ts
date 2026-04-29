export class FrameSpikeMonitor {
  private readonly thresholdMs: number;
  private readonly windowMs: number;
  private spikes: number[] = [];
  private rafHandle: number | null = null;
  private lastTimestamp = 0;
  private readonly requestAnimationFrameFn: Window['requestAnimationFrame'];
  private readonly cancelAnimationFrameFn: Window['cancelAnimationFrame'];

  constructor(
    private readonly win: Window,
    thresholdMs: number,
    windowMs: number,
  ) {
    this.thresholdMs = thresholdMs;
    this.windowMs = windowMs;
    this.requestAnimationFrameFn =
      win.requestAnimationFrame?.bind(win) ??
      ((callback) => win.setTimeout(() => callback(win.performance.now()), 16));
    this.cancelAnimationFrameFn =
      win.cancelAnimationFrame?.bind(win) ?? ((handle) => win.clearTimeout(handle));
  }

  start(): void {
    if (this.rafHandle != null) {
      return;
    }

    const tick = (timestamp: number) => {
      if (this.lastTimestamp > 0) {
        const delta = timestamp - this.lastTimestamp;
        if (delta >= this.thresholdMs) {
          this.spikes.push(timestamp);
        }
      }
      this.lastTimestamp = timestamp;
      this.trim(timestamp);
      this.rafHandle = this.requestAnimationFrameFn(tick);
    };

    this.rafHandle = this.requestAnimationFrameFn(tick);
  }

  stop(): void {
    if (this.rafHandle != null) {
      this.cancelAnimationFrameFn(this.rafHandle);
      this.rafHandle = null;
    }
  }

  getSpikeCount(now = this.win.performance.now()): number {
    this.trim(now);
    return this.spikes.length;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    this.spikes = this.spikes.filter((timestamp) => timestamp >= cutoff);
  }
}
