import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { ActionButton } from './ui';

/**
 * Destructive-action confirmation sheet. Never auto-confirms; caller must
 * separately enforce the recent-auth gate before submitting.
 */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel = 'Confirm',
  onCancel,
  onConfirm,
  confirming,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <ActionButton title={confirmLabel} onPress={onConfirm} danger loading={confirming} />
          <TouchableOpacity onPress={onCancel} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface2,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 14, marginTop: spacing.sm, lineHeight: 20 },
  cancel: { alignItems: 'center', padding: spacing.md },
  cancelText: { color: colors.text, fontWeight: '600' },
});
