import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth/AuthContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0B0F14' },
          headerTintColor: '#E8EEF4',
          contentStyle: { backgroundColor: '#0B0F14' },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="computers/index" options={{ title: 'My computers' }} />
        <Stack.Screen name="computers/[id]" options={{ title: 'Computer' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair computer' }} />
        <Stack.Screen name="commands/[id]" options={{ title: 'Command' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="screen-viewer" options={{ title: 'Remote Screen' }} />
        <Stack.Screen name="touchpad" options={{ title: 'Touchpad' }} />
        <Stack.Screen name="keyboard" options={{ title: 'Keyboard' }} />
        <Stack.Screen name="files" options={{ title: 'Files' }} />
        <Stack.Screen name="clipboard" options={{ title: 'Clipboard' }} />
        <Stack.Screen name="audio" options={{ title: 'Audio' }} />
        <Stack.Screen name="apps" options={{ title: 'Apps' }} />
        <Stack.Screen name="activity" options={{ title: 'Activity' }} />
      </Stack>
    </AuthProvider>
  );
}
