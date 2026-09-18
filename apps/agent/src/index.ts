import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { commandRequestSchema } from "@orbit/protocol";
import { loadConfig } from "./config.js";
import { FileSecureStore } from "./secure-store.js";
import { CommandDispatcher } from "./dispatcher.js";
import { ConnectionManager } from "./connection.js";
import { EnrollmentManager } from "./enrollment.js";
import { AuditWriter } from "./audit.js";
import { createIpcServer } from "./ipc.js";
import { collectStatus } from "./status.js";

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

  if (args.has("--pair")) {
    const httpBase = (process.env.ORBITPC_SERVER_HTTP || "http://localhost:3000").replace(/\/$/, "");
    const enrollment = new EnrollmentManager(httpBase, store);
    const session = await enrollment.startDeviceCode();
    console.log(`[pair] code: ${session.userCode}  pairingId: ${session.pairingId}  expires: ${session.expiresAt}`);
    console.log(`[pair] QR should encode pairingId only: ${session.pairingId}`);
    console.log("[pair] Approve from the signed-in mobile app, then polling continues (Ctrl+C to abort).");
    return;
  }

  // IPC: service <-> helper round-trip (single-process dev: server + fake helper echo).
  const ipc = createIpcServer((msg, reply) => {
    reply({ commandId: msg.commandId, nonce: msg.nonce, kind: `${msg.kind}.ack` });
  });
  ipc.listen(computeIpcPath(), () => console.log(`[ipc] listening`));
  ipc.on("error", (e) => console.warn(`[ipc] ${(e as Error).message}`));

  dispatcher.onResult = (res) => {
    if (process.env.ORBITPC_VERBOSE) console.log(`[result] ${res.commandId} ${res.status} #${res.sequence}`);
    connection?.send({ ...res });
  };

  let connection: ConnectionManager | null = null;

  if (args.has("--mock-server")) {
    await runMockServer(computerId, (raw) => void dispatcher.submit(raw), dispatcher);
    return;
  }

  if (!config.credentialId && !secrets.credential) {
    console.log("[agent] no credential â€” presence only (dry). Run with --pair once server is live, or --mock-server for local E2E.");
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
  dispatcher.onResult = (res) => connection?.send({ ...res });

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

function computeIpcPath(): string {
  return process.platform === "win32" ? `\\\\.\\pipe\\OrbitPC-agent` : "/tmp/orbitpc-agent.sock";
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
