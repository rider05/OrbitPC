import type { Server as HttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { AgentHub } from './agent-hub.js';
import { MobileHub } from './mobile-hub.js';

export interface RealtimeHub {
  /** Push a persisted command envelope to a connected agent (low-latency path). */
  pushCommandRequest(computerId: string, envelope: unknown): void;
  /** Hint to the computer owner's mobile sockets that a command changed. */
  hintCommandResult(computerId: string, commandId: string): void;
  /** Revoke: send 'revoked' + close the agent's WSS immediately. */
  closeAgentSockets(computerId: string): void;
  /** Revoke: disconnect a mobile session's sockets immediately. */
  closeSessionSockets(sessionId: string): void;
  /** HTTP server 'upgrade' handler — routes /agent to the agent WSS hub. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
}

let hub: RealtimeHub | null = null;

/** Attach the realtime relay to a long-lived HTTP server (not in serverless). */
export function attachRealtime(server: HttpServer): RealtimeHub {
  const mobileHub = new MobileHub(server);
  const agentHub = new AgentHub({ mobileHub });
  server.on('upgrade', (req, socket, head) => {
    // Agent WSS only; leave /socket.io upgrades to the socket.io engine.
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname === '/agent' || pathname === '/socket') {
      agentHub.handleUpgrade(req, socket as Duplex, head as Buffer);
    }
  });
  hub = {
    pushCommandRequest: (computerId, envelope) => agentHub.pushCommandRequest(computerId, envelope),
    hintCommandResult: (computerId, commandId) => mobileHub.hintCommandResult(computerId, commandId),
    closeAgentSockets: (computerId) => agentHub.closeComputers(computerId),
    closeSessionSockets: (sessionId) => mobileHub.closeSessionSockets(sessionId),
    handleUpgrade: (req, socket, head) => agentHub.handleUpgrade(req, socket, head),
  };
  return hub;
}

/** Access the attached hub from Express routes; null in serverless/tests. */
export function getRealtimeHub(): RealtimeHub | null {
  return hub;
}
