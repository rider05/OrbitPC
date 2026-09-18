import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { isMockMode } from '../src/lib/config';
import { friendlyError } from '../src/lib/errors';
import { colors, radius, spacing } from '../src/theme/tokens';

export default function SignIn() {
  const { signIn, register } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('you@example.com');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.includes('@') || password.length < 8) {
      Alert.alert('Check your input', 'Enter a valid email and a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await register(email.trim(), password);
      router.replace('/computers');
    } catch (e) {
      const err = e as Error & { code?: string };
      Alert.alert('Sign in failed', friendlyError(err.code, err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>OrbitPC</Text>
      <Text style={styles.sub}>Securely control your PC from anywhere.{isMockMode() ? '\n(mock backend — set EXPO_PUBLIC_API_URL for staging)' : ''}</Text>
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={colors.muted}
      />
      <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy} accessibilityRole="button">
        <Text style={styles.btnText}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={styles.switch}>
        <Text style={styles.switchText}>
          {mode === 'login' ? 'No account? Create one' : 'Have an account? Sign in'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center' },
  title: { color: colors.text, fontSize: 32, fontWeight: '800' },
  sub: { color: colors.muted, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 13, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    padding: 14,
    marginTop: 6,
  },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: spacing.lg },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  switch: { alignItems: 'center', marginTop: spacing.md },
  switchText: { color: colors.accent, fontWeight: '600' },
});
