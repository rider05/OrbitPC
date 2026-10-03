import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { NEARBY_LAN_DEFAULT_PORT, commandRequestSchema } from "@orbit/protocol";
import { loadConfig } from "./config.js";
import { FileSecureStore } from "./secure-store.js";
import { CommandDispatcher } from "./dispatcher.js";
import { ConnectionManager } from "./connection.js";
import { EnrollmentManager } from "./enrollment.js";
import { AuditWriter } from "./audit.js";
import type { PairingUiState } from "./pairing-ui.js";
import { createIpcServer, PIPE_NAME } from "./ipc.js";
import { collectStatus, getBootId } from "./status.js";

const args = new Set(process.argv.slice(2));

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new FileSecureStore(config.dataDir);
  const audit = new AuditWriter(config.dataDir);
  let secrets = await store.load();
  let computerId = config.computerId || secrets.computerId || randomUUID();
  const httpBase = (process.env.ORBITPC_SERVER_HTTP || "http://localhost:3000").replace(/\/$/, "");
  let effectiveCredentialId: string | null = config.credentialId || secrets.credentialId || null;
  let liveCredential: string | null = secrets.credential ?? null;
  let openPanel = args.has("--panel");
  const startedAt = new Date().toISOString();

  if (args.has("--revoke")) {
    await new EnrollmentManager("", store).revokeLocal();
    console.log("[agent] local credential wiped. Revoke server-side via DELETE /computers/:id too.");
    return;
  }

  if (args.has("--nearby-status")) {
    const { lanAddresses } = await import("./nearby-lan.js");
    console.log(JSON.stringify({
      lanEnabled: config.nearbyLanEnabled,
      port: config.nearbyLanPort,
      host: config.nearbyLanHost,
      addresses: lanAddresses(),
      tlsConfigured: !!(config.nearbyTlsCert && config.nearbyTlsKey),
      requireAuth: config.nearbyRequireAuth,
      mdns: config.nearbyMdns,
      bleEnabled: config.nearbyBleEnabled,
      computerId,
    }, null, 2));
    return;
  }

  if (args.has("--show-lan-token")) {
    const { ensureLanToken } = await import("./nearby-auth.js");
    const { token, created } = await ensureLanToken(store);
    console.log(`[lan-token] ${created ? "created" : "existing"} — enter this in the phone app Settings > Nearby direct (per PC).`);
    console.log(token);
    return;
  }

  if (args.has("--firewall-add")) {
    if (process.platform !== "win32") {
      console.error("[firewall] Windows only (netsh). Open TCP port manually on this OS.");
      process.exitCode = 1;
      return;
    }
    const { execFile } = await import("node:child_process");
    const port = String(config.nearbyLanPort || 11430);
    await new Promise<void>((resolve, reject) => {
      execFile("netsh", ["advfirewall", "firewall", "add", "rule", "name=OrbitPC Nearby", "dir=in", "action=allow", "protocol=TCP", `localport=${port}`], { shell: false }, (err) => (err ? reject(err) : resolve()));
    }).catch((e) => {
      console.error(`[firewall] failed (run as Administrator): ${(e as Error).message}`);
      process.exitCode = 1;
    });
    if (process.exitCode !== 1) console.log(`[firewall] inbound TCP ${port} allowed (LAN only — do not port-forward on your router).`);
    return;
  }

  if (args.has("--pair-demo")) {
    const { demoSession, servePairingPage, qrTerminal } = await import("./pairing-ui.js");
    const state = demoSession();
    const { url } = await servePairingPage(state);
    console.log(`[pair-demo] offline UI preview at ${url} (fake code, nothing to approve)`);
    console.log(await qrTerminal(state.pairingId));
    console.log(`[pair-demo] If no browser opened, paste this URL manually: ${url}`);
    await new Promise(() => {});
    return;
  }

  if (args.has("--pair")) {
    try {
      const done = await runPairingFlow(new EnrollmentManager(httpBase, store), audit);
      effectiveCredentialId = done.credentialId;
      computerId = done.computerId;
      openPanel = true; // paired -> show the control panel, then keep running
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith("device-code failed")) {
        console.error(`[pair] server has no pairing endpoint yet (${msg}). Try --pair-demo for the offline UI preview.`);
      } else {
        console.error(`[pair] ${msg}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  // QR-first: a fresh `start` with no credential shows the pairing QR before
  // doing anything else. After approval the agent continues to connect below
  // and opens the control panel.
  if (!effectiveCredentialId && !secrets.credential && !args.has("--mock-server")) {
    console.log("[agent] no credential — showing pairing QR first. Approve on your phone to continue.");
    try {
      const done = await runPairingFlow(new EnrollmentManager(httpBase, store), audit);
      effectiveCredentialId = done.credentialId;
      computerId = done.computerId;
      openPanel = true;
    } catch (e) {
      console.log(`[agent] pairing unavailable (${(e as Error).message}) — presence only (dry). Run with --pair once server is live, or --mock-server for local E2E.`);
      console.log("[status]", JSON.stringify(await collectStatus()));
      // Stay up until Ctrl+C. Note: a bare never-resolving promise does NOT
      // keep Node's event loop alive on its own — the interval below does.
      const heartbeat = setInterval(() => {
        void collectStatus().then((s) => console.log(`[presence] heartbeat bootId=${s.bootId} uptimeSec=${s.uptimeSec}`));
      }, 30_000);
      const stop = () => {
        clearInterval(heartbeat);
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await new Promise(() => {});
      return;
    }
  }

  const dryRun = process.env.ORBITPC_DRY_RUN !== "0"; // default safe: never lock/sleep dev box
  secrets = await store.load(); // pairing above may have written the keypair after initial load
  const dispatcher = new CommandDispatcher({
    computerId,
    adapterCtx: { allowedApps: config.allowedApps, dryRun },
    clipboardOptIn: config.clipboardOptIn,
    allowPowerOps: config.allowSleepRestartShutdown,
    allowScreenCapture: config.allowScreenCapture,
    allowedApps: config.allowedApps,
    dataDir: config.dataDir,
    audit,
  });

  // IPC: service <-> helper round-trip (single-process dev: server + fake helper echo).
  const ipc = createIpcServer((msg, reply) => {
    reply({ commandId: msg.commandId, nonce: msg.nonce, kind: `${msg.kind}.ack` });
  });
  ipc.listen(PIPE_NAME, () => console.log(`[ipc] listening`));
  ipc.on("error", (e) => console.warn(`[ipc] ${(e as Error).message}`));

  let connection: ConnectionManager | null = null;
  let connStatus = "not-started";

  // Nearby fan-out: LAN sockets register a per-command reply; cloud send stays.
  const lanReplies = new Map<string, Set<(msg: unknown) => void>>();
  const { createCommandLog } = await import("./control-panel.js");
  const { PollTransport } = await import("./poll-transport.js");
  const commandLog = createCommandLog(10);
  let poll: import("./poll-transport.js").PollTransport | null = null;
  const fanOutResult = (res: { commandId: string }) => {
    if (process.env.ORBITPC_VERBOSE) console.log(`[result] ${res.commandId} ${(res as { status?: string }).status}`);
    const full = res as { status?: string; sequence?: number; error?: { code?: string } | null };
    commandLog.push({
      commandId: res.commandId,
      status: full.status ?? "?",
      sequence: full.sequence ?? 0,
      at: new Date().toISOString(),
      errorCode: full.error?.code ?? null,
    });
    connection?.send({ ...res });
    if (poll) void poll.report(res as import("@orbit/protocol").CommandResult);
    const set = lanReplies.get(res.commandId);
    if (set) {
      for (const reply of [...set]) {
        try { reply(res); } catch { /* ignore */ }
      }
      const terminal = ["succeeded", "failed", "rejected", "expired", "cancelled", "timed_out"];
      if (terminal.includes((res as unknown as { status: string }).status)) lanReplies.delete(res.commandId);
    }
  };
  dispatcher.onResult = fanOutResult as typeof dispatcher.onResult;

  async function servePanel(): Promise<void> {
    const { serveControlPanel } = await import("./control-panel.js");
    const { url } = await serveControlPanel({
      snapshot: async () => ({
        computerId,
        computerName: config.computerName,
        startedAt,
        connection: connStatus,
        credentialPresent: !!(effectiveCredentialId || (await store.load()).credential),
        dryRun,
        allowedApps: Object.keys(config.allowedApps),
        clipboardOptIn: config.clipboardOptIn,
        allowPowerOps: config.allowSleepRestartShutdown,
        recentCommands: commandLog.list(),
        recentAudit: await audit.recent(20),
      }),
      onDisconnect: async () => {
        await new EnrollmentManager("", store).revokeLocal();
        effectiveCredentialId = null;
        liveCredential = null;
        connStatus = "offline";
        connection?.stop();
        poll?.stop();
        await audit.write({ actor: "owner", name: "pairing.revoked", outcome: "succeeded", computerId });
        console.log("[panel] emergency disconnect: credential wiped, sockets closed.");
      },
    });
    console.log(`[panel] control panel: ${url}`);
  }

  if (openPanel) {
    await servePanel();
  }

  if (args.has("--mock-server")) {
    await runMockServer(computerId, (raw) => void dispatcher.submit(raw), dispatcher);
    return;
  }

  // (Unpaired fresh starts pair via the QR-first flow above; --mock-server
  // needs no credential.)
  const rawWsUrl = process.env.ORBITPC_SERVER_URL || `${httpBase.replace(/^http/, "ws")}/agent`;
  const wsUrlWithComputer = (() => {
    try {
      const u = new URL(rawWsUrl);
      u.searchParams.set("computerId", computerId);
      return u.toString();
    } catch {
      return rawWsUrl;
    }
  })();
  const streamer = new ((await import("./screen-stream.js")).ScreenStreamer)(
    { computerId, allowedApps: config.allowedApps, dryRun },
    (msg) => connection?.send(msg),
  );
  connection = new ConnectionManager({
    serverUrl: wsUrlWithComputer,
    credentialId: effectiveCredentialId,
    signNonce: (nonce) => {
      const pem = secrets.privateKeyPem;
      if (!pem) return null; // unpaired / stale — bearer-only, dev mode
      try {
        return Buffer.from(EnrollmentManager.signWithPem(pem, nonce));
      } catch {
        return null;
      }
    },
    getAgentToken: () => liveCredential,
    onScreenStart: (msg) => {
      streamer.stop();
      // ScreenStreamer interval is fixed at 500ms/2fps; fps is accepted but
      // clamped later when we add an adaptive quality selector.
      streamer.start();
    },
    onScreenStop: () => streamer.stop(),
    onCommandRequest: (raw) => {
      const parsed = commandRequestSchema.safeParse(raw);
      if (!parsed.success) return; // fail closed
      void dispatcher.submit(parsed.data);
    },
    onStatusChange: (s) => {
      connStatus = s;
      console.log(`[connection] ${s}`);
    },
  });
  connection.start();

  // HTTPS poll relay (serverless-compatible): heartbeat + pending inbox +
  // result posts. Runs whenever this agent holds a credential.
  // Refresh from store: a pairing completed above in this same process.
  liveCredential = (await store.load()).credential ?? liveCredential;
  secrets = await store.load(); // refresh keypair captured before QR-first pairing
  if (effectiveCredentialId || liveCredential) {
    poll = new PollTransport({
      httpBase,
      computerId,
      agentVersion: "0.1.0",
      getCredential: () => liveCredential,
      onCommandRequest: (raw) => {
        const parsed = commandRequestSchema.safeParse(raw);
        if (!parsed.success) return; // fail closed
        void dispatcher.submit(parsed.data);
      },
      onOnlineChange: (online) => console.log(`[poll] ${online ? "online" : "offline"}`),
    });
    poll.start();
  }

  // Nearby direct connect (opt-in, starts on boot alongside cloud).
  // LAN-first phone path + BLE beacon hint. Cloud relay keeps running.
  let stopNearby: (() => void) | null = null;
  if (config.nearbyLanEnabled || config.nearbyBleEnabled) {
    const { startNearbyLan } = await import("./nearby-lan.js");
    if (config.nearbyLanEnabled) {
      try {
        const { ensureLanToken, verifyLanToken } = await import("./nearby-auth.js");
        const { token: lanToken, created } = await ensureLanToken(store);
        if (created) console.log("[nearby-lan] LAN bearer created — run with --show-lan-token to enter it in the phone app.");
        const handle = await startNearbyLan({
          port: config.nearbyLanPort || NEARBY_LAN_DEFAULT_PORT,
          host: config.nearbyLanHost,
          computerId,
          computerName: config.computerName,
          getBootId,
          tlsCertPath: config.nearbyTlsCert,
          tlsKeyPath: config.nearbyTlsKey,
          requireAuth: config.nearbyRequireAuth,
          verifyToken: (presented) => verifyLanToken(presented, lanToken),
          enableMdns: config.nearbyMdns,
          onAudit: (event) => { void audit.write(event); },
          submit: (raw, reply) => {
            const parsed = commandRequestSchema.safeParse(raw);
            if (!parsed.success) return; // fail closed
            const id = parsed.data.commandId;
            if (!lanReplies.has(id)) lanReplies.set(id, new Set());
            lanReplies.get(id)!.add(reply);
            void dispatcher.submit(parsed.data);
          },
        });
        stopNearby = handle.stop;
      } catch (e) {
        console.warn(`[nearby-lan] failed to start: ${(e as Error).message}`);
      }
    }
    if (config.nearbyBleEnabled) {
      try {
        const { startBleAdvertise } = await import("./nearby-ble.js");
        const adv = await startBleAdvertise({ computerId, lanPort: config.nearbyLanPort || NEARBY_LAN_DEFAULT_PORT, bootId: await getBootId() });
        if (adv) {
          const prev = stopNearby;
          stopNearby = () => { try { prev?.(); } catch { /* ignore */ } adv.stop(); };
        }
      } catch (e) {
        console.warn(`[nearby-ble] failed to start: ${(e as Error).message}`);
      }
    }
  }

  console.log(`[agent] started computer=${computerId} dryRun=${dryRun}`);
  console.log("[agent] tray: online state, last command, pairing, policies, emergency --revoke available");

  const shutdown = () => {
    try { streamer.stop(); } catch { /* ignore */ }
    try { stopNearby?.(); } catch { /* ignore */ }
    try { poll?.stop(); } catch { /* ignore */ }
    connection?.stop();
    ipc.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** Shared pairing flow: device-code -> QR page -> poll -> approved. Used by
 *  --pair and by QR-first auto-pairing on fresh `start`. */
async function runPairingFlow(
  enrollment: EnrollmentManager,
  audit: AuditWriter,
): Promise<{ credentialId: string; credential: string; computerId: string }> {
  const session = await enrollment.startDeviceCode(); // throws when server has no pairing endpoint
  const { servePairingPage, qrTerminal } = await import("./pairing-ui.js");
  const state: PairingUiState = { mode: "live", pairingId: session.pairingId, userCode: session.userCode, expiresAt: session.expiresAt, status: "waiting" };
  const { server, url } = await servePairingPage(state);
  console.log(`[pair] code: ${session.userCode}  opened: ${url}`);
  console.log(await qrTerminal(session.pairingId));
  console.log(`[pair] If no browser opened, paste this URL manually: ${url}`);
  console.log("[pair] Scan the QR (pairing ID only) with the signed-in mobile app and approve. Ctrl+C to abort.");
  try {
    if (!session.pollingSecret) {
      throw new Error("server did not return a polling secret — cannot complete pairing.");
    }
    const done = await enrollment.pollUntilApproved(session.pairingId, session.pollingSecret);
    state.status = "approved";
    await audit.write({ actor: "agent", name: "pairing.approved", outcome: "succeeded", computerId: done.computerId });
    console.log(`[pair] approved — computer ${done.computerId}. Credential stored, page shows success.`);
    // Keep the success page up briefly, then close.
    await new Promise((r) => setTimeout(r, 15000));
    return done;
  } finally {
    server.close();
  }
}

/** Local E2E without backend: canned command.request -> dispatcher -> result log. */
async function runMockServer(
  computerId: string,
  submit: (raw: unknown) => void,
  dispatcher: CommandDispatcher,
): Promise<void> {
  const port = Number(process.env.ORBITPC_MOCK_PORT || 4455);
  const wss = new WebSocketServer({ port });
  console.log(`[mock-server] ws://127.0.0.1:${port} computerId=${computerId}`);
  const prevOnResult = dispatcher.onResult;
  dispatcher.onResult = (res) => {
    try {
      prevOnResult(res); // keep fan-out (panel log, LAN replies) alive in mock mode
    } catch {
      // ignore
    }
    console.log(`[mock-result] ${res.status} #${res.sequence} ${JSON.stringify(res.result ?? res.error)}`);
  };

  wss.on("connection", (ws) => {
    for (const cmd of buildSequence()) {
      ws.send(JSON.stringify(cmd));
      submit(cmd);
    }
    ws.on("message", (d) => console.log(`[mock-server] got: ${d.toString().slice(0, 200)}`));
  });

  // mock-status payload for mobile dashboard before live agent exists.
  console.log("[mock-status]", JSON.stringify({ computerId, ...(await collectStatus()) }));

  // Also run the M2a sequence locally even with no WS client connected.
  for (const cmd of buildSequence()) submit(cmd);

  function buildSequence() {
    const now = new Date();
    const mk = (name: string, reqArgs: Record<string, unknown> = {}) => ({
      v: 1,
      type: "command.request",
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      computerId,
      name,
      args: reqArgs,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      requestContext: { mobileSessionId: randomUUID() },
    });
    // M2a sequence per pc-agent-plan §5.
    return [mk("system.getStatus"), mk("system.lock"), mk("app.launch", { appId: "notepad" })];
  }

  await new Promise(() => {});
}

main().catch((e) => {
  console.error("[agent] fatal", e);
  process.exit(1);
});
