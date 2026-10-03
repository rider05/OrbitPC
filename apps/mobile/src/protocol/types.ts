/**
 * Frozen protocol contracts — CONSUME ONLY (mobile track).
 *
 * Source of truth: docs/protocol.md + plan.md §7–§8.
 * Owner: server track (packages/protocol). Do NOT edit shapes here to
 * "fix" the backend — file a server RFC instead (see plans/mobile-plan.md §2).
 * This copy lets mobile build against the frozen v1 contract + mock-server
 * until the shared package lands.
 */

export const PROTOCOL_VERSION = 1 as const;

export type CommandName =
  | 'system.getStatus'
  | 'system.lock'
  | 'system.sleep'
  | 'system.restart'
  | 'system.shutdown'
  | 'app.launch'
  | 'notification.show'
  | 'clipboard.setText'
  | 'screen.capture';

export type CommandStatus =
  | 'queued'
  | 'delivered'
  | 'acknowledged'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'timed_out';

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'NOT_OWNER'
  | 'COMPUTER_OFFLINE'
  | 'COMMAND_NOT_ALLOWED'
  | 'POLICY_DENIED'
  | 'INVALID_ARGUMENT'
  | 'LOCAL_PERMISSION_DENIED'
  | 'COMMAND_EXPIRED'
  | 'DUPLICATE_COMMAND'
  | 'EXECUTION_FAILED';

export interface CommandRequestEnvelope {
  v: 1;
  type: 'command.request';
  commandId: string;
  idempotencyKey: string;
  computerId: string;
  name: CommandName;
  args: Record<string, unknown>;
  requestedAt: string; // ISO
  expiresAt: string; // ISO
  requestContext: { mobileSessionId: string };
}

export interface CommandResultEnvelope {
  v: 1;
  type: 'command.result';
  commandId: string;
  status: CommandStatus;
  sequence: number;
  completedAt: string; // ISO
  result: Record<string, unknown> | null;
  error: { code: ErrorCode; message: string } | null;
}

export interface ApiErrorShape {
  error: { code: ErrorCode | string; message: string; requestId: string };
}

export type PresenceStatus = 'online' | 'offline' | 'connecting';

export interface Computer {
  id: string;
  displayName: string;
  platform: string;
  agentVersion: string;
  status: PresenceStatus;
  lastSeenAt: string | null;
  bootId: string | null;
  allowedActions: CommandName[];
}

export interface CommandRecord {
  id: string;
  idempotencyKey: string;
  computerId: string;
  name: CommandName;
  /** Redacted args — never log clipboard/notification bodies. */
  argsRedacted: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  resultRedacted: Record<string, unknown> | null;
  errorCode: ErrorCode | null;
  /** Monotonic per-command event counter (mirrors socket sequence). */
  sequence: number;
}

export interface CommandEvent {
  id: string;
  commandId: string;
  sequence: number;
  eventType: CommandStatus;
  occurredAt: string;
}

export interface PairingPreview {
  pairingId: string;
  computerName: string;
  accountEmail: string;
  expiresAt: string;
}

/** Risk metadata — drives confirm sheets + recent-auth gating. */
export const COMMAND_RISK: Record<CommandName, { destructive: boolean; requiresRecentAuth: boolean; confirm: boolean }> = {
  'system.getStatus': { destructive: false, requiresRecentAuth: false, confirm: false },
  'system.lock': { destructive: false, requiresRecentAuth: false, confirm: false },
  'app.launch': { destructive: false, requiresRecentAuth: false, confirm: false },
  'notification.show': { destructive: false, requiresRecentAuth: false, confirm: false },
  'clipboard.setText': { destructive: false, requiresRecentAuth: false, confirm: true },
  'screen.capture': { destructive: false, requiresRecentAuth: false, confirm: true },
  'system.sleep': { destructive: true, requiresRecentAuth: false, confirm: true },
  'system.restart': { destructive: true, requiresRecentAuth: true, confirm: true },
  'system.shutdown': { destructive: true, requiresRecentAuth: true, confirm: true },
};

/** Destructive commands must NEVER auto-retry once dispatched (see plan.md §20). */
export function isSafeToRetry(name: CommandName, status: CommandStatus): boolean {
  if (COMMAND_RISK[name].destructive && (status === 'timed_out' || status === 'running' || status === 'delivered')) {
    return false;
  }
  return status === 'failed' || status === 'expired' || status === 'cancelled';
}
