import { useEffect, useState } from 'react';
import { NearbyManager } from './NearbyManager';
import type { ConnectionRoute } from './nearby';

/** Live route badge state for one computer (lan | ble | cloud). */
export function useNearbyRoute(computerId: string | undefined): ConnectionRoute {
  const [route, setRoute] = useState<ConnectionRoute>(() => (computerId ? NearbyManager.routeFor(computerId) : 'cloud'));
  useEffect(() => {
    if (!computerId) return;
    setRoute(NearbyManager.routeFor(computerId));
    return NearbyManager.subscribe(() => setRoute(NearbyManager.routeFor(computerId)));
  }, [computerId]);
  return route;
}

export function routeLabel(route: ConnectionRoute): string {
  if (route === 'lan') return 'Nearby • Wi-Fi';
  if (route === 'ble') return 'Nearby • Bluetooth';
  return 'Cloud relay';
}
