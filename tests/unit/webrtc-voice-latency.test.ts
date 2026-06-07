import { describe, expect, test } from 'vitest'

import {
  bindWebRtcVoiceLatencyTurnToMessage,
  buildVoiceLatencyBreakdownLog,
  buildVoiceTurnTimelineLog,
  claimOldestPendingWebRtcVoiceHandoffTurn,
  claimPendingWebRtcVoiceLatencyTurn,
  claimWebRtcVoiceLatencyTurnForMessage,
  markWebRtcVoiceLatency,
  resetWebRtcVoiceLatencyForTests,
  startWebRtcVoiceLatencyTurn,
} from '../../src/server/webrtc-voice-latency.js'

describe('WebRTC voice latency diagnostics', () => {
  test('formats a single-line breakdown with computed stage durations', () => {
    resetWebRtcVoiceLatencyForTests()
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-1',
      now: 1_000,
      segment: 3,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, { fastReplyEnterAt: 1_050 })
    markWebRtcVoiceLatency(turn.turnId, { glmRequestAt: 1_100 })
    markWebRtcVoiceLatency(turn.turnId, { glmResponseAt: 1_900 })
    markWebRtcVoiceLatency(turn.turnId, { escalated: true, gatekeeperAt: 1_950 })
    markWebRtcVoiceLatency(turn.turnId, { ttsStartAt: 2_200 })
    markWebRtcVoiceLatency(turn.turnId, { ttsEndAt: 2_700 })
    markWebRtcVoiceLatency(turn.turnId, { firstDownlinkFrameAt: 2_900 })

    expect(buildVoiceLatencyBreakdownLog(turn)).toBe(
      'voice latency breakdown: call_id=call-1 turn_id=call-1-turn-3 segment=3 silence_to_final_ms=na final_to_fast_reply_ms=50 glm_ms=800 escalated=true gatekeeper_ms=900 tts_ms=500 tts_to_first_frame_ms=200 final_to_downlink_ms=1900 total_ms=1900'
    )
  })

  test('removes old turns when the pending queue overflows', () => {
    resetWebRtcVoiceLatencyForTests()
    const firstTurn = startWebRtcVoiceLatencyTurn({
      callId: 'call-overflow',
      now: 1_000,
      segment: 1,
      workspaceId: 'workspace-1',
    })

    for (let segment = 2; segment <= 21; segment += 1) {
      startWebRtcVoiceLatencyTurn({
        callId: 'call-overflow',
        now: 1_000 + segment,
        segment,
        workspaceId: 'workspace-1',
      })
    }

    expect(markWebRtcVoiceLatency(firstTurn.turnId, { fastReplyEnterAt: 2_000 })).toBeNull()
    const nextTurn = claimPendingWebRtcVoiceLatencyTurn('workspace-1')
    expect(nextTurn?.turnId).toBe('call-overflow-turn-2')
  })

  test('formats intent-driven voice turn timeline and claims by exact downlink message id', () => {
    resetWebRtcVoiceLatencyForTests()
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-timeline',
      now: 1_000,
      segment: 1,
      speechStartAt: 400,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, {
      branch: 'handled',
      decisionAt: 1_300,
      firstDownlinkFrameAt: 1_900,
      forwardPm: false,
      intentVerdictAt: 1_250,
      textLen: 12,
    })
    bindWebRtcVoiceLatencyTurnToMessage(turn.turnId, 'reply-message-1')

    expect(claimWebRtcVoiceLatencyTurnForMessage('other-message')).toBeNull()
    const claimed = claimWebRtcVoiceLatencyTurnForMessage('reply-message-1')
    expect(claimed?.turnId).toBe(turn.turnId)
    if (!claimed) throw new Error('expected exact message claim to return a turn')
    expect(buildVoiceTurnTimelineLog(claimed)).toBe(
      'voice turn timeline: call_id=call-timeline turn=call-timeline-turn-1 branch=handled forward_pm=false text_len=12 speech_to_final_ms=600 final_to_verdict_ms=250 verdict_to_dispatch_ms=50 dispatch_to_downlink_ms=600 total_speech_to_audio_ms=1500'
    )
  })

  test('intent-driven voice turn timeline omits fake total when there is no downlink audio', () => {
    resetWebRtcVoiceLatencyForTests()
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-drop',
      now: 1_000,
      segment: 1,
      speechStartAt: 700,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, {
      branch: 'drop',
      decisionAt: 1_090,
      forwardPm: false,
      intentVerdictAt: 1_080,
      textLen: 2,
    })

    expect(buildVoiceTurnTimelineLog(turn)).toBe(
      'voice turn timeline: call_id=call-drop turn=call-drop-turn-1 branch=drop forward_pm=false text_len=2 speech_to_final_ms=300 final_to_verdict_ms=80 verdict_to_dispatch_ms=10 dispatch_to_downlink_ms=na total_speech_to_audio_ms=na'
    )
  })

  test('claims pending handoff turns only for active call ids', () => {
    resetWebRtcVoiceLatencyForTests()
    const oldTurn = startWebRtcVoiceLatencyTurn({
      callId: 'call-old',
      now: 1_000,
      segment: 1,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(oldTurn.turnId, {
      branch: 'escalate',
      forwardPm: true,
    })
    const activeTurn = startWebRtcVoiceLatencyTurn({
      callId: 'call-active',
      now: 2_000,
      segment: 2,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(activeTurn.turnId, {
      branch: 'escalate',
      forwardPm: true,
    })

    const claimed = claimOldestPendingWebRtcVoiceHandoffTurn('workspace-1', {
      callIds: ['call-active'],
    })
    expect(claimed?.turnId).toBe(activeTurn.turnId)
    expect(claimOldestPendingWebRtcVoiceHandoffTurn('workspace-1', { callIds: [] })).toBeNull()
    expect(
      claimOldestPendingWebRtcVoiceHandoffTurn('workspace-1', { callIds: ['call-missing'] })
    ).toBeNull()
    expect(claimOldestPendingWebRtcVoiceHandoffTurn('workspace-1')?.turnId).toBe(oldTurn.turnId)
  })
})
