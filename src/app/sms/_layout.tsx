import { Stack } from 'expo-router';
export default function SmsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" />
      <Stack.Screen name="reserved" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
