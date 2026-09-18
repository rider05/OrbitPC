import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';
import { db } from '../lib/db.js';
import { verifyAccessToken } from '../lib/tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string };
    }
  }
}

/** Mobile Bearer auth: short JWT + live-session check (revocation closes access). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? verifyAccessToken(token) : null;
    if (!claims) throw new ApiError('AUTH_REQUIRED', 401, 'Authentication required.');
    const session = await db.userSession.findUnique({ where: { id: claims.sid } });
    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new ApiError('AUTH_REQUIRED', 401, 'Session expired. Please sign in again.');
    }
    req.auth = { userId: claims.sub, sessionId: claims.sid };
    await db.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => undefined);
    next();
  } catch (err) {
    next(err);
  }
}
