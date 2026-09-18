import fs from "node:fs/promises";
import path from "node:path";

// Secure-store abstraction. Prod Windows: DPAPI / Credential Manager scoped to
// the service identity (to be wired via native module). Dev fallback: file in
// dataDir with 0600 + explicit warning. Helper process never calls this.

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
      return JSON.parse(raw) as SecretBundle;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return {};
      throw err;
    }
  }

  async save(bundle: SecretBundle): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(bundle), { mode: 0o600 });
    if (process.platform !== "win32") {
      console.warn("[secure-store] dev file fallback in use — wire DPAPI/Credential Manager on Windows");
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
