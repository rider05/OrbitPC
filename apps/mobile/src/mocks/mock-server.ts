import type { CommandName, CommandRecord, CommandStatus, Computer, PairingPreview } from '../protocol/types';
import { newId } from '../lib/ids';

/**
 * In-memory mock backend implementing the frozen REST/socket contract so the
 * mobile track can build M1 → M2b without waiting on the server track.
 * Swap for the real HTTPS API by setting EXPO_PUBLIC_API_URL.
 */

const nowIso = () => new Date().toISOString();

function bootId() {
  return 'boot-' + Math.floor(Date.now() / 1000).toString(16);
}

const BOOT = bootId();

export const mockComputers: Computer[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Home-Desktop',
    platform: 'windows',
    agentVersion: '0.1.0-mock',
    status: 'online',
    lastSeenAt: nowIso(),
    bootId: BOOT,
    allowedActions: ['system.getStatus', 'system.lock', 'app.launch', 'system.sleep', 'system.restart', 'system.shutdown', 'notification.show', 'clipboard.setText'],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: 'Work-Laptop (offline fixture)',
    platform: 'windows',
    agentVersion: '0.1.0-mock',
    status: 'offline',
    lastSeenAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    bootId: null,
    allowedActions: ['system.getStatus', 'system.lock'],
  },
];

const commands = new Map<string, CommandRecord>();
const byIdempotency = new Map<string, string>();
const listeners = new Set<(cmd: CommandRecord) => void>();

