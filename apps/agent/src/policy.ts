import type { CommandName } from "@orbit/protocol";

// PolicyEngine: local allowlist is AUTHORITATIVE. Default deny.
// Server policy view is display cache only and never overrides a local deny.

export interface PolicyInput {
  name: CommandName;
  args: Record<string, unknown>;
  clipboardOptIn: boolean;
  allowPowerOps: boolean;
  allowedApps: Record<string, string>;
  /** Screen capture is opt-in (ORBITPC_SCREEN=1) — default deny. */
  allowScreenCapture?: boolean;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: "COMMAND_NOT_ALLOWED" | "POLICY_DENIED" | "INVALID_ARGUMENT"; message: string };

const RATE_NOTE = "Denied by local policy.";

export function checkPolicy(input: PolicyInput): PolicyDecision {
  switch (input.name) {
    case "system.getStatus":
    case "system.lock":
      return { allowed: true };
    case "app.launch": {
      const appId = (input.args as { appId?: unknown }).appId;
      if (typeof appId !== "string" || !appId) {
        return { allowed: false, code: "INVALID_ARGUMENT", message: "appId is required." };
      }
      if (!Object.hasOwn(input.allowedApps, appId)) {
        return { allowed: false, code: "COMMAND_NOT_ALLOWED", message: `${RATE_NOTE} App '${appId}' is not allowlisted.` };
      }
      return { allowed: true };
    }
    case "notification.show": {
      const body = (input.args as { body?: unknown }).body;
      if (typeof body !== "string" || body.length === 0 || body.length > 200) {
        return { allowed: false, code: "INVALID_ARGUMENT", message: "Notification body must be 1-200 chars." };
      }
      return { allowed: true };
    }
    case "clipboard.setText": {
      if (!input.clipboardOptIn) {
        return { allowed: false, code: "POLICY_DENIED", message: `${RATE_NOTE} Clipboard write is opt-in and disabled.` };
      }
      const text = (input.args as { text?: unknown }).text;
      if (typeof text !== "string" || text.length === 0 || text.length > 4096) {
        return { allowed: false, code: "INVALID_ARGUMENT", message: "Clipboard text must be 1-4096 chars." };
      }
      return { allowed: true };
    }
    case "system.sleep":
    case "system.restart":
    case "system.shutdown":
      if (!input.allowPowerOps) {
        return { allowed: false, code: "POLICY_DENIED", message: `${RATE_NOTE} Power operations disabled locally.` };
      }
      return { allowed: true };
    case "screen.capture": {
      if (!input.allowScreenCapture) {
        return { allowed: false, code: "POLICY_DENIED", message: `${RATE_NOTE} Screen capture is opt-in and disabled.` };
      }
      return { allowed: true };
    }
    default:
      return { allowed: false, code: "COMMAND_NOT_ALLOWED", message: "Unknown command (default deny)." };
  }
}
