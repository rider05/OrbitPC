import { Router } from 'express';
import { z } from 'zod';
import { COMMAND_CATALOG, COMMAND_EXPIRY_SEC, commandArgsSchemas, type CommandName } from '@orbit/protocol';
import { ApiError, Errors } from '../lib/errors.js';
import { db } from '../lib/db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { applyCommandResult, redactArgs } from '../lib/command-results.js';
import { getRealtimeHub } from '../realtime/index.js';
import { isOnline, requireAgent } from './computers.js';

export const commandsRouter = Router();

type CommandRow = {
  id: string;
  idempotencyKey: string;
  computerId: string;
  name: string;
  argsRedacted: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  resultRedacted: unknown;
  errorCode: string | null;
};

async function toCommandRecord(r: CommandRow) {
  const last = await db.commandEvent.findFirst({
    where: { commandId: r.id },
    orderBy: { sequence: 'desc' },
  });
  return {
    id: r.id,
    idempotencyKey: r.idempotencyKey,
    computerId: r.computerId,
    name: r.name,
    argsRedacted: (r.argsRedacted as Record<string, unknown>) ?? {},
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    resultRedacted: (r.resultRedacted as Record<string, unknown> | null) ?? null,
    errorCode: r.errorCode,
    sequence: last?.sequence ?? 0,
  };
}

const submitSchema = z
  .object({
    commandId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    name: z.string().min(1).max(64),
    args: z.record(z.unknown()).default({}),
  })
  .strict();

