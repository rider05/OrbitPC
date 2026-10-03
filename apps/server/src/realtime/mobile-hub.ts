import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Namespace, type Socket } from 'socket.io';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { corsOrigins } from '../config/env.js';

interface SocketAuth {
  userId: string;
  sessionId: string;
}

/**
 * Mobile hint channel (socket.io namespace `/socket`, matching
 * apps/mobile/src/lib/socket.ts). Hints only — HTTPS polling stays
 * authoritative (plan.md §6). Sockets are closed on session revocation.
 */
export class MobileHub {
  private io: SocketIOServer;
  private nsp: Namespace;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      path: '/socket.io',
      cors: { origin: corsOrigins(), credentials: false },
      transports: ['websocket'],
    });
    this.nsp = this.io.of('/socket');

    this.nsp.use((socket, next) => {
      void this.authenticate(socket)
        .then((auth) => {
          if (!auth) return next(new Error('AUTH_REQUIRED'));
          Object.assign(socket.data, auth);
          next();
        })
        .catch(() => next(new Error('AUTH_REQUIRED')));
    });

    this.nsp.on('connection', (socket) => {
      const auth = socket.data as SocketAuth;
      void socket.join(`user:${auth.userId}`);
      logger.debug({ userId: auth.userId }, 'mobile socket connected');
      socket.on('auth.refresh', (msg: unknown) => {
        void this.onAuthRefresh(socket, msg);
      });
    });
  }

  /** Emit a `command.result` hint to the computer owner's sockets. */
  hintCommandResult(computerId: string, commandId: string): void {
    void (async () => {
      try {
        const computer = await db.computer.findUnique({ where: { id: computerId } });
        if (!computer) return;
        this.nsp.to(`user:${computer.ownerUserId}`).emit('command.result', { commandId });
      } catch (err) {
        logger.warn({ err, commandId }, 'mobile-hub: hint failed');
      }
    })();
  }

  /** Logout / revoke: drop all live sockets for this session immediately. */
  closeSessionSockets(sessionId: string): void {
    for (const socket of this.nsp.sockets.values()) {
      const auth = socket.data as SocketAuth;
      if (auth?.sessionId === sessionId) {
        try {
          socket.disconnect(true);
        } catch {
          // ignore
        }
      }
    }
  }

  private async authenticate(socket: Socket): Promise<SocketAuth | null> {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== 'string' || !token) return null;
    const claims = verifyAccessToken(token);
    if (!claims) return null;
    const session = await db.userSession.findUnique({ where: { id: claims.sid } });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return { userId: claims.sub, sessionId: claims.sid };
  }

  private async onAuthRefresh(socket: Socket, msg: unknown): Promise<void> {
    const token = (msg as { token?: unknown } | null)?.token;
    const prev = socket.data as SocketAuth;
    if (typeof token !== 'string' || !token || !prev?.userId) {
      socket.disconnect(true);
      return;
    }
    const claims = verifyAccessToken(token);
    const session = claims ? await db.userSession.findUnique({ where: { id: claims.sid } }) : null;
    if (
      !claims ||
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.userId !== prev.userId
    ) {
      socket.disconnect(true);
      return;
    }
    // Re-bind to the new session id so revoke-close-socket targets the right row.
    Object.assign(socket.data, { userId: prev.userId, sessionId: session.id });
    await socket.join(`user:${prev.userId}`);
  }
}
