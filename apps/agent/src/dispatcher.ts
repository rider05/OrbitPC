import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_COMMAND_MESSAGE_BYTES,
  commandArgsSchemas,
  isExpired,
  isMessageTooLarge,
  isOutsideClockSkew,
  type CommandName,
  type CommandRequest,
  type CommandResult,
  type CommandStatus,
  type ErrorCode,
} from "@orbit/protocol";
import { checkPolicy } from "./policy.js";
import {
  captureScreen,
  getStatus,
  launchApp,
  lockWorkstation,
  powerOps,
  setClipboardText,
  showNotification,
  type AdapterContext,
} from "./windows-adapter.js";
import { AuditWriter } from "./audit.js";

export interface DispatcherOptions {
  computerId: string;
  adapterCtx: AdapterContext;
  clipboardOptIn: boolean;
  allowPowerOps: boolean;
  allowedApps: Record<string, string>;
  allowScreenCapture?: boolean;
  dataDir: string;
  audit: AuditWriter;
  commandTimeoutMs?: number;
}

const DESTRUCTIVE: CommandName[] = ["system.sleep", "system.restart", "system.shutdown"];

export class CommandDispatcher {
  private seen = new Set<string>();
  private queue: CommandRequest[] = [];
  private running = false;
  private seqByCommand = new Map<string, number>();
  private storeFile: string;
  private ready: Promise<void>;

  constructor(private opts: DispatcherOptions) {
    this.storeFile = path.join(opts.dataDir, "completed-commands.json");
    this.ready = this.loadStore();
  }

  onResult: (res: CommandResult) => void = () => {};

