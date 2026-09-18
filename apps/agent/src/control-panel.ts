import http from "node:http";
import { escapeHtml, openBrowser } from "./pairing-ui.js";

// Local control panel (agent-side): status, recent commands, policy summary,
// recent audit, and an emergency disconnect. Served on 127.0.0.1 only
// (ephemeral port) — this PC's owner console, not a network service.
// Opened automatically right after pairing succeeds, or via --panel.

export interface PanelCommand {
  commandId: string;
  status: string;
  sequence: number;
  at: string;
  errorCode: string | null;
}

export interface PanelSnapshot {
  computerId: string;
  computerName: string;
  startedAt: string;
  connection: string;
  credentialPresent: boolean;
  dryRun: boolean;
  allowedApps: string[];
  clipboardOptIn: boolean;
  allowPowerOps: boolean;
  recentCommands: PanelCommand[];
  recentAudit: Record<string, unknown>[];
}

export interface PanelHooks {
  snapshot: () => Promise<PanelSnapshot> | PanelSnapshot;
  /** Emergency disconnect: wipe local credential + close sockets. */
  onDisconnect: () => Promise<void> | void;
}

/** Bounded newest-first command log for the panel. */
export function createCommandLog(max = 10): {
  push: (c: PanelCommand) => void;
  list: () => PanelCommand[];
} {
  const items: PanelCommand[] = [];
  return {
    push(c) {
      items.unshift(c);
      if (items.length > Math.max(1, max)) items.length = Math.max(1, max);
    },
    list: () => [...items],
  };
}

function row(cells: string[]): string {
  return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

export function renderPanelPage(s: PanelSnapshot): string {
  const cmdRows =
    s.recentCommands.length === 0
      ? `<tr><td colspan="4" class="dim">No commands yet — send one from the phone app.</td></tr>`
      : s.recentCommands
          .map((c) =>
            row([
              escapeHtml(c.commandId.slice(0, 8)),
              escapeHtml(c.status),
              escapeHtml(c.errorCode ?? "—"),
              escapeHtml(c.at),
            ]),
          )
          .join("");
  const auditRows =
    s.recentAudit.length === 0
      ? `<tr><td colspan="3" class="dim">No audit events yet.</td></tr>`
      : s.recentAudit
          .slice(-10)
          .reverse()
          .map((e) =>
            row([
              escapeHtml(String(e.ts ?? "?")),
              escapeHtml(String((e as { name?: unknown }).name ?? (e as { action?: unknown }).action ?? "?")),
              escapeHtml(String((e as { outcome?: unknown }).outcome ?? "?")),
            ]),
          )
          .join("");
  const badge =
    s.connection === "online"
      ? `<span class="pill on">online</span>`
      : `<span class="pill off">${escapeHtml(s.connection)}</span>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>OrbitPC control panel — ${escapeHtml(s.computerName)}</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;color:#111}
.pill{display:inline-block;padding:2px 12px;border-radius:999px;font-weight:600}
.on{background:#e6f4ea}.off{background:#fef7e0}
table{border-collapse:collapse;width:100%;margin:8px 0 20px}td,th{border:1px solid #ddd;padding:6px 8px;font-size:14px;text-align:left}
.dim{color:#777}button{background:#b3261e;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer}
.card{border:1px solid #e0e0e0;border-radius:12px;padding:12px 16px;margin:12px 0}
.mono{font-family:Consolas,monospace;font-size:13px}
</style></head><body>
<h1>OrbitPC control panel</h1>
<div class="card">
<div><b>${escapeHtml(s.computerName)}</b> ${badge}</div>
<div class="mono">computer: ${escapeHtml(s.computerId)}</div>
<div class="dim">started ${escapeHtml(s.startedAt)} · credential ${s.credentialPresent ? "stored" : "MISSING"} · dry-run ${s.dryRun ? "on" : "OFF"}</div>
</div>
<h2>Policy (local, authoritative)</h2>
<div class="card">apps: ${s.allowedApps.length ? escapeHtml(s.allowedApps.join(", ")) : "<span class=dim>none</span>"}
<br>clipboard write: ${s.clipboardOptIn ? "opted in" : "off"} · power ops: ${s.allowPowerOps ? "allowed" : "denied"}</div>
<h2>Recent commands</h2>
<table><tr><th>id</th><th>status</th><th>error</th><th>at</th></tr>${cmdRows}</table>
<h2>Recent activity</h2>
<table><tr><th>time</th><th>event</th><th>outcome</th></tr>${auditRows}</table>
<h2>Emergency</h2>
<div class="card"><form method="POST" action="/api/disconnect" onsubmit="return confirm('Revoke this PC? The phone loses access immediately.');">
<button type="submit">Disconnect / revoke this PC</button></form>
<p class="dim">Wipes the local credential + key and closes all sockets. Re-pair to reconnect.</p></div>
</body></html>`;
}

export async function serveControlPanel(
  hooks: PanelHooks,
  opts: { port?: number; open?: boolean } = {},
): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || "/", "http://x");
      if (url.pathname === "/api/state" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(await hooks.snapshot()));
        return;
      }
      if (url.pathname === "/api/disconnect" && req.method === "POST") {
        // Drain body, then act (no sensitive payload expected).
        await new Promise<void>((resolve) => {
          req.resume();
          req.on("end", () => resolve());
        });
        await hooks.onDisconnect();
        res.writeHead(303, { location: "/" });
        res.end();
        return;
      }
      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderPanelPage(await hooks.snapshot()));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    })().catch(() => {
      try {
        res.writeHead(500);
        res.end();
      } catch {
        // ignore
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
  const url = `http://127.0.0.1:${port}/`;
  if (opts.open !== false) openBrowser(url);
  return { server, url };
}