export function onMockCommandChanged(fn: (cmd: CommandRecord) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(cmd: CommandRecord) {
  commands.set(cmd.id, cmd);
  listeners.forEach((fn) => fn(cmd));
}

function transition(cmd: CommandRecord, status: CommandStatus, patch: Partial<CommandRecord> = {}, delayMs = 600) {
  setTimeout(() => {
    const current = commands.get(cmd.id);
    if (!current) return;
    emit({ ...current, ...patch, status, sequence: current.sequence + 1, updatedAt: nowIso() });
  }, delayMs);
}

export const mockApi = {
  async login(email: string, _password: string) {
    await sleep(500);
    if (!email.includes('@')) throw mockError('INVALID_ARGUMENT', 'Enter a valid email address.');
    return {
      accessToken: 'mock.access.' + newId(),
      refreshToken: 'mock.refresh.' + newId(),
      sessionId: newId(),
      user: { email },
    };
  },

  async register(email: string, _password: string) {
    return this.login(email, _password);
  },

  async refresh(refreshToken: string) {
    await sleep(300);
    if (!refreshToken) throw mockError('AUTH_REQUIRED', 'Session expired.');
    return { accessToken: 'mock.access.' + newId(), refreshToken: 'mock.refresh.' + newId(), sessionId: newId() };
  },

  async logout() {
    await sleep(200);
  },

  async reauthenticate(_password: string) {
    await sleep(400);
    return { recentAuthAt: nowIso() };
  },

  async listComputers(): Promise<Computer[]> {
    await sleep(350);
    return mockComputers.map((c) => ({ ...c, lastSeenAt: c.status === 'online' ? nowIso() : c.lastSeenAt }));
  },

  async getComputer(id: string): Promise<Computer> {
    await sleep(250);
    const c = mockComputers.find((x) => x.id === id);
    if (!c) throw mockError('NOT_OWNER', 'Computer not found.');
    return { ...c, lastSeenAt: c.status === 'online' ? nowIso() : c.lastSeenAt };
  },

  async renameComputer(id: string, displayName: string): Promise<Computer> {
    const c = await this.getComputer(id);
    const updated = { ...c, displayName };
    const i = mockComputers.findIndex((x) => x.id === id);
    mockComputers[i] = updated;
    return updated;
  },

  async revokeComputer(id: string): Promise<void> {
    await sleep(300);
    const i = mockComputers.findIndex((x) => x.id === id);
    if (i >= 0) mockComputers.splice(i, 1);
    // Real server closes sockets ≤60s — mock drops immediately.
  },

  async previewPairing(pairingIdOrCode: string): Promise<PairingPreview> {
    await sleep(400);
    const code = pairingIdOrCode.trim().toUpperCase();
    if (code === 'EXPIRED' || code.length < 4) throw mockError('COMMAND_EXPIRED', 'This pairing code expired. Generate a new one on your PC.');
    return {
      pairingId: code.length > 20 ? pairingIdOrCode.trim() : 'pairing-' + code,
      computerName: 'DESKTOP-MOCK',
      accountEmail: 'you@example.com',
      expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
    };
  },

  async confirmPairing(pairingId: string): Promise<Computer> {
    await sleep(600);
    if (!pairingId) throw mockError('INVALID_ARGUMENT', 'Invalid pairing session.');
    const created: Computer = {
      id: newId(),
      displayName: 'DESKTOP-MOCK',
      platform: 'windows',
      agentVersion: '0.1.0-mock',
      status: 'online',
      lastSeenAt: nowIso(),
      bootId: BOOT,
      allowedActions: ['system.getStatus', 'system.lock', 'app.launch'],
    };
    mockComputers.unshift(created);
    return created;
  },

  async submitCommand(computerId: string, name: CommandName, args: Record<string, unknown>, idempotencyKey: string, commandId: string): Promise<CommandRecord> {
    await sleep(250);
    const computer = mockComputers.find((c) => c.id === computerId);
    if (!computer) throw mockError('NOT_OWNER', 'Computer not found.');

    // Idempotency: same key → same record (plan.md §6).
    const existingId = byIdempotency.get(idempotencyKey);
    if (existingId) {
      const existing = commands.get(existingId);
      if (existing) return existing;
    }

    const destructive = name === 'system.restart' || name === 'system.shutdown' || name === 'system.sleep';
    if (computer.status !== 'online' && destructive) {
      throw mockError('COMPUTER_OFFLINE', 'Your PC is offline. Destructive actions are never queued offline.');
    }
    if (name === 'notification.show') {
      const text = String((args as { text?: unknown }).text ?? '');
      if (text.length === 0 || text.length > 200) throw mockError('INVALID_ARGUMENT', 'Notification must be 1–200 characters.');
    }
    if (name === 'clipboard.setText') {
      const text = String((args as { text?: unknown }).text ?? '');
      if (text.length === 0 || text.length > 4096) throw mockError('INVALID_ARGUMENT', 'Clipboard text must be 1–4096 characters.');
    }

    const record: CommandRecord = {
      id: commandId,
      idempotencyKey,
      computerId,
      name,
      argsRedacted: { keys: Object.keys(args) },
      status: 'queued',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      resultRedacted: null,
      errorCode: null,
      sequence: 0,
    };
    byIdempotency.set(idempotencyKey, commandId);
    emit(record);

    // Simulate agent lifecycle: delivered → acknowledged → running → final.
    transition(record, 'delivered', {}, 400);
    setTimeout(() => {
      const cur = commands.get(commandId);
      if (cur) emit({ ...cur, status: 'acknowledged', sequence: cur.sequence + 1, updatedAt: nowIso() });
      setTimeout(() => {
        const cur2 = commands.get(commandId);
        if (!cur2) return;
        if (name === 'system.restart' || name === 'system.shutdown') {
          // Destructive: simulate dispatch-then-timeout → uncertain UX.
          emit({ ...cur2, status: 'running', sequence: cur2.sequence + 1, updatedAt: nowIso() });
          transition({ ...cur2, status: 'running' }, 'timed_out', { errorCode: null }, 2500);
        } else {
          emit({ ...cur2, status: 'running', sequence: cur2.sequence + 1, updatedAt: nowIso() });
          transition(
            { ...cur2, status: 'running' },
            'succeeded',
            { resultRedacted: mockResult(name), errorCode: null },
            1400,
          );
        }
      }, 500);
    }, 700);
    return record;
  },

  async getCommand(id: string): Promise<CommandRecord> {
    await sleep(200);
    const cmd = commands.get(id);
    if (!cmd) throw mockError('INVALID_ARGUMENT', 'Command not found.');
    return cmd;
  },

  async listCommands(computerId: string): Promise<CommandRecord[]> {
    await sleep(300);
    return [...commands.values()]
      .filter((c) => c.computerId === computerId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  },
};

function mockResult(name: CommandName): Record<string, unknown> {
  switch (name) {
    case 'system.getStatus':
      return { hostname: 'DESKTOP-MOCK', uptimeSec: 12345, bootId: BOOT, batteryPct: 87, cpuPct: 12, memPct: 44 };
    case 'system.lock':
      return { locked: true };
    case 'app.launch':
      return { launched: true };
    case 'notification.show':
      return { shown: true };
    case 'clipboard.setText':
      return { length: 0 };
    default:
      return { ok: true };
  }
}

export function mockError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string; requestId?: string };
  e.code = code;
  e.requestId = newId();
  return e;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** UI-state fixtures so server/agent can verify copy without this branch. */
export const fixtures = {
  online: mockComputers[0],
  offline: mockComputers[1],
  uncertainCommand: {
    id: 'cmd-uncertain-fixture',
    name: 'system.restart',
    status: 'timed_out',
  } as const,
};
