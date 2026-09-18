import * as SecureStore from 'expo-secure-store';
import type { CommandName, CommandRecord } from '../../protocol/types';
import { newId } from '../ids';
import {
  NEARBY_ENDPOINT_TTL_MS,
  NEARBY_LAN_DEFAULT_PORT,
  NEARBY_LAN_PROBE_TIMEOUT_MS,
  isNearbyEndpointFresh,
  pickNearbyRoute,
  type ConnectionRoute,
  type NearbyEndpoint,
} from './nearby';

/**
 * NearbyManager — LAN-first, BLE-data fallback, cloud fallback.
 *
 * - Auto-connect entry: `autoConnect()` runs on app open + foreground
 *   (wired in AuthContext) and on computer-list focus. Never throws.
 * - Discovery: probes remembered LAN hosts (`/nearby/health`), then an
 *   injectable BLE scanner (no-op until a native BLE lib is installed).
 * - Commands: `submitBestEffort()` tries LAN WebSocket → BLE transport →
 *   cloud HTTPS. Same v1 envelopes + idempotency keys on every route.
 */

export interface BleBeaconHit {
  computerId: string;
  peripheralId: string;
  lanPort?: number;
  rssi?: number;
}

export interface BleScanner {
  scan(timeoutMs: number): Promise<BleBeaconHit[]>;
}

export interface BleTransport {
  send(envelope: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

interface LanHealth {
  ok: boolean;
  computerId: string;
}

const HOSTS_KEY = 'orbitpc.lanHosts.v1';
const TOKENS_KEY = 'orbitpc.lanTokens.v1';

const noBleScanner: BleScanner = { scan: async () => [] };

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function loadKnownHosts(): Promise<Record<string, string[]>> {
  try {
    const raw = await SecureStore.getItemAsync(HOSTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

async function saveKnownHosts(map: Record<string, string[]>): Promise<void> {
  try {
    await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(map));
  } catch {
    // best effort — discovery still works in-memory
  }
}

async function loadLanTokens(): Promise<Record<string, string>> {
  try {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const TERMINAL = new Set(['succeeded', 'failed', 'rejected', 'expired', 'cancelled', 'timed_out']);

function sendViaLanWs(host: string, port: number, envelope: Record<string, unknown>, token?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      // LAN bearer travels outside the frozen envelope (query param).
      const url = token ? `ws://${host}:${port}/nearby?token=${encodeURIComponent(token)}` : `ws://${host}:${port}/nearby`;
      ws = new WebSocket(url);
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error('LAN command timed out'));
    }, 25_000);
    ws.onopen = () => {
      try { ws.send(JSON.stringify(envelope)); } catch (e) { clearTimeout(timer); reject(e); }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String((ev as MessageEvent).data)) as { type?: string; commandId?: string; status?: string };
        if (msg?.type !== 'command.result') return;
        if (msg.commandId !== (envelope as { commandId: string }).commandId) return;
        if (msg.status && TERMINAL.has(msg.status)) {
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          resolve(msg as unknown as Record<string, unknown>);
        }
      } catch { /* ignore malformed */ }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('LAN send failed')); };
  });
}

class NearbyManagerImpl {
  private endpoints = new Map<string, NearbyEndpoint[]>();
  private listeners = new Set<() => void>();
  private lastRoute = new Map<string, ConnectionRoute>();
  private scanning = false;
  bleScanner: BleScanner = noBleScanner;
  bleTransport: BleTransport | null = null;

  setBleAdapter(scanner: BleScanner, transport: BleTransport | null): void {
    this.bleScanner = scanner;
    this.bleTransport = transport;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    this.listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }

  endpointsFor(computerId: string): NearbyEndpoint[] {
    return (this.endpoints.get(computerId) ?? []).filter((e) => isNearbyEndpointFresh(e));
  }

  routeFor(computerId: string): ConnectionRoute {
    const hit = pickNearbyRoute(this.endpoints.get(computerId) ?? []);
    return hit ? hit.route : 'cloud';
  }

  lastUsedRoute(computerId: string): ConnectionRoute {
    return this.lastRoute.get(computerId) ?? 'cloud';
  }

  /** Remember a LAN host (Settings field + auto-learned from probes). */
  async rememberLanHost(computerId: string, host: string): Promise<void> {
    const map = await loadKnownHosts();
    const list = [host, ...(map[computerId] ?? []).filter((h) => h !== host)].slice(0, 5);
    map[computerId] = list;
    await saveKnownHosts(map);
  }

