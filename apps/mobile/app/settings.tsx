import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { ActionButton, Card, Muted } from '../src/components/ui';
import { api } from '../src/lib/api';
import { isMockMode } from '../src/lib/config';
import { friendlyError } from '../src/lib/errors';
import { NearbyManager } from '../src/lib/nearby/NearbyManager';
import type { Computer } from '../src/protocol/types';
import { colors, radius, spacing } from '../src/theme/tokens';

export default function Settings() {
  const { signOut, email } = useAuth();
  const router = useRouter();
  const [computers, setComputers] = useState<Computer[]>([]);
  const [rename, setRename] = useState<Record<string, string>>({});
  const [lanHost, setLanHost] = useState<Record<string, string>>({});
  const [lanToken, setLanToken] = useState<Record<string, string>>({});
  const [nearbyMsg, setNearbyMsg] = useState<string | null>(null);

  useEffect(() => {
    api.listComputers().then(setComputers).catch(() => {});
  }, []);

  async function doRename(id: string) {
    const name = (rename[id] ?? '').trim();
    if (name.length < 2) {
      Alert.alert('Invalid name', 'Give the computer a name of at least 2 characters.');
      return;
    }
    try {
      const updated = await api.renameComputer(id, name);
      setComputers((cs) => cs.map((c) => (c.id === id ? updated : c)));
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Rename failed', friendlyError(err.code, err.message));
    }
  }

  function confirmRevoke(c: Computer) {
    Alert.alert('Revoke ' + c.displayName + '?', 'This unpairs the PC immediately (sockets close ≤60s). Audit history is kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.revokeComputer(c.id);
            setComputers((cs) => cs.filter((x) => x.id !== c.id));
          } catch (e) {
            const err = e as Error & { code?: string };
            Alert.alert('Revoke failed', friendlyError(err.code, err.message));
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.wrap}>
      <Card>
        <Text style={styles.title}>Account</Text>
        <Muted>{email ?? 'Signed in (mock session)'}</Muted>
        <Muted>Backend: {isMockMode() ? 'mock (set EXPO_PUBLIC_API_URL for staging)' : 'live'}</Muted>
        <ActionButton
          title="Sign out (revokes this session)"
          onPress={async () => {
            await signOut();
            router.replace('/sign-in');
          }}
        />
      </Card>
      <Text style={styles.section}>Computers</Text>
      {computers.map((c) => (
        <Card key={c.id}>
          <Text style={styles.title}>{c.displayName}</Text>
          <Muted>{c.status} • {c.platform}</Muted>
          <TextInput
            style={styles.input}
            placeholder="Rename computer"
            placeholderTextColor={colors.muted}
            value={rename[c.id] ?? ''}
            onChangeText={(v) => setRename((r) => ({ ...r, [c.id]: v }))}
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <ActionButton title="Rename" onPress={() => doRename(c.id)} />
            </View>
            <View style={{ flex: 1 }}>
              <ActionButton title="Revoke" danger onPress={() => confirmRevoke(c)} />
            </View>
          </View>
          <Text style={styles.section}>Nearby direct (Wi-Fi LAN)</Text>
          <Muted>Same PC on the same Wi-Fi? Enter its LAN IP once — the app auto-connects nearby on every open, cloud otherwise.</Muted>
          <TextInput
            style={styles.input}
            placeholder="e.g. 192.168.1.20"
            placeholderTextColor={colors.muted}
            value={lanHost[c.id] ?? ''}
            onChangeText={(v) => setLanHost((r) => ({ ...r, [c.id]: v }))}
            autoCapitalize="none"
          />
          <ActionButton
            title="Save LAN IP & rescan nearby"
            onPress={async () => {
              const host = (lanHost[c.id] ?? '').trim();
              if (!host) {
                Alert.alert('Enter the PC LAN IP', 'Find it on the PC agent (nearby-lan log line) or via ipconfig.');
                return;
              }
              await NearbyManager.rememberLanHost(c.id, host);
              const token = (lanToken[c.id] ?? '').trim();
              if (token) await NearbyManager.rememberLanToken(c.id, token);
              await NearbyManager.autoConnect([c.id]);
              setNearbyMsg('Nearby scan done for ' + c.displayName + ' — open its dashboard to see the route badge.');
            }}
          />
          <Muted>LAN bearer (only if the PC enforces auth: run agent with --show-lan-token).</Muted>
          <TextInput
            style={styles.input}
            placeholder="LAN token (optional)"
            placeholderTextColor={colors.muted}
            value={lanToken[c.id] ?? ''}
            onChangeText={(v) => setLanToken((r) => ({ ...r, [c.id]: v }))}
            autoCapitalize="none"
            secureTextEntry
          />
        </Card>
      ))}
      {nearbyMsg ? (
        <Card>
          <Muted>{nearbyMsg}</Muted>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.title}>Security notes</Text>
        <Muted>• Tokens live only in secure storage (Keychain / Keystore), never in logs.</Muted>
        <Muted>• Destructive actions need confirmation + fresh sign-in approval.</Muted>
        <Muted>• Push notifications (later) carry opaque text only — details load over HTTPS.</Muted>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  section: { color: colors.text, fontWeight: '800', marginVertical: spacing.sm },
  input: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    padding: 12,
    marginTop: spacing.sm,
  },
  row: { flexDirection: 'row', gap: 8 },
});
