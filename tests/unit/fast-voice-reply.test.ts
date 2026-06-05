import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAnthropicFastVoiceReplyProvider,
  createFastVoiceReplyProvider,
  createGlmFastVoiceReplyProvider,
  FAST_VOICE_REPLY_FALLBACK_TEXTS,
  GLM_FAST_VOICE_REPLY_BASE_URL,
  GLM_FAST_VOICE_REPLY_MODEL,
  maybeInsertFastVoiceReply,
  maybeInsertFastVoiceReplyWithGatekeeper,
  normalizeFastVoiceReply,
} from '../../src/server/fast-voice-reply.js'

describe('fast voice reply', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

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
    expect(body.system).toContain('1-2句')
    expect(body.system).toContain('每句尽量短')
    expect(body.system).toContain('简短利落')
    expect(body.messages[0].content).toContain('让关羽汇报进展')
  })

  it('calls GLM OpenAI-compatible chat completions and parses the first choice', async () => {
    vi.stubEnv('GLM_FAST_MODEL', '')
    vi.stubEnv('HIVE_VOICE_FRONT_MODE', 'strong')
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

    await expect(
      provider.generate({
        history: [
          { role: 'user', text: '刚才手机语音很慢' },
          { role: 'assistant', text: '我会先检查 STT 和 TTS。' },
        ],
        statusContext: '当前状态：关羽 working；赵云 idle；未完成派单 1 个。',
        transcript: '让关羽汇报进展',
      })
    ).resolves.toBe('好，我马上处理。')

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
    expect(body.max_tokens).toBe(120)
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[0].content).toContain('1-2句')
    expect(body.messages[0].content).toContain('每句尽量短')
    expect(body.messages[0].content).toContain('简短利落')
    expect(body.messages[0].content).toContain('真对话前台')
    expect(body.messages[0].content).toContain('状态/简单问题/闲聊')
    expect(body.messages[0].content).toContain('一律自己handled')
    expect(body.messages[0].content).toContain('直接、具体、有判断')
    expect(body.messages[0].content).toContain('禁止官腔、空话')
    expect(body.messages[0].content).toContain('只说一句短促的接管确认')
    expect(body.messages[0].content).toContain('这个我转给主管')
    expect(body.messages[0].content).toContain('不能')
    expect(body.messages[0].content).toContain('不说"我已经做完了"')
    expect(body.messages[0].content).toContain('不说"我已经派人了"')
    expect(body.messages[0].content).toContain('禁止任何声称自己派工')
    expect(body.messages[0].content).not.toContain('好,我让团队上')
    expect(body.messages[0].content).not.toContain('我让团队')
    expect(body.messages[0].content).not.toContain('我来安排')
    expect(body.messages[0].content).not.toContain('我会派')
    expect(body.messages[0].content).not.toContain('我让谁去做')
    expect(body.messages[0].content).toContain('当前状态：关羽 working')
    expect(body.messages[1]).toEqual({ content: '刚才手机语音很慢', role: 'user' })
    expect(body.messages[2]).toEqual({ content: '我会先检查 STT 和 TTS。', role: 'assistant' })
    expect(body.messages[3]).toEqual({ content: '让关羽汇报进展', role: 'user' })
  })

  it('refreshes project phase and commits off the voice request hot path', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'hive-fast-voice-context-'))
    mkdirSync(join(projectRoot, '.hive'), { recursive: true })
    writeFileSync(
      join(projectRoot, '.hive', 'plan.md'),
      '---\ncurrent_phase: M38 快准狠前台\n---\n'
    )
    execFileSync('git', ['init'], { cwd: projectRoot })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: projectRoot })
    writeFileSync(join(projectRoot, 'README.md'), 'one\n')
    execFileSync('git', ['add', 'README.md'], { cwd: projectRoot })
    execFileSync('git', ['commit', '-m', 'fix voice front context'], { cwd: projectRoot })
    writeFileSync(join(projectRoot, 'README.md'), 'two\n')
    execFileSync('git', ['add', 'README.md'], { cwd: projectRoot })
    execFileSync('git', ['commit', '-m', 'ship concise talkback replies'], { cwd: projectRoot })
    vi.spyOn(process, 'cwd').mockReturnValue(projectRoot)

    const store = {
      insertMobileChatMessage: vi.fn(),
      listDispatches: vi.fn(() => [
        {
          id: 'dispatch-1',
          status: 'submitted',
          text: '修 WebRTC 通话音频卡顿并验证下行',
          toAgentId: 'worker-1',
        },
      ]),
      listMobileChatMessages: vi.fn(() => []),
      listWorkers: vi.fn(() => [
        {
          id: 'worker-1',
          name: '关羽',
          pendingTaskCount: 1,
          role: 'coder',
          status: 'working',
        },
      ]),
    }
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n关羽正在修通话卡顿。'),
    }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '现在进度怎样',
        workspaceId: 'ws-1',
      })
    ).resolves.toBe('关羽正在修通话卡顿。')

    const firstCall = provider.generate.mock.calls[0]?.[0]
    expect(firstCall.statusContext).not.toContain('Current phase: M38 快准狠前台')
    expect(firstCall.statusContext).not.toContain('Recent commits:')
    expect(firstCall.statusContext).toContain(
      '关羽(coder): working, pending 1, doing: 修 WebRTC 通话音频卡顿并验证下行'
    )

    let refreshedContext = ''
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      provider.generate.mockClear()
      await maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '现在进度怎样',
        workspaceId: 'ws-1',
      })
      const context = provider.generate.mock.calls[0]?.[0]?.statusContext ?? ''
      if (context.includes('Current phase: M38 快准狠前台')) {
        refreshedContext = context
        break
      }
    }

    expect(refreshedContext).toContain('Current phase: M38 快准狠前台')
    expect(refreshedContext).toContain(
      'Recent commits: ship concise talkback replies; fix voice front context'
    )
    expect(refreshedContext).toContain(
      'Open dispatches: 关羽 submitted 修 WebRTC 通话音频卡顿并验证下行'
    )
  })

  it('defaults the strong voice front to GLM 5.1 and keeps env model override', async () => {
    vi.stubEnv('GLM_FAST_MODEL', '')
    vi.stubEnv('HIVE_VOICE_FRONT_MODE', 'strong')
    expect(GLM_FAST_VOICE_REPLY_MODEL).toBe('glm-5.1')
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'HIVE_GLM_GATEKEEPER: handled\n我在。' } }],
      }),
      ok: true,
    })
    const provider = createGlmFastVoiceReplyProvider({
      apiKey: 'glm-key',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await provider.generate({ transcript: '现在什么情况' })

    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, request] = firstCall as [string, RequestInit]
    expect(JSON.parse(String(request.body)).model).toBe('glm-5.1')

    fetchImpl.mockClear()
    const overrideProvider = createGlmFastVoiceReplyProvider({
      apiKey: 'glm-key',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: 'custom-glm',
      timeoutMs: 1000,
    })
    await overrideProvider.generate({ transcript: '现在什么情况' })
    const overrideCall = fetchImpl.mock.calls[0]
    expect(overrideCall).toBeDefined()
    const [, overrideRequest] = overrideCall as [string, RequestInit]
    expect(JSON.parse(String(overrideRequest.body)).model).toBe('custom-glm')
  })

  it('keeps the strong front on GLM 5.1 even when legacy GLM_FAST_MODEL points to flash', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'HIVE_GLM_GATEKEEPER: handled\n我在。' } }],
      }),
      ok: true,
    })
    const provider = createFastVoiceReplyProvider({
      env: {
        GLM_API_KEY: 'glm-key',
        GLM_BASE_URL: 'https://glm.example/v4',
        GLM_FAST_MODEL: 'glm-4-flash',
        HIVE_VOICE_FRONT_MODE: 'strong',
        NODE_ENV: 'test',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await provider.generate({ transcript: '现在什么情况' })

    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, request] = firstCall as [string, RequestInit]
    const body = JSON.parse(String(request.body))
    expect(body.model).toBe('glm-5.1')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('allows the strong front model to be overridden only by HIVE_VOICE_STRONG_MODEL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'HIVE_GLM_GATEKEEPER: handled\n我在。' } }],
      }),
      ok: true,
    })
    const provider = createFastVoiceReplyProvider({
      env: {
        GLM_API_KEY: 'glm-key',
        GLM_BASE_URL: 'https://glm.example/v4',
        GLM_FAST_MODEL: 'glm-4-flash',
        HIVE_VOICE_FRONT_MODE: 'strong',
        HIVE_VOICE_STRONG_MODEL: 'custom-strong-glm',
        NODE_ENV: 'test',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await provider.generate({ transcript: '现在什么情况' })

    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, request] = firstCall as [string, RequestInit]
    const body = JSON.parse(String(request.body))
    expect(body.model).toBe('custom-strong-glm')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('disables GLM 5.1 thinking so the short voice budget is not spent on reasoning', async () => {
    vi.stubEnv('GLM_FAST_MODEL', '')
    vi.stubEnv('HIVE_VOICE_FRONT_MODE', 'strong')
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'HIVE_GLM_GATEKEEPER: handled\n我在。' } }],
      }),
      ok: true,
    })
    const provider = createGlmFastVoiceReplyProvider({
      apiKey: 'glm-key',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await provider.generate({ transcript: '现在什么情况' })

    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, request] = firstCall as [string, RequestInit]
    const body = JSON.parse(String(request.body))
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.max_tokens).toBe(120)
  })

  it('treats empty GLM content caused by reasoning token exhaustion as no reply', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: '',
              reasoning_content: '这里是被模型内部思考吃掉的 token。',
            },
          },
        ],
      }),
      ok: true,
    })
    const provider = createGlmFastVoiceReplyProvider({
      apiKey: 'glm-key',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await expect(provider.generate({ transcript: '现在什么情况' })).resolves.toBeNull()
  })

  it('falls back to the readonly front prompt and glm-4-flash with HIVE_VOICE_FRONT_MODE=readonly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [{ message: { content: 'HIVE_GLM_GATEKEEPER: escalate\n这个需要主管处理。' } }],
      }),
      ok: true,
    })
    const provider = createFastVoiceReplyProvider({
      env: {
        GLM_API_KEY: 'glm-key',
        GLM_BASE_URL: 'https://glm.example/v4',
        GLM_FAST_MODEL: 'custom-glm',
        HIVE_VOICE_FRONT_MODE: 'readonly',
        NODE_ENV: 'test',
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1000,
    })

    await provider.generate({ transcript: '现在什么情况' })

    const firstCall = fetchImpl.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, request] = firstCall as [string, RequestInit]
    const body = JSON.parse(String(request.body))
    expect(body.model).toBe('glm-4-flash')
    expect(body.messages[0].content).toContain('只读知情前台')
    expect(body.messages[0].content).toContain('这个需要主管处理')
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
    const store = {
      insertMobileChatMessage: vi.fn(),
      listMobileChatMessages: vi.fn(() => [
        {
          content_json: JSON.stringify({ text: '上一句用户问题' }),
          created_at: 1,
          direction: 'inbound',
          id: 'm-1',
          message_type: 'user_text',
          workspace_id: 'ws-1',
        },
        {
          content_json: JSON.stringify({ text: '上一句 orch 回答' }),
          created_at: 2,
          direction: 'outbound',
          id: 'm-2',
          message_type: 'orch_reply',
          workspace_id: 'ws-1',
        },
        {
          content_json: JSON.stringify({ text: '查一下 relay' }),
          created_at: 3,
          direction: 'inbound',
          id: 'm-3',
          message_type: 'user_text',
          workspace_id: 'ws-1',
        },
      ]),
      listDispatches: vi.fn(() => [
        {
          id: 'dispatch-1',
          status: 'submitted',
          text: '修语音秒回',
          toAgentId: 'worker-1',
        },
      ]),
      listWorkers: vi.fn(() => [
        {
          id: 'worker-1',
          name: '关羽',
          pendingTaskCount: 1,
          role: 'coder',
          status: 'working',
        },
        {
          id: 'worker-2',
          name: '赵云',
          pendingTaskCount: 0,
          role: 'coder',
          status: 'idle',
        },
      ]),
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
    ).resolves.toBe('好，我先处理。')

    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({ fast_reply: true, source: 'voice_fast_reply', text: '好，我先处理。' })
    )
    expect(store.listMobileChatMessages).toHaveBeenCalledWith('ws-1', undefined, 15)
    expect(store.listWorkers).toHaveBeenCalledWith('ws-1')
    expect(store.listDispatches).toHaveBeenCalledWith('ws-1')
    expect(provider.generate).toHaveBeenCalledWith({
      history: [
        { role: 'user', text: '上一句用户问题' },
        { role: 'assistant', text: '上一句 orch 回答' },
      ],
      statusContext: expect.stringContaining('关羽(coder): working'),
      transcript: '查一下 relay',
    })
    expect(provider.generate).toHaveBeenCalledWith({
      history: [
        { role: 'user', text: '上一句用户问题' },
        { role: 'assistant', text: '上一句 orch 回答' },
      ],
      statusContext: expect.stringContaining('关羽 submitted 修语音秒回'),
      transcript: '查一下 relay',
    })

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

  it('keeps the GLM voice reply when gatekeeper escalates to orchestrator', async () => {
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n好，我让 orchestrator 去办。'),
    }

    await expect(
      maybeInsertFastVoiceReplyWithGatekeeper({
        provider,
        source: 'voice',
        store,
        text: '让关羽修一下对讲',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ gatekeeper: 'escalate', reply: '好，我让 orchestrator 去办。' })

    expect(provider.generate).toHaveBeenCalled()
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({
        fast_reply: true,
        gatekeeper: 'escalate',
        source: 'voice_fast_reply',
        text: '好，我让 orchestrator 去办。',
      })
    )
  })

  it('keeps status questions handled and action requests escalated through the gatekeeper marker', async () => {
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce('HIVE_GLM_GATEKEEPER: handled\n关羽正在修 WebRTC，赵云空闲。')
        .mockResolvedValueOnce('HIVE_GLM_GATEKEEPER: escalate\n好，这个我转给主管，稍等。'),
    }

    await expect(
      maybeInsertFastVoiceReplyWithGatekeeper({
        provider,
        source: 'voice',
        store,
        text: '现在谁在忙',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ gatekeeper: 'handled', reply: '关羽正在修 WebRTC，赵云空闲。' })
    await expect(
      maybeInsertFastVoiceReplyWithGatekeeper({
        provider,
        source: 'voice',
        store,
        text: '派关羽去改代码',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ gatekeeper: 'escalate', reply: '好，这个我转给主管，稍等。' })
  })

  it('drops team-name prompt echo noise before calling the fast voice model', async () => {
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n我在。'),
    }

    await expect(
      maybeInsertFastVoiceReplyWithGatekeeper({
        provider,
        source: 'voice',
        store,
        text: '团队成员：关羽、马超、赵云、钟馗、吕布',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ gatekeeper: 'drop', reply: null })

    expect(provider.generate).not.toHaveBeenCalled()
    expect(store.insertMobileChatMessage).not.toHaveBeenCalled()
  })

  it('keeps real team-name commands with action words on the orchestrator path', async () => {
    const store = { insertMobileChatMessage: vi.fn() }
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n好，我让 orchestrator 去办。'),
    }

    await expect(
      maybeInsertFastVoiceReplyWithGatekeeper({
        provider,
        source: 'voice',
        store,
        text: '关羽张飞钟馗重启',
        workspaceId: 'ws-1',
      })
    ).resolves.toEqual({ gatekeeper: 'escalate', reply: '好，我让 orchestrator 去办。' })

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '关羽张飞钟馗重启' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalled()
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

  it('does not reject when reading chat history fails before a fallback reply', async () => {
    const store = {
      insertMobileChatMessage: vi.fn(),
      listMobileChatMessages: vi.fn(() => {
        throw new Error('history read failed')
      }),
    }
    const provider = { generate: vi.fn().mockResolvedValue(null) }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '查一下上下文',
        workspaceId: 'ws-1',
      })
    ).resolves.toBeTruthy()
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [],
        transcript: '查一下上下文',
      })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalled()
  })

  it('does not reject when reading workspace status fails before a fallback reply', async () => {
    const store = {
      insertMobileChatMessage: vi.fn(),
      listDispatches: vi.fn(() => {
        throw new Error('dispatch read failed')
      }),
      listMobileChatMessages: vi.fn(() => []),
      listWorkers: vi.fn(() => {
        throw new Error('worker read failed')
      }),
    }
    const provider = { generate: vi.fn().mockResolvedValue(null) }

    await expect(
      maybeInsertFastVoiceReply({
        provider,
        source: 'voice',
        store,
        text: '现在谁在忙',
        workspaceId: 'ws-1',
      })
    ).resolves.toBeTruthy()
    expect(provider.generate).toHaveBeenCalledWith({
      history: [],
      statusContext: '',
      transcript: '现在谁在忙',
    })
    expect(store.insertMobileChatMessage).toHaveBeenCalled()
  })

  it('normalizes long model responses before insertion', () => {
    expect(normalizeFastVoiceReply(` 好的，\n我来处理。 ${'x'.repeat(300)}`)).toHaveLength(180)
  })
})
