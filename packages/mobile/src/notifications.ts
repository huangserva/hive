import * as Notifications from 'expo-notifications'

export const getExpoPushToken = async () => {
  try {
    const existing = await Notifications.getPermissionsAsync()
    const permission =
      existing.status === 'granted' ? existing : await Notifications.requestPermissionsAsync()
    if (permission.status !== 'granted') return null
    const token = await Notifications.getExpoPushTokenAsync()
    return token.data
  } catch {
    return null
  }
}

export const installNotificationHandlers = () => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
  const received = Notifications.addNotificationReceivedListener(() => {})
  const response = Notifications.addNotificationResponseReceivedListener(() => {})
  return () => {
    received.remove()
    response.remove()
  }
}
