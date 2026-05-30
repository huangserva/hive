import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'

export interface MobileNotificationData {
  action?: string
  approvalId?: string
  type?: string
  workspaceId?: string
}

const notificationHandler = {
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
}

const extractNotificationData = (raw: unknown): MobileNotificationData | null => {
  if (!raw || typeof raw !== 'object') return null
  return raw as MobileNotificationData
}

const getProjectId = () => {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string }; projectId?: string }
    | undefined
  return extra?.eas?.projectId ?? extra?.projectId ?? undefined
}

export const getExpoPushToken = async (): Promise<string | null> => {
  try {
    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== 'granted') return null
    const projectId = getProjectId()
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    return typeof token.data === 'string' && token.data.trim() ? token.data : null
  } catch {
    return null
  }
}

export const installNotificationHandlers = (
  onNotification?: (data: MobileNotificationData) => void | Promise<void>
) => {
  Notifications.setNotificationHandler(notificationHandler)
  const received = Notifications.addNotificationReceivedListener((notification) => {
    const data = extractNotificationData(notification.request.content.data)
    if (data) void Promise.resolve(onNotification?.(data)).catch(() => {})
  })
  const response = Notifications.addNotificationResponseReceivedListener((event) => {
    const data = extractNotificationData(event.notification.request.content.data)
    if (data) void Promise.resolve(onNotification?.(data)).catch(() => {})
  })
  return () => {
    received?.remove?.()
    response?.remove?.()
  }
}
