import { beforeEach, describe, expect, test, vi } from 'vitest'

const expoNotifications = vi.hoisted(() => ({
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
}))

vi.mock('expo-notifications', () => ({
  addNotificationReceivedListener:
    expoNotifications.addNotificationReceivedListener.mockReturnValue({
      remove: vi.fn(),
    }),
  addNotificationResponseReceivedListener:
    expoNotifications.addNotificationResponseReceivedListener.mockReturnValue({
      remove: vi.fn(),
    }),
  getExpoPushTokenAsync: expoNotifications.getExpoPushTokenAsync,
  requestPermissionsAsync: expoNotifications.requestPermissionsAsync,
  setNotificationHandler: expoNotifications.setNotificationHandler,
}))

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        eas: {
          projectId: 'project-123',
        },
      },
    },
  },
}))

import {
  getExpoPushToken,
  installNotificationHandlers,
} from '../../packages/mobile/src/notifications.js'

describe('mobile notifications helpers', () => {
  beforeEach(() => {
    expoNotifications.addNotificationReceivedListener.mockReset()
    expoNotifications.addNotificationResponseReceivedListener.mockReset()
    expoNotifications.getExpoPushTokenAsync.mockReset()
    expoNotifications.requestPermissionsAsync.mockReset()
    expoNotifications.setNotificationHandler.mockReset()
    expoNotifications.addNotificationReceivedListener.mockReturnValue({
      remove: vi.fn(),
    })
    expoNotifications.addNotificationResponseReceivedListener.mockReturnValue({
      remove: vi.fn(),
    })
  })

  test('getExpoPushToken requests permission and returns an Expo token', async () => {
    expoNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' })
    expoNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[abc]' })

    await expect(getExpoPushToken()).resolves.toBe('ExpoPushToken[abc]')
    expect(expoNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(expoNotifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'project-123',
    })
  })

  test('installNotificationHandlers forwards received and response notifications', () => {
    const onNotification = vi.fn()
    const cleanup = installNotificationHandlers(onNotification)

    expect(expoNotifications.setNotificationHandler).toHaveBeenCalledTimes(1)
    expect(expoNotifications.addNotificationReceivedListener).toHaveBeenCalledTimes(1)
    expect(expoNotifications.addNotificationResponseReceivedListener).toHaveBeenCalledTimes(1)

    const received = expoNotifications.addNotificationReceivedListener.mock.calls[0]?.[0]
    const responded = expoNotifications.addNotificationResponseReceivedListener.mock.calls[0]?.[0]
    received?.({
      request: { content: { data: { type: 'approval', approvalId: 'approval-1' } } },
    })
    responded?.({
      notification: { request: { content: { data: { type: 'worker_done' } } } },
    })

    expect(onNotification).toHaveBeenNthCalledWith(1, {
      approvalId: 'approval-1',
      type: 'approval',
    })
    expect(onNotification).toHaveBeenNthCalledWith(2, { type: 'worker_done' })

    cleanup()
    expect(
      expoNotifications.addNotificationReceivedListener.mock.results[0]?.value.remove
    ).toHaveBeenCalledTimes(1)
    expect(
      expoNotifications.addNotificationResponseReceivedListener.mock.results[0]?.value.remove
    ).toHaveBeenCalledTimes(1)
  })
})
