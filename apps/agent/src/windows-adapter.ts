import { spawn } from "node:child_process";
import { collectStatus } from "./status.js";

// WindowsAdapter: safe OS invocation. No shell strings, arg arrays only.
// Session-0 note: lock/toast/clipboard must run in the per-user helper (agent-ui)
// via IPC; the service never calls them directly. This module is the helper-side
// implementation; in this single-process dev build both roles run together.

export interface AdapterContext {
  allowedApps: Record<string, string>;
  dryRun: boolean; // true on dev/CI to avoid locking/sleeping the dev box
}

export async function getStatus() {
  return collectStatus();
}

export async function lockWorkstation(ctx: AdapterContext): Promise<{ locked: boolean; simulated: boolean }> {
  if (ctx.dryRun) return { locked: true, simulated: true };
  if (process.platform !== "win32") return { locked: true, simulated: true };
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    execFile("rundll32.exe", ["user32.dll,LockWorkStation"], (err) => (err ? reject(err) : resolve()));
  });
  return { locked: true, simulated: false };
}

export async function launchApp(
  ctx: AdapterContext,
  appId: string,
): Promise<{ launched: boolean; appId: string; simulated: boolean }> {
  const target = ctx.allowedApps[appId];
  if (!target) throw new Error(`App '${appId}' is not allowlisted`);
  if (ctx.dryRun) return { launched: true, appId, simulated: true };
  // Arg-array spawn only. No shell, no string concat, no caller-supplied args in MVP.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(target, [], { shell: false, detached: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("spawn", () => resolve());
    setTimeout(() => resolve(), 2000); // don't hang if spawn event stalls
  });
  return { launched: true, appId, simulated: false };
}

export async function showNotification(
  _ctx: AdapterContext,
  title: string,
  body: string,
): Promise<{ shown: boolean; simulated: boolean }> {
  if (body.length > 200) throw new Error("Notification body too long");
  // TODO(agent-ui): ToastNotification via WinRT in helper process. Console fallback for dev.
  console.log(`[notification] ${title}: ${body}`);
  return { shown: true, simulated: true };
}

export async function setClipboardText(text: string): Promise<{ set: boolean; simulated: boolean }> {
  if (text.length > 4096) throw new Error("Clipboard text too large");
  // TODO(agent-ui): real clipboard via helper (clip.exe / WinRT). Log length only — never content.
  console.log(`[clipboard] set ${text.length} chars (content redacted)`);
  return { set: true, simulated: true };
}

async function runPower(ctx: AdapterContext, exe: string, args: string[]): Promise<{ simulated: boolean }> {
  if (ctx.dryRun) {
    console.log(`[power:dry-run] ${exe} ${args.join(" ")}`);
    return { simulated: true };
  }
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    execFile(exe, args, { shell: false }, (err) => (err ? reject(err) : resolve()));
  });
  return { simulated: false };
}

export const powerOps = {
  sleep(ctx: AdapterContext) {
    if (process.platform === "win32") return runPower(ctx, "rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]);
    return runPower(ctx, process.execPath, ["--eval", ""]);
  },
  restart(ctx: AdapterContext) {
    if (process.platform === "win32") return runPower(ctx, "shutdown.exe", ["/r", "/t", "30", "/c", "OrbitPC remote restart"]);
    return runPower(ctx, process.execPath, ["--eval", ""]);
  },
  shutdown(ctx: AdapterContext) {
    if (process.platform === "win32") return runPower(ctx, "shutdown.exe", ["/s", "/t", "30", "/c", "OrbitPC remote shutdown"]);
    return runPower(ctx, process.execPath, ["--eval", ""]);
  },
};
