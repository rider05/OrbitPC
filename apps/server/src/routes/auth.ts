import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { db } from '../lib/db.js';
import { hashPassword, newOpaqueToken, sha256Hex, safeEqualHex, verifyPassword } from '../lib/secrets.js';
import { signAccessToken } from '../lib/tokens.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getRealtimeHub } from '../realtime/index.js';

export const authRouter = Router();

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

const credentialsSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128),
  })
  .strict();

// --- login throttling: 10 failures / 10 min per email+ip (single-instance; Redis when scaled)
const failures = new Map<string, { count: number; resetAt: number }>();

function throttleKey(email: string, ip: string): string {
  return `${email}|${ip}`;
}

function checkThrottle(email: string, ip: string): void {
  const now = Date.now();
  const entry = failures.get(throttleKey(email, ip));
  if (entry && (entry.resetAt > now ? entry.count >= 10 : false)) {
    throw new ApiError('RATE_LIMITED', 429, 'Too many attempts. Try again later.');
  }
  if (entry && entry.resetAt <= now) failures.delete(throttleKey(email, ip));
}

function noteFailure(email: string, ip: string): void {
  const key = throttleKey(email, ip);
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= Date.now()) {
    failures.set(key, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

async function issueSession(userId: string, deviceLabel?: string) {
  const refreshToken = newOpaqueToken();
  const session = await db.userSession.create({
    data: {
      userId,
      refreshTokenHash: sha256Hex(refreshToken),
      deviceLabel: deviceLabel?.slice(0, 100),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      lastSeenAt: new Date(),
    },
  });
  return {
    accessToken: signAccessToken(userId, session.id),
    refreshToken,
    sessionId: session.id,
  };
}

async function registerOrLogin(email: string, password: string, create: boolean, ip: string) {
  checkThrottle(email, ip);
  const existing = await db.user.findUnique({ where: { email } });
  if (create) {
    if (existing) throw new ApiError('CONFLICT', 409, 'An account with this email already exists.');
    const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password) } });
    return { user, tokens: await issueSession(user.id) };
  }
  if (!existing || existing.status !== 'active' || !(await verifyPassword(existing.passwordHash, password))) {
    noteFailure(email, ip);
    throw new ApiError('AUTH_REQUIRED', 401, 'Invalid email or password.');
  }
  return { user: existing, tokens: await issueSession(existing.id) };
}

authRouter.post('/register', async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const { user, tokens } = await registerOrLogin(email, password, true, req.ip ?? '');
    res.status(201).json({ ...tokens, user: { email: user.email } });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = credentialsSchema.parse(req.body);
    const { user, tokens } = await registerOrLogin(email, password, false, req.ip ?? '');
    res.json({ ...tokens, user: { email: user.email } });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const body = z.object({ refreshToken: z.string().min(16), sessionId: z.string().uuid() }).strict().parse(req.body);
    const session = await db.userSession.findUnique({ where: { id: body.sessionId } });
    const ok =
      session &&
      !session.revokedAt &&
      session.expiresAt.getTime() > Date.now() &&
      safeEqualHex(sha256Hex(body.refreshToken), session.refreshTokenHash);
    if (!session || !ok) {
      // Reuse detection: a live session presented with a WRONG refresh token
      // means the stored one may be stolen. Kill the session (M3 hardening).
      if (session && !session.revokedAt && session.expiresAt.getTime() > Date.now()) {
        logger.warn({ sessionId: session.id, userId: session.userId }, 'refresh token reuse detected — session revoked');
        await db.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        getRealtimeHub()?.closeSessionSockets(session.id);
      }
      throw new ApiError('AUTH_REQUIRED', 401, 'Session expired. Please sign in again.');
    }
    // Rotate: the presented refresh token dies here; a new one is issued.
    const refreshToken = newOpaqueToken();
    await db.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        lastSeenAt: new Date(),
      },
    });
    res.json({
      accessToken: signAccessToken(session.userId, session.id),
      refreshToken,
      sessionId: session.id,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const body = z.object({ sessionId: z.string().uuid() }).strict().parse(req.body);
    await db.userSession.updateMany({
      where: { id: body.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // M3: revocation closes live sockets immediately (not just at next request).
    getRealtimeHub()?.closeSessionSockets(body.sessionId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/reauthenticate', requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ password: z.string().min(1).max(128) }).strict().parse(req.body);
    const user = await db.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw new ApiError('AUTH_REQUIRED', 401, 'Password check failed.');
    }
    await db.userSession.update({
      where: { id: req.auth!.sessionId },
      data: { lastReauthAt: new Date() },
    });
    res.json({ ok: true, recentAuthAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});
