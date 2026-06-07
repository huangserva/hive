import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createVoiceCallStateFrame,
  createVoiceCallStateSender,
  isVoiceCallStateFrame,
} from '../../src/server/voice-call-state-protocol.js'

describe('voice_call_state protocol', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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

  test('watchdog returns a processing turn to listening when no response arrives', () => {
    vi.useFakeTimers()
    const sent: unknown[] = []
    const sender = createVoiceCallStateSender({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      watchdogMs: 100,
    })

    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'processing', turnId: 't1' }))
    vi.advanceTimersByTime(99)
    expect(sent).toHaveLength(1)

    vi.advanceTimersByTime(1)

    expect(sent).toEqual([
      expect.objectContaining({ phase: 'processing', turn_id: 't1' }),
      expect.objectContaining({ phase: 'listening', turn_id: 't1' }),
    ])
  })

  test('logs every sent call state frame and marks watchdog fallback', () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const sent: unknown[] = []
    const infoLogs: string[] = []
    const sender = createVoiceCallStateSender({
      callId: 'call-1',
      logger: { info: (message: string) => infoLogs.push(message) },
      send: (frame) => sent.push(frame),
      watchdogMs: 100,
    })

    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'processing', turnId: 't1' }))
    vi.advanceTimersByTime(100)

    expect(sent).toEqual([
      expect.objectContaining({ phase: 'processing', turn_id: 't1' }),
      expect.objectContaining({ phase: 'listening', turn_id: 't1' }),
    ])
    expect(infoLogs).toEqual([
      'voice call state sent: call_id=call-1 turn_id=t1 phase=processing at=2000',
      'voice call state sent: call_id=call-1 turn_id=t1 phase=listening at=2100 reason=watchdog',
    ])
  })

  test('responding, listening, and close clear the processing watchdog', () => {
    vi.useFakeTimers()
    const sent: unknown[] = []
    const sender = createVoiceCallStateSender({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      watchdogMs: 100,
    })

    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'processing', turnId: 't1' }))
    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'responding', turnId: 't1' }))
    vi.advanceTimersByTime(100)
    expect(sent.map((frame) => (frame as { phase?: string }).phase)).toEqual([
      'processing',
      'responding',
    ])

    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'processing', turnId: 't2' }))
    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'listening', turnId: 't2' }))
    vi.advanceTimersByTime(100)
    expect(sent.map((frame) => (frame as { phase?: string }).phase)).toEqual([
      'processing',
      'responding',
      'processing',
      'listening',
    ])

    sender.send(createVoiceCallStateFrame({ callId: 'call-1', phase: 'processing', turnId: 't3' }))
    sender.close()
    vi.advanceTimersByTime(100)
    expect(sent.map((frame) => (frame as { phase?: string }).phase)).toEqual([
      'processing',
      'responding',
      'processing',
      'listening',
      'processing',
    ])
  })
})
