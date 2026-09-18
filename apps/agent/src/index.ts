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
  const secrets = await store.load();
  const computerId = config.computerId || secrets.computerId || randomUUID();

  const dryRun = process.env.ORBITPC_DRY_RUN !== "0"; // default safe: never lock/sleep dev box
  const dispatcher = new CommandDispatcher({
    computerId,
    adapterCtx: { allowedApps: config.allowedApps, dryRun },
    clipboardOptIn: config.clipboardOptIn,
    allowPowerOps: config.allowSleepRestartShutdown,
    allowedApps: config.allowedApps,
    dataDir: config.dataDir,
    audit,
  });

  if (args.has("--revoke")) {
    await new EnrollmentManager("", store).revokeLocal();
    console.log("[agent] local credential wiped. Revoke server-side via DELETE /computers/:id too.");
    return;
  }

  if (args.has("--pair-demo")) {
    const { demoSession, servePairingPage } = await import("./pairing-ui.js");
    const state = demoSession();
    const { url } = await servePairingPage(state);
    console.log(`[pair-demo] offline UI preview at ${url} (fake code, nothing to approve)`);
    await new Promise(() => {});
    return;
  }

  if (args.has("--pair")) {
    const httpBase = (process.env.ORBITPC_SERVER_HTTP || "http://localhost:3000").replace(/\/$/, "");
    const enrollment = new EnrollmentManager(httpBase, store);
    let session;
    try {
      session = await enrollment.startDeviceCode();
    } catch (e) {
      console.error(`[pair] server has no pairing endpoint yet (${(e as Error).message}). Try --pair-demo for the offline UI preview.`);
      process.exitCode = 1;
      return;
    }
    const { servePairingPage } = await import("./pairing-ui.js");
    const state: PairingUiState = { mode: "live", pairingId: session.pairingId, userCode: session.userCode, expiresAt: session.expiresAt, status: "waiting" };
    const { server, url } = await servePairingPage(state);
    console.log(`[pair] code: ${session.userCode}  opened: ${url}`);
    console.log("[pair] Scan the QR (pairing ID only) with the signed-in mobile app and approve. Ctrl+C to abort.");
    try {
      if (!session.pollingSecret) {
        console.error("[pair] server did not return a polling secret — cannot complete pairing.");
        process.exitCode = 1;
        return;
      }
      const done = await enrollment.pollUntilApproved(session.pairingId, session.pollingSecret);
      state.status = "approved";
      await audit.write({ actor: "agent", name: "pairing.approved", outcome: "succeeded", computerId: done.computerId });
      console.log(`[pair] approved — computer ${done.computerId}. Credential stored, page shows success.`);
      // Keep the success page up briefly, then close.
      await new Promise((r) => setTimeout(r, 15000));
    } catch (e) {
      console.error(`[pair] ${(e as Error).message}`);
      process.exitCode = 1;
    } finally {
      server.close();
    }
    return;
  }

  // IPC: service <-> helper round-trip (single-process dev: server + fake helper echo).
  const ipc = createIpcServer((msg, reply) => {
    reply({ commandId: msg.commandId, nonce: msg.nonce, kind: `${msg.kind}.ack` });
  });
  ipc.listen(PIPE_NAME, () => console.log(`[ipc] listening`));
  ipc.on("error", (e) => console.warn(`[ipc] ${(e as Error).message}`));

  let connection: ConnectionManager | null = null;

  // Nearby fan-out: LAN sockets register a per-command reply; cloud send stays.
  const lanReplies = new Map<string, Set<(msg: unknown) => void>>();
  const fanOutResult = (res: { commandId: string }) => {
    if (process.env.ORBITPC_VERBOSE) console.log(`[result] ${res.commandId} ${(res as { status?: string }).status}`);
    connection?.send({ ...res });
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

  if (args.has("--mock-server")) {
    await runMockServer(computerId, (raw) => void dispatcher.submit(raw), dispatcher);
    return;
  }

  if (!config.credentialId && !secrets.credential) {
    console.log("[agent] no credential — presence only (dry). Run with --pair once server is live, or --mock-server for local E2E.");
    // Presence-only: still prove status collection + dispatcher locally.
    console.log("[status]", JSON.stringify(await collectStatus()));
    // Keep alive for tray/IPC demo.
    await new Promise(() => {});
    return;
  }

  connection = new ConnectionManager({
    serverUrl: config.serverUrl,
    credentialId: config.credentialId,
    signNonce: () => null, // wired to Ed25519 key once enrolled
    onCommandRequest: (raw) => {
      const parsed = commandRequestSchema.safeParse(raw);
      if (!parsed.success) return; // fail closed
      void dispatcher.submit(parsed.data);
    },
    onStatusChange: (s) => console.log(`[connection] ${s}`),
  });
  connection.start();

  // Nearby direct connect (opt-in, starts on boot alongside cloud).
  // LAN-first phone path + BLE beacon hint. Cloud relay keeps running.
  if (config.nearbyLanEnabled || config.nearbyBleEnabled) {
    const { startNearbyLan } = await import("./nearby-lan.js");
    if (config.nearbyLanEnabled) {
      try {
        await startNearbyLan({
          port: config.nearbyLanPort || NEARBY_LAN_DEFAULT_PORT,
          computerId,
          computerName: config.computerName,
          getBootId,
          submit: (raw, reply) => {
            const parsed = commandRequestSchema.safeParse(raw);
            if (!parsed.success) return; // fail closed
            const id = parsed.data.commandId;
            if (!lanReplies.has(id)) lanReplies.set(id, new Set());
            lanReplies.get(id)!.add(reply);
            void dispatcher.submit(parsed.data);
          },
        });
      } catch (e) {
        console.warn(`[nearby-lan] failed to start: ${(e as Error).message}`);
      }
    }
    if (config.nearbyBleEnabled) {
      try {
        const { startBleAdvertise } = await import("./nearby-ble.js");
        await startBleAdvertise({ computerId, lanPort: config.nearbyLanPort || NEARBY_LAN_DEFAULT_PORT, bootId: await getBootId() });
      } catch (e) {
        console.warn(`[nearby-ble] failed to start: ${(e as Error).message}`);
      }
    }
  }

  console.log(`[agent] started computer=${computerId} dryRun=${dryRun}`);
  console.log("[agent] tray: online state, last command, pairing, policies, emergency --revoke available");

  const shutdown = () => {
    connection?.stop();
    ipc.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
  dispatcher.onResult = (res) => console.log(`[mock-result] ${res.status} #${res.sequence} ${JSON.stringify(res.result ?? res.error)}`);

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
