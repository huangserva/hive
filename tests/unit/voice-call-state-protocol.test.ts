import { describe, expect, test } from 'vitest'

import {
  createVoiceCallStateFrame,
  isVoiceCallStateFrame,
} from '../../src/server/voice-call-state-protocol.js'

describe('voice_call_state protocol', () => {
  test('creates a valid voice_call_state frame with snake_case fields', () => {
    const frame = createVoiceCallStateFrame({
      callId: 'call-1',
      phase: 'processing',
      ts: 1_717_000,
      turnId: 'turn-1',
    })

    expect(frame).toEqual({
      call_id: 'call-1',
      phase: 'processing',
      ts: 1_717_000,
      turn_id: 'turn-1',
      type: 'voice_call_state',
    })
    expect(isVoiceCallStateFrame(frame)).toBe(true)
  })

  test('rejects malformed frames and unknown phases', () => {
    expect(
      isVoiceCallStateFrame({
        call_id: 'call-1',
        phase: 'waiting',
        ts: 1,
        turn_id: 'turn-1',
        type: 'voice_call_state',
      })
    ).toBe(false)
    expect(
      isVoiceCallStateFrame({
        call_id: 'call-1',
        phase: 'heard',
        ts: Number.NaN,
        turn_id: 'turn-1',
        type: 'voice_call_state',
      })
    ).toBe(false)
    expect(
      isVoiceCallStateFrame({
        call_id: '',
        phase: 'responding',
        ts: 1,
        turn_id: 'turn-1',
        type: 'voice_call_state',
      })
    ).toBe(false)
  })
})
