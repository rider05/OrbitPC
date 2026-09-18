import fs from "node:fs/promises";
import path from "node:path";

// Append-only JSONL audit log with rotation. Never write secrets/clipboard/file content.

const MAX_BYTES = 512 * 1024;

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "text" || k === "body") out[k] = `<redacted:${typeof v}:len=${String(v).length}>`;
    else out[k] = v;
  }
  return out;
}

export class AuditWriter {
  constructor(private dataDir: string) {}

  private get file(): string {
    return path.join(this.dataDir, "audit.jsonl");
  }

  async write(event: Record<string, unknown>): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...event,
        args: event.args ? redactArgs(event.args as Record<string, unknown>) : undefined,
      }) + "\n";
    await fs.appendFile(this.file, line, "utf8");
    await this.rotateIfNeeded();
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const st = await fs.stat(this.file);
      if (st.size > MAX_BYTES) {
        await fs.rename(this.file, this.file + ".1");
      }
    } catch {
      // ignore
    }
  }
}
