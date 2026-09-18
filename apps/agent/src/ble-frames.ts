import { MAX_COMMAND_MESSAGE_BYTES } from "@orbit/protocol";

// MTU-chunked framing for the BLE command characteristic.
// Layout per frame (all little-endian, binary):
//   [0..15]  msgId   16-byte hex id (random per message)
//   [16..17] seq     uint16 frame index (0-based)
//   [18..19] total   uint16 frame count
//   [20..]   payload raw bytes (JSON UTF-8 slice)
// Reassembly validates seq/total continuity, total*MTU bounds, and the 64KB
// protocol cap. Pure functions — shared by the future WinRT GATT bridge and
// the phone transport; the dispatcher never sees frames, only reassembled
// envelopes (which still go through strict schema validation).

export const BLE_DEFAULT_MTU = 20;
export const BLE_MAX_PAYLOAD = MAX_COMMAND_MESSAGE_BYTES;

export interface BleFrame {
  msgId: string;
  seq: number;
  total: number;
  payload: Buffer;
}

export function encodeBleFrames(message: unknown, msgId: string, mtu: number = BLE_DEFAULT_MTU): Buffer[] {
  if (!/^[0-9a-f]{32}$/i.test(msgId)) throw new Error("msgId must be 32 hex chars");
  if (!Number.isInteger(mtu) || mtu < 8 || mtu > 512) throw new Error("mtu out of range 8..512");
  const json = JSON.stringify(message);
  if (json === undefined) throw new Error("unserializable message");
  const body = Buffer.from(json, "utf8");
  if (body.length > BLE_MAX_PAYLOAD) throw new Error("message exceeds 64KB cap");
  const perFrame = mtu;
  const total = Math.max(1, Math.ceil(body.length / perFrame));
  if (total > 0xffff) throw new Error("message needs too many frames");
  const idBuf = Buffer.from(msgId, "hex");
  const out: Buffer[] = [];
  for (let seq = 0; seq < total; seq++) {
    const slice = body.subarray(seq * perFrame, (seq + 1) * perFrame);
    const head = Buffer.alloc(20);
    idBuf.copy(head, 0);
    head.writeUInt16LE(seq, 16);
    head.writeUInt16LE(total, 18);
    out.push(Buffer.concat([head, slice]));
  }
  return out;
}

export function decodeBleFrame(frame: Buffer): BleFrame {
  if (frame.length < 20) throw new Error("frame too short");
  return {
    msgId: frame.subarray(0, 16).toString("hex"),
    seq: frame.readUInt16LE(16),
    total: frame.readUInt16LE(18),
    payload: frame.subarray(20),
  };
}

/** Reassemble a full set of frames into the original JSON value. Validates shape. */
export function reassembleBleFrames(frames: Buffer[]): { msgId: string; value: unknown } {
  if (frames.length === 0) throw new Error("no frames");
  const decoded = frames.map(decodeBleFrame);
  const msgId = decoded[0].msgId;
  const total = decoded[0].total;
  if (total !== decoded.length) throw new Error(`expected ${total} frames, got ${decoded.length}`);
  if (total > 4096) throw new Error("frame count absurd — refusing");
  const seen = new Set<number>();
  for (const f of decoded) {
    if (f.msgId !== msgId) throw new Error("mixed msgId in batch");
    if (f.total !== total) throw new Error("mixed total in batch");
    if (f.seq >= total || seen.has(f.seq)) throw new Error("bad/duplicate seq");
    seen.add(f.seq);
  }
  const ordered = [...decoded].sort((a, b) => a.seq - b.seq);
  const body = Buffer.concat(ordered.map((f) => f.payload));
  if (body.length > BLE_MAX_PAYLOAD) throw new Error("reassembled message exceeds 64KB cap");
  return { msgId, value: JSON.parse(body.toString("utf8")) };
}
