import { useEffect } from 'react';
import { onMockCommandChanged } from '../mocks/mock-server';
import { isMockMode, getApiUrl } from './config';
import { loadSession } from './secure-store';
import type { CommandRecord } from '../protocol/types';

/**
 * Live command-result subscription.
 * - Mock mode: in-memory listener (same sequence-ordered semantics).
 * - Real mode: socket.io WSS with JWT auth + auth.refresh on rotation
 *   (rooms user:{id}; cursor replay on reconnect handled server-side).
 * TODO(M1): finish real-mode socket wiring against staging (rooms, cursor,
 * re-auth within 60s of rotation). Contract frozen in docs/protocol.md.
 */
export function useCommandUpdates(onUpdate: (cmd: CommandRecord) => void) {
  useEffect(() => {
    if (isMockMode()) {
      return onMockCommandChanged(onUpdate);
    }
    let closed = false;
    let socket: { disconnect: () => void } | null = null;
    (async () => {
      const tokens = await loadSession();
      if (!tokens || closed) return;
      const { io } = await import('socket.io-client');
      const s = io(getApiUrl() + '/socket', {
        auth: { token: tokens.accessToken },
        transports: ['websocket'],
        reconnectionDelayMax: 60_000,
      });
      socket = s;
      s.on('command.result', (msg: { commandId: string }) => {
        // Authoritative state via HTTPS; socket is a hint (plan.md §6).
        import('./api').then(({ api }) => api.getCommand(msg.commandId).then(onUpdate).catch(() => {}));
      });
      s.on('connect', () => {
        // Re-auth live socket after every access-token refresh.
        loadSession().then((t) => {
          if (t) s.emit('auth.refresh', { token: t.accessToken });
        });
      });
    })().catch(() => {});
    return () => {
      closed = true;
      socket?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
