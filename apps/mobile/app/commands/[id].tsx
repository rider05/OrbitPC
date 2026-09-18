import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CommandTimeline } from '../../src/components/CommandTimeline';
import { ActionButton, Card, Muted, StatusBadge } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { friendlyError } from '../../src/lib/errors';
import { useCommandUpdates, useCommandPolling } from '../../src/lib/socket';
import type { CommandRecord } from '../../src/protocol/types';
import { isSafeToRetry } from '../../src/protocol/types';
import { newId } from '../../src/lib/ids';
import { colors, spacing } from '../../src/theme/tokens';

export default function CommandDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [command, setCommand] = useState<CommandRecord | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id) api.getCommand(id).then(setCommand).catch(() => {});
  }, [id]);

  useCommandUpdates((cmd) => {
    if (cmd.id === id) setCommand(cmd);
  });

  useCommandPolling(typeof id === 'string' ? id : undefined, true, (cmd) => {
    if (cmd.id === id) setCommand(cmd);
  });

  if (!command) {
    return (
      <View style={styles.wrap}>
        <Muted>Loading command…</Muted>
      </View>
    );
  }

  const safe = isSafeToRetry(command.name, command.status);

  async function retry() {
    const c = command;
    if (!c) return;
    if (!safe) {
      Alert.alert('Do not resend', 'Destructive actions that already dispatched must never auto-retry. Wait for boot-ID reconciliation.');
      return;
    }
    setBusy(true);
    try {
      // Safe retry reuses the SAME idempotency key (idempotent only).
      const next = await api.submitCommand(c.computerId, c.name, {}, c.idempotencyKey, newId());
      setCommand(next);
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Retry failed', friendlyError(err.code, err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.wrap}>
      <Card>
        <Text style={styles.title}>{command.name}</Text>
        <StatusBadge status={command.status} />
        <Muted>Created {new Date(command.createdAt).toLocaleString()}</Muted>
        <Muted>Sequence {command.sequence} • idempotency retained until resolved</Muted>
        {command.errorCode ? <Text style={styles.err}>{friendlyError(command.errorCode, command.errorCode)}</Text> : null}
      </Card>
      <Card>
        <Text style={styles.title}>Timeline</Text>
        <CommandTimeline command={command} />
      </Card>
      {safe ? (
        <ActionButton title="Retry (same idempotency key)" onPress={retry} loading={busy} />
      ) : (
        <Muted>Destructive or uncertain commands cannot be retried from here.</Muted>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  err: { color: colors.danger, marginTop: spacing.sm },
});
