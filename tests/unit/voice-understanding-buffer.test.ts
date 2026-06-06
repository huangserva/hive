import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  __resetVoiceUnderstandingBuffersForTests,
  enqueueVoiceUnderstandingInput,
  resolveVoiceUnderstandingWindowMs,
} from '../../src/server/voice-understanding-buffer.js'

const createStore = () => ({
  getActiveRunByAgentId: vi.fn<() => { runId: string } | null>(() => ({ runId: 'run-1' })),
  insertMobileChatMessage: vi.fn(),
  recordUserInput: vi.fn(),
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  __resetVoiceUnderstandingBuffersForTests()
})

describe('voice understanding buffer', () => {
  test('merges voice segments within the window before invoking the front layer once', async () => {
    vi.useFakeTimers()
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const store = createStore()
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到，交给主管。'),
    }
    const logger = { info: vi.fn(), warn: vi.fn() }

    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: provider,
      logger,
      store,
      text: '让关羽查一下',
      windowMs: 1200,
      workspaceId: 'ws-1',
    })
    await vi.advanceTimersByTimeAsync(800)
    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: provider,
      logger,
      store,
      text: 'WebRTC 为什么断续',
      windowMs: 1200,
      workspaceId: 'ws-1',
    })

    await vi.advanceTimersByTimeAsync(1199)
    expect(provider.generate).not.toHaveBeenCalled()
    expect(store.recordUserInput).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(provider.generate).toHaveBeenCalledTimes(1)
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '让关羽查一下\nWebRTC 为什么断续' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ source: 'talk_continuous', text: '让关羽查一下\nWebRTC 为什么断续' })
    )
    const injected = store.recordUserInput.mock.calls[0]?.[2] as string
    expect(injected).toContain('[来自手机 Mobile App]\n---\n让关羽查一下\nWebRTC 为什么断续')
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('segments=2'))
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('wait_ms=1200'))
  })

  test('processes a single voice segment after the configured window', async () => {
    vi.useFakeTimers()
    const store = createStore()
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n现在没有阻塞。'),
    }

    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: provider,
      store,
      text: '现在有什么阻塞',
      windowMs: 500,
      workspaceId: 'ws-1',
    })
    await vi.advanceTimersByTimeAsync(500)

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '现在有什么阻塞' })
    )
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      '[来自手机 Mobile App]\n---\n现在有什么阻塞',
      { forwardToOrchestrator: false }
    )
  })

  test('flushes immediately when the understanding window is configured as zero', async () => {
    const store = createStore()
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到。'),
    }

    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: provider,
      store,
      text: '立即处理',
      windowMs: 0,
      workspaceId: 'ws-1',
    })

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '立即处理' })
    )
    expect(store.recordUserInput).toHaveBeenCalledTimes(1)
  })

  test('resolves the window from environment with a safe default', () => {
    expect(resolveVoiceUnderstandingWindowMs({})).toBe(1200)
    expect(resolveVoiceUnderstandingWindowMs({ HIVE_VOICE_UNDERSTANDING_WINDOW_MS: '450' })).toBe(
      450
    )
    expect(resolveVoiceUnderstandingWindowMs({ HIVE_VOICE_UNDERSTANDING_WINDOW_MS: '-1' })).toBe(
      1200
    )
  })

  test('persists voice text without forwarding when the orchestrator stops before flush', async () => {
    const store = createStore()
    store.getActiveRunByAgentId.mockReturnValue(null)
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到。'),
    }
    const logger = { info: vi.fn(), warn: vi.fn() }

    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: provider,
      logger,
      store,
      text: '我刚才说的别丢',
      windowMs: 0,
      workspaceId: 'ws-1',
    })

    expect(provider.generate).not.toHaveBeenCalled()
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ source: 'talk_continuous', text: '我刚才说的别丢' })
    )
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      '[来自手机 Mobile App]\n---\n我刚才说的别丢',
      { forwardToOrchestrator: false }
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('orchestrator_not_running'),
      undefined
    )
  })

  test('still records user input when inbound chat insert fails during flush', async () => {
    const store = createStore()
    store.insertMobileChatMessage.mockImplementation(() => {
      throw new Error('chat db locked')
    })
    const logger = { info: vi.fn(), warn: vi.fn() }

    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: {
        generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到。'),
      },
      logger,
      store,
      text: '插入聊天失败也别丢',
      windowMs: 0,
      workspaceId: 'ws-1',
    })

    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      '[来自手机 Mobile App]\n---\n插入聊天失败也别丢'
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('inbound chat persist failed'),
      expect.any(Error)
    )
  })

  test('keeps inbound chat visible when recordUserInput fails during flush', async () => {
    const store = createStore()
    store.recordUserInput.mockImplementation(() => {
      throw new Error('runtime write failed')
    })
    const logger = { info: vi.fn(), warn: vi.fn() }

    await enqueueVoiceUnderstandingInput({
      fastVoiceReplyProvider: {
        generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到。'),
      },
      logger,
      store,
      text: 'record 失败也要能看见',
      windowMs: 0,
      workspaceId: 'ws-1',
    })

    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ source: 'talk_continuous', text: 'record 失败也要能看见' })
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('record user input failed'),
      expect.any(Error)
    )
  })
})
