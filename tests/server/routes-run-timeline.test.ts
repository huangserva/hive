import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const servers: Array<Awaited<ReturnType<typeof startTestServer>>> = []

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close()
  }
})

const fetchJson = async (url: string, cookie?: string) => {
  const response = await fetch(url, cookie ? { headers: { cookie } } : undefined)
  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

describe('GET /api/ui/runs/:runId/timeline', () => {
  test('rejects missing UI token', async () => {
    const server = await startTestServer()
    servers.push(server)
    server.store.appendAgentRunTimelineEvent({
      eventType: 'pty_chunk',
      payloadJson: JSON.stringify({ text: 'hello' }),
      runId: 'run-1',
      workspaceId: 'ws-1',
    })

    const { status } = await fetchJson(`${server.baseUrl}/api/ui/runs/run-1/timeline`)
    expect(status).toBe(403)
  })

  test('returns tail and after windows for a run timeline', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    for (const text of ['one', 'two', 'three']) {
      server.store.appendAgentRunTimelineEvent({
        agentId: 'agent-1',
        eventType: 'pty_chunk',
        payloadJson: JSON.stringify({ text }),
        runId: 'run-1',
        workspaceId: 'ws-1',
      })
    }

    const tail = await fetchJson(
      `${server.baseUrl}/api/ui/runs/run-1/timeline?direction=tail&limit=2`,
      cookie
    )
    expect(tail.status).toBe(200)
    expect((tail.body.events as Array<Record<string, unknown>>).map((event) => event.seq)).toEqual([
      2, 3,
    ])
    expect(tail.body.start_cursor).toEqual({ epoch: 1, seq: 2 })
    expect(tail.body.end_cursor).toEqual({ epoch: 1, seq: 3 })
    expect(tail.body.gap).toBe(false)

    const after = await fetchJson(
      `${server.baseUrl}/api/ui/runs/run-1/timeline?direction=after&epoch=1&seq=1&limit=10`,
      cookie
    )
    expect(after.status).toBe(200)
    expect((after.body.events as Array<Record<string, unknown>>).map((event) => event.seq)).toEqual(
      [2, 3]
    )
    expect(after.body.has_more_after).toBe(false)
  })

  test('validates cursor parameters for before and after fetches', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const missing = await fetchJson(
      `${server.baseUrl}/api/ui/runs/run-1/timeline?direction=after`,
      cookie
    )
    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('seq and epoch are required for before/after timeline fetches')

    const badLimit = await fetchJson(
      `${server.baseUrl}/api/ui/runs/run-1/timeline?limit=500`,
      cookie
    )
    expect(badLimit.status).toBe(400)
    expect(badLimit.body.error).toBe('limit must be between 1 and 200')
  })
})
