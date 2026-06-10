import { describe, expect, it } from 'vitest'

import {
  adaptFastVoiceReplyToGrmTurnDecision,
  adaptSafeFallbackToGrmTurnDecision,
  adaptVoiceIntentToGrmTurnDecision,
  classifyGrmRequiresPm,
} from '../../src/server/grm-turn-decision.js'

const baseInput = {
  source: 'webrtc_call' as const,
  transcript: '团队现在在忙什么',
  turnId: 'turn-1',
}

describe('GRM turn decision contract', () => {
  it('keeps strong-front status and social questions handled', () => {
    for (const transcript of ['团队现在在忙什么', '现在进度如何', '你好，谢谢'] as const) {
      expect(classifyGrmRequiresPm(transcript)).toBeNull()
      expect(
        adaptVoiceIntentToGrmTurnDecision({
          ...baseInput,
          transcript,
          update: {
            status: 'accepted',
            verdict: {
              action: 'handled',
              completeness: 'complete',
              confidence: 0.9,
              distilled_intent: '',
              intent_generation: 1,
              reason: 'status',
              reply_text: '我直接答。',
              should_speculate_tts: true,
            },
          },
        })
      ).toMatchObject({
        action: 'handled',
        branch: 'handled',
        requiresPmReason: null,
      })
    }
  })

  it('forces explicit work requests to PM even when a model labels them handled', () => {
    for (const transcript of [
      '安排关羽修 WebRTC 通话延迟',
      '让关羽修一下对讲',
      '请赵云处理一下 WebRTC',
      '让钟馗排查一下通话延迟',
      '请马超看一下线上状态',
      '帮我部署 4010',
      '重启服务',
      '查证一下当前线上错误',
      '这个方案让 PM 拍板',
    ] as const) {
      const reason = classifyGrmRequiresPm(transcript)
      expect(reason).not.toBeNull()
      const decision = adaptVoiceIntentToGrmTurnDecision({
        ...baseInput,
        transcript,
        update: {
          status: 'accepted',
          verdict: {
            action: 'handled',
            completeness: 'complete',
            confidence: 0.88,
            distilled_intent: '',
            intent_generation: 7,
            reason: 'model_misclassified',
            reply_text: '我直接答。',
            should_speculate_tts: true,
          },
        },
      })
      expect(decision).toMatchObject({
        action: 'escalate',
        allowPmHandoff: true,
        branch: 'escalate',
        distilledIntent: transcript,
        origin: 'voice_intent',
        requiresPmReason: reason,
        replyText: '好，这个我转给主管。',
      })
    }
  })

  it('does not turn low-confidence voice-intent escalate into PM handoff without handoff or explicit work', () => {
    expect(
      adaptVoiceIntentToGrmTurnDecision({
        ...baseInput,
        transcript: '这个问题我有点纠结',
        update: {
          status: 'accepted',
          verdict: {
            action: 'escalate',
            completeness: 'complete',
            confidence: 0.4,
            distilled_intent: '用户对问题有疑问',
            intent_generation: 2,
            reason: 'low_confidence',
            reply_text: '我先按已知情况说。',
            should_speculate_tts: false,
          },
        },
      })
    ).toMatchObject({
      action: 'handled',
      allowPmHandoff: false,
      branch: 'handled',
      requiresPmReason: null,
      risk: 'low_confidence_escalate_without_handoff',
    })
  })

  it('adapts legacy gatekeeper decisions through the same explicit-work override', () => {
    expect(
      adaptFastVoiceReplyToGrmTurnDecision({
        ...baseInput,
        fastReply: { gatekeeper: 'handled', reply: '我直接答。' },
        source: 'talk_continuous',
        transcript: '让赵云重启 4010 服务',
      })
    ).toMatchObject({
      action: 'escalate',
      allowPmHandoff: true,
      branch: 'escalate',
      origin: 'legacy_gatekeeper',
      source: 'talk_continuous',
    })

    expect(
      adaptFastVoiceReplyToGrmTurnDecision({
        ...baseInput,
        fastReply: { gatekeeper: 'handled', reply: '当前关羽在处理通话。' },
        source: 'mobile_voice',
        transcript: '当前谁在处理通话',
      })
    ).toMatchObject({
      action: 'handled',
      allowPmHandoff: false,
      branch: 'handled',
      origin: 'legacy_gatekeeper',
      source: 'mobile_voice',
    })
  })

  it('keeps safe fallback explicit and non-speaking until a caller chooses legacy fallback', () => {
    expect(adaptSafeFallbackToGrmTurnDecision(baseInput)).toMatchObject({
      action: 'drop',
      allowPmHandoff: false,
      branch: 'fallback',
      confidence: 0,
      origin: 'safe_fallback',
      replyText: '',
    })
  })
})
