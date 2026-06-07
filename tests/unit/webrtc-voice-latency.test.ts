import { describe, expect, test } from 'vitest'

import {
  buildVoiceLatencyBreakdownLog,
  claimPendingWebRtcVoiceLatencyTurn,
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
})
