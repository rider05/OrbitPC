import { useLocalSearchParams, Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Button, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { io as sioClient, type Socket as ClientSocket } from 'socket.io-client';
import { getApiUrl } from '../src/lib/config';
import { loadSession } from '../src/lib/secure-store';
import { colors, spacing } from '../src/theme/tokens';
import { frameUri, isValidScreenFrame, type ScreenFrameMsg } from '../src/lib/screen-frame';

type ScreenFrame = ScreenFrameMsg;

export default function ScreenViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [frame, setFrame] = useState<ScreenFrame | null>(null);
  const [running, setRunning] = useState(false);
  const socketRef = useRef<ClientSocket | null>(null);

  useEffect(() => {
    if (!id) return;
    let closed = false;
    (async () => {
      const tokens = await loadSession();
      if (!tokens || closed) return;
      const s = sioClient(getApiUrl() + '/socket', {
        auth: { token: tokens.accessToken },
        transports: ['websocket'],
        reconnectionDelayMax: 60_000,
      });
      socketRef.current = s;
      s.on('screen.frame', (f: ScreenFrame) => {
        if (f?.computerId === id && isValidScreenFrame(f)) setFrame(f);
      });
    })().catch(() => {});
    return () => {
      closed = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [id]);

  const start = () => {
    socketRef.current?.emit('screen.start', { computerId: id, fps: 2 });
    setRunning(true);
  };

  const stop = () => {
    socketRef.current?.emit('screen.stop', { computerId: id });
    setRunning(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>Remote Screen</Text>
      <Text style={styles.sub}>{id}</Text>
      <View style={styles.row}>
        <Button title={running ? 'Stop' : 'Start'} onPress={running ? stop : start} />
      </View>
      {frame ? (
        <Image
          style={styles.frame}
          source={{ uri: frameUri(frame.format, frame.frameBase64) }}
          resizeMode="contain"
        />
      ) : (
        <Text style={styles.muted}>No frame yet. Press Start.</Text>
      )}
      <Link href={{ pathname: '/computers/[id]', params: { id } }} asChild>
        <Button title="Back to dashboard" />
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  sub: { color: colors.muted },
  row: { flexDirection: 'row' },
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 8 },
  muted: { color: colors.muted },
});
