import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import { commandRequestSchema } from "@orbit/protocol";

// Opt-in LAN listener for nearby direct connect.
// SECURITY: disabled by default (ORBITPC_NEARBY_LAN=1 to enable). Binds the
// configured port for the local LAN only — never expose via router port
// forwarding. Carries the SAME v1 envelopes as cloud: strict schema parse,
// expiry/freshness + local PolicyEngine recheck happen in the dispatcher.
// TODO(prod): terminate with TLS using the pairing-pinned cert instead of
// plain WS; require the mobile access token per message.

export interface NearbyLanOptions {
  port: number;
  computerId: string;
  computerName: string;
  submit: (raw: unknown, reply: (msg: unknown) => void) => void;
  getBootId: () => Promise<string>;
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

export async function startNearbyLan(opts: NearbyLanOptions): Promise<{ server: Server; wss: WebSocketServer; stop: () => void }> {
  const server = createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/nearby/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, computerId: opts.computerId, computerName: opts.computerName, bootId: await opts.getBootId() }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Unknown LAN endpoint." } }));
  });

  const wss = new WebSocketServer({ server, path: "/nearby" });
  wss.on("connection", (ws: WebSocket) => {
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
      opts.submit(parsed.data, (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, "0.0.0.0", resolve));
  console.log(`[nearby-lan] ws://<lan-ip>:${opts.port}/nearby computer=${opts.computerId} addrs=${lanAddresses().join(",") || "none"}`);
  console.log(`[nearby-lan] mDNS hint: advertise ${opts.computerName} as _orbitpc._tcp:${opts.port} (enable in your mDNS publisher; see docs)`);
  return { server, wss, stop: () => { wss.close(); server.close(); } };
}
