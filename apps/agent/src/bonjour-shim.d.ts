// Optional peer dep: mDNS publish for nearby LAN discovery.
// Installed => agent advertises `_orbitpc._tcp`; missing => dynamic import in
// nearby-lan.ts falls back to remembered-IP with a warning. Kept as an ambient
// declaration so typecheck passes with or without the package present.
declare module "bonjour-service" {
  export interface PublishedService {
    on(event: "up" | "error", fn: (e?: Error) => void): void;
    stop(cb?: () => void): void;
  }
  export class Bonjour {
    publish(opts: {
      name: string;
      type: string;
      port: number;
      txt?: Record<string, string>;
    }): PublishedService;
    destroy(): void;
  }
}