  private async loadStore(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storeFile, "utf8");
      const ids = JSON.parse(raw) as string[];
      for (const id of ids) this.seen.add(id);
    } catch {
      // no store yet
    }
  }

  private async persistCompleted(id: string): Promise<void> {
    this.seen.add(id);
    try {
      await fs.mkdir(this.opts.dataDir, { recursive: true });
      await fs.writeFile(this.storeFile, JSON.stringify([...this.seen].slice(-500)), "utf8");
    } catch {
      // best effort
    }
  }

  private nextSeq(commandId: string): number {
    const n = (this.seqByCommand.get(commandId) ?? 0) + 1;
    this.seqByCommand.set(commandId, n);
    return n;
  }

  /** Validate + dedup + enqueue. Emits ack/running/final via onResult. */
  async submit(raw: unknown): Promise<void> {
    await this.ready;
    if (isMessageTooLarge(raw)) return;

    // Strict envelope parse is done by caller; re-validate minimally here.
    const req = raw as CommandRequest;
    if (req.v !== 1 || req.type !== "command.request") return;

    if (req.computerId !== this.opts.computerId) {
      this.emit(makeError(req.commandId, this.nextSeq(req.commandId), "NOT_OWNER", "Wrong computer."));
      return;
    }
    if (this.seen.has(req.commandId)) {
      this.emit(makeError(req.commandId, this.nextSeq(req.commandId), "DUPLICATE_COMMAND", "Already handled.", "cancelled"));
      return;
    }
    if (isOutsideClockSkew(req.requestedAt) || isExpired(req.expiresAt)) {
      this.emit(makeError(req.commandId, this.nextSeq(req.commandId), "COMMAND_EXPIRED", "Command expired or clock skew too large.", "expired"));
      return;
    }
    if (Date.parse(req.expiresAt) <= Date.parse(req.requestedAt)) {
      this.emit(makeError(req.commandId, this.nextSeq(req.commandId), "INVALID_ARGUMENT", "Bad timestamps."));
      return;
    }
    const argSchema = commandArgsSchemas[req.name];
    if (!argSchema || !argSchema.safeParse(req.args ?? {}).success) {
      this.emit(makeError(req.commandId, this.nextSeq(req.commandId), "INVALID_ARGUMENT", "Bad arguments."));
      return;
    }
    const policy = checkPolicy({
      name: req.name,
      args: (req.args ?? {}) as Record<string, unknown>,
      clipboardOptIn: this.opts.clipboardOptIn,
      allowPowerOps: this.opts.allowPowerOps,
      allowedApps: this.opts.allowedApps,
      allowScreenCapture: this.opts.allowScreenCapture,
    });
    if (!policy.allowed) {
      this.emit(makeError(req.commandId, this.nextSeq(req.commandId), policy.code, policy.message));
      return;
    }

    this.queue.push(req);
    this.emit({ v: 1, type: "command.result", commandId: req.commandId, status: "acknowledged", sequence: this.nextSeq(req.commandId), completedAt: new Date().toISOString(), result: null, error: null });
    void this.drain();
  }

  private emit(res: CommandResult): void {
    try {
      this.onResult(res);
    } catch {
      // never throw from dispatcher
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const req = this.queue.shift()!;
        await this.execute(req);
      }
    } finally {
      this.running = false;
    }
  }

  private async execute(req: CommandRequest): Promise<void> {
    const seq = () => this.nextSeq(req.commandId);
    this.emit({ v: 1, type: "command.result", commandId: req.commandId, status: "running", sequence: seq(), completedAt: new Date().toISOString(), result: null, error: null });

    const timeoutMs = this.opts.commandTimeoutMs ?? 25_000;
    try {
      const result = await withTimeout(this.runCommand(req), timeoutMs);
      await this.persistCompleted(req.commandId);
      await this.opts.audit.write({ actor: "agent", commandId: req.commandId, name: req.name, outcome: "succeeded", args: req.args });
      this.emit({ v: 1, type: "command.result", commandId: req.commandId, status: "succeeded", sequence: seq(), completedAt: new Date().toISOString(), result, error: null });
    } catch (err) {
      const isTimeout = (err as Error)?.message === "COMMAND_TIMEOUT";
      // Destructive timeout after dispatch => timed_out; mobile shows `uncertain` until boot-ID reconcile.
      const status = isTimeout && (DESTRUCTIVE as string[]).includes(req.name) ? "timed_out" : "failed";
      const code = isTimeout ? "EXECUTION_FAILED" : "EXECUTION_FAILED";
      await this.opts.audit.write({ actor: "agent", commandId: req.commandId, name: req.name, outcome: status, args: req.args });
      if (!isTimeout) await this.persistCompleted(req.commandId);
      this.emit(makeError(req.commandId, seq(), code, err instanceof Error ? err.message : "Execution failed", status));
    }
  }

  private async runCommand(req: CommandRequest): Promise<Record<string, unknown>> {
    const args = (req.args ?? {}) as Record<string, unknown>;
    switch (req.name) {
      case "system.getStatus":
        return (await getStatus()) as unknown as Record<string, unknown>;
      case "system.lock":
        return (await lockWorkstation(this.opts.adapterCtx)) as unknown as Record<string, unknown>;
      case "app.launch":
        return (await launchApp(this.opts.adapterCtx, args.appId as string)) as unknown as Record<string, unknown>;
      case "notification.show":
        return (await showNotification(this.opts.adapterCtx, (args.title as string) ?? "OrbitPC", args.body as string)) as unknown as Record<string, unknown>;
      case "clipboard.setText":
        return (await setClipboardText(args.text as string)) as unknown as Record<string, unknown>;
      case "system.sleep":
        // Flush-then-act: result is emitted by caller BEFORE the OS sleeps where possible.
        await powerOps.sleep(this.opts.adapterCtx);
        return { sleepInitiated: true };
      case "system.restart":
        await powerOps.restart(this.opts.adapterCtx);
        return { restartInitiated: true };
      case "system.shutdown":
        await powerOps.shutdown(this.opts.adapterCtx);
        return { shutdownInitiated: true };
      case "screen.capture": {
        const fmt = (args.format as 'png' | 'jpeg' | undefined) ?? 'png';
        return captureScreen(this.opts.adapterCtx, fmt) as unknown as Record<string, unknown>;
      }
      default:
        throw new Error("Not allowlisted");
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("COMMAND_TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function makeError(
  commandId: string,
  sequence: number,
  code: ErrorCode,
  message: string,
  status: CommandStatus = "rejected",
): CommandResult {
  return {
    v: 1,
    type: "command.result",
    commandId,
    status,
    sequence,
    completedAt: new Date().toISOString(),
    result: null,
    error: { code, message },
  };
}

export { MAX_COMMAND_MESSAGE_BYTES };
