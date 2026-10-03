import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { sha256Hex, safeEqualHex } from '../lib/secrets.js';
import { applyCommandResult } from '../lib/command-results.js';
import type { MobileHub } from './mobile-hub.js';

const resultMessageSchema = z.object({
  type: z.literal('command.result'),
  commandId: z.string().uuid(),
  status: z.enum([
    'delivered',
    'acknowledged',
    'running',
    'succeeded',
    'failed',
    'rejected',
    'expired',
    'cancelled',
    'timed_out',
  ]),
  sequence: z.number().int().min(0).max(100000),
  result: z.record(z.unknown()).nullish(),
  error: z.object({ code: z.string().max(64), message: z.string().max(500) }).nullish(),
});

const heartbeatMessageSchema = z.object({
  type: z.literal('presence.heartbeat'),
  bootId: z.string().min(1).max(200),
  agentVersion: z.string().max(50).optional(),
  at: z.string().optional(),
});

export interface AgentHubOptions {
  mobileHub: MobileHub;
}

/**
 * Long-lived WSS endpoint for the Windows agent (plan.md §6).
 * Handshake auth: `Authorization: Bearer <device credential>` + `?computerId=<uuid>`.
 * Fail closed: unknown credential, revoked computer, bad schema => close.
 */
export class AgentHub {
  private wss = new WebSocketServer({ noServer: true });
  /** computerId -> live agent sockets */
  private sockets = new Map<string, Set<WebSocket>>();

  constructor(private opts: AgentHubOptions) {}

  private async onConnection(ws: WebSocket, req: IncomingMessage, computerId: string): Promise<void> {
    const set = this.sockets.get(computerId) ?? new Set<WebSocket>();
    set.add(ws);
    this.sockets.set(computerId, set);
    logger.info({ computerId }, 'agent ws connected');
    try {
      await db.computer.update({ where: { id: computerId }, data: { lastSeenAt: new Date(), status: 'online' } });
    } catch (err) {
      logger.warn({ err, computerId }, 'agent ws: presence update failed');
    }
    // Deliver undelivered envelopes immediately (same shape as the poll inbox,
    // which remains the fallback + the serverless path).
    try {
      const rows = await db.command.findMany({
        where: { computerId, status: { in: ['queued', 'delivered'] }, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        await db.command.updateMany({ where: { id: { in: ids }, status: 'queued' }, data: { status: 'delivered' } });
      }
      for (const r of rows) {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'command.request',
            commandId: r.id,
            idempotencyKey: r.idempotencyKey,
            computerId: r.computerId,
            name: r.name,
            args: ((r.args ?? r.argsRedacted) as Record<string, unknown>) ?? {},
            requestedAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
            requestContext: { mobileSessionId: r.requesterSessionId },
          }),
        );
      }
    } catch (err) {
      logger.warn({ err, computerId }, 'agent ws: pending replay failed');
    }

    ws.on('message', (data) => {
      void this.onMessage(ws, computerId, data);
    });
    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) this.sockets.delete(computerId);
      void db.computer
        .update({ where: { id: computerId }, data: { status: 'offline' } })
        .catch(() => undefined);
    });
  }

  private async onMessage(ws: WebSocket, computerId: string, data: unknown): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      return; // fail closed — never execute unparseable input
    }
    const hb = heartbeatMessageSchema.safeParse(parsed);
    if (hb.success) {
      try {
        await db.computer.update({
          where: { id: computerId },
          data: {
            lastSeenAt: new Date(),
            bootId: hb.data.bootId,
            status: 'online',
            ...(hb.data.agentVersion ? { agentVersion: hb.data.agentVersion } : {}),
          },
        });
        ws.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
      } catch (err) {
        logger.warn({ err, computerId }, 'agent ws: heartbeat persist failed');
      }
      return;
    }
    const res = resultMessageSchema.safeParse(parsed);
    if (res.success) {
      try {
        const command = await db.command.findUnique({ where: { id: res.data.commandId } });
        if (!command || command.computerId !== computerId) return; // fail closed
        await applyCommandResult(command.id, res.data);
        this.opts.mobileHub.hintCommandResult(command.computerId, command.id);
      } catch (err) {
        logger.warn({ err, computerId }, 'agent ws: result persist failed');
      }
      return;
    }
    // Unknown shape: ignore (fail closed by doing nothing).
  }

  /** Push a freshly persisted command to a connected agent (poll relay is fallback). */
  pushCommandRequest(computerId: string, envelope: unknown): void {
    const set = this.sockets.get(computerId);
    if (!set) return;
    const payload = JSON.stringify(envelope);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  /** Revocation: tell the agent and drop its sockets immediately. */
  closeComputers(computerId: string): void {
    const set = this.sockets.get(computerId);
    if (!set) return;
    for (const ws of set) {
      try {
        ws.send(JSON.stringify({ type: 'revoked' }));
        ws.close();
      } catch {
        // ignore
      }
    }
    this.sockets.delete(computerId);
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // '/agent' is canonical; '/socket' kept for agents built against the older default.
    if (url.pathname !== '/agent' && url.pathname !== '/socket') {
      socket.destroy();
      return;
    }
    const computerId = url.searchParams.get('computerId') ?? '';
    const header = req.headers.authorization ?? '';
    const credential = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!credential || !z.string().uuid().safeParse(computerId).success) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    void this.authorize(computerId, credential)
      .then((ok) => {
        if (!ok) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          void this.onConnection(ws, req, computerId);
        });
      })
      .catch(() => {
        socket.destroy();
      });
  }

  private async authorize(computerId: string, credential: string): Promise<boolean> {
    const computer = await db.computer.findUnique({ where: { id: computerId } });
    if (!computer || computer.revokedAt) return false;
    const creds = await db.computerCredential.findMany({ where: { computerId: computer.id, revokedAt: null } });
    return creds.some((c) => safeEqualHex(sha256Hex(credential), c.credentialHash));
  }
}
