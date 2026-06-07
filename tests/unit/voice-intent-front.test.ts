import { describe, expect, it, vi } from 'vitest'

import {
  createGlmVoiceIntentVerdictProvider,
  createVoiceIntentSession,
  DEFAULT_VOICE_INTENT_THROTTLE,
  parseVoiceIntentVerdict,
  shouldEvaluateVoiceIntent,
} from '../../src/server/voice-intent-front.js'

const baseInput = {
  callId: 'call-1',
  partialSeq: 1,
  transcript: '让关羽汇报一下 WebRTC 进度',
  turnId: 'turn-1',
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('voice intent front verdict provider', () => {
  it('parses strict GLM JSON verdicts and preserves safe structured fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: 'escalate',
                completeness: 'complete',
                confidence: 0.91,
                distilled_intent: '让关羽汇报 WebRTC 进度',
                intent_generation: 3,
                reply_text: '好，我把这个完整意图交给主管。',
                should_speculate_tts: true,
              }),
            },
          },
        ],
      }),
      ok: true,
    })
    const provider = createGlmVoiceIntentVerdictProvider({
      apiKey: 'glm-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: 'glm-5.1',
      timeoutMs: 1000,
    })

    await expect(provider.evaluate(baseInput)).resolves.toMatchObject({
      action: 'escalate',
      completeness: 'complete',
      confidence: 0.91,
      distilled_intent: '让关羽汇报 WebRTC 进度',
      intent_generation: 3,
      reply_text: '好，我把这个完整意图交给主管。',
      should_speculate_tts: true,
    })

    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions')
    expect(request.headers).toMatchObject({ Authorization: 'Bearer glm-key' })
    const body = JSON.parse(String(request.body))
    expect(body.model).toBe('glm-5.1')
    expect(body.messages[0].content).toContain('严格 JSON')
    expect(body.messages[0].content).toContain('complete')
    expect(body.messages[1].content).toContain(baseInput.transcript)
  })

  it('instructs GLM to handle known status questions and escalate only real work requests', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body)) as {
        messages: Array<{ content: string; role: string }>
      }
      const systemPrompt = body.messages[0]?.content ?? ''
      const userPrompt = body.messages[1]?.content ?? ''
      const transcript = userPrompt.split('transcript:\n').at(-1)?.trim() ?? ''
      const hasStrongFrontRule =
        systemPrompt.includes('强前台') &&
        systemPrompt.includes('状态/进度/团队在忙什么') &&
        systemPrompt.includes('只有真要动手') &&
        systemPrompt.includes('查证 GLM 不掌握的实时信息') &&
        !systemPrompt.includes('拿不准就 escalate')
      const shouldEscalate =
        hasStrongFrontRule && /(?:派|安排|部署|重启|查证|我不知道的)/u.test(transcript)
      const shouldHandle = hasStrongFrontRule && !shouldEscalate
      return {
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: shouldEscalate || !shouldHandle ? 'escalate' : 'handled',
                  completeness: 'complete',
                  confidence: 0.91,
                  distilled_intent: shouldEscalate ? transcript : '',
                  intent_generation: 1,
                  reply_text:
                    shouldEscalate || !shouldHandle ? '好，这个我转给主管。' : '我直接答。',
                  should_speculate_tts: true,
                }),
              },
            },
          ],
        }),
        ok: true,
      }
    })
    const provider = createGlmVoiceIntentVerdictProvider({
      apiKey: 'glm-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: 'glm-5.1',
      timeoutMs: 1000,
    })

    for (const transcript of ['团队在忙什么', '现在几点了状态如何', '你好', '谢谢'] as const) {
      await expect(provider.evaluate({ ...baseInput, transcript })).resolves.toMatchObject({
        action: 'handled',
      })
    }

    for (const transcript of [
      '派关羽做音量回归',
      '帮我部署 4010',
      '重启服务',
      '查证一下我不知道的线上错误',
    ] as const) {
      await expect(provider.evaluate({ ...baseInput, transcript })).resolves.toMatchObject({
        action: 'escalate',
        distilled_intent: transcript,
      })
    }
  })

  it('turns garbage, empty output, and invalid JSON into a safe non-complete verdict', () => {
    for (const raw of ['', '不是 json', '{"completeness":"complete"'] as const) {
      const verdict = parseVoiceIntentVerdict(raw, baseInput)
      expect(verdict.completeness).toBe('incomplete')
      expect(verdict.action).toBe('drop')
      expect(verdict.confidence).toBe(0)
      expect(verdict.should_speculate_tts).toBe(false)
    }
  })

  it('treats missing or mistyped required verdict fields as safe non-complete output', () => {
    for (const raw of [
      JSON.stringify({
        action: 'escalate',
        completeness: 'complete',
        distilled_intent: '让关羽处理 WebRTC',
        intent_generation: 1,
        reply_text: '好，这个交给主管。',
        should_speculate_tts: true,
      }),
      JSON.stringify({
        action: 'handled',
        completeness: 'complete',
        confidence: null,
        distilled_intent: '查询状态',
        intent_generation: 1,
        reply_text: '正在处理。',
        should_speculate_tts: true,
      }),
      JSON.stringify({
        action: 'escalate',
        completeness: 'complete',
        confidence: 0.9,
        distilled_intent: '让关羽处理 WebRTC',
        intent_generation: '1',
        reply_text: '好，这个交给主管。',
        should_speculate_tts: true,
      }),
      JSON.stringify({
        action: 'escalate',
        completeness: 'complete',
        confidence: 0.9,
        distilled_intent: '让关羽处理 WebRTC',
        intent_generation: 1,
        reply_text: '好，这个交给主管。',
      }),
    ] as const) {
      const verdict = parseVoiceIntentVerdict(raw, baseInput)
      expect(verdict).toMatchObject({
        action: 'drop',
        completeness: 'incomplete',
        confidence: 0,
        should_speculate_tts: false,
      })
    }
  })

  it('returns a safe non-complete verdict on GLM timeout without throwing', async () => {
    const fetchImpl = vi.fn((_url: string, request?: RequestInit) => {
      const signal = request?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const provider = createGlmVoiceIntentVerdictProvider({
      apiKey: 'glm-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1,
    })

    await expect(provider.evaluate(baseInput)).resolves.toMatchObject({
      action: 'drop',
      completeness: 'incomplete',
      confidence: 0,
      should_speculate_tts: false,
    })
  })
})

