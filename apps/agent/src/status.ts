import os from "node:os";

export interface SystemStatus {
  hostname: string;
  platform: NodeJS.Platform;
  uptimeSec: number;
  bootId: string;
  bootTime: string;
  cpuCount: number;
  loadAvg: number[];
  memTotal: number;
  memFree: number;
}

// bootId: stable per boot. Windows: tick-derived + boot time; Unix: /proc/sys/kernel/random/boot_id when present.
export async function getBootId(): Promise<string> {
  if (process.platform === "linux") {
    try {
      const fs = await import("node:fs/promises");
      const id = (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      if (id) return id;
    } catch {
      // fall through
    }
  }
  const bootTimeMs = Date.now() - os.uptime() * 1000;
  return `boot-${Math.round(bootTimeMs)}`;
}

let cache: { at: number; status: SystemStatus } | null = null;

export async function collectStatus(): Promise<SystemStatus> {
  const now = Date.now();
  if (cache && now - cache.at < 5000) return cache.status; // 5s cache per protocol
  const bootTimeMs = Date.now() - os.uptime() * 1000;
  const status: SystemStatus = {
    hostname: os.hostname(),
    platform: os.platform(),
    uptimeSec: Math.floor(os.uptime()),
    bootId: await getBootId(),
    bootTime: new Date(bootTimeMs).toISOString(),
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(),
    memTotal: os.totalmem(),
    memFree: os.freemem(),
  };
  cache = { at: now, status };
  return status;
}
