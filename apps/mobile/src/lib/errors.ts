import type { ErrorCode } from '../protocol/types';

/** Friendly user copy per error code. Technical detail stays in secure logs. */
export const FRIENDLY_ERRORS: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Your session expired. Please sign in again.',
  NOT_OWNER: 'This computer is not paired with your account.',
  COMPUTER_OFFLINE: 'Your PC is offline. Wake it or try again when it reconnects.',
  COMMAND_NOT_ALLOWED: 'This action is not enabled on this computer.',
  POLICY_DENIED: 'Blocked by the PC’s local policy. Check the tray app settings on your PC.',
  INVALID_ARGUMENT: 'That input was not valid. Please check and try again.',
  LOCAL_PERMISSION_DENIED: 'Windows denied this action on the PC (permissions).',
  COMMAND_EXPIRED: 'The request expired before your PC could run it. Try again.',
  DUPLICATE_COMMAND: 'This action was already sent. Check its status instead of resending.',
  EXECUTION_FAILED: 'Your PC could not complete this action.',
};

export function friendlyError(code: string | null | undefined, fallback: string): string {
  if (!code) return fallback;
  return (FRIENDLY_ERRORS as Record<string, string>)[code] ?? fallback;
}
