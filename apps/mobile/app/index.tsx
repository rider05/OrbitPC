import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';

export default function Index() {
  const { loading, sessionId } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0F14' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={sessionId ? '/computers' : '/sign-in'} />;
}
