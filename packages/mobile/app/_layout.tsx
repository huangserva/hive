import 'react-native-get-random-values'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { MobileRuntimeProvider } from '../src/api/mobile-runtime-context'
import { ErrorBoundary, OfflineBanner } from '../src/components/ErrorBoundary'
import { LanguageProvider } from '../src/i18n'
import { installNotificationHandlers } from '../src/notifications'

export default function RootLayout() {
  useEffect(() => installNotificationHandlers(), [])

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <ErrorBoundary>
          <MobileRuntimeProvider>
            <OfflineBanner />
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </MobileRuntimeProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </SafeAreaProvider>
  )
}
