import { describe, expect, test, vi } from 'vitest'

import {
  createHighAiActionNotifier,
  createMobilePushService,
} from '../../src/server/mobile-push.js'

const firstPushBody = <T>(fetchImpl: ReturnType<typeof vi.fn>): T => {
  const request = (fetchImpl.mock.calls as Array<[string, RequestInit]>)[0]?.[1]
  return JSON.parse(String(request?.body)) as T
}

const device = (input: { id: string; push_token: string | null; revoked_at?: number | null }) => ({
  capabilities: ['read_dashboard'],
  created_at: 1,
  device_type: 'mobile',
  id: input.id,
  last_seen_at: null,
  name: input.id,
  push_token: input.push_token,
  revoked_at: input.revoked_at ?? null,
  token: `token-${input.id}`,
})

describe('mobile push service', () => {
  test('sends worker done notifications only to active devices with push tokens', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ status: 'ok' }] }))
    const service = createMobilePushService({
      fetchImpl,
      store: {
        clearMobilePushToken: vi.fn(),
        listMobileDevices: () => [
          device({ id: 'active', push_token: 'ExponentPushToken[active]' }),
          device({ id: 'missing', push_token: null }),
          device({ id: 'revoked', push_token: 'ExponentPushToken[revoked]', revoked_at: 2 }),
        ],
      } as never,
    })

    await service.notifyWorkerDone('workspace-1', 'Alice', 'Implemented push support', 'dispatch-1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body =
      firstPushBody<
        Array<{
          body: string
          data: { type: string; workspaceId: string }
          title: string
          to: string
        }>
      >(fetchImpl)
    expect(body).toEqual([
      {
        body: 'Implemented push support',
        data: { type: 'worker_done', workspaceId: 'workspace-1' },
        title: 'Alice completed a task',
        to: 'ExponentPushToken[active]',
      },
    ])
  })

  test('clears invalid Expo push tokens after a failed send response', async () => {
    const clearMobilePushToken = vi.fn()
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          {
            details: { error: 'DeviceNotRegistered' },
            status: 'error',
          },
        ],
      })
    )
    const service = createMobilePushService({
      fetchImpl,
      store: {
        clearMobilePushToken,
        listMobileDevices: () => [device({ id: 'stale', push_token: 'ExponentPushToken[stale]' })],
      } as never,
    })

    await service.notifyHighAiAction('workspace-1', 'Answer Q1')

    expect(clearMobilePushToken).toHaveBeenCalledWith('ExponentPushToken[stale]')
  })

  test('dedupes worker done notifications by dispatch id', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ status: 'ok' }] }))
    const service = createMobilePushService({
      fetchImpl,
      store: {
        clearMobilePushToken: vi.fn(),
        listMobileDevices: () => [
          device({ id: 'active', push_token: 'ExponentPushToken[active]' }),
        ],
      } as never,
    })

    await service.notifyWorkerDone('workspace-1', 'Alice', 'Done once', 'dispatch-1')
    await service.notifyWorkerDone('workspace-1', 'Alice', 'Done once', 'dispatch-1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('sends approval requested notifications to active devices with approval data', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ status: 'ok' }] }))
    const service = createMobilePushService({
      fetchImpl,
      store: {
        clearMobilePushToken: vi.fn(),
        listMobileDevices: () => [
          device({ id: 'active', push_token: 'ExponentPushToken[active]' }),
        ],
      } as never,
    })

    await service.notifyApprovalRequested('workspace-1', {
      action: 'Delete old files',
      approvalId: 'approval-1',
      risk: 'high',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body =
      firstPushBody<
        Array<{
          body: string
          data: { action: string; approvalId: string; type: string; workspaceId: string }
          title: string
          to: string
        }>
      >(fetchImpl)
    expect(body).toEqual([
      {
        body: 'Delete old files',
        data: {
          action: 'Delete old files',
          approvalId: 'approval-1',
          type: 'approval',
          workspaceId: 'workspace-1',
        },
        title: 'Approval required',
        to: 'ExponentPushToken[active]',
      },
    ])
  })

  test('notifies high aiActions once per action id', async () => {
    const notifyHighAiAction = vi.fn(async () => {})
    const notifier = createHighAiActionNotifier({ notifyHighAiAction })

    await notifier('workspace-1', [
      { id: 'q1', priority: 'high', text: 'Answer Q1' },
      { id: 'q1', priority: 'high', text: 'Answer Q1' },
      { id: 'audit1', priority: 'medium', text: 'Baseline stale' },
    ])
    await notifier('workspace-1', [{ id: 'q1', priority: 'high', text: 'Answer Q1' }])

    expect(notifyHighAiAction).toHaveBeenCalledTimes(1)
    expect(notifyHighAiAction).toHaveBeenCalledWith('workspace-1', 'Answer Q1')
  })

  test('sends critical sentinel alerts whenever heartbeat asks it to notify', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ status: 'ok' }] }))
    const service = createMobilePushService({
      fetchImpl,
      store: {
        clearMobilePushToken: vi.fn(),
        listMobileDevices: () => [
          device({ id: 'active', push_token: 'ExponentPushToken[active]' }),
        ],
      } as never,
    })

    await service.notifySentinelAlert('workspace-1', {
      dedupeKey: 'workspace-1:R2:dispatch-1',
      detail: 'report_overdue for 11m',
      ruleId: 'R2',
      suggestedAction: 'team recover dispatch-1 或 team abandon dispatch-1',
      tier: 'critical',
      title: 'Coder report_overdue',
      workspaceId: 'workspace-1',
    })
    await service.notifySentinelAlert('workspace-1', {
      dedupeKey: 'workspace-1:R2:dispatch-1',
      detail: 'report_overdue recurred after recovery',
      ruleId: 'R2',
      suggestedAction: 'team recover dispatch-1 或 team abandon dispatch-1',
      tier: 'critical',
      title: 'Coder report_overdue',
      workspaceId: 'workspace-1',
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const body =
      firstPushBody<
        Array<{
          body: string
          data: { ruleId: string; type: string; workspaceId: string }
          title: string
          to: string
        }>
      >(fetchImpl)
    expect(body).toEqual([
      {
        body: 'team recover dispatch-1 或 team abandon dispatch-1',
        data: { ruleId: 'R2', type: 'sentinel_alert', workspaceId: 'workspace-1' },
        title: 'Coder report_overdue',
        to: 'ExponentPushToken[active]',
      },
    ])
  })
})