// --- Mobile: submit a validated command (persisted before the agent ever sees it) ---
commandsRouter.post('/computers/:id/commands', requireAuth, async (req, res, next) => {
  try {
    const body = submitSchema.parse(req.body);
    const computerId = req.params.id;
    if (!z.string().uuid().safeParse(computerId).success) {
      throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid computer id.');
    }
    const computer = await db.computer.findUnique({ where: { id: computerId } });
    if (!computer || computer.ownerUserId !== req.auth!.userId || computer.revokedAt) {
      throw new ApiError('NOT_OWNER', 403, 'Computer not found.');
    }
    if (!(body.name in COMMAND_CATALOG)) {
      throw new ApiError('COMMAND_NOT_ALLOWED', 403, 'This action is not allowed.');
    }
    const name = body.name as CommandName;
    const entry = COMMAND_CATALOG[name];
    const argCheck = commandArgsSchemas[name].safeParse(body.args ?? {});
    if (!argCheck.success) throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid arguments.');
    const policies = await db.commandPolicy.findMany({ where: { computerId } });
    if (policies.some((p) => p.commandName === name && !p.enabled)) {
      throw new ApiError('COMMAND_NOT_ALLOWED', 403, 'This action is not enabled on the computer.');
    }
    const online = isOnline(computer.lastSeenAt);
    if (!online && entry.rejectWhenOffline) {
      throw new ApiError('COMPUTER_OFFLINE', 409, 'Computer is offline. Destructive actions are never queued.');
    }
    // Destructive commands need a fresh password proof (10-min window).
    if (entry.requiresRecentAuth) {
      const session = await db.userSession.findUnique({ where: { id: req.auth!.sessionId } });
      const fresh = !!session?.lastReauthAt && Date.now() - session.lastReauthAt.getTime() <= 10 * 60 * 1000;
      if (!fresh) {
        throw new ApiError('AUTH_REQUIRED', 401, 'Re-enter your password to approve this action.');
      }
    }
    // Idempotent resubmit returns the original record without consuming quota.
    const dupe = await db.command.findFirst({
      where: { requesterSessionId: req.auth!.sessionId, idempotencyKey: body.idempotencyKey },
    });
    if (dupe) {
      if (dupe.computerId !== computerId || dupe.name !== name) {
        throw new ApiError('DUPLICATE_COMMAND', 409, 'Idempotency key already used for a different command.');
      }
      res.json(await toCommandRecord(dupe));
      return;
    }
    // Quota: N requests per window (single-instance count; Redis when scaled).
    const windowStart = new Date(Date.now() - entry.quota.windowSec * 1000);
    const recent = await db.command.count({
      where: { computerId, name, createdAt: { gt: windowStart } },
    });
    if (recent >= entry.quota.limit) {
      throw new ApiError('RATE_LIMITED', 429, 'Rate limit for this action. Try again later.');
    }
    const now = new Date();
    try {
      const created = await db.command.create({
        data: {
          id: body.commandId,
          idempotencyKey: body.idempotencyKey,
          computerId,
          requesterSessionId: req.auth!.sessionId,
          name,
          args: (body.args ?? {}) as object,
          argsRedacted: redactArgs(name, (body.args ?? {}) as Record<string, unknown>) as object,
          status: 'queued',
          expiresAt: new Date(now.getTime() + COMMAND_EXPIRY_SEC * 1000),
        },
      });
      await db.commandEvent.create({
        data: { commandId: created.id, sequence: 0, eventType: 'queued', payloadRedact: {} },
      });
      await db.auditEvent.create({
        data: {
          actorType: 'user',
          actorId: req.auth!.userId,
          computerId,
          action: `command.${name}`,
          outcome: 'queued',
          ipContext: req.ip,
        },
      });
      res.status(201).json(await toCommandRecord(created));
      // Low-latency push hint to a connected agent; polling stays authoritative.
      getRealtimeHub()?.pushCommandRequest(computerId, {
        v: 1,
        type: 'command.request',
        commandId: created.id,
        idempotencyKey: created.idempotencyKey,
        computerId: created.computerId,
        name: created.name,
        args: (body.args ?? {}) as Record<string, unknown>,
        requestedAt: created.createdAt.toISOString(),
        expiresAt: created.expiresAt.toISOString(),
        requestContext: { mobileSessionId: req.auth!.sessionId },
      });
    } catch (e: unknown) {
      // Race on (session, idempotencyKey) or commandId reuse.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') {
        const existing = await db.command.findFirst({
          where: { requesterSessionId: req.auth!.sessionId, idempotencyKey: body.idempotencyKey },
        });
        if (existing) {
          res.json(await toCommandRecord(existing));
          return;
        }
        throw new ApiError('DUPLICATE_COMMAND', 409, 'Command already submitted.');
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

async function loadOwnedCommand(commandId: string, userId: string) {
  if (!z.string().uuid().safeParse(commandId).success) {
    throw new ApiError('INVALID_ARGUMENT', 400, 'Invalid command id.');
  }
  const command = await db.command.findUnique({
    where: { id: commandId },
    include: { computer: true },
  });
  if (!command || command.computer.ownerUserId !== userId || command.computer.revokedAt) {
    throw new ApiError('NOT_OWNER', 403, 'Command not found.');
  }
  return command;
}

commandsRouter.get('/commands/:id', requireAuth, async (req, res, next) => {
  try {
    res.json(await toCommandRecord(await loadOwnedCommand(req.params.id, req.auth!.userId)));
  } catch (err) {
    next(err);
  }
});

commandsRouter.get('/computers/:id/commands', requireAuth, async (req, res, next) => {
  try {
    const computer = await db.computer.findUnique({ where: { id: req.params.id } });
    if (!computer || computer.ownerUserId !== req.auth!.userId || computer.revokedAt) {
      throw new ApiError('NOT_OWNER', 403, 'Computer not found.');
    }
    const rows = await db.command.findMany({
      where: { computerId: computer.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(await Promise.all(rows.map(toCommandRecord)));
  } catch (err) {
    next(err);
  }
});

const resultSchema = z
  .object({
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
    result: z.record(z.unknown()).nullable().default(null),
    error: z.object({ code: z.string().max(64), message: z.string().max(500) }).nullable().default(null),
  })
  .strict();

// --- Agent: report progress / final result (monotonic sequence per command) ---
commandsRouter.post('/commands/:id/result', async (req, res, next) => {
  try {
    const body = resultSchema.parse(req.body);
    const command = await db.command.findUnique({ where: { id: req.params.id } });
    if (!command) throw Errors.notFound('Command not found.');
    await requireAgent({ header: (n: string) => req.header(n), params: { id: command.computerId } });
    const updated = await applyCommandResult(command.id, body);
    getRealtimeHub()?.hintCommandResult(command.computerId, command.id);
    res.json(await toCommandRecord(updated));
  } catch (err) {
    next(err);
  }
});
