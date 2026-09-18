import Constants from 'expo-constants';

type Extra = { apiUrl?: string; mockMode?: boolean };

function getExtra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

/** Base URL for HTTPS REST. Override with EXPO_PUBLIC_API_URL (staging). */
export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  return getExtra().apiUrl ?? 'http://localhost:3000';
}

/**
 * Mock mode: ON when no real backend is configured or EXPO_PUBLIC_MOCK=true.
 * In mock mode the app runs against src/mocks/mock-server (fixtures +
 * in-memory command lifecycle) so UI can be built/tested standalone.
 */
export function isMockMode(): boolean {
  if (process.env.EXPO_PUBLIC_MOCK === 'false') return false;
  if (process.env.EXPO_PUBLIC_API_URL) return false;
  return getExtra().mockMode !== false;
}

export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;
export const COMMAND_EXPIRY_MS = 60 * 1000;
