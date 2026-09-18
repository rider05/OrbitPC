import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PollTransport } from "../src/poll-transport.js";
import { CommandDispatcher } from "../src/dispatcher.js";
import { AuditWriter } from "../src/audit.js";
import { commandRequestSchema } from "@orbit/protocol";

function envelope(computerId: string, name: string, args: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    v: 1 as const,
    type: "command.request" as const,
    commandId: randomUUID(),
    idempotencyKey: randomUUID(),
    computerId,
    name,
    args,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    requestContext: { mobileSessionId: randomUUID() },
  };
}

describe("PollTransport", () => {
  it("heartbeats, picks up pending, posts results", async () => {
    const computerId = randomUUID();
    const inbox = [envelope(computerId, "system.getStatus")];
    const seen = { heartbeats: 0, results: [] as unknown[] };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://x");
      if (req.method === "POST" && url.pathname.endsWith("/heartbeat")) {
        if (req.headers.authorization !== "Bearer cred-123") {
          res.writeHead(401);
          res.end();
          return;
        }
        seen.heartbeats++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (req.method === "GET" && url.pathname.endsWith("/pending")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ commands: inbox.splice(0) }));
        return;
      }
      const m = url.pathname.match(/\/commands\/(.+)\/result$/);
      if (req.method === "POST" && m) {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          seen.results.push(JSON.parse(body));
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const dir = path.join(os.tmpdir(), `orbitpc-poll-${randomUUID()}`);
    const dispatcher = new CommandDispatcher({
      computerId,
      adapterCtx: { allowedApps: {}, dryRun: true },
      clipboardOptIn: false,
      allowPowerOps: true,
      allowedApps: {},
      dataDir: dir,
      audit: new AuditWriter(dir),
    });
    const poll = new PollTransport({
      httpBase: `http://127.0.0.1:${port}`,
      computerId,
      getCredential: () => "cred-123",
      onCommandRequest: (raw) => {
        const parsed = commandRequestSchema.safeParse(raw);
        assert.equal(parsed.success, true);
        if (parsed.success) void dispatcher.submit(parsed.data);
      },
      pollMs: 300,
    });
    dispatcher.onResult = (res) => void poll.report(res);
    poll.start();
    try {
      const deadline = Date.now() + 8000;
      while (seen.results.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(seen.heartbeats >= 1);
      assert.ok(seen.results.length >= 1);
      const statuses = (seen.results as { status: string }[]).map((x) => x.status);
      assert.ok(statuses.includes("succeeded"));
    } finally {
      poll.stop();
      server.close();
    }
  });
});
