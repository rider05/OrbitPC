import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api } from '../src/lib/api';
import { friendlyError } from '../src/lib/errors';
import type { PairingPreview } from '../src/protocol/types';
import { ActionButton, Card, Muted } from '../src/components/ui';
import { colors, radius, spacing } from '../src/theme/tokens';
import { hasRecentAuth } from '../src/auth/AuthContext';

/**
 * Pair flow: camera-permission-at-use QR scan (pairingId only) or manual
 * user-code entry → confirmation sheet (PC name + account + expiry) →
 * POST confirm. Never types the account password on the PC.
 */
export default function Pair() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<PairingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);

  async function lookup(value: string) {
    const v = value.trim();
    if (v.length < 4) {
      Alert.alert('Invalid code', 'Enter the code shown on your PC (e.g. WXYZ-1234), or scan the QR.');
      return;
    }
    setBusy(true);
    try {
      const p = await api.previewPairing(v);
      setPreview(p);
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Pairing failed', friendlyError(err.code, err.message));
    } finally {
      setBusy(false);
    }
  }

  function onScanned(data: string) {
    if (scanned) return;
    setScanned(true);
    setScanning(false);
    // QR encodes the pairingId only — never a secret.
    lookup(extractPairingId(data));
    setTimeout(() => setScanned(false), 2000);
  }

  async function confirm() {
    if (!preview) return;
    if (!(await hasRecentAuth())) {
      Alert.alert('Recent sign-in required', 'Please sign in again on this phone before pairing a new PC.');
      router.push('/sign-in');
      return;
    }
    setBusy(true);
    try {
      const computer = await api.confirmPairing(preview.pairingId);
      Alert.alert('Paired', computer.displayName + ' is now linked to your account.');
      router.replace({ pathname: '/computers/[id]', params: { id: computer.id } });
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Pairing failed', friendlyError(err.code, err.message));
    } finally {
      setBusy(false);
    }
  }

  if (scanning) {
    if (!permission?.granted) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Camera needed for QR scan</Text>
          <Muted>Camera is used only to scan the pairing code. You can also enter the code manually.</Muted>
          <ActionButton title="Allow camera" onPress={requestPermission} />
          <TouchableOpacity onPress={() => setScanning(false)} style={styles.link}>
            <Text style={styles.linkText}>Enter code manually instead</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(r) => onScanned(r.data)}
        />
        <TouchableOpacity onPress={() => setScanning(false)} style={styles.closeScan}>
          <Text style={styles.closeScanText}>Cancel scan</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Pair this PC</Text>
      <Muted>On your PC: open the OrbitPC tray app → Pair this PC. Then scan the QR or enter the code here.</Muted>
      <ActionButton title="Scan QR code" onPress={() => setScanning(true)} />
      <Text style={styles.label}>Or enter code</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="WXYZ-1234"
        placeholderTextColor={colors.muted}
      />
      <ActionButton title="Look up PC" onPress={() => lookup(code)} loading={busy} />
      {preview ? (
        <Card>
          <Text style={styles.pcName}>{preview.computerName}</Text>
          <Muted>Account: {preview.accountEmail}</Muted>
          <Muted>Expires: {new Date(preview.expiresAt).toLocaleTimeString()}</Muted>
          <Muted>Check the name matches the PC in front of you before confirming.</Muted>
          <ActionButton title="Confirm pairing" onPress={confirm} loading={busy} />
        </Card>
      ) : null}
    </View>
  );
}

function extractPairingId(data: string): string {
  // Accept raw pairingId or orbitpc://pair/<id> deep link.
  const m = data.match(/pair\/([A-Za-z0-9-]+)/);
  return m ? m[1] : data.trim();
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: 4 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', marginBottom: spacing.sm },
  label: { color: colors.muted, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    padding: 14,
    marginTop: 6,
    fontSize: 18,
    letterSpacing: 2,
  },
  link: { alignItems: 'center', padding: spacing.md },
  linkText: { color: colors.accent, fontWeight: '600' },
  pcName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  closeScan: { position: 'absolute', bottom: 48, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', padding: 14, borderRadius: 12 },
  closeScanText: { color: '#fff', fontWeight: '700' },
});