  /** Remember the LAN bearer for a PC (Settings field; secure storage only). */
  async rememberLanToken(computerId: string, token: string): Promise<void> {
    try {
      const map = await loadLanTokens();
      if (token) map[computerId] = token;
      else delete map[computerId];
      await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(map));
    } catch { /* best effort */ }
  }

  async lanTokenFor(computerId: string): Promise<string | undefined> {
    return (await loadLanTokens())[computerId];
  }

  /**
   * Auto-connect: probe remembered LAN hosts + BLE scan. Call on app open,
   * foreground, and list focus. Resolves fast; never throws.
   */
  async autoConnect(computerIds: string[]): Promise<void> {
    if (this.scanning || computerIds.length === 0) return;
    this.scanning = true;
    try {
      const known = await loadKnownHosts();
      await Promise.all(
        computerIds.map(async (id) => {
          const hosts = known[id] ?? [];
          for (const host of hosts) {
            try {
              const res = await fetchWithTimeout(`http://${host}:${NEARBY_LAN_DEFAULT_PORT}/nearby/health`, NEARBY_LAN_PROBE_TIMEOUT_MS);
              if (!res.ok) continue;
              const body = (await res.json()) as LanHealth;
              if (body?.ok && body.computerId === id) {
                this.putEndpoint({ computerId: id, host, port: NEARBY_LAN_DEFAULT_PORT, route: 'lan', discoveredAt: new Date().toISOString() });
                break;
              }
            } catch { /* next host */ }
          }
        }),
      );
      // BLE discovery hint (no-op until a native BLE scanner is injected).
      try {
        const hits = await this.bleScanner.scan(3_000);
        const now = new Date().toISOString();
        for (const h of hits) {
          this.putEndpoint({ computerId: h.computerId, blePeripheralId: h.peripheralId, port: h.lanPort ?? NEARBY_LAN_DEFAULT_PORT, route: 'ble', rssi: h.rssi, discoveredAt: now });
        }
      } catch { /* BLE unavailable — cloud/LAN still work */ }
      this.emit();
    } finally {
      this.scanning = false;
    }
  }

  private putEndpoint(ep: NearbyEndpoint): void {
    const list = (this.endpoints.get(ep.computerId) ?? []).filter(
      (e) => !(e.route === ep.route && (e.host ?? '') === (ep.host ?? '') && (e.blePeripheralId ?? '') === (ep.blePeripheralId ?? '')),
    );
    list.push(ep);
    // Keep it bounded; TTL prunes the rest.
    this.endpoints.set(ep.computerId, list.slice(-10));
  }

  /**
   * Submit with route priority LAN → BLE → cloud. Returns the authoritative
   * record plus which route actually served it (for the route badge).
   */
  async submitBestEffort(
    computerId: string,
    name: CommandName,
    args: Record<string, unknown>,
    cloudSubmit: () => Promise<CommandRecord>,
    opts?: { sessionId?: string },
  ): Promise<{ record: CommandRecord; route: ConnectionRoute }> {
    const now = new Date();
    const envelope: Record<string, unknown> = {
      v: 1,
      type: 'command.request',
      commandId: newId(),
      idempotencyKey: newId(),
      computerId,
      name,
      args,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      requestContext: { mobileSessionId: opts?.sessionId ?? newId() },
    };

    const nearby = pickNearbyRoute(this.endpoints.get(computerId) ?? []);

    // 1) LAN direct (WebSocket to the PC agent's opt-in listener).
    if (nearby?.route === 'lan' && nearby.host) {
      try {
        const token = await this.lanTokenFor(computerId);
        const res = (await sendViaLanWs(nearby.host, nearby.port, envelope, token)) as {
          status: string; result?: Record<string, unknown> | null; error?: { code: string } | null;
        };
        this.lastRoute.set(computerId, 'lan');
        return { record: lanResultToRecord(computerId, name, envelope, res), route: 'lan' };
      } catch { /* fall through to BLE/cloud */ }
    }

    // 2) BLE data fallback (requires injected native transport).
    if ((nearby?.route === 'ble' || nearby?.route === 'lan') && this.bleTransport) {
      try {
        const res = (await this.bleTransport.send(envelope)) as {
          status: string; result?: Record<string, unknown> | null; error?: { code: string } | null;
        } | null;
        if (res && TERMINAL.has(res.status)) {
          this.lastRoute.set(computerId, 'ble');
          return { record: lanResultToRecord(computerId, name, envelope, res), route: 'ble' };
        }
      } catch { /* fall through to cloud */ }
    } else if (nearby?.route === 'ble' && !this.bleTransport) {
      // BLE seen but no data transport installed — skip straight to cloud.
    }

    // 3) Cloud relay (existing server path, authoritative audit).
    const record = await cloudSubmit();
    this.lastRoute.set(computerId, 'cloud');
    return { record, route: 'cloud' };
  }
}

function lanResultToRecord(
  computerId: string,
  name: CommandName,
  envelope: Record<string, unknown>,
  res: { status: string; result?: Record<string, unknown> | null; error?: { code: string } | null },
): CommandRecord {
  const now = new Date().toISOString();
  return {
    id: envelope.commandId as string,
    idempotencyKey: envelope.idempotencyKey as string,
    computerId,
    name,
    argsRedacted: { keys: Object.keys((envelope.args as Record<string, unknown>) ?? {}) },
    status: res.status as CommandRecord['status'],
    createdAt: envelope.requestedAt as string,
    updatedAt: now,
    expiresAt: envelope.expiresAt as string,
    resultRedacted: (res.result as Record<string, unknown>) ?? null,
    errorCode: (res.error?.code as CommandRecord['errorCode']) ?? null,
    sequence: 3,
  };
}

export const NearbyManager = new NearbyManagerImpl();

/** Re-exported for tests without pulling SecureStore side effects twice. */
export { NEARBY_ENDPOINT_TTL_MS };
