import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CommandDispatcher } from "../src/dispatcher.js";
import { AuditWriter } from "../src/audit.js";
import type { CommandResult } from "@orbit/protocol";

function mkReq(computerId: string, name: string, args: Record<string, unknown> = {}) {
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

describe("CommandDispatcher", () => {
  it("acks then succeeds getStatus; dedups replay", async () => {
    const computerId = randomUUID();
    const dir = path.join(os.tmpdir(), `orbitpc-test-${randomUUID()}`);
    const results: CommandResult[] = [];
    const d = new CommandDispatcher({
      computerId,
      adapterCtx: { allowedApps: {}, dryRun: true },
      clipboardOptIn: true,
      allowPowerOps: true,
      allowedApps: {},
      dataDir: dir,
      audit: new AuditWriter(dir),
      commandTimeoutMs: 5000,
    });
    d.onResult = (r) => results.push(r);
    const req = mkReq(computerId, "system.getStatus");
    await d.submit(req as never);
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(results.some((x) => x.status === "acknowledged"));
    assert.ok(results.some((x) => x.status === "succeeded"));

    // replay same commandId => cancelled/duplicate, never executes twice
    results.length = 0;
    await d.submit(req as never);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(results.some((x) => x.status === "cancelled"));
  });

  it("rejects wrong computer + expired", async () => {
    const computerId = randomUUID();
    const dir = path.join(os.tmpdir(), `orbitpc-test-${randomUUID()}`);
    const results: CommandResult[] = [];
    const d = new CommandDispatcher({
      computerId,
      adapterCtx: { allowedApps: {}, dryRun: true },
      clipboardOptIn: false,
      allowPowerOps: true,
      allowedApps: {},
      dataDir: dir,
      audit: new AuditWriter(dir),
    });
    d.onResult = (r) => results.push(r);
    await d.submit(mkReq(randomUUID(), "system.lock") as never);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(results.at(-1)?.error?.code, "NOT_OWNER");

    const expired = mkReq(computerId, "system.lock");
    expired.requestedAt = new Date(Date.now() - 120_000).toISOString();
    expired.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await d.submit(expired as never);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(results.at(-1)?.error?.code, "COMMAND_EXPIRED");
  });

  it("sequences are monotonic per command", async () => {
    const computerId = randomUUID();
    const dir = path.join(os.tmpdir(), `orbitpc-test-${randomUUID()}`);
    const results: CommandResult[] = [];
    const d = new CommandDispatcher({
      computerId,
      adapterCtx: { allowedApps: {}, dryRun: true },
      clipboardOptIn: false,
      allowPowerOps: true,
      allowedApps: {},
      dataDir: dir,
      audit: new AuditWriter(dir),
    });
    d.onResult = (r) => {
      if (r.commandId === req.commandId) results.push(r);
    };
    const req = mkReq(computerId, "system.lock");
    await d.submit(req as never);
    await new Promise((r) => setTimeout(r, 800));
    const seqs = results.map((x) => x.sequence);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.ok(seqs.length >= 3); // ack + running + final
  });
});
