import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FileSecureStore } from "./secure-store.js";

// Nearby-LAN bearer auth. The token is a 256-bit secret generated on first LAN
// enable, persisted beside the device credential (0600 file / DPAPI later), and
// shown ONLY via the explicit `--show-lan-token` flag for entry into the phone
// Settings screen. It is never logged, never sent over the cloud relay, and
// verified in constant time. Envelopes stay frozen — the token travels outside
// them (WS `?token=` query param or `Authorization: Bearer` header).

export function newLanToken(): string {
  return randomBytes(32).toString("hex");
}

/** Load the stored token or create + persist one (caller must have LAN enabled). */
export async function ensureLanToken(store: FileSecureStore): Promise<{ token: string; created: boolean }> {
  const bundle = await store.load();
  if (bundle.lanToken) return { token: bundle.lanToken, created: false };
  const token = newLanToken();
  await store.save({ ...bundle, lanToken: token });
  return { token, created: true };
}

/** Constant-time comparison; false on any shape mismatch (fail closed). */
export function verifyLanToken(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Pull a bearer token from a WS upgrade request (header first, query fallback). */
export function extractBearerToken(req: { headers?: Record<string, string | string[] | undefined>; url?: string }): string | null {
  const h = req.headers?.["authorization"];
  const header = Array.isArray(h) ? h[0] : h;
  if (header) {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (m) return m[1].trim();
  }
  if (req.url) {
    try {
      const u = new URL(req.url, "http://localhost");
      const q = u.searchParams.get("token");
      if (q) return q;
    } catch {
      // ignore malformed URL — no token
    }
  }
  return null;
}