describe('voice intent session throttle', () => {
  it('gates first partials by length, subsequent partials by interval and new text, and always allows final', () => {
    expect(
      shouldEvaluateVoiceIntent({
        config: DEFAULT_VOICE_INTENT_THROTTLE,
        isFinal: false,
        lastEvaluatedText: '',
        lastEvaluationAtMs: null,
        nowMs: 1000,
        transcript: '太短',
      })
    ).toBe(false)

    expect(
      shouldEvaluateVoiceIntent({
        config: DEFAULT_VOICE_INTENT_THROTTLE,
        isFinal: false,
        lastEvaluatedText: '',
        lastEvaluationAtMs: null,
        nowMs: 1000,
        transcript: '让关羽汇报今天进度',
      })
    ).toBe(true)

    expect(
      shouldEvaluateVoiceIntent({
        config: DEFAULT_VOICE_INTENT_THROTTLE,
        isFinal: false,
        lastEvaluatedText: '让关羽汇报今天进度',
        lastEvaluationAtMs: 1000,
        nowMs: 1400,
        transcript: '让关羽汇报今天进度并',
      })
    ).toBe(false)

    expect(
      shouldEvaluateVoiceIntent({
        config: DEFAULT_VOICE_INTENT_THROTTLE,
        isFinal: false,
        lastEvaluatedText: '让关羽汇报今天进度',
        lastEvaluationAtMs: 1000,
        nowMs: 1600,
        transcript: '让关羽汇报今天进度并说明风险原因',
      })
    ).toBe(true)

    expect(
      shouldEvaluateVoiceIntent({
        config: DEFAULT_VOICE_INTENT_THROTTLE,
        isFinal: true,
        lastEvaluatedText: '让关羽汇报今天进度',
        lastEvaluationAtMs: 1000,
        nowMs: 1100,
        transcript: '好',
      })
    ).toBe(true)
  })
})

