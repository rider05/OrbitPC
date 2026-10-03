import { beforeEach, describe, expect, it, vi } from 'vitest';

// expo-secure-store hits native keychains — mock with an in-memory map.
const mem = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void mem.set(k, v),
  getItemAsync: async (k: string) => (mem.has(k) ? mem.get(k)! : null),
  deleteItemAsync: async (k: string) => void mem.delete(k),
}));

import {
  clearSession,
  getRecentAuthAt,
  loadSession,
  markRecentAuth,
  redact,
  saveSession,
} from './secure-store';

describe('secure-store session lifecycle', () => {
  beforeEach(() => mem.clear());

  it('saves and loads a session round-trip', async () => {
    await saveSession({ accessToken: 'a', refreshToken: 'r', sessionId: 's1' });
    expect(await loadSession()).toEqual({ accessToken: 'a', refreshToken: 'r', sessionId: 's1' });
  });

  it('returns null when any field is missing', async () => {
    expect(await loadSession()).toBeNull();
    mem.set('orbitpc.accessToken', 'a');
    expect(await loadSession()).toBeNull();
  });

  it('clearSession wipes every key, including recentAuthAt', async () => {
    await saveSession({ accessToken: 'a', refreshToken: 'r', sessionId: 's1' });
    await markRecentAuth();
    await clearSession();
    expect(await loadSession()).toBeNull();
    expect(await getRecentAuthAt()).toBeNull();
  });

  it('getRecentAuthAt returns null before markRecentAuth, Date after', async () => {
    expect(await getRecentAuthAt()).toBeNull();
    await markRecentAuth();
    expect((await getRecentAuthAt())!.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('redact never leaks token material', () => {
    expect(redact('secret-token-value')).not.toContain('secret');
    expect(redact('')).toBe('〈empty〉');
    expect(redact(42)).toBe('〈redacted〉');
  });
});
