import { getBootId } from "./status.js";
import type { CommandResult } from "@orbit/protocol";

// HTTPS poll transport: the serverless-compatible relay path (works where a
// persistent WSS cannot be held). Loop: heartbeat -> fetch pending
// command.request envelopes -> dispatcher executes -> POST each result.
// The WSS ConnectionManager stays as the low-latency path when available;
// both feed the same dispatcher, which dedups by commandId.

export interface PollTransportOptions {
  httpBase: string;
  computerId: string;
  agentVersion?: string;
  /** Raw device credential (Bearer). Resolved live so rotation applies. */
  getCredential: () => string | null;
  onCommandRequest: (raw: unknown) => void;
  onOnlineChange?: (online: boolean) => void;
  heartbeatMs?: number;
  pollMs?: number;
}

export class PollTransport {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private online = false;

  constructor(private opts: PollTransportOptions) {}

  start(): void {
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private setOnline(v: boolean): void {
    if (v !== this.online) {
      this.online = v;
      try {
        this.opts.onOnlineChange?.(v);
      } catch {
        // ignore
      }
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.round();
      this.setOnline(true);
    } catch {
      this.setOnline(false);
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.tick(), this.opts.pollMs ?? 5000);
    }
  }

  private headers(): Record<string, string> {
    const cred = this.opts.getCredential();
    return {
      "content-type": "application/json",
      ...(cred ? { authorization: `Bearer ${cred}` } : {}),
    };
  }

  private async round(): Promise<void> {
    const { httpBase, computerId } = this.opts;
    const hb = await fetch(`${httpBase}/v1/computers/${computerId}/heartbeat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        bootId: await getBootId(),
        ...(this.opts.agentVersion ? { agentVersion: this.opts.agentVersion } : {}),
      }),
    });
    if (hb.status === 401) throw new Error("unauthorized");
    if (!hb.ok) throw new Error(`heartbeat ${hb.status}`);
    const pend = await fetch(`${httpBase}/v1/computers/${computerId}/pending`, { headers: this.headers() });
    if (pend.status === 401) throw new Error("unauthorized");
    if (!pend.ok) throw new Error(`pending ${pend.status}`);
    const data = (await pend.json()) as { commands?: unknown[] };
    for (const cmd of data.commands ?? []) {
      this.opts.onCommandRequest(cmd);
    }
  }

  /** POST one dispatcher result (fire-and-forget with one retry). */
  async report(res: CommandResult): Promise<void> {
    const { httpBase } = this.opts;
    const body = JSON.stringify({
      status: res.status,
      sequence: res.sequence,
      result: res.result,
      error: res.error,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`${httpBase}/v1/commands/${res.commandId}/result`, {
          method: "POST",
          headers: this.headers(),
          body,
        });
        if (r.ok || r.status === 404) return;
      } catch {
        // retry once
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
