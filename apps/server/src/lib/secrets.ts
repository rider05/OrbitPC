import argon from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Secrets policy: only HASHES touch the DB (see prisma/schema.prisma header).

export async function hashPassword(password: string): Promise<string> {
  return argon.hash(password, { type: argon.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon.verify(hash, password);
  } catch {
    return false;
  }
}

/** Opaque random token (refresh tokens, agent credentials, polling secrets). */
export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time hex comparison (length-guarded). */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// User-facing pairing code: 8 Crockford-ish chars (no 0/O/1/I), shown XXXX-XXXX.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newUserCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalize for lookup: uppercase, strip dashes/spaces. */
export function normalizeUserCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, '');
}
