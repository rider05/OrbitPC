import { isMockMode, getApiUrl } from './config';
import { mockApi } from '../mocks/mock-server';
import type { CommandName, Computer, CommandRecord, PairingPreview } from '../protocol/types';
import { loadSession, saveSession, clearSession } from './secure-store';

/**
 * REST client. Mock mode → in-memory mockApi. Real mode → HTTPS fetch with
 * Bearer access token + single refresh-and-retry on 401.
 */

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

async function realFetch<T>(path: string, init: RequestInit, tokens: SessionTokens | null, retry = true): Promise<T> {
  const res = await fetch(getApiUrl() + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens ? { Authorization: 'Bearer ' + tokens.accessToken } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && retry && tokens) {
    // Rotate refresh token once, then retry.
    const rot = await fetch(getApiUrl() + '/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken, sessionId: tokens.sessionId }),
    });
    if (!rot.ok) {
      await clearSession();
      throw apiError('AUTH_REQUIRED', 'Your session expired. Please sign in again.');
    }
    const next = (await rot.json()) as SessionTokens;
    await saveSession(next);
    return realFetch<T>(path, init, next, false);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw apiError(body?.error?.code ?? 'EXECUTION_FAILED', body?.error?.message ?? 'Request failed (' + res.status + ').');
  }
  return (await res.json()) as T;
}

export function apiError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (async () => {
    const tokens = await loadSession();
    return realFetch<T>(path, init, tokens);
  })();
}

export const api = {
  async login(email: string, password: string) {
    if (isMockMode()) {
      const r = await mockApi.login(email, password);
      await saveSession(r);
      return r;
    }
    const r = await realFetch<SessionTokens & { user: { email: string } }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, null, false);
    await saveSession(r);
    return r;
  },

  async register(email: string, password: string) {
    if (isMockMode()) {
      const r = await mockApi.register(email, password);
      await saveSession(r);
      return r;
    }
    const r = await realFetch<SessionTokens & { user: { email: string } }>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, null, false);
    await saveSession(r);
    return r;
  },

  async logout() {
    if (isMockMode()) {
      await mockApi.logout();
    } else {
      const tokens = await loadSession();
      if (tokens) {
        await realFetch('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ sessionId: tokens.sessionId }) }, tokens, false).catch(() => {});
      }
    }
    await clearSession();
  },

  async reauthenticate(password: string): Promise<void> {
    if (isMockMode()) {
      await mockApi.reauthenticate(password);
    } else {
      await req('/v1/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password }) });
    }
    const { markRecentAuth } = await import('./secure-store');
    await markRecentAuth();
  },

  listComputers(): Promise<Computer[]> {
    return isMockMode() ? mockApi.listComputers() : req('/v1/computers');
  },

  getComputer(id: string): Promise<Computer> {
    return isMockMode() ? mockApi.getComputer(id) : req('/v1/computers/' + id);
  },

  renameComputer(id: string, displayName: string): Promise<Computer> {
    return isMockMode()
      ? mockApi.renameComputer(id, displayName)
      : req('/v1/computers/' + id, { method: 'PATCH', body: JSON.stringify({ displayName }) });
  },

  revokeComputer(id: string): Promise<void> {
    return isMockMode()
      ? mockApi.revokeComputer(id)
      : req('/v1/computers/' + id, { method: 'DELETE' }).then(() => {});
  },

  previewPairing(codeOrId: string): Promise<PairingPreview> {
    // Real: GET pairing preview by user code; confirm via POST /pairing-sessions/:id/confirm.
    return isMockMode()
      ? mockApi.previewPairing(codeOrId)
      : req('/v1/pairing-sessions/preview?code=' + encodeURIComponent(codeOrId));
  },

  confirmPairing(pairingId: string): Promise<Computer> {
    return isMockMode()
      ? mockApi.confirmPairing(pairingId)
      : req('/v1/pairing-sessions/' + encodeURIComponent(pairingId) + '/confirm', { method: 'POST', body: '{}' });
  },

  submitCommand(computerId: string, name: CommandName, args: Record<string, unknown>, idempotencyKey: string, commandId: string): Promise<CommandRecord> {
    return isMockMode()
      ? mockApi.submitCommand(computerId, name, args, idempotencyKey, commandId)
      : req('/v1/computers/' + computerId + '/commands', {
          method: 'POST',
          body: JSON.stringify({ commandId, idempotencyKey, name, args }),
        });
  },

  getCommand(id: string): Promise<CommandRecord> {
    return isMockMode() ? mockApi.getCommand(id) : req('/v1/commands/' + id);
  },

  listCommands(computerId: string): Promise<CommandRecord[]> {
    return isMockMode() ? mockApi.listCommands(computerId) : req('/v1/computers/' + computerId + '/commands');
  },
};
