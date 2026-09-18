import http from "node:http";
import { execFile } from "node:child_process";
import QRCode from "qrcode";
import type { PairingSession } from "./enrollment.js";

// Pairing GUI (agent-side): the PC SHOWS the QR, the signed-in phone SCANS it.
// QR payload rule (docs/architecture.md): encode the pairingId ONLY — never the
// polling secret, credential, or private key.
//
// Modes:
// - live: session came from POST /v1/pairing-sessions/device-code; page polls
//   GET .../status via the agent (secret never leaves this process) and flips
//   to success when the mobile app approves.
// - demo (--pair-demo): offline; renders the same page with a fake session so
//   the UI is reviewable before server pairing endpoints land (server M0 has
//   health only as of now).

export interface PairingUiState {
  mode: "live" | "demo";
  pairingId: string;
  userCode: string;
  expiresAt: string;
  status: "waiting" | "approved" | "expired";
}

export function qrPayload(session: Pick<PairingSession, "pairingId">): string {
  return session.pairingId; // pairingId only — see rule above
}

export function secondsLeft(expiresAt: string, nowMs = Date.now()): number {
  return Math.max(0, Math.round((Date.parse(expiresAt) - nowMs) / 1000));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function qrDataUrl(pairingId: string): Promise<string> {
  return QRCode.toDataURL(qrPayload({ pairingId }), { width: 280, margin: 2 });
}

export function renderPairingPage(state: PairingUiState, qrImg: string): string {
  const left = secondsLeft(state.expiresAt);
  const statusLine =
    state.status === "approved"
      ? `<p class="ok">Approved — this PC is paired. You can close this window.</p>`
      : state.status === "expired" || left <= 0
        ? `<p class="bad">Code expired. Close and run pair again for a fresh code.</p>`
        : `<p class="wait" id="status">Waiting for approval in the mobile app… (<span id="count">${left}</span>s left)</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair this PC — OrbitPC</title>
<style>
body{font-family:Segoe UI,system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#111}
.code{font-size:44px;letter-spacing:6px;font-weight:700;text-align:center;margin:8px 0}
img.qr{display:block;margin:16px auto;border:1px solid #ddd;padding:8px;border-radius:8px}
.ok{background:#e6f4ea;padding:12px;border-radius:8px}.bad{background:#fce8e6;padding:12px;border-radius:8px}
.wait{background:#fef7e0;padding:12px;border-radius:8px}.hint{color:#555;font-size:14px}
</style></head><body>
<h1>Pair this PC</h1>
<p>On your signed-in phone, scan this code (or enter it manually), check the PC name, and approve.</p>
<img class="qr" src="${qrImg}" alt="pairing QR" width="280" height="280">
<div class="code">${escapeHtml(state.userCode)}</div>
${statusLine}
<p class="hint">Expires in <span id="count2">${left}</span>s. The QR contains an ID only — no secrets. No password is ever typed on this PC.</p>
<script>
const expiresAt=${JSON.stringify(state.expiresAt)};
function tick(){
  const left=Math.max(0,Math.round((Date.parse(expiresAt)-Date.now())/1000));
  for(const id of ["count","count2"]){const el=document.getElementById(id);if(el)el.textContent=left;}
  if(left<=0)location.reload();
}
setInterval(tick,1000);
async function poll(){
  try{
    const r=await fetch("/api/status");const s=await r.json();
    if(s.status==="approved")location.reload();
  }catch{}
  setTimeout(poll,${state.mode === "demo" ? "30000" : "2500"});
}
poll();
</script></body></html>`;
}

/** Serve the pairing page on 127.0.0.1 and open the default browser. Returns the server (caller closes it). */
export async function servePairingPage(
  state: PairingUiState,
  opts: { port?: number } = {},
): Promise<{ server: http.Server; url: string }> {
  const qrImg = await qrDataUrl(state.pairingId);
  const server = http.createServer((req, res) => {
    if (req.url === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: state.status, secondsLeft: secondsLeft(state.expiresAt) }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderPairingPage(state, qrImg));
  });
  const port = opts.port ?? 0;
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://127.0.0.1:${actual}/`;
  openBrowser(url);
  return { server, url };
}

export function openBrowser(url: string): void {
  if (process.env.ORBITPC_NO_BROWSER === "1") {
    console.log(`[pair] browser open suppressed (ORBITPC_NO_BROWSER=1): ${url}`);
    return;
  }
  const plat = process.platform;
  try {
    if (plat === "win32") execFile("cmd", ["/c", "start", "", url]);
    else if (plat === "darwin") execFile("open", [url]);
    else execFile("xdg-open", [url]);
  } catch {
    console.log(`[pair] open this URL in a browser: ${url}`);
  }
}

/** Demo session for --pair-demo (offline UI review; clearly fake, unusable as credential). */
export function demoSession(): PairingUiState {
  return {
    mode: "demo",
    pairingId: "00000000-0000-4000-8000-000000000000",
    userCode: "DEMO-0000",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    status: "waiting",
  };
}
