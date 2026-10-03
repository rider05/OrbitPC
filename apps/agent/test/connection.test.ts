import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { ConnectionManager } from "../src/connection.js";

// Integration test for the WSS ConnectionManager against a stand-in relay.
// Covers: outbound connect, presence.heartbeat exchange, command.request,
// screen.start / screen.stop routing, revoked -> client closes.

describe("ConnectionManager WSS integration", () => {
  it("connects, heartbeats, handles command.request and screen.*, and revoked closes", async () => {
    const seen = { heartbeats: 0, commands: [] as string[], screenStart: 0, screenStop: 0 };
    const wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as { port: number }).port;
    wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === "presence.heartbeat") {
            seen.heartbeats++;
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch { /* ignore */ }
      });
      setTimeout(() => {
        ws.send(JSON.stringify({ type: "command.request", name: "system.getStatus" }));
        ws.send(JSON.stringify({ type: "screen.start", fps: 2 }));
        ws.send(JSON.stringify({ type: "screen.stop" }));
        ws.send(JSON.stringify({ type: "revoked" }));
      }, 200);
    });

    const commander = randomUUID();
    let statusChanges: string[] = [];
    const mgr = new ConnectionManager({
      serverUrl: `ws://127.0.0.1:${port}`,
      credentialId: null,
      signNonce: () => null,
      onCommandRequest: (raw) => {
        const msg = raw as { name?: string };
        if (msg?.name) seen.commands.push(msg.name);
      },
      onStatusChange: (s) => { statusChanges.push(s); },
      heartbeatMs: 100,
      onScreenStart: () => { seen.screenStart++; },
      onScreenStop: () => { seen.screenStop++; },
    });
    mgr.start();

    // Give it time to connect + receive the injected messages.
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(seen.heartbeats >= 1, "heartbeat sent");
    assert.deepEqual(seen.commands, ["system.getStatus"]);
    assert.equal(seen.screenStart, 1);
    assert.equal(seen.screenStop, 1);
    assert.ok(statusChanges.includes("online"));
    assert.ok(statusChanges.includes("offline"), "revoked close should mark offline");
    wss.close();
  });
});
