import { NEARBY_BLE_SERVICE_UUID } from "@orbit/protocol";

// BLE beacon for nearby discovery + data-fallback hint.
// Scaffold: advertises presence (computerId + LAN port + bootId) so the phone
// can find the PC nearby and skip mDNS. Real GATT peripheral on Windows needs
// a native bridge (WinRT GATT server) — this module owns that boundary so the
// dispatcher never touches transport code.
//
// Next step (native): advertise NEARBY_BLE_SERVICE_UUID with the beacon char,
// accept command.request writes on the command char (MTU-chunked), notify
// command.result. Same envelopes, same validation, same idempotency.

export interface BleBeacon {
  computerId: string;
  lanPort: number;
  bootId: string;
}

export interface BleAdvertiser {
  stop: () => void;
}

export async function startBleAdvertise(beacon: BleBeacon, opts?: { enabled?: boolean }): Promise<BleAdvertiser | null> {
  if (opts?.enabled === false) return null;
  // No native BLE peripheral dep installed yet — log the beacon that WOULD be
  // advertised so QA can verify discovery payloads without hardware.
  console.log(
    `[nearby-ble] advertise service=${NEARBY_BLE_SERVICE_UUID} computer=${beacon.computerId} lanPort=${beacon.lanPort} boot=${beacon.bootId}`,
  );
  console.log("[nearby-ble] stub: install a WinRT GATT bridge to broadcast for real phones (see file header).");
  return { stop: () => console.log("[nearby-ble] stopped") };
}
