import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessClaims {
  sub: string; // user id
  sid: string; // user_session id
}

const ACCESS_TTL_SEC = 15 * 60;

/** Short-lived (15 min) mobile access token. Secret from env, never logged. */
export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TTL_SEC,
    issuer: 'orbit-server',
    audience: 'orbit-mobile',
  });
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'orbit-server',
      audience: 'orbit-mobile',
    }) as { sub?: unknown; sid?: unknown };
    if (typeof decoded.sub !== 'string' || typeof decoded.sid !== 'string') return null;
    return { sub: decoded.sub, sid: decoded.sid };
  } catch {
    return null;
  }
}
