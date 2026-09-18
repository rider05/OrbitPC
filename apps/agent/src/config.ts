import os from "node:os";
import path from "node:path";

export interface AgentConfig {
  computerId: string | null;
  computerName: string;
  serverUrl: string;
  credentialId: string | null;
  dataDir: string;
  allowedApps: Record<string, string>;
  clipboardOptIn: boolean;
  allowSleepRestartShutdown: boolean;
  /** Opt-in LAN listener for nearby direct connect (default OFF — opens a LAN port). */
  nearbyLanEnabled: boolean;
  nearbyLanPort: number;
  /** Opt-in BLE beacon for nearby discovery + data fallback (default OFF). */
  nearbyBleEnabled: boolean;
}

function dataDir(): string {
  const base =
    process.env.ORBITPC_DATA_DIR ||
    (process.platform === "win32"
      ? process.env.PROGRAMDATA || "C:\\ProgramData"
      : os.tmpdir());
  return path.join(base, "OrbitPC", "agent");
}

export function loadConfig(): AgentConfig {
  return {
    computerId: process.env.ORBITPC_COMPUTER_ID ?? null,
    computerName: process.env.ORBITPC_COMPUTER_NAME || os.hostname(),
    serverUrl: process.env.ORBITPC_SERVER_URL || "wss://api.example.com/socket",
    credentialId: process.env.ORBITPC_CREDENTIAL_ID ?? null,
    dataDir: dataDir(),
    allowedApps: parseAllowedApps(process.env.ORBITPC_ALLOWED_APPS),
    clipboardOptIn: process.env.ORBITPC_CLIPBOARD_OPT_IN === "1",
    allowSleepRestartShutdown: process.env.ORBITPC_ALLOW_POWER !== "0",
    nearbyLanEnabled: process.env.ORBITPC_NEARBY_LAN === "1",
    nearbyLanPort: Number(process.env.ORBITPC_NEARBY_PORT || 11430),
    nearbyBleEnabled: process.env.ORBITPC_NEARBY_BLE === "1",
  };
}

/** Format: "appId=/abs/path;otherId=/abs/path". Empty => dev default single entry. */
function parseAllowedApps(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return process.platform === "win32"
      ? { notepad: "C:\\Windows\\System32\\notepad.exe" }
      : { shell: process.execPath };
  }
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [id, p] = part.split("=").map((s) => s?.trim());
    if (id && p) out[id] = p;
  }
  return out;
}
