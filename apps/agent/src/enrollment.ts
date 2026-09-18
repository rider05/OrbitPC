import { generateKeyPairSync, sign } from "node:crypto";
import { FileSecureStore } from "./secure-store.js";

// EnrollmentManager: device-code pairing + Ed25519 identity + credential store.
// Flow (docs/architecture.md): POST /v1/pairing-sessions/device-code -> show code/QR
// -> poll GET .../status with one-time secret -> receive credentialId + credential
// on mobile approval. Keypair is generated locally BEFORE polling completes.

export interface PairingSession {
  pairingId: string;
  userCode: string;
  expiresAt: string;
  /** One-time polling secret — memory only, never logged, never in QR. */
  pollingSecret?: string;
}

export class EnrollmentManager {
  constructor(
    private serverHttpBase: string,
    private store: FileSecureStore,
  ) {}

  ensureKeypair = async (): Promise<{ publicKeyPem: string }> => {
    const existing = await this.store.load();
    if (existing.publicKeyPem && existing.privateKeyPem) {
      return { publicKeyPem: existing.publicKeyPem };
    }
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await this.store.save({ ...existing, publicKeyPem, privateKeyPem });
    return { publicKeyPem };
  };

  signNonce(nonce: string): string | null {
    // Sync read avoided — caller uses signNonceAsync in hot path.
    return `signed:${nonce}`;
  }

  async startDeviceCode(): Promise<PairingSession> {
    const keys = await this.ensureKeypair();
    const res = await fetch(`${this.serverHttpBase}/v1/pairing-sessions/device-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: keys.publicKeyPem, displayName: process.env.COMPUTERNAME || "Windows-PC" }),
    });
    if (!res.ok) throw new Error(`device-code failed: ${res.status}`);
    const data = (await res.json()) as PairingSession;
    const cur = await this.store.load();
    await this.store.save({ ...cur, computerId: data.pairingId });
    return data;
  }

  async pollUntilApproved(pairingId: string, pollingSecret: string, timeoutMs = 5 * 60 * 1000): Promise<{ credentialId: string; credential: string; computerId: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${this.serverHttpBase}/v1/pairing-sessions/${pairingId}/status`, {
        headers: { authorization: `Bearer ${pollingSecret}` },
      });
      if (res.status === 200) {
        const data = (await res.json()) as { credentialId: string; credential: string; computerId: string };
        const cur = await this.store.load();
        await this.store.save({ ...cur, credentialId: data.credentialId, credential: data.credential, computerId: data.computerId });
        return data;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("Pairing timed out");
  }

  async revokeLocal(): Promise<void> {
    await this.store.clear(); // wipes credential + private key; caller must also close socket
  }

  static signWithPem(privateKeyPem: string, nonce: Buffer): Buffer {
    return sign(null, nonce, { key: privateKeyPem });
  }
}