describe('voice intent session state machine', () => {
  it('increments generation only when the semantic distilled intent changes', async () => {
    const provider = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          action: 'handled',
          completeness: 'complete',
          confidence: 0.9,
          distilled_intent: '查询关羽状态',
          intent_generation: 1,
          reply_text: '关羽正在处理。',
          should_speculate_tts: true,
        })
        .mockResolvedValueOnce({
          action: 'handled',
          completeness: 'complete',
          confidence: 0.9,
          distilled_intent: '查询关羽状态',
          intent_generation: 1,
          reply_text: '关羽仍在处理。',
          should_speculate_tts: true,
        })
        .mockResolvedValueOnce({
          action: 'handled',
          completeness: 'complete',
          confidence: 0.9,
          distilled_intent: '重启 4010',
          intent_generation: 1,
          reply_text: '这个要交给主管。',
          should_speculate_tts: true,
        }),
    }
    const session = createVoiceIntentSession({
      env: { HIVE_VOICE_INTENT_FRONT: '1' },
      provider,
      turnId: 'turn-1',
    })

    await expect(
      session.evaluate({ isFinal: true, partialSeq: 1, transcript: '关羽现在什么状态' })
    ).resolves.toMatchObject({ candidate: { intentGeneration: 1 } })
    await expect(
      session.evaluate({ isFinal: true, partialSeq: 2, transcript: '关羽现在什么状态啊' })
    ).resolves.toMatchObject({ candidate: { intentGeneration: 1 } })
    await expect(
      session.evaluate({ isFinal: true, partialSeq: 3, transcript: '重启一下 4010' })
    ).resolves.toMatchObject({ candidate: { intentGeneration: 2 } })
  })

  it('aborts an in-flight generation and discards its late result when a newer evaluation starts', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const signals: AbortSignal[] = []
    const provider = {
      evaluate: vi.fn((_input, signal?: AbortSignal) => {
        if (signal) signals.push(signal)
        return signals.length === 1 ? first.promise : second.promise
      }),
    }
    const session = createVoiceIntentSession({
      env: { HIVE_VOICE_INTENT_FRONT: '1' },
      provider,
      turnId: 'turn-1',
    })

    const firstResult = session.evaluate({
      isFinal: true,
      partialSeq: 1,
      transcript: '让关羽查一下进度',
    })
    const secondResult = session.evaluate({
      isFinal: true,
      partialSeq: 2,
      transcript: '改成让马超查一下进度',
    })

    expect(signals[0]?.aborted).toBe(true)
    first.resolve({
      action: 'handled',
      completeness: 'complete',
      confidence: 0.8,
      distilled_intent: '关羽查进度',
      intent_generation: 1,
      reply_text: '关羽在查。',
      should_speculate_tts: true,
    })
    await expect(firstResult).resolves.toMatchObject({ status: 'superseded' })

    second.resolve({
      action: 'handled',
      completeness: 'complete',
      confidence: 0.8,
      distilled_intent: '马超查进度',
      intent_generation: 1,
      reply_text: '马超在查。',
      should_speculate_tts: true,
    })
    await expect(secondResult).resolves.toMatchObject({
      candidate: { intentGeneration: 1, replyText: '马超在查。' },
      status: 'accepted',
    })
  })

  it('turns provider rejection into a safe non-complete verdict without throwing', async () => {
    const provider = {
      evaluate: vi.fn().mockRejectedValue(new Error('provider failed')),
    }
    const session = createVoiceIntentSession({
      env: { HIVE_VOICE_INTENT_FRONT: '1' },
      provider,
      turnId: 'turn-1',
    })

    await expect(
      session.evaluate({ isFinal: true, partialSeq: 1, transcript: '让关羽汇报进度' })
    ).resolves.toMatchObject({
      candidate: {
        action: 'drop',
        completeness: 'incomplete',
        confidence: 0,
        shouldSpeculateTts: false,
      },
      status: 'accepted',
      verdict: { reason: 'provider_failed' },
    })
  })

  it('returns superseded instead of throwing when an aborted old provider call rejects', async () => {
    const second = deferred<unknown>()
    const provider = {
      evaluate: vi.fn((_input, signal?: AbortSignal) => {
        if (!signal) return second.promise
        if (provider.evaluate.mock.calls.length === 1) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
        return second.promise
      }),
    }
    const session = createVoiceIntentSession({
      env: { HIVE_VOICE_INTENT_FRONT: '1' },
      provider,
      turnId: 'turn-1',
    })

    const firstResult = session.evaluate({
      isFinal: true,
      partialSeq: 1,
      transcript: '让关羽查一下进度',
    })
    const secondResult = session.evaluate({
      isFinal: true,
      partialSeq: 2,
      transcript: '改成让马超查一下进度',
    })

    await expect(firstResult).resolves.toMatchObject({ status: 'superseded' })

    second.resolve({
      action: 'handled',
      completeness: 'complete',
      confidence: 0.82,
      distilled_intent: '马超查进度',
      intent_generation: 1,
      reply_text: '马超在查。',
      should_speculate_tts: true,
    })
    await expect(secondResult).resolves.toMatchObject({
      candidate: { intentGeneration: 1, replyText: '马超在查。' },
      status: 'accepted',
    })
  })

  it('hands off to PM only for one complete escalate verdict per turn', async () => {
    const provider = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce({
          action: 'escalate',
          completeness: 'likely_complete',
          confidence: 0.99,
          distilled_intent: '让关羽处理 WebRTC',
          intent_generation: 1,
          reply_text: '我先确认一下。',
          should_speculate_tts: true,
        })
        .mockResolvedValueOnce({
          action: 'escalate',
          completeness: 'complete',
          confidence: 0.74,
          distilled_intent: '让关羽处理 WebRTC',
          intent_generation: 1,
          reply_text: '我先确认一下。',
          should_speculate_tts: true,
        })
        .mockResolvedValueOnce({
          action: 'escalate',
          completeness: 'complete',
          confidence: 0.88,
          distilled_intent: '让关羽处理 WebRTC',
          intent_generation: 1,
          reply_text: '好，这个交给主管。',
          should_speculate_tts: true,
        })
        .mockResolvedValueOnce({
          action: 'escalate',
          completeness: 'complete',
          confidence: 0.92,
          distilled_intent: '让马超复查 WebRTC',
          intent_generation: 1,
          reply_text: '好，这个也交给主管。',
          should_speculate_tts: true,
        }),
    }
    const session = createVoiceIntentSession({
      env: { HIVE_VOICE_INTENT_FRONT: '1' },
      provider,
      turnId: 'turn-1',
    })

    await expect(
      session.evaluate({ isFinal: true, partialSeq: 1, transcript: '让关羽处理 WebRTC' })
    ).resolves.not.toHaveProperty('handoff')
    await expect(
      session.evaluate({ isFinal: true, partialSeq: 2, transcript: '让关羽处理 WebRTC' })
    ).resolves.not.toHaveProperty('handoff')
    await expect(
      session.evaluate({ isFinal: true, partialSeq: 3, transcript: '让关羽处理 WebRTC' })
    ).resolves.toMatchObject({
      handoff: { distilledIntent: '让关羽处理 WebRTC', intentGeneration: 1 },
    })
    await expect(
      session.evaluate({ isFinal: true, partialSeq: 4, transcript: '让马超复查 WebRTC' })
    ).resolves.not.toHaveProperty('handoff')
  })

  it('never hands off when a complete-looking provider response fails strict schema validation', async () => {
    const provider = {
      evaluate: vi.fn().mockResolvedValue({
        action: 'escalate',
        completeness: 'complete',
        confidence: null,
        distilled_intent: '让关羽处理 WebRTC',
        intent_generation: 1,
        reply_text: '好，这个交给主管。',
        should_speculate_tts: true,
      }),
    }
    const session = createVoiceIntentSession({
      env: { HIVE_VOICE_INTENT_FRONT: '1' },
      provider,
      turnId: 'turn-1',
    })

    await expect(
      session.evaluate({ isFinal: true, partialSeq: 1, transcript: '让关羽处理 WebRTC' })
    ).resolves.toMatchObject({
      candidate: {
        action: 'drop',
        completeness: 'incomplete',
        confidence: 0,
        shouldSpeculateTts: false,
      },
      status: 'accepted',
    })
    await expect(
      session.evaluate({ isFinal: true, partialSeq: 1, transcript: '让关羽处理 WebRTC' })
    ).resolves.not.toHaveProperty('handoff')
  })

  it('is flag-gated off by default and does not call the provider', async () => {
    const provider = { evaluate: vi.fn() }
    const session = createVoiceIntentSession({ env: {}, provider, turnId: 'turn-1' })

    await expect(
      session.evaluate({ isFinal: true, partialSeq: 1, transcript: '让关羽汇报进度' })
    ).resolves.toMatchObject({ status: 'disabled' })
    expect(provider.evaluate).not.toHaveBeenCalled()
  })
})
