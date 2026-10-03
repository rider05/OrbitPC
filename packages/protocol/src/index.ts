import { z } from 'zod';

/**
 * Protocol v1 — frozen shared contracts.
 * Source of truth: docs/protocol.md + plan.md §7–§8.
 * Owned by server track per plans/server-plan.md §2–§3 (no silent edits;
 * breaking change => bump `v`, keep v-1 parser one release, fail closed).
 */

// ---------------------------------------------------------------------------
// Version + transport constants
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1 as const;

/** Max 64KB per command message; reject larger (docs/protocol.md). */
export const MAX_COMMAND_MESSAGE_BYTES = 64 * 1024;

/** Server time authoritative; allow ±30s clock skew on requestedAt. */
export const CLOCK_SKEW_SEC = 30;

/** Default command expiry: 60s (expiresAt enforced server-side). */
export const COMMAND_EXPIRY_SEC = 60;

/** Socket heartbeat every 20–30s; peer offline after ~75s. */
export const HEARTBEAT_INTERVAL_SEC = 25;
export const OFFLINE_AFTER_SEC = 75;

/** Agent reconnect backoff: 1s → 60s cap with jitter. */
export const RECONNECT_BASE_SEC = 1;
export const RECONNECT_CAP_SEC = 60;

/** Socket rooms (authorized server-side only, never client-claimed). */
export const roomForComputer = (id: string) => `computer:${id}`;
export const roomForUser = (id: string) => `user:${id}`;

// ---------------------------------------------------------------------------
// Error codes + REST error shape
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'NOT_OWNER',
  'COMPUTER_OFFLINE',
  'COMMAND_NOT_ALLOWED',
  'POLICY_DENIED',
  'INVALID_ARGUMENT',
  'LOCAL_PERMISSION_DENIED',
  'COMMAND_EXPIRED',
  'DUPLICATE_COMMAND',
  'EXECUTION_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

export const restErrorSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1).max(500),
        requestId: z.string().min(1).max(100),
      })
      .strict(),
  })
  .strict();

export type RestError = z.infer<typeof restErrorSchema>;

// ---------------------------------------------------------------------------
// Command catalog (MVP boundary — plan.md §8)
// ---------------------------------------------------------------------------

