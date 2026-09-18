import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import type { CommandStatus, PresenceStatus } from '../protocol/types';

export function StatusBadge({ status }: { status: PresenceStatus | CommandStatus | string }) {
  const color =
    status === 'online' || status === 'succeeded'
      ? colors.success
      : status === 'offline' || status === 'failed' || status === 'rejected'
        ? colors.danger
        : status === 'timed_out' || status === 'running'
          ? colors.warning
          : colors.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label(status)}</Text>
    </View>
  );
}

function label(s: string) {
  if (s === 'timed_out') return 'uncertain — verifying';
  return s.replace(/_/g, ' ');
}

export function ActionButton({
  title,
  onPress,
  disabled,
  danger,
  loading,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.btn, danger && styles.btnDanger, (disabled || loading) && styles.btnDisabled]}
    >
      <Text style={styles.btnText}>{loading ? 'Sending…' : title}</Text>
    </TouchableOpacity>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  btnDanger: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  muted: { color: colors.muted, fontSize: 13, marginTop: 4 },
});
