import { z } from 'zod';

/**
 * Nearby transport contracts (LAN-first, BLE-data fallback, cloud fallback).
 * Additive only — command envelopes in index.ts are unchanged. All three
 * transports carry the SAME v1 command.request / command.result envelopes,
 * same idempotency keys, same expiry/freshness rules, same allowlist.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default opt-in LAN listener port on the PC agent (loopback + LAN only). */
export const NEARBY_LAN_DEFAULT_PORT = 11430;

/** mDNS / DNS-SD service type advertised by the PC agent on the LAN. */
export const NEARBY_MDNS_SERVICE_TYPE = '_orbitpc._tcp';

/** BLE GATT service UUID used for OrbitPC nearby discovery + data fallback. */
export const NEARBY_BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

/** BLE characteristic: short discovery beacon (computerId + LAN endpoint hint). */
export const NEARBY_BLE_BEACON_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

/** BLE characteristic: command.request write / command.result notify (MTU-chunked). */
export const NEARBY_BLE_COMMAND_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

/** How long a discovered endpoint is trusted before a re-scan is required. */
export const NEARBY_ENDPOINT_TTL_MS = 30_000;

/** LAN probe timeout per host (fast fail so cloud fallback stays snappy). */
export const NEARBY_LAN_PROBE_TIMEOUT_MS = 2_500;

/** BLE scan window per auto-connect attempt. */
export const NEARBY_BLE_SCAN_MS = 8_000;

// ---------------------------------------------------------------------------
// Route + endpoint schemas
// ---------------------------------------------------------------------------

export const connectionRouteSchema = z.enum(['lan', 'ble', 'cloud']);
export type ConnectionRoute = z.infer<typeof connectionRouteSchema>;

/** Ordered preference. Default: lan → ble → cloud (user chose LAN-first). */
export const transportPreferenceSchema = z.array(connectionRouteSchema).default(['lan', 'ble', 'cloud']);
export type TransportPreference = z.infer<typeof transportPreferenceSchema>;

export const nearbyEndpointSchema = z
  .object({
    computerId: z.string().uuid(),
    /** LAN IPv4/hostname discovered via mDNS or last-known host. */
    host: z.string().min(1).max(255).optional(),
    port: z.number().int().min(1).max(65535).default(NEARBY_LAN_DEFAULT_PORT),
    /** BLE peripheral id / MAC seen during scan (data-fallback path). */
    blePeripheralId: z.string().min(1).max(100).optional(),
    route: connectionRouteSchema,
    /** RSSI / signal hint where available (display only, never auth). */
    rssi: z.number().int().min(-127).max(20).optional(),
    discoveredAt: z.string().datetime(),
  })
  .strict();

export type NearbyEndpoint = z.infer<typeof nearbyEndpointSchema>;

export function isNearbyEndpointFresh(ep: NearbyEndpoint, now: number = Date.now()): boolean {
  const t = Date.parse(ep.discoveredAt);
  if (Number.isNaN(t)) return false;
  return now - t <= NEARBY_ENDPOINT_TTL_MS;
}

/**
 * Pick the first fresh endpoint following the preference order.
 * Returns null when nothing nearby is fresh → caller uses cloud relay.
 */
export function pickNearbyRoute(
  endpoints: NearbyEndpoint[],
  preference: TransportPreference = ['lan', 'ble', 'cloud'],
  now: number = Date.now(),
): NearbyEndpoint | null {
  const fresh = endpoints.filter((e) => isNearbyEndpointFresh(e, now));
  for (const route of preference) {
    if (route === 'cloud') return null; // cloud = no nearby endpoint
    const hit = fresh.find((e) => e.route === route);
    if (hit) return hit;
  }
  return null;
}

/** Beacon payload carried over BLE (small: ids only, never secrets/tokens). */
export const nearbyBeaconSchema = z
  .object({
    v: z.literal(1),
    computerId: z.string().uuid(),
    /** Advertised LAN endpoint hint so the phone can skip mDNS. */
    lanPort: z.number().int().min(1).max(65535).default(NEARBY_LAN_DEFAULT_PORT),
    bootId: z.string().min(1).max(100),
  })
  .strict();

export type NearbyBeacon = z.infer<typeof nearbyBeaconSchema>;
