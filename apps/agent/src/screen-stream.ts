import { captureScreen } from './windows-adapter.js';

// ScreenStreamer — view-only remote desktop (Stage 2): a throttled loop that
// captures frames via the same windows-adapter used by screen.capture, and
// emits them as screen.frame envelopes. Cloud transport (agent WSS -> server
// -> mobile socket.io) for M3; direct LAN unicast can be added later.

export interface ScreenStreamerOptions {
  computerId: string;
  allowedApps: Record<string, string>;
  dryRun: boolean;
  /** Target capture interval (default 2 fps). */
  intervalMs?: number;
}

export class ScreenStreamer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  constructor(
    private opts: ScreenStreamerOptions,
    private emit: (msg: unknown) => void,
  ) {}

  get running(): boolean {
    return !!this.timer;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs ?? 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      const snap = await captureScreen({ allowedApps: this.opts.allowedApps, dryRun: this.opts.dryRun }, 'jpeg');
      const frame = snap.jpegBase64 ?? snap.pngBase64;
      if (!frame) return;
      this.seq += 1;
      this.emit({
        v: 1,
        type: 'screen.frame',
        computerId: this.opts.computerId,
        format: snap.format,
        seq: this.seq,
        capturedAt: snap.capturedAt,
        frameBase64: frame,
      });
    } catch {
      // transient capture failure — skip this tick
    }
  }
}
