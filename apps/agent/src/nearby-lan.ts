import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import fs from "node:fs/promises";
import { WebSocketServer, type WebSocket } from "ws";
import {
  COMMAND_CATALOG,
  NEARBY_MDNS_SERVICE_TYPE,
  commandRequestSchema,
  errorResult,
  type CommandName,
} from "@orbit/protocol";
import { extractBearerToken, verifyLanToken } from "./nearby-auth.js";

// Opt-in LAN listener for nearby direct connect.
// SECURITY: disabled by default (ORBITPC_NEARBY_LAN=1 to enable). Binds the
// configured port for the local LAN only — never expose via router port
// forwarding. Carries the SAME v1 envelopes as cloud: strict schema parse,
// expiry/freshness + local PolicyEngine recheck happen in the dispatcher.
//
// Upgrades over the scaffold:
// - Optional TLS (ORBITPC_NEARBY_TLS_CERT/KEY): serves wss:// with a cert the
//   phone pins at pairing time. Without it, plain ws:// with a startup warning.
// - Optional token gate (ORBITPC_NEARBY_REQUIRE_AUTH=1): every WS message must
//   carry the LAN bearer (Authorization header or ?token=). Without it the
//   socket gets a terminal AUTH_REQUIRED result and is closed. Health stays
//   open (presence only: ids + boot, never secrets).
// - Per-IP sliding-window quotas mirrored from COMMAND_CATALOG (server parity).
// - mDNS publish of `_orbitpc._tcp` via bonjour-service when installed;
//   otherwise logs the record the user can publish manually.

export interface NearbyLanOptions {
  port: number;
  host?: string;
  computerId: string;
  computerName: string;
  submit: (raw: unknown, reply: (msg: unknown) => void) => void;
  getBootId: () => Promise<string>;
  /** PEM cert/key paths. Both set => wss://, else ws:// + warning. */
  tlsCertPath?: string | null;
  tlsKeyPath?: string | null;
  /** Fail closed without a valid LAN bearer. Default false (warn) for compat. */
  requireAuth?: boolean;
  verifyToken?: (presented: string | null) => boolean;
  /** Publish mDNS record. Default true (best-effort, warns when unavailable). */
  enableMdns?: boolean;
  onAudit?: (event: Record<string, unknown>) => void;
}

export interface NearbyLanHandle {
  server: Server;
  wss: WebSocketServer;
  url: string;
  usingTls: boolean;
  mdnsPublished: boolean;
  stop: () => void;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const nics of Object.values(networkInterfaces())) {
    for (const nic of nics ?? []) {
      if (nic.family === "IPv4" && !nic.internal) out.push(nic.address);
    }
  }
  return out;
}

/** Sliding-window quota tracker keyed by `${ip}:${command}` (server parity). */
export class LanRateLimiter {
  private hits = new Map<string, number[]>();

