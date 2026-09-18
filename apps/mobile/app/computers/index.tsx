import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import { api } from '../../src/lib/api';
import { friendlyError } from '../../src/lib/errors';
import { NearbyManager } from '../../src/lib/nearby/NearbyManager';
import { useNearbyRoute, routeLabel } from '../../src/lib/nearby/useNearby';
import type { Computer } from '../../src/protocol/types';
import { ActionButton, Card, Muted, StatusBadge } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme/tokens';

function timeAgo(iso: string | null): string {
  if (!iso) return 'never seen';
  const s = Math.max(0, Math.floor((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

export default function Computers() {
  const { refreshTick, lastForegroundAt } = useAuth();
  const [computers, setComputers] = useState<Computer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listComputers();
      setComputers(list);
      setUpdatedAt(new Date());
      // Auto-connect: every app open / list focus probes nearby LAN + BLE,
      // then falls back to cloud. Never blocks the list on failure.
      NearbyManager.autoConnect(list.map((c) => c.id)).catch(() => {});
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(friendlyError(err.code, err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, refreshTick]),
  );

  return (
    <View style={styles.wrap}>
      <Muted>
        {updatedAt ? 'Last updated ' + updatedAt.toLocaleTimeString() : 'Loading…'}
        {lastForegroundAt ? ' • refetched on foreground' : ''}
      </Muted>
      {error ? (
        <Card>
          <Text style={styles.err}>{error}</Text>
          <ActionButton title="Retry" onPress={() => { setLoading(true); load(); }} />
        </Card>
      ) : null}
      <FlatList
        data={computers}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Muted>No computers paired yet. Pair your PC to begin.</Muted> : null}
        renderItem={({ item }) => (
          <ComputerRow item={item} />
        )}
      />
      <Link href="/pair" asChild>
        <TouchableOpacity style={styles.pair} accessibilityRole="button">
          <Text style={styles.pairText}>+ Pair computer</Text>
        </TouchableOpacity>
      </Link>
      <Link href="/settings" asChild>
        <TouchableOpacity style={styles.link} accessibilityRole="button">
          <Text style={styles.linkText}>Settings</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

function ComputerRow({ item }: { item: Computer }) {
  const route = useNearbyRoute(item.id);
  return (
    <Card>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.displayName}</Text>
          <Muted>
            {item.platform} • {item.agentVersion}
          </Muted>
          <Muted>
            {item.status === 'online' ? 'Online' : 'Offline'} • last seen {timeAgo(item.lastSeenAt)}
          </Muted>
          {item.bootId ? <Muted>boot {item.bootId.slice(0, 12)}…</Muted> : null}
          <Muted>{routeLabel(route)}{route !== 'cloud' ? ' • auto-connected nearby' : ''}</Muted>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <Link href={{ pathname: '/computers/[id]', params: { id: item.id } }} asChild>
        <TouchableOpacity style={styles.open} accessibilityRole="button">
          <Text style={styles.openText}>Open dashboard →</Text>
        </TouchableOpacity>
      </Link>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  err: { color: colors.danger },
  open: { marginTop: spacing.md },
  openText: { color: colors.accent, fontWeight: '700' },
  pair: { backgroundColor: colors.surface2, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  pairText: { color: colors.text, fontWeight: '700' },
  link: { alignItems: 'center', padding: spacing.md },
  linkText: { color: colors.muted, fontWeight: '600' },
});
