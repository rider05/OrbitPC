import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { hasRecentAuth } from '../../src/auth/AuthContext';
import { ConfirmSheet } from '../../src/components/ConfirmSheet';
import { ActionButton, Card, Muted, StatusBadge } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { friendlyError } from '../../src/lib/errors';
import { newId } from '../../src/lib/ids';
import { useCommandUpdates } from '../../src/lib/socket';
import type { CommandName, CommandRecord, Computer } from '../../src/protocol/types';
import { colors, radius, spacing } from '../../src/theme/tokens';

const DESTRUCTIVE: Partial<Record<CommandName, string>> = {
  'system.sleep': 'Put this PC to sleep now?',
  'system.restart': 'Restart this PC now? Unsaved work may be lost. The app will show “verifying” until the PC reconnects.',
  'system.shutdown': 'Shut down this PC now? You will need physical access (or WoL) to turn it back on.',
};

export default function ComputerDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [computer, setComputer] = useState<Computer | null>(null);
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const [pending, setPending] = useState<CommandRecord | null>(null);
  const [confirming, setConfirming] = useState<CommandName | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  const [clip, setClip] = useState('');
  const [reauthPw, setReauthPw] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [c, h] = await Promise.all([api.getComputer(id), api.listCommands(id)]);
      setComputer(c);
      setHistory(h);
      setUpdatedAt(new Date());
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Failed to load', friendlyError(err.code, err.message));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useCommandUpdates((cmd) => {
    if (cmd.computerId !== id) return;
    setPending((p) => (p && p.id === cmd.id ? cmd : p));
    setHistory((h) => {
      const i = h.findIndex((x) => x.id === cmd.id);
      if (i >= 0) return h.map((x) => (x.id === cmd.id ? cmd : x));
      return [cmd, ...h];
    });
    // Resolve "uncertain" by boot-ID comparison once fresh status arrives.
    if (cmd.status === 'timed_out') load();
  });

  async function submit(name: CommandName, args: Record<string, unknown> = {}) {
    if (!id || !computer) return;
    if (computer.status !== 'online' && (name === 'system.restart' || name === 'system.shutdown' || name === 'system.sleep')) {
      Alert.alert('PC offline', friendlyError('COMPUTER_OFFLINE', ''));
      return;
    }
    if ((name === 'system.restart' || name === 'system.shutdown') && !(await hasRecentAuth())) {
      setNeedsReauth(true);
      setConfirming(name);
      return;
    }
    setSending(true);
    try {
      // Client-generated commandId + idempotencyKey; retained until resolution.
      const record = await api.submitCommand(id, name, args, newId(), newId());
      setPending(record);
      setHistory((h) => [record, ...h.filter((x) => x.id !== record.id)]);
      setConfirming(null);
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Action not sent', friendlyError(err.code, err.message));
    } finally {
      setSending(false);
    }
  }

  async function doReauth() {
    if (reauthPw.length < 8) {
      Alert.alert('Enter your password', 'Re-enter your account password to approve this action.');
      return;
    }
    try {
      await api.reauthenticate(reauthPw);
      setNeedsReauth(false);
      setReauthPw('');
      const name = confirming;
      setConfirming(null);
      if (name) submit(name);
    } catch {
      Alert.alert('Not approved', 'Could not verify your password. Try again.');
    }
  }

  if (!computer) {
    return (
      <View style={styles.wrap}>
        <Muted>Loading computer…</Muted>
      </View>
    );
  }

  const uncertain = pending?.status === 'timed_out' || pending?.status === 'running';

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
      <Card>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{computer.displayName}</Text>
            <Muted>
              {computer.status} • last seen {computer.lastSeenAt ? new Date(computer.lastSeenAt).toLocaleTimeString() : 'never'}
            </Muted>
            {computer.bootId ? <Muted>boot {computer.bootId.slice(0, 16)}…</Muted> : null}
            {updatedAt ? <Muted>Last updated {updatedAt.toLocaleTimeString()} (cached otherwise)</Muted> : null}
          </View>
          <StatusBadge status={computer.status} />
        </View>
      </Card>

      {uncertain && pending ? (
        <Card>
          <Text style={styles.uncertain}>Action uncertain — verifying</Text>
          <Muted>
            {pending.name} was dispatched but the PC hasn’t confirmed the outcome. Do NOT resend — the app resolves this
            when the PC reconnects (boot-ID comparison).
          </Muted>
          <Link href={{ pathname: '/commands/[id]', params: { id: pending.id } }} asChild>
            <Text style={styles.link}>View command timeline →</Text>
          </Link>
        </Card>
      ) : null}

      {pending && !uncertain && pending.status !== 'succeeded' ? (
        <Card>
          <Text style={styles.name}>Sending: {pending.name}</Text>
          <Muted>Authoritative state: {pending.status} (sequence {pending.sequence})</Muted>
        </Card>
      ) : null}

      <Text style={styles.section}>Status & quick actions (M2a)</Text>
      <ActionButton title="Refresh status" onPress={() => submit('system.getStatus')} loading={sending} />
      <ActionButton title="🔒 Lock PC" onPress={() => submit('system.lock')} loading={sending} />
      <ActionButton title="▶ Launch approved app" onPress={() => submit('app.launch', { appId: 'approved-app-1' })} loading={sending} />
      <Muted>app.launch uses an immutable approved-app ID. Raw paths are never sent from this app.</Muted>

      <Text style={styles.section}>Power (M2b — confirm required)</Text>
      {(['system.sleep', 'system.restart', 'system.shutdown'] as CommandName[]).map((name) => (
        <ActionButton key={name} title={name} danger onPress={() => setConfirming(name)} />
      ))}

      <Text style={styles.section}>Send to PC (M2b)</Text>
      <Text style={styles.label}>Notification (≤200 chars)</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Hello from your phone" placeholderTextColor={colors.muted} maxLength={200} />
      <ActionButton title="Show notification" onPress={() => submit('notification.show', { text: note })} disabled={note.length === 0} loading={sending} />
      <Text style={styles.label}>Clipboard text (opt-in on PC, ≤4KB)</Text>
      <TextInput style={styles.input} value={clip} onChangeText={setClip} placeholder="Text to place on PC clipboard" placeholderTextColor={colors.muted} maxLength={4096} />
      <ActionButton title="Set PC clipboard" onPress={() => submit('clipboard.setText', { text: clip })} disabled={clip.length === 0} loading={sending} />

      <Text style={styles.section}>Recent activity</Text>
      {history.length === 0 ? <Muted>No commands yet.</Muted> : null}
      {history.slice(0, 20).map((c) => (
        <Link key={c.id} href={{ pathname: '/commands/[id]', params: { id: c.id } }} asChild>
          <View style={styles.histRow}>
            <Text style={styles.histName}>{c.name}</Text>
            <StatusBadge status={c.status} />
          </View>
        </Link>
      ))}
      <Link href="/settings" asChild>
        <Text style={styles.link}>Rename / revoke in Settings →</Text>
      </Link>

      <ConfirmSheet
        visible={confirming !== null}
        title={confirming ?? ''}
        body={needsReauth ? 'This action needs a fresh sign-in approval (10-min window). Enter your password, then confirm.' : (confirming ? (DESTRUCTIVE[confirming] ?? 'Run this action?') : '')}
        confirmLabel={needsReauth ? 'Verify & continue' : 'Confirm'}
        confirming={sending}
        onCancel={() => { setConfirming(null); setNeedsReauth(false); }}
        onConfirm={() => {
          if (needsReauth) doReauth();
          else if (confirming) submit(confirming);
        }}
      />
      {needsReauth && confirming ? (
        <Card>
          <Text style={styles.label}>Account password (recent-auth proof, never stored)</Text>
          <TextInput style={styles.input} value={reauthPw} onChangeText={setReauthPw} secureTextEntry placeholder="••••••••" placeholderTextColor={colors.muted} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  head: { flexDirection: 'row', gap: 12 },
  name: { color: colors.text, fontSize: 18, fontWeight: '800' },
  section: { color: colors.text, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm },
  label: { color: colors.muted, marginTop: spacing.md, fontSize: 13 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    padding: 12,
    marginTop: 6,
  },
  uncertain: { color: colors.warning, fontWeight: '800', fontSize: 16 },
  histRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  histName: { color: colors.text, fontWeight: '600' },
  link: { color: colors.accent, fontWeight: '700', marginTop: spacing.md },
});
