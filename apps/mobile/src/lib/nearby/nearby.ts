/**
 * Nearby route contracts — mobile-local mirror.
 * Source of truth: packages/protocol/src/nearby.ts (same values).
 * Kept local so the Expo app builds standalone without the workspace package.
 */

export type ConnectionRoute = 'lan' | 'ble' | 'cloud';

/** Preference chosen by the user: LAN first, BLE-data fallback, cloud fallback. */
export const TRANSPORT_PREFERENCE: ConnectionRoute[] = ['lan', 'ble', 'cloud'];

export const NEARBY_LAN_DEFAULT_PORT = 11430;
export const NEARBY_BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

/** Freshness window for a discovered endpoint before a re-scan is required. */
export const NEARBY_ENDPOINT_TTL_MS = 30_000;
export const NEARBY_LAN_PROBE_TIMEOUT_MS = 2_500;

export interface NearbyEndpoint {
  computerId: string;
  host?: string;
  port: number;
  blePeripheralId?: string;
  route: Exclude<ConnectionRoute, 'cloud'>;
  rssi?: number;
  discoveredAt: string; // ISO
}

export function isNearbyEndpointFresh(ep: NearbyEndpoint, now: number = Date.now()): boolean {
  const t = Date.parse(ep.discoveredAt);
  if (Number.isNaN(t)) return false;
  return now - t <= NEARBY_ENDPOINT_TTL_MS;
}

export function pickNearbyRoute(endpoints: NearbyEndpoint[], now: number = Date.now()): NearbyEndpoint | null {
  const fresh = endpoints.filter((e) => isNearbyEndpointFresh(e, now));
  for (const route of TRANSPORT_PREFERENCE) {
    if (route === 'cloud') return null;
    const hit = fresh.find((e) => e.route === route);
    if (hit) return hit;
  }
  return null;
}
