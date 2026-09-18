import { useEffect } from 'react';
import { onMockCommandChanged } from '../mocks/mock-server';
import { isMockMode, getApiUrl } from './config';
import { loadSession } from './secure-store';
import type { CommandRecord } from '../protocol/types';

const TERMINAL = new Set(['succeeded', 'failed', 'rejected', 'expired', 'cancelled', 'timed_out']);

/**
 * HTTPS fallback: poll one command until it settles. Used in real mode
 * alongside (or when) the socket hint is unavailable — the poll relay is
 * authoritative, sockets are only hints (plan.md §6).
 */
export function useCommandPolling(
  commandId: string | undefined,
  enabled: boolean,
  onUpdate: (cmd: CommandRecord) => void,
) {
  useEffect(() => {
    if (!commandId || !enabled || isMockMode()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (stopped) return;
      try {
        const { api } = await import('./api');
        const cmd = await api.getCommand(commandId);
        if (stopped) return;
        onUpdate(cmd);
        if (!TERMINAL.has(cmd.status)) {
          timer = setTimeout(poll, 3000);
        }
      } catch {
        if (!stopped) timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandId, enabled]);
}

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
