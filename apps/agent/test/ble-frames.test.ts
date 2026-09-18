import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decodeBleFrame, encodeBleFrames, reassembleBleFrames } from "../src/ble-frames.js";

const msgId = () => randomBytes(16).toString("hex");

describe("ble-frames MTU codec", () => {
  it("round-trips a command envelope at MTU 20", () => {
    const msg = { v: 1, type: "command.request", commandId: "x", args: { body: "hello" } };
    const frames = encodeBleFrames(msg, msgId(), 20);
    assert.ok(frames.length > 1);
    for (const f of frames) assert.ok(f.length <= 40);
    const { value } = reassembleBleFrames(frames);
    assert.deepEqual(value, msg);
  });

  it("single frame for tiny payloads, header layout sane", () => {
    const frames = encodeBleFrames({ a: 1 }, msgId(), 512);
    assert.equal(frames.length, 1);
    const d = decodeBleFrame(frames[0]);
    assert.equal(d.seq, 0);
    assert.equal(d.total, 1);
  });

  it("refuses oversize messages and mixed batches", () => {
    assert.throws(() => encodeBleFrames({ big: "x".repeat(70 * 1024) }, msgId(), 20), /64KB/);
    assert.throws(() => encodeBleFrames({ a: 1 }, "not-hex", 20), /msgId/);
    const a = encodeBleFrames({ a: 1 }, msgId(), 20);
    assert.throws(() => reassembleBleFrames([...a, ...a]), /expected 1 frames, got 2/);
    assert.throws(() => reassembleBleFrames([]), /no frames/);
    const multi = encodeBleFrames({ text: "y".repeat(100) }, msgId(), 20);
    assert.ok(multi.length > 2);
    assert.throws(() => reassembleBleFrames(multi.slice(0, -1)), /expected/);
    const tampered = Buffer.from(multi[1]);
    tampered[0] ^= 0xff; // corrupt msgId on one frame of an otherwise valid batch
    assert.throws(() => reassembleBleFrames([multi[0], tampered, ...multi.slice(2)]), /mixed msgId/);
  });
});
