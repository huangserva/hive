import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { MobileRuntimeProvider } from '../src/api/mobile-runtime-context'
import { installNotificationHandlers } from '../src/notifications'

export default function RootLayout() {
  useEffect(() => installNotificationHandlers(), [])

  return (
    <SafeAreaProvider>
      <MobileRuntimeProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </MobileRuntimeProvider>
    </SafeAreaProvider>
  )
}
