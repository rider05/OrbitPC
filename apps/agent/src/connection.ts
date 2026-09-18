import WebSocket from "ws";
import { randomBytes } from "node:crypto";
import { getBootId } from "./status.js";

// ConnectionManager: outbound WSS lifecycle, token renewal without queue drop,
// heartbeat 20-30s, offline after ~75s, backoff 1s -> 60s cap with jitter.

export interface ConnectionOptions {
  serverUrl: string;
  credentialId: string | null;
  signNonce: (nonce: Buffer) => Buffer | null;
  getAgentToken?: () => string | null;
  onCommandRequest: (raw: unknown) => void;
  onStatusChange: (s: "connecting" | "online" | "offline") => void;
  heartbeatMs?: number;
}

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private closed = false;
  private backoffMs = 1000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastPong = 0;

  constructor(private opts: ConnectionOptions) {}

  start(): void {
    this.closed = false;
    void this.connectLoop();
  }

  stop(): void {
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(obj: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private async connectLoop(): Promise<void> {
    while (!this.closed) {
      try {
        this.opts.onStatusChange("connecting");
        await this.connectOnce();
        this.backoffMs = 1000; // reset after stable path; reconnects re-enter loop
        return;
      } catch {
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, Math.min(this.backoffMs, 60_000) + jitter));
        this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
      }
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const nonce = randomBytes(32);
      const proof = this.opts.signNonce(nonce);
      const headers: Record<string, string> = {};
      if (this.opts.credentialId) headers["x-credential-id"] = this.opts.credentialId;
      if (proof) headers["x-nonce-proof"] = proof.toString("base64");
      headers["x-nonce"] = nonce.toString("base64");
      const token = this.opts.getAgentToken?.();
      if (token) headers["authorization"] = `Bearer ${token}`;

      const ws = new WebSocket(this.opts.serverUrl, { headers });
      let settled = false;
      const fail = (e: unknown) => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            // ignore
          }
          reject(e instanceof Error ? e : new Error("connect failed"));
        }
      };
      ws.on("error", fail);
      ws.on("open", () => {
        settled = true;
        this.ws = ws;
        this.lastPong = Date.now();
        this.opts.onStatusChange("online");
        this.startHeartbeat();
        resolve();
      });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === "pong") {
            this.lastPong = Date.now();
            return;
          }
          if (msg.type === "command.request") {
            this.opts.onCommandRequest(msg);
            return;
          }
          if (msg.type === "revoked") {
            this.stop();
            return;
          }
        } catch {
          // ignore malformed (fail closed — never execute)
        }
      });
      ws.on("pong", () => {
        this.lastPong = Date.now();
      });
      ws.on("close", () => {
        this.opts.onStatusChange("offline");
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.ws = null;
        if (!this.closed) void this.connectLoop();
      });
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const ms = this.opts.heartbeatMs ?? 25_000;
    this.heartbeatTimer = setInterval(async () => {
      if (Date.now() - this.lastPong > 75_000) {
        this.ws?.terminate();
        return;
      }
      try {
        this.send({ type: "presence.heartbeat", bootId: await getBootId(), at: new Date().toISOString() });
        this.ws?.ping();
      } catch {
        // ignore
      }
    }, ms);
  }
}
