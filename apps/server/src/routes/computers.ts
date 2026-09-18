import { Router } from 'express';
import { z } from 'zod';
import { COMMAND_CATALOG, type CommandName } from '@orbit/protocol';
import { ApiError } from '../lib/errors.js';
import { db } from '../lib/db.js';
import { safeEqualHex, sha256Hex } from '../lib/secrets.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const computersRouter = Router();

const OFFLINE_AFTER_MS = 75 * 1000;

export function isOnline(lastSeenAt: Date | null): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt.getTime() <= OFFLINE_AFTER_MS;
}

type ComputerRow = {
  id: string;
  displayName: string;
  platform: string;
  agentVersion: string | null;
  status: string;
  lastSeenAt: Date | null;
  bootId: string | null;
};

// Mobile Computer shape (see apps/mobile/src/protocol/types.ts).
export async function toComputerShape(c: ComputerRow) {
  const policies = await db.commandPolicy.findMany({ where: { computerId: c.id } });
  const disabled = new Set(policies.filter((p) => !p.enabled).map((p) => p.commandName));
  const allowedActions = (Object.keys(COMMAND_CATALOG) as CommandName[]).filter((n) => !disabled.has(n));
  const online = isOnline(c.lastSeenAt);
  return {
    id: c.id,
    displayName: c.displayName,
    platform: c.platform,
    agentVersion: c.agentVersion ?? 'unknown',
    status: online ? 'online' : 'offline',
    lastSeenAt: c.lastSeenAt?.toISOString() ?? null,
    bootId: c.bootId,
    allowedActions,
  };
}

async function loadOwnedComputer(computerId: string, userId: string) {
  if (!z.string().uuid().safeParse(computerId).success) {
    throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid computer id.');
  }
  const computer = await db.computer.findUnique({ where: { id: computerId } });
  if (!computer || computer.ownerUserId !== userId) {
    throw new ApiError('NOT_OWNER', 403, 'Computer not found.');
  }
  if (computer.revokedAt) throw new ApiError('NOT_FOUND', 404, 'Computer not found.');
  return computer;
}

computersRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await db.computer.findMany({
      where: { ownerUserId: req.auth!.userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json(await Promise.all(rows.map(toComputerShape)));
  } catch (err) {
    next(err);
  }
});

computersRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    res.json(await toComputerShape(await loadOwnedComputer(req.params.id, req.auth!.userId)));
  } catch (err) {
    next(err);
  }
});

computersRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ displayName: z.string().trim().min(1).max(100) }).strict().parse(req.body);
    const computer = await loadOwnedComputer(req.params.id, req.auth!.userId);
    const updated = await db.computer.update({ where: { id: computer.id }, data: { displayName: body.displayName } });
    res.json(await toComputerShape(updated));
  } catch (err) {
    next(err);
  }
});

computersRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const computer = await loadOwnedComputer(req.params.id, req.auth!.userId);
    const now = new Date();
    await db.$transaction([
      db.computer.update({ where: { id: computer.id }, data: { revokedAt: now, status: 'offline' } }),
      db.computerCredential.updateMany({ where: { computerId: computer.id, revokedAt: null }, data: { revokedAt: now } }),
      db.auditEvent.create({
        data: {
          actorType: 'user',
          actorId: req.auth!.userId,
          computerId: computer.id,
          action: 'computer.revoke',
          outcome: 'succeeded',
          ipContext: req.ip,
        },
      }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Agent transport (poll-based relay; Bearer device credential, computer-bound) ---

export async function requireAgent(req: { header: (n: string) => string | undefined; params: { id: string } }): Promise<ComputerRow> {
  const header = req.header('authorization') ?? '';
  const credential = header.startsWith('Bearer ') ? header.slice(7) : '';
  const computerId = req.params.id;
  if (!credential || !z.string().uuid().safeParse(computerId).success) {
    throw new ApiError('AUTH_REQUIRED', 401, 'Authentication required.');
  }
  const computer = await db.computer.findUnique({ where: { id: computerId } });
  if (!computer || computer.revokedAt) throw new ApiError('AUTH_REQUIRED', 401, 'Authentication required.');
  const creds = await db.computerCredential.findMany({
    where: { computerId: computer.id, revokedAt: null },
  });
  const match = creds.some((c) => safeEqualHex(sha256Hex(credential), c.credentialHash));
  if (!match) throw new ApiError('AUTH_REQUIRED', 401, 'Authentication required.');
  return computer;
}

const heartbeatSchema = z
  .object({
    bootId: z.string().min(1).max(200),
    bootTime: z.string().datetime().optional(),
    agentVersion: z.string().max(50).optional(),
  })
  .strict();

computersRouter.post('/:id/heartbeat', async (req, res, next) => {
  try {
    const computer = await requireAgent(req);
    const body = heartbeatSchema.parse(req.body);
    await db.computer.update({
      where: { id: computer.id },
      data: {
        lastSeenAt: new Date(),
        bootId: body.bootId,
        status: 'online',
        ...(body.agentVersion ? { agentVersion: body.agentVersion } : {}),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Agent long-poll inbox: undelivered command.request envelopes, oldest first.
computersRouter.get('/:id/pending', async (req, res, next) => {
  try {
    const computer = await requireAgent(req);
    const rows = await db.command.findMany({
      where: { computerId: computer.id, status: { in: ['queued', 'delivered'] }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.command.updateMany({ where: { id: { in: ids }, status: 'queued' }, data: { status: 'delivered' } });
    }
    await db.computer.update({ where: { id: computer.id }, data: { lastSeenAt: new Date() } });
    res.json({
      commands: rows.map((r) => ({
        v: 1,
        type: 'command.request',
        commandId: r.id,
        idempotencyKey: r.idempotencyKey,
        computerId: r.computerId,
        name: r.name,
        // Full args: agent-only pickup payload, never returned to mobile.
        args: ((r.args ?? r.argsRedacted) as Record<string, unknown>) ?? {},
        requestedAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        requestContext: { mobileSessionId: r.requesterSessionId },
      })),
    });
  } catch (err) {
    next(err);
  }
});