export const COMMAND_NAMES = [
  'system.getStatus',
  'system.lock',
  'system.sleep',
  'system.restart',
  'system.shutdown',
  'app.launch',
  'notification.show',
  'clipboard.setText',
  // M3 remote-desktop Stage 1: on-demand screen snapshot (PNG/JPEG, not a stream).
  'screen.capture',
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export const COMMAND_STATUSES = [
  'queued',
  'delivered',
  'acknowledged',
  'running',
  'succeeded',
  'failed',
  'rejected',
  'expired',
  'cancelled',
  'timed_out',
] as const;

export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export interface CommandCatalogEntry {
  name: CommandName;
  stage: 'M2a' | 'M2b' | 'M3';
  description: string;
  /** Max requests per window for this command (server-enforced). */
  quota: { limit: number; windowSec: number };
  requiresConfirmation: boolean;
  requiresRecentAuth: boolean;
  /** Destructive commands are never queued while the PC is offline. */
  rejectWhenOffline: boolean;
  destructive: boolean;
}

/**
 * Quotas from docs/protocol.md. Server enforces; agent rechecks locally.
 * - getStatus: 1 req / 5s (cached 5s)
 * - lock: 1 req / 10s
 * - sleep: 3/hr (confirm)
 * - restart/shutdown: 2/hr (confirm + 10-min recent-auth)
 * - app.launch / notification.show / clipboard.setText: 10/hr
 */
export const COMMAND_CATALOG: Record<CommandName, CommandCatalogEntry> = {
  'system.getStatus': {
    name: 'system.getStatus',
    stage: 'M2a',
    description: 'Read-only status snapshot (incl. boot ID), cached 5s.',
    quota: { limit: 1, windowSec: 5 },
    requiresConfirmation: false,
    requiresRecentAuth: false,
    rejectWhenOffline: false,
    destructive: false,
  },
  'system.lock': {
    name: 'system.lock',
    stage: 'M2a',
    description: 'Lock the Windows session immediately.',
    quota: { limit: 1, windowSec: 10 },
    requiresConfirmation: false,
    requiresRecentAuth: false,
    rejectWhenOffline: false,
    destructive: false,
  },
  'app.launch': {
    name: 'app.launch',
    stage: 'M2a',
    description: 'Launch one locally-approved app by immutable ID (no raw path/args).',
    quota: { limit: 10, windowSec: 3600 },
    requiresConfirmation: false,
    requiresRecentAuth: false,
    rejectWhenOffline: false,
    destructive: false,
  },
  'system.sleep': {
    name: 'system.sleep',
    stage: 'M2b',
    description: 'Sleep the PC (app confirmation; agent policy may deny).',
    quota: { limit: 3, windowSec: 3600 },
    requiresConfirmation: true,
    requiresRecentAuth: false,
    rejectWhenOffline: true,
    destructive: true,
  },
  'system.restart': {
    name: 'system.restart',
    stage: 'M2b',
    description: 'Restart the PC (confirm + recent-auth, 30s local abort toast).',
    quota: { limit: 2, windowSec: 3600 },
    requiresConfirmation: true,
    requiresRecentAuth: true,
    rejectWhenOffline: true,
    destructive: true,
  },
  'system.shutdown': {
    name: 'system.shutdown',
    stage: 'M2b',
    description: 'Shut down the PC (confirm + recent-auth, 30s local abort toast).',
    quota: { limit: 2, windowSec: 3600 },
    requiresConfirmation: true,
    requiresRecentAuth: true,
    rejectWhenOffline: true,
    destructive: true,
  },
  'notification.show': {
    name: 'notification.show',
    stage: 'M2b',
    description: 'Show a short notification (≤200 chars, no scripts/URLs executed).',
    quota: { limit: 10, windowSec: 3600 },
    requiresConfirmation: false,
    requiresRecentAuth: false,
    rejectWhenOffline: false,
    destructive: false,
  },
  'clipboard.setText': {
    name: 'clipboard.setText',
    stage: 'M2b',
    description: 'Set clipboard text (opt-in local policy, text only ≤4KB).',
    quota: { limit: 10, windowSec: 3600 },
    requiresConfirmation: false,
    requiresRecentAuth: false,
    rejectWhenOffline: false,
    destructive: false,
  },
  'screen.capture': {
    name: 'screen.capture',
    stage: 'M3',
    description: 'On-demand compressed screenshot (Stage 1 remote desktop; opt-in local policy).',
    quota: { limit: 12, windowSec: 60 },
    requiresConfirmation: true,
    requiresRecentAuth: false,
    rejectWhenOffline: false,
    destructive: false,
  },
};

// ---------------------------------------------------------------------------
// Per-command argument schemas (unknown fields rejected via .strict())
// ---------------------------------------------------------------------------

const noArgs = z.object({}).strict();

const appLaunchArgs = z
  .object({
    /** Immutable approved-app ID resolved locally; never a raw path. */
    appId: z.string().min(1).max(100),
  })
  .strict();

const notificationArgs = z
  .object({
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(200),
  })
  .strict();

const clipboardArgs = z
  .object({
    /** Text only, ≤4KB. */
    text: z.string().min(1).max(4096),
  })
  .strict();

const screenCaptureArgs = z
  .object({
    /** Screenshot format; agent may downscale to stay under the 64KB envelope. */
    format: z.enum(['png', 'jpeg']).default('png'),
  })
  .strict();

export const commandArgsSchemas: Record<CommandName, z.ZodTypeAny> = {
  'system.getStatus': noArgs,
  'system.lock': noArgs,
  'system.sleep': noArgs,
  'system.restart': noArgs,
  'system.shutdown': noArgs,
  'app.launch': appLaunchArgs,
  'notification.show': notificationArgs,
  'clipboard.setText': clipboardArgs,
  'screen.capture': screenCaptureArgs,
};

// ---------------------------------------------------------------------------
// Envelopes (mobile → server → agent / agent → server → mobile)
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime();

export const commandRequestSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('command.request'),
    commandId: uuidSchema,
    idempotencyKey: uuidSchema,
    computerId: uuidSchema,
    name: z.enum(COMMAND_NAMES),
    // Args validated per-command by parseCommandRequest(); base shape stays open
    // here so the union error maps to INVALID_ARGUMENT, not a shape rejection.
    args: z.record(z.unknown()).default({}),
    requestedAt: isoDateSchema,
    expiresAt: isoDateSchema,
    requestContext: z.object({ mobileSessionId: uuidSchema }).strict(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const argsSchema = commandArgsSchemas[val.name as CommandName];
    if (!argsSchema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unknown command', path: ['name'] });
      return;
    }
    const parsed = argsSchema.safeParse(val.args ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['args', ...(issue.path ?? [])] });
      }
    }
    const requested = Date.parse(val.requestedAt);
    const expires = Date.parse(val.expiresAt);
    if (Number.isNaN(requested) || Number.isNaN(expires)) return;
    if (expires <= requested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt must be after requestedAt',
        path: ['expiresAt'],
      });
    }
  });

export type CommandRequest = z.infer<typeof commandRequestSchema>;

export const commandResultSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('command.result'),
    commandId: uuidSchema,
    status: z.enum(COMMAND_STATUSES),
    /** Monotonic per commandId. */
    sequence: z.number().int().min(0),
    completedAt: isoDateSchema,
    result: z.record(z.unknown()).nullable().default(null),
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().max(500),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export type CommandResult = z.infer<typeof commandResultSchema>;

// ---------------------------------------------------------------------------
// Screen-frame envelope (M3 Stage 2 — view-only streaming over the agent WSS)
// ---------------------------------------------------------------------------

export const screenFrameSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('screen.frame'),
    computerId: uuidSchema,
    format: z.enum(['png', 'jpeg']),
    /** Monotonic per stream. */
    seq: z.number().int().min(0),
    capturedAt: isoDateSchema,
    /** Base64 encoded PNG/JPEG frame (compressed; still keep under ~128KB). */
    frameBase64: z.string().max(192 * 1024),
  })
  .strict();

