import net from "node:net";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Local IPC: named pipe (Windows) / unix socket (dev).
// SDACL restriction (SYSTEM + logged-in user SID) is applied at pipe creation
// in the installed service; this module owns framing (JSONL + commandId + nonce).

export const PIPE_NAME =
  process.platform === "win32" ? `\\\\.\\pipe\\OrbitPC-agent-${process.env.USERNAME || "user"}` : "/tmp/orbitpc-agent.sock";

export interface IpcMessage {
  commandId: string;
  nonce: string;
  kind: string;
  payload?: unknown;
}

export function createIpcServer(onMessage: (msg: IpcMessage, reply: (m: IpcMessage) => void) => void): net.Server {
  // Clean stale unix socket in dev.
  if (process.platform !== "win32") {
    try {
      fs.rmSync(PIPE_NAME, { force: true });
    } catch {
      // ignore
    }
  }
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as IpcMessage;
          onMessage(msg, (reply) => sock.write(JSON.stringify(reply) + "\n"));
        } catch {
          // ignore malformed
        }
      }
    });
  });
  return server;
}

export function sendIpc(msg: Omit<IpcMessage, "nonce"> & { nonce?: string }): Promise<IpcMessage> {
  return new Promise((resolve, reject) => {
    const full: IpcMessage = { nonce: randomUUID(), ...msg };
    const sock = net.connect(PIPE_NAME, () => {
      sock.write(JSON.stringify(full) + "\n");
    });
    let buf = "";
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("IPC timeout"));
    }, 5000);
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(buf.slice(0, idx)) as IpcMessage);
        } catch (e) {
          reject(e);
        }
        sock.end();
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
