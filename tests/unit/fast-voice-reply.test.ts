import { describe, expect, it, vi } from 'vitest'

import {
  createAnthropicFastVoiceReplyProvider,
  FAST_VOICE_REPLY_FALLBACK_TEXTS,
  FAST_VOICE_REPLY_MODEL,
  maybeInsertFastVoiceReply,
  normalizeFastVoiceReply,
} from '../../src/server/fast-voice-reply.js'

describe('fast voice reply', () => {
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
    const [, request] = fetchImpl.mock.calls[0]
    expect(request.headers['x-api-key']).toBe('test-key')
    const body = JSON.parse(request.body)
    expect(body.model).toBe(FAST_VOICE_REPLY_MODEL)
    expect(body.max_tokens).toBeLessThanOrEqual(80)
    expect(body.system).toContain('简体中文')
    expect(body.system).toContain('1-2 句')
    expect(body.messages[0].content).toContain('让关羽汇报进展')
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
