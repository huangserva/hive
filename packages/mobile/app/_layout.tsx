import 'react-native-get-random-values'

import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { MobileRuntimeProvider, useMobileRuntime } from '../src/api/mobile-runtime-context'
import { ErrorBoundary, OfflineBanner } from '../src/components/ErrorBoundary'
import { LanguageProvider } from '../src/i18n'
import { installNotificationHandlers, type MobileNotificationData } from '../src/notifications'

const openNotificationTarget = async (
  router: ReturnType<typeof useRouter>,
  selectWorkspace: (workspaceId: string) => Promise<void>,
  data: MobileNotificationData
) => {
  if (data.workspaceId) {
    await selectWorkspace(data.workspaceId)
  }

  if (data.type === 'approval' && data.approvalId) {
    router.push({ pathname: '/approval', params: { approvalId: data.approvalId } })
    return
  }

  if (data.type === 'high_ai_action') {
    router.push('/cockpit')
    return
  }

  if (data.type === 'worker_done') {
    router.push('/')
  }
}

function NotificationBridge() {
  const router = useRouter()
  const { selectWorkspace } = useMobileRuntime()

  const handleNotification = useCallback(
    (data: MobileNotificationData) => void openNotificationTarget(router, selectWorkspace, data),
    [router, selectWorkspace]
  )

  useEffect(() => {
    const cleanup = installNotificationHandlers(handleNotification)
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return
        const data = response.notification.request.content.data as MobileNotificationData
        void handleNotification(data)
      })
      .catch(() => {})
    return cleanup
  }, [handleNotification])

  return null
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <ErrorBoundary>
          <MobileRuntimeProvider>
            <NotificationBridge />
            <OfflineBanner />
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </MobileRuntimeProvider>
        </ErrorBoundary>
      </LanguageProvider>
    </SafeAreaProvider>
  )
}