  /** True when allowed (and recorded); false when the quota is exhausted. */
  check(ip: string, name: CommandName, now: number = Date.now()): boolean {
    const quota = COMMAND_CATALOG[name]?.quota;
    if (!quota) return false; // unknown command — deny
    const key = `${ip}:${name}`;
    const windowStart = now - quota.windowSec * 1000;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (kept.length >= quota.limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }
}

async function loadTls(opts: NearbyLanOptions): Promise<{ cert: Buffer; key: Buffer } | null> {
  if (!opts.tlsCertPath || !opts.tlsKeyPath) return null;
  const [cert, key] = await Promise.all([fs.readFile(opts.tlsCertPath), fs.readFile(opts.tlsKeyPath)]);
  return { cert, key };
}

export async function startNearbyLan(opts: NearbyLanOptions): Promise<NearbyLanHandle> {
  const tls = await loadTls(opts).catch((e) => {
    throw new Error(`TLS cert/key unreadable: ${(e as Error).message}`);
  });
  const usingTls = tls !== null;
  if (!usingTls) {
    console.warn("[nearby-lan] plain ws:// (no TLS) — trusted-LAN only. Set ORBITPC_NEARBY_TLS_CERT/KEY for wss://.");
  }
  const requireAuth = opts.requireAuth === true;
  if (!requireAuth) {
    console.warn("[nearby-lan] auth optional — any LAN device can submit. Set ORBITPC_NEARBY_REQUIRE_AUTH=1 to enforce the LAN bearer.");
  }

  const limiter = new LanRateLimiter();
  const handler = async (req: { url?: string }, res: { writeHead: (c: number, h: Record<string, string>) => void; end: (b: string) => void }) => {
    if (req.url === "/health" || req.url === "/nearby/health" || req.url?.startsWith("/nearby/health?")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          computerId: opts.computerId,
          computerName: opts.computerName,
          bootId: await opts.getBootId(),
          tls: usingTls,
          auth: requireAuth ? "required" : "optional",
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Unknown LAN endpoint." } }));
  };

  const server: Server = usingTls
    ? createHttpsServer({ cert: tls!.cert, key: tls!.key }, handler as never)
    : createServer(handler as never);

  const wss = new WebSocketServer({ server, path: "/nearby" });
  wss.on("connection", (ws: WebSocket, req: { socket?: { remoteAddress?: string }; headers?: Record<string, string | string[] | undefined>; url?: string }) => {
    const ip = req.socket?.remoteAddress ?? "unknown";
    let authed = !requireAuth;
    if (requireAuth && opts.verifyToken) {
      authed = verifyLanTokenDirect(req, opts.verifyToken);
      if (!authed) {
        try {
          ws.send(JSON.stringify(errorResult("pending-auth", 0, "AUTH_REQUIRED", "LAN bearer required. Enter the PC token in app Settings.")));
        } catch { /* ignore */ }
        ws.close(4401, "AUTH_REQUIRED");
        opts.onAudit?.({ actor: "agent", name: "nearby.auth_rejected", outcome: "rejected", route: "lan", ip });
        return;
      }
    }
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return; // fail closed — never execute malformed
      }
      const parsed = commandRequestSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.computerId !== opts.computerId) return;
      if (!limiter.check(ip, parsed.data.name)) {
        try {
          ws.send(JSON.stringify(errorResult(parsed.data.commandId, 0, "RATE_LIMITED", "Too many requests for this command.")));
        } catch { /* ignore */ }
        return;
      }
      opts.onAudit?.({ actor: "agent", commandId: parsed.data.commandId, name: parsed.data.name, outcome: "received", route: "lan", ip });
      opts.submit(parsed.data, (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      });
    });
  });

  const host = opts.host || "0.0.0.0";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => resolve());
  });
  const scheme = usingTls ? "wss" : "ws";
  const url = `${scheme}://<lan-ip>:${opts.port}/nearby`;
  console.log(`[nearby-lan] ${url} computer=${opts.computerId} addrs=${lanAddresses().join(",") || "none"}`);

  // mDNS publish (best-effort; pure-JS dep, no native builds).
  let mdnsPublished = false;
  if (opts.enableMdns !== false) {
    try {
      const { Bonjour } = (await import("bonjour-service")) as typeof import("bonjour-service");
      const bonjour = new Bonjour();
      const service = bonjour.publish({
        name: `OrbitPC ${opts.computerName}`,
        type: NEARBY_MDNS_SERVICE_TYPE.replace(/^_/, "").replace(/\._tcp$/, ""),
        port: opts.port,
        txt: { computer: opts.computerId, tls: usingTls ? "1" : "0", auth: requireAuth ? "1" : "0" },
      });
      service.on("up", () => console.log(`[nearby-lan] mDNS up: ${NEARBY_MDNS_SERVICE_TYPE} :${opts.port}`));
      service.on("error", (e: unknown) => console.warn(`[nearby-lan] mDNS error: ${(e as Error).message}`));
      mdnsPublished = true;
      const prevStop = () => { wss.close(); server.close(); };
      return {
        server, wss, url, usingTls, mdnsPublished,
        stop: () => { try { service.stop(() => bonjour.destroy()); } catch { /* ignore */ } prevStop(); },
      };
    } catch {
      console.warn("[nearby-lan] bonjour-service not installed — phones use remembered IP. `pnpm add bonjour-service` in apps/agent to enable mDNS.");
    }
  }
  return { server, wss, url, usingTls, mdnsPublished, stop: () => { wss.close(); server.close(); } };
}

function verifyLanTokenDirect(
  req: { headers?: Record<string, string | string[] | undefined>; url?: string },
  verify: (presented: string | null) => boolean,
): boolean {
  return verify(extractBearerToken(req));
}
