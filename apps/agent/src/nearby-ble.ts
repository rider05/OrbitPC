import { randomBytes } from "node:crypto";
import {
  NEARBY_BLE_BEACON_CHAR_UUID,
  NEARBY_BLE_COMMAND_CHAR_UUID,
  NEARBY_BLE_SERVICE_UUID,
  nearbyBeaconSchema,
} from "@orbit/protocol";
import { encodeBleFrames, reassembleBleFrames } from "./ble-frames.js";

// BLE nearby transport — discovery beacon (real shape) + MTU framing (real
// codec). The GATT peripheral itself still needs a native WinRT bridge on
// Windows (pure Node cannot own a BLE GATT server), so this module:
//   1. validates the exact beacon bytes the phone scans for,
//   2. owns the frame codec both sides must speak (ble-frames.ts, tested),
//   3. exposes BLE_GATT_LAYOUT so the native bridge + phone implement the
//      same service/characteristic/MTU contract with zero drift,
//   4. runs a codec self-check at startup so a broken build fails loudly here,
//      never silently on a phone in the field.

export const BLE_GATT_LAYOUT = {
  serviceUuid: NEARBY_BLE_SERVICE_UUID,
  beaconCharUuid: NEARBY_BLE_BEACON_CHAR_UUID,
  commandCharUuid: NEARBY_BLE_COMMAND_CHAR_UUID,
  /** Beacon char: UTF-8 JSON of NearbyBeacon (ids only, never secrets/tokens). */
  beaconEncoding: "utf8-json",
  /** Command char: write command.request frames / notify command.result frames. */
  frameEncoding: "ble-frames/v1 (20-byte header + payload, default MTU 20, DLE up to 512)",
} as const;

export interface BleBeacon {
  computerId: string;
  lanPort: number;
  bootId: string;
}

export interface BleAdvertiser {
  layout: typeof BLE_GATT_LAYOUT;
  stop: () => void;
}

/** Validate + serialize the beacon exactly as the phone's scanner parses it. */
export function buildBeaconPayload(beacon: BleBeacon): Buffer {
  const parsed = nearbyBeaconSchema.safeParse({ v: 1, ...beacon });
  if (!parsed.success) throw new Error("invalid beacon: " + parsed.error.issues.map((i) => i.message).join("; "));
  return Buffer.from(JSON.stringify(parsed.data), "utf8");
}

export async function startBleAdvertise(beacon: BleBeacon, opts?: { enabled?: boolean }): Promise<BleAdvertiser | null> {
  if (opts?.enabled === false) return null;
  const payload = buildBeaconPayload(beacon); // fails fast on bad ids

  // Codec self-check: envelope -> frames -> envelope must round-trip here.
  const probe = { v: 1, type: "command.request", selfCheck: true };
  const frames = encodeBleFrames(probe, randomBytes(16).toString("hex"), 20);
  const back = reassembleBleFrames(frames).value as Record<string, unknown>;
  if (back.selfCheck !== true) throw new Error("BLE codec self-check failed");

  console.log(`[nearby-ble] beacon service=${NEARBY_BLE_SERVICE_UUID} bytes=${payload.length} computer=${beacon.computerId} lanPort=${beacon.lanPort} boot=${beacon.bootId}`);
  console.log("[nearby-ble] codec self-check ok. GATT peripheral needs a WinRT bridge on Windows — beacon shape + framing above are the contract it must speak.");
  return { layout: BLE_GATT_LAYOUT, stop: () => console.log("[nearby-ble] stopped") };
}
