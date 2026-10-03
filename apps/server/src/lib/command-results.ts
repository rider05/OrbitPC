import { db } from './db.js';

export const TERMINAL_STATUSES = new Set([
  'succeeded',
  'failed',
  'rejected',
  'expired',
  'cancelled',
  'timed_out',
]);

/** Redact sensitive args before they are persisted or echoed to mobile. */
export function redactArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'clipboard.setText') return { textLength: String(args.text ?? '').length };
  if (name === 'notification.show') return { title: args.title, bodyLength: String(args.body ?? '').length };
  return args;
}

function redactResult(result: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result) return null;
  // Status payloads carry no user content (bootId/hostname/counters/flags) — keep.
  return result;
}

export interface CommandResultInput {
  status:
    | 'delivered'
    | 'acknowledged'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'rejected'
    | 'expired'
    | 'cancelled'
    | 'timed_out';
  sequence: number;
  result?: Record<string, unknown> | null;
  error?: { code: string; message: string } | null;
}

/**
 * Shared agent-result persistence (used by the REST result endpoint AND the
 * realtime agent hub). Idempotent: terminal states accept retransmissions;
 * stale/duplicate sequence numbers never rerun or regress.
 */
export async function applyCommandResult(commandId: string, body: CommandResultInput) {
  const command = await db.command.findUnique({ where: { id: commandId } });
  if (!command) throw new Error('Command not found.');
  if (TERMINAL_STATUSES.has(command.status)) {
    return command; // already finished: accept retransmission idempotently
  }
  const last = await db.commandEvent.findFirst({
    where: { commandId: command.id },
    orderBy: { sequence: 'desc' },
  });
  const lastSeq = last?.sequence ?? 0;
  if (body.sequence <= lastSeq) {
    return command; // stale/duplicate delivery
  }
  await db.commandEvent.create({
    data: {
      commandId: command.id,
      sequence: body.sequence,
      eventType: body.status,
      payloadRedact: {},
    },
  });
  const terminal = TERMINAL_STATUSES.has(body.status);
  const updated = await db.command.update({
    where: { id: command.id },
    data: {
      status: body.status,
      ...(terminal && body.result ? { resultRedacted: redactResult(body.result) as object } : {}),
      ...(terminal && body.error ? { errorCode: body.error.code } : {}),
    },
  });
  await db.computer.update({
    where: { id: command.computerId },
    data: { lastSeenAt: new Date() },
  });
  return updated;
}
