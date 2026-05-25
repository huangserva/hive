import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { MobileRuntimeProvider } from '../src/api/mobile-runtime-context'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MobileRuntimeProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </MobileRuntimeProvider>
    </SafeAreaProvider>
  )
}
