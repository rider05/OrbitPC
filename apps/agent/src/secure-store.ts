import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

// Secure-store abstraction. On Windows, secrets are wrapped with DPAPI
// (ProtectedData, CurrentUser scope) so a plain file read on another account /
// machine is useless. Dev fallback on non-Windows / CI: plaintext JSON with 0600.

async function protect(payload: string): Promise<string> {
  if (process.platform !== "win32" || process.env.ORBITPC_DPAPI === "0") return payload;
  const b64 = Buffer.from(payload, "utf8").toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$bytes = [Convert]::FromBase64String($env:ORB_PLAIN)",
    "$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')",
    "[Convert]::ToBase64String($enc)",
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ORB_PLAIN: b64 }, shell: false }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function unprotect(payload: string): Promise<string> {
  if (process.platform !== "win32" || process.env.ORBITPC_DPAPI === "0") return payload;
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$bytes = [Convert]::FromBase64String($env:ORB_ENC)",
    "$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')",
    "[Convert]::ToBase64String($dec)",
  ].join('; ');
  const protectedB64 = payload;
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ORB_ENC: protectedB64 }, shell: false }, (err, stdout) => {
      if (err) reject(err);
      else {
        try {
          resolve(Buffer.from(stdout.trim(), 'base64').toString('utf8'));
        } catch (e) { reject(e); }
      }
    });
  });
}

export interface SecretBundle {
  credentialId?: string;
  credential?: string;
  privateKeyPem?: string;
  publicKeyPem?: string;
  computerId?: string;
  /**
   * Nearby-LAN bearer token (pairing-derived secret for direct Wi-Fi commands).
   * Never logged, never sent to the cloud relay — presented by the phone only
   * over the LAN transport (WS query param), verified in constant time.
   */
  lanToken?: string;
}

export class FileSecureStore {
  constructor(private dataDir: string) {}

  private get file(): string {
    return path.join(this.dataDir, "secrets.json");
  }

  async load(): Promise<SecretBundle> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const plaintext = await unprotect(raw);
      return JSON.parse(plaintext) as SecretBundle;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
      // Fall back: a pre-DPAPI plaintext secrets.json parses directly.
      try {
        const raw = await fs.readFile(this.file, "utf8");
        return JSON.parse(raw) as SecretBundle;
      } catch {
        throw err;
      }
    }
  }

  async save(bundle: SecretBundle): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const plaintext = JSON.stringify(bundle);
    const wrapped = await protect(plaintext);
    await fs.writeFile(this.file, wrapped, { mode: 0o600 });
    if (process.platform !== "win32") {
      console.warn("[secure-store] dev file fallback in use — DPAPI is Windows-only");
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.rm(this.file, { force: true });
    } catch {
      // ignore
    }
  }
}
