import { describe, expect, it } from 'vitest';
import {
  NEARBY_BLE_SERVICE_UUID,
  NEARBY_LAN_DEFAULT_PORT,
  isNearbyEndpointFresh,
  nearbyBeaconSchema,
  pickNearbyRoute,
  type NearbyEndpoint,
} from './nearby.js';

const CID = '33333333-3333-4333-8333-333333333333';

function ep(route: 'lan' | 'ble', ageMs: number): NearbyEndpoint {
  return {
    computerId: CID,
    host: '192.168.1.20',
    port: NEARBY_LAN_DEFAULT_PORT,
    route,
    discoveredAt: new Date(Date.now() - ageMs).toISOString(),
  };
}

describe('nearby transport', () => {
  it('prefers LAN over BLE over cloud', () => {
    const now = Date.now();
    expect(pickNearbyRoute([ep('ble', 0), ep('lan', 0)], undefined, now)?.route).toBe('lan');
    expect(pickNearbyRoute([ep('ble', 0)], undefined, now)?.route).toBe('ble');
    expect(pickNearbyRoute([], undefined, now)).toBeNull();
  });

  it('drops stale endpoints (TTL)', () => {
    expect(isNearbyEndpointFresh(ep('lan', 0))).toBe(true);
    expect(isNearbyEndpointFresh(ep('lan', 60_000))).toBe(false);
    expect(pickNearbyRoute([ep('lan', 60_000)], undefined, Date.now())).toBeNull();
  });

  it('accepts a minimal BLE beacon', () => {
    expect(nearbyBeaconSchema.safeParse({ v: 1, computerId: CID, bootId: 'boot-1' }).success).toBe(true);
    expect(NEARBY_BLE_SERVICE_UUID.length).toBeGreaterThan(10);
  });
});
