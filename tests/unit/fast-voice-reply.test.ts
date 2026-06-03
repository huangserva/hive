import { describe, expect, it, vi } from 'vitest'

import {
  createAnthropicFastVoiceReplyProvider,
  createFastVoiceReplyProvider,
  createGlmFastVoiceReplyProvider,
  FAST_VOICE_REPLY_FALLBACK_TEXTS,
  GLM_FAST_VOICE_REPLY_BASE_URL,
  GLM_FAST_VOICE_REPLY_MODEL,
  maybeInsertFastVoiceReply,
  normalizeFastVoiceReply,
} from '../../src/server/fast-voice-reply.js'

describe('fast voice reply', () => {
  it('uses the GLM coding paas base URL by default to stay on the free coding plan', () => {
    expect(GLM_FAST_VOICE_REPLY_BASE_URL).toBe('https://open.bigmodel.cn/api/coding/paas/v4')
  })

  it('calls Anthropic Haiku with a short Chinese voice prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ content: [{ text: ' 好，我马上去安排。 ', type: 'text' }] }),
      ok: true,
    })
    const provider = createAnthropicFastVoiceReplyProvider({
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await expect(provider.generate({ transcript: '让关羽汇报进展' })).resolves.toBe(
      '好，我马上去安排。'
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, request] = firstCall as [string, RequestInit]
    expect(request.headers).toBeDefined()
    const headers = request.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    const body = JSON.parse(String(request.body))
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.max_tokens).toBeLessThanOrEqual(80)
    expect(body.system).toContain('简体中文')
    expect(body.system).toContain('1-2 句')
    expect(body.messages[0].content).toContain('让关羽汇报进展')
  })

  it('calls GLM OpenAI-compatible chat completions and parses the first choice', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: ' 好，我马上处理。 ' } }],
      }),
      ok: true,
    })
    const provider = createGlmFastVoiceReplyProvider({
      apiKey: 'glm-key',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await expect(provider.generate({ transcript: '让关羽汇报进展' })).resolves.toBe(
      '好，我马上处理。'
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [url, request] = firstCall as [string, RequestInit]
    expect(url).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions')
    expect(request.headers).toBeDefined()
    const headers = request.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer glm-key')
    const body = JSON.parse(String(request.body))
    expect(body.model).toBe(GLM_FAST_VOICE_REPLY_MODEL)
    expect(body.max_tokens).toBe(80)
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[0].content).toContain('1-2 句')
    expect(body.messages[1]).toEqual({ content: '让关羽汇报进展', role: 'user' })
  })

  it('prefers GLM over Anthropic when both keys are configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'GLM 秒回' } }],
      }),
      ok: true,
    })
    const provider = createFastVoiceReplyProvider({
      env: {
        ANTHROPIC_API_KEY: 'anthropic-key',
        GLM_API_KEY: 'glm-key',
        GLM_BASE_URL: 'https://glm.example/v4',
        NODE_ENV: 'test',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await expect(provider.generate({ transcript: '查一下状态' })).resolves.toBe('GLM 秒回')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    expect(firstCall?.[0]).toBe('https://glm.example/v4/chat/completions')
  })

  it('falls back to fixed acknowledgement when no model key is configured', async () => {
    const fetchImpl = vi.fn()
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = createFastVoiceReplyProvider({
      env: { NODE_ENV: 'test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })
    const fallbackText = FAST_VOICE_REPLY_FALLBACK_TEXTS[2] ?? FAST_VOICE_REPLY_FALLBACK_TEXTS[0]

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '查一下状态',
        workspaceId: 'ws-1',
      })
    ).resolves.toBe(fallbackText)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      expect.stringContaining(fallbackText)
    )
  })

  it('inserts a fast orch_reply only for voice prompts', async () => {
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = { generate: vi.fn().mockResolvedValue('好，我先处理。') }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '查一下 relay',
        workspaceId: 'ws-1',
      })
    ).resolves.toBe('好，我先处理。')

    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({ fast_reply: true, source: 'voice_fast_reply', text: '好，我先处理。' })
    )

    store.insertMobileChatMessage.mockClear()
    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'text',
        store,
        text: '查一下 relay',
        workspaceId: 'ws-1',
      })
    ).resolves.toBeNull()
    expect(store.insertMobileChatMessage).not.toHaveBeenCalled()
  })

  it('inserts an immediate deterministic acknowledgement when no fast model reply is available', async () => {
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = { generate: vi.fn().mockResolvedValue(null) }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '帮我查一下语音延迟',
        workspaceId: 'ws-1',
      })
    ).resolves.toBe(FAST_VOICE_REPLY_FALLBACK_TEXTS[0])

    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({
        fast_reply: true,
        source: 'voice_fast_reply',
        text: FAST_VOICE_REPLY_FALLBACK_TEXTS[0],
      })
    )
  })

  it('does not reject when inserting the fast model reply fails', async () => {
    const store = {
      insertMobileChatMessage: vi.fn(() => {
        throw new Error('sqlite write failed')
      }),
    }
    const provider = { generate: vi.fn().mockResolvedValue('好，我先处理。') }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '查一下 relay',
        workspaceId: 'ws-1',
      })
    ).resolves.toBeNull()
  })

  it('does not reject when provider and fallback insertion both fail', async () => {
    const store = {
      insertMobileChatMessage: vi.fn(() => {
        throw new Error('sqlite write failed')
      }),
    }
    const provider = {
      generate: vi.fn(async () => {
        throw new Error('anthropic failed')
      }),
    }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '帮我查一下语音延迟',
        workspaceId: 'ws-1',
      })
    ).resolves.toBeNull()
  })

  it('normalizes long model responses before insertion', () => {
    expect(normalizeFastVoiceReply(` 好的，\n我来处理。 ${'x'.repeat(300)}`)).toHaveLength(180)
  })
})