export type ScreenFrame = z.infer<typeof screenFrameSchema>;

// ---------------------------------------------------------------------------
// Time / size helpers (server time authoritative)
// ---------------------------------------------------------------------------

/** Byte size of the JSON encoding; used to enforce the 64KB cap. */
export function messageByteSize(message: unknown): number {
  try {
    if (typeof message === 'string') return Buffer.byteLength(message, 'utf8');
    const json = JSON.stringify(message);
    if (json === undefined) return 0;
    return Buffer.byteLength(json, 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isMessageTooLarge(message: unknown): boolean {
  return messageByteSize(message) > MAX_COMMAND_MESSAGE_BYTES;
}

/** True when `expiresAt` has passed relative to `now` (default: server now). */
export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

/**
 * True when `requestedAt` is more than ±CLOCK_SKEW_SEC from server now.
 * Out-of-window requests are rejected with COMMAND_EXPIRED.
 */
export function isOutsideClockSkew(requestedAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(requestedAt);
  if (Number.isNaN(t)) return true;
  return Math.abs(now.getTime() - t) > CLOCK_SKEW_SEC * 1000;
}

/** Parse + validate a command.request; throws ZodError on invalid (fail closed). */
export function parseCommandRequest(input: unknown): CommandRequest {
  return commandRequestSchema.parse(input);
}

/** Parse + validate a command.result; throws ZodError on invalid. */
export function parseCommandResult(input: unknown): CommandResult {
  return commandResultSchema.parse(input);
}

// ---------------------------------------------------------------------------
// Compatibility aliases (agent track naming — same semantics, no fork)
// ---------------------------------------------------------------------------
// The agent track was scaffolded against PascalCase / short helper names.
// Both spellings are supported so server (`commandRequestSchema`) and agent
// (`CommandRequestSchema`) share one implementation and one test suite.

/** Alias: PascalCase schema name used by apps/agent. */
export const CommandRequestSchema = commandRequestSchema;
/** Alias: PascalCase schema name for results. */
export const CommandResultSchema = commandResultSchema;

/** Alias: short constant name used by apps/agent. */
export const MAX_COMMAND_BYTES = MAX_COMMAND_MESSAGE_BYTES;
/** Alias: short helper name used by apps/agent. */
export const byteSizeOf = messageByteSize;

/**
 * Freshness check used by the agent dispatcher.
 * Fails closed with COMMAND_EXPIRED when the envelope is expired,
 * outside the ±30s clock-skew window, or has unparseable timestamps.
 */
export function checkFreshness(req: Pick<CommandRequest, 'requestedAt' | 'expiresAt'>): (
  | { ok: true }
  | { ok: false; code: Extract<ErrorCode, 'COMMAND_EXPIRED'>; message: string }
) {
  const requested = Date.parse(req.requestedAt);
  const expires = Date.parse(req.expiresAt);
  if (Number.isNaN(requested) || Number.isNaN(expires)) {
    return { ok: false, code: 'COMMAND_EXPIRED', message: 'Unparseable timestamps.' };
  }
  const now = Date.now();
  if (expires <= now) {
    return { ok: false, code: 'COMMAND_EXPIRED', message: 'Command expired.' };
  }
  if (Math.abs(now - requested) > CLOCK_SKEW_SEC * 1000) {
    return { ok: false, code: 'COMMAND_EXPIRED', message: 'Clock skew too large.' };
  }
  return { ok: true };
}

/** Validate per-command args; fail-closed shape check (no execution). */
export function validateCommandArgs(
  name: string,
  args: unknown,
): { success: boolean } {
  const schema = (commandArgsSchemas as Record<string, z.ZodTypeAny>)[name];
  if (!schema) return { success: false };
  return { success: schema.safeParse(args ?? {}).success };
}

const REJECT_CODES: ReadonlySet<string> = new Set([
  'NOT_OWNER',
  'COMMAND_NOT_ALLOWED',
  'POLICY_DENIED',
  'INVALID_ARGUMENT',
  'LOCAL_PERMISSION_DENIED',
]);

/**
 * Build a terminal command.result envelope for failures.
 * Defaults to `rejected` for validation/policy denials, else `failed`;
 * callers may override (e.g. `cancelled` for duplicates, `expired`,
 * `timed_out` for destructive timeouts).
 */
export function errorResult(
  commandId: string,
  sequence: number,
  code: ErrorCode,
  message: string,
  status: CommandStatus = REJECT_CODES.has(code) ? 'rejected' : 'failed',
): CommandResult {
  return {
    v: PROTOCOL_VERSION,
    type: 'command.result',
    commandId,
    status,
    sequence,
    completedAt: new Date().toISOString(),
    result: null,
    error: { code, message },
  };
}

// Nearby transports (LAN-first, BLE-data fallback, cloud fallback).
// Same envelopes on every route — see nearby.ts.
export * from './nearby.js';
