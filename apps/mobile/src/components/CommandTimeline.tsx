import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CommandRecord } from '../protocol/types';
import { colors, spacing } from '../theme/tokens';

/** Authoritative command-state timeline. Never claims success optimistically. */
const ORDER = ['queued', 'delivered', 'acknowledged', 'running', 'succeeded'] as const;

export function CommandTimeline({ command }: { command: CommandRecord }) {
  const steps = command.status === 'timed_out' ? [...ORDER, 'timed_out' as const] : ORDER;
  return (
    <View style={styles.wrap}>
      {steps.map((s) => {
        const reached = stepIndex(command.status) >= stepIndex(s);
        const active = command.status === s;
        return (
          <View key={s} style={styles.row}>
            <View style={[styles.pip, reached && styles.pipOn, active && styles.pipActive]} />
            <Text style={[styles.label, reached && styles.labelOn]}>
              {s === 'timed_out' ? 'uncertain — verifying via reboot' : s}
            </Text>
          </View>
        );
      })}
      {command.errorCode ? <Text style={styles.err}>Error: {command.errorCode}</Text> : null}
    </View>
  );
}

function stepIndex(s: string): number {
  const i = (ORDER as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  if (s === 'timed_out') return ORDER.length;
  if (s === 'failed' || s === 'rejected' || s === 'expired' || s === 'cancelled') return 1;
  return 0;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pip: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  pipOn: { backgroundColor: colors.accent },
  pipActive: { borderWidth: 2, borderColor: colors.text },
  label: { color: colors.muted, textTransform: 'capitalize', fontSize: 13 },
  labelOn: { color: colors.text, fontWeight: '700' },
  err: { color: colors.danger, marginTop: spacing.sm, fontSize: 13 },
});
