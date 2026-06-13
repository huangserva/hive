import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { runTeamCommand } from '../../src/cli/team.js'

// M44 钟馗第二轮 blocking #1 最后一环：parse 段 / route→transport 段都各自有测，
// 但 CLI 把 reply.file 透传进 POST body 这段链中间没保护——产品删掉 team.ts:728
// `...(reply.file ? { file: reply.file } : {})` parse 测仍绿、route 测仍绿（手工 POST），
// 实际 CLI 反而退回纯文本无人报。本文件用 fetch 桩断言 CLI 实际打出的 HTTP body。

const REPLY_URL_SUFFIX = '/internal/feishu/outbound'

const ORIGINAL_ENV = { ...process.env }
const ENV = {
  HIVE_AGENT_ID: 'ws_x:orchestrator',
  HIVE_AGENT_TOKEN: 'test-token',
  HIVE_PORT: '4099',
  HIVE_PROJECT_ID: 'ws_x',
}

const okResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })

const findOutboundCall = (fetchSpy: ReturnType<typeof vi.fn>) => {
  const call = fetchSpy.mock.calls.find(([url]) => String(url).endsWith(REPLY_URL_SUFFIX))
  if (!call) throw new Error('expected fetch call to /internal/feishu/outbound')
  const init = call[1] as RequestInit
  if (typeof init.body !== 'string') throw new Error('expected JSON body string')
  return {
    body: JSON.parse(init.body) as Record<string, unknown>,
    headers: init.headers as Record<string, string>,
    method: init.method,
    url: String(call[0]),
  }
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, ...ENV }
  fetchSpy = vi.fn().mockResolvedValue(okResponse())
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = ORIGINAL_ENV
})

describe('runTeamCommand feishu reply --file HTTP body 透传', () => {
  test('--chat + --file + caption → POST body 含 { chatId, file, text } 三字段', async () => {
    await runTeamCommand(['feishu', 'reply', '--chat', 'oc_x', '--file', '/tmp/a.mp4', 'caption'])

    const outbound = findOutboundCall(fetchSpy)
    expect(outbound.method).toBe('POST')
    expect(outbound.headers['content-type']).toBe('application/json')
    expect(outbound.headers.authorization).toBe('Bearer test-token')
    expect(outbound.headers['x-hive-agent-id']).toBe('ws_x:orchestrator')
    // 关键断言：产品反则（删 team.ts:728 file 透传）→ body.file 缺失 → 这条必红。
    expect(outbound.body).toMatchObject({
      chatId: 'oc_x',
      file: '/tmp/a.mp4',
      text: 'caption',
    })
  })

  test('--chat + --file 无 caption → body 仍含 file 且 text 为空字符串', async () => {
    await runTeamCommand(['feishu', 'reply', '--chat', 'oc_x', '--file', '/tmp/a.mp4'])

    const outbound = findOutboundCall(fetchSpy)
    expect(outbound.body).toMatchObject({
      chatId: 'oc_x',
      file: '/tmp/a.mp4',
      text: '',
    })
    // 反测：传统 sendMessage 路径不会把 file 字段挂上去；这里必须挂。
    expect(outbound.body).toHaveProperty('file', '/tmp/a.mp4')
  })

  test('无 --file 旧路径（向后兼容）→ body 不含 file 字段', async () => {
    await runTeamCommand(['feishu', 'reply', '--chat', 'oc_x', 'hello'])

    const outbound = findOutboundCall(fetchSpy)
    expect(outbound.body).toMatchObject({ chatId: 'oc_x', text: 'hello' })
    expect(outbound.body).not.toHaveProperty('file')
  })
})
