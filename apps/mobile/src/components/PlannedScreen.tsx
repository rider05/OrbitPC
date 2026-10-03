import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Muted } from './ui';
import { colors, spacing } from '../theme/tokens';

/** Placeholder for surfaces defined in OrbitPC_Complete_Plan §28 that need
 *  protocol/agent features not yet allowlisted (remote input, files, audio).
 *  The screen exists in the planned IA so navigation and QA are stable. */
export function PlannedScreen(props: { title: string; subtitle: string; note: string; linkHref?: string; linkLabel?: string }) {
  return (
    <View style={styles.wrap}>
      <Card>
        <Text style={styles.title}>{props.title}</Text>
        <Muted>{props.subtitle}</Muted>
        <Muted>{props.note}</Muted>
        {props.linkHref ? (
          <Link href={props.linkHref as never} asChild>
            <Text style={styles.link}>{props.linkLabel ?? 'Continue'} →</Text>
          </Link>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  link: { color: colors.accent, fontWeight: '600', marginTop: spacing.md },
});
