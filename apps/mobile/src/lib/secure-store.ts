import * as SecureStore from 'expo-secure-store';

/**
 * Secure-storage wrapper. Tokens live ONLY in iOS Keychain / Android
 * Keystore-backed storage (expo-secure-store). Never AsyncStorage, never logs.
 * Keys are namespaced per app install.
 */

const KEYS = {
  accessToken: 'orbitpc.accessToken',
  refreshToken: 'orbitpc.refreshToken',
  sessionId: 'orbitpc.sessionId',
  recentAuthAt: 'orbitpc.recentAuthAt',
} as const;

export async function saveSession(tokens: { accessToken: string; refreshToken: string; sessionId: string }): Promise<void> {
  await SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken);
  await SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken);
  await SecureStore.setItemAsync(KEYS.sessionId, tokens.sessionId);
  await SecureStore.setItemAsync(KEYS.recentAuthAt, new Date().toISOString());
}

export async function loadSession(): Promise<{ accessToken: string; refreshToken: string; sessionId: string } | null> {
  const [accessToken, refreshToken, sessionId] = await Promise.all([
    SecureStore.getItemAsync(KEYS.accessToken),
    SecureStore.getItemAsync(KEYS.refreshToken),
    SecureStore.getItemAsync(KEYS.sessionId),
  ]);
  if (!accessToken || !refreshToken || !sessionId) return null;
  return { accessToken, refreshToken, sessionId };
}

export async function clearSession(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
}

export async function markRecentAuth(): Promise<void> {
  await SecureStore.setItemAsync(KEYS.recentAuthAt, new Date().toISOString());
}

export async function getRecentAuthAt(): Promise<Date | null> {
  const v = await SecureStore.getItemAsync(KEYS.recentAuthAt);
  return v ? new Date(v) : null;
}

/** Redact helper for logs: never print tokens/clipboard/notification bodies. */
export function redact(value: unknown): string {
  if (typeof value === 'string') return value.length > 0 ? '〈redacted:' + value.length + ' chars〉' : '〈empty〉';
  return '〈redacted〉';
}
