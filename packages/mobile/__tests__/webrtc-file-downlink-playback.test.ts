import { afterEach, describe, expect, test, vi } from 'vitest'

import { createVoiceDownlinkSegmentReassemblerCache } from '../src/api/voice-downlink-segment-protocol.js'
import {
  cleanupWebRtcFileDownlinkResources,
  cleanupWebRtcRuntimeCallResources,
} from '../src/lib/webrtc-file-downlink-cleanup.js'
import {
  createWebRtcFileDownlinkPlaybackGate,
  playWebRtcFileDownlinkSegment,
} from '../src/lib/webrtc-file-downlink-playback.js'

describe('WebRTC file downlink playback', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('switches to playback audio mode before playing the received TTS file', async () => {
    const setAudioMode = vi.fn().mockResolvedValue(undefined)
    const player = {
      play: vi.fn(),
      replace: vi.fn(),
    }

    await playWebRtcFileDownlinkSegment({
      player,
      segment: { audio: 'base64-audio', mime: 'audio/mpeg' },
      setAudioMode,
    })

    expect(setAudioMode).toHaveBeenCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    })
    expect(player.replace).toHaveBeenCalledWith({
      uri: 'data:audio/mpeg;base64,base64-audio',
    })
    expect(player.play).toHaveBeenCalledTimes(1)
    expect(setAudioMode.mock.invocationCallOrder[0]).toBeLessThan(
      player.replace.mock.invocationCallOrder[0] ?? 0
    )
  })

  test('queues received segments while the local call state is still inside the user speaking window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const play = vi.fn().mockResolvedValue(undefined)
    const gate = createWebRtcFileDownlinkPlaybackGate({ minQuietGapMs: 1000, play })

    gate.updatePhase('heard')
    gate.enqueue({
      audio: 'queued-audio',
      call_id: 'call-1',
      format: 'mp3',
      generation: 1,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-1',
    })

    expect(play).not.toHaveBeenCalled()

    vi.setSystemTime(500)
    gate.updatePhase('listening')
    vi.advanceTimersByTime(499)
    expect(play).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()

    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ audio: 'queued-audio', generation: 1, turn_id: 'turn-1' })
    )
  })

  test('retracts queued but unplayed generations without touching newer queued audio', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const play = vi.fn().mockResolvedValue(undefined)
    const gate = createWebRtcFileDownlinkPlaybackGate({ minQuietGapMs: 800, play })

    gate.updatePhase('processing')
    gate.enqueue({
      audio: 'old-audio',
      call_id: 'call-1',
      format: 'mp3',
      generation: 2,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-old',
    })
    gate.enqueue({
      audio: 'new-audio',
      call_id: 'call-1',
      format: 'mp3',
      generation: 3,
      mime: 'audio/mpeg',
      segment_id: 2,
      turn_id: 'turn-new',
    })

    gate.retract('call-1', 2)
    vi.setSystemTime(800)
    gate.updatePhase('listening')
    await Promise.resolve()

    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ audio: 'new-audio', generation: 3, turn_id: 'turn-new' })
    )
  })

  test('clear drops queued playback and cancels delayed starts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const play = vi.fn()
    const gate = createWebRtcFileDownlinkPlaybackGate({ minQuietGapMs: 500, play })

    gate.updatePhase('heard')
    gate.enqueue({
      audio: 'queued-audio',
      call_id: 'call-1',
      format: 'mp3',
      generation: 1,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-1',
    })
    gate.updatePhase('listening')
    gate.clear()
    vi.advanceTimersByTime(500)

    expect(play).not.toHaveBeenCalled()
    expect(gate.pendingCount()).toBe(0)
  })

  test('waits for the real playback ended signal before starting the next queued segment', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const play = vi.fn().mockResolvedValue(undefined)
    const gate = createWebRtcFileDownlinkPlaybackGate({ minQuietGapMs: 0, play })

    gate.enqueue({
      audio: 'first',
      call_id: 'call-1',
      format: 'mp3',
      generation: 1,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-1',
    })
    gate.enqueue({
      audio: 'second',
      call_id: 'call-1',
      format: 'mp3',
      generation: 2,
      mime: 'audio/mpeg',
      segment_id: 2,
      turn_id: 'turn-2',
    })

    expect(play).toHaveBeenCalledTimes(1)
    expect(gate.pendingCount()).toBe(1)

    await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(1)

    gate.onPlaybackEnded()
    await Promise.resolve()

    expect(play).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenNthCalledWith(2, expect.objectContaining({ audio: 'second' }))
  })

  test('reports queue, start, and finished events with the active segment ids', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const events: string[] = []
    const play = vi.fn().mockResolvedValue(undefined)
    const gate = createWebRtcFileDownlinkPlaybackGate({
      minQuietGapMs: 0,
      onEnqueue: ({ pendingCount, segment }) =>
        events.push(`queued:${segment.turn_id}:${pendingCount}`),
      onPlaybackEnd: (segment) => events.push(`finished:${segment.turn_id}`),
      onPlaybackStart: (segment) => events.push(`started:${segment.turn_id}`),
      play,
    })

    gate.enqueue({
      audio: 'first',
      call_id: 'call-1',
      format: 'mp3',
      generation: 1,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-1',
    })
    gate.enqueue({
      audio: 'second',
      call_id: 'call-1',
      format: 'mp3',
      generation: 2,
      mime: 'audio/mpeg',
      segment_id: 2,
      turn_id: 'turn-2',
    })

    expect(events).toEqual(['queued:turn-1:1', 'started:turn-1', 'queued:turn-2:1'])

    gate.onPlaybackEnded()
    await Promise.resolve()

    expect(events).toEqual([
      'queued:turn-1:1',
      'started:turn-1',
      'queued:turn-2:1',
      'finished:turn-1',
      'started:turn-2',
    ])
  })

  test('ignores stale playback completion after clear starts a newer playback epoch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const play = vi.fn().mockResolvedValue(undefined)
    const gate = createWebRtcFileDownlinkPlaybackGate({ minQuietGapMs: 0, play })

    gate.enqueue({
      audio: 'old-first',
      call_id: 'call-1',
      format: 'mp3',
      generation: 1,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-old-first',
    })
    gate.enqueue({
      audio: 'old-second',
      call_id: 'call-1',
      format: 'mp3',
      generation: 2,
      mime: 'audio/mpeg',
      segment_id: 2,
      turn_id: 'turn-old-second',
    })

    expect(play).toHaveBeenCalledTimes(1)
    gate.clear()
    gate.enqueue({
      audio: 'new-first',
      call_id: 'call-1',
      format: 'mp3',
      generation: 3,
      mime: 'audio/mpeg',
      segment_id: 3,
      turn_id: 'turn-new-first',
    })
    gate.enqueue({
      audio: 'new-second',
      call_id: 'call-1',
      format: 'mp3',
      generation: 4,
      mime: 'audio/mpeg',
      segment_id: 4,
      turn_id: 'turn-new-second',
    })

    expect(play).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenNthCalledWith(2, expect.objectContaining({ audio: 'new-first' }))

    gate.onPlaybackEnded(1)
    await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(2)

    gate.onPlaybackEnded()
    await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(3)
    expect(play).toHaveBeenNthCalledWith(3, expect.objectContaining({ audio: 'new-second' }))
  })

  test('runtime disconnect cleanup closes active call resources and file segment state', () => {
    const unsubscribe = vi.fn()
    const session = { close: vi.fn() }
    const audioRoute = { stop: vi.fn().mockResolvedValue(undefined) }
    const remoteAudioRefsRef = { current: [{}] }
    const reassemblers = { clear: vi.fn() }
    const player = { pause: vi.fn() }
    const unsubscribeRef = { current: unsubscribe }
    const sessionRef = { current: session }
    const audioRouteRef = { current: audioRoute }

    cleanupWebRtcRuntimeCallResources({
      audioRouteRef,
      fileDownlink: {
        player,
        reassemblers,
        unsubscribeRef,
      },
      remoteAudioRefsRef,
      sessionRef,
    })

    expect(session.close).toHaveBeenCalledTimes(1)
    expect(sessionRef.current).toBeNull()
    expect(audioRouteRef.current).toBeNull()
    expect(remoteAudioRefsRef.current).toEqual([])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribeRef.current).toBeNull()
    expect(reassemblers.clear).toHaveBeenCalledTimes(1)
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(audioRoute.stop).toHaveBeenCalledTimes(1)
  })
})

describe('WebRTC file downlink reassembler cache', () => {
  test('bounds incomplete segments and expires stale entries', () => {
    const cache = createVoiceDownlinkSegmentReassemblerCache({ maxEntries: 1, ttlMs: 100 })
    const frame = {
      call_id: 'call-1',
      generation: 0,
      op: 'segment_chunk' as const,
      payload: 'a',
      segment_id: 1,
      seq: 1,
      turn_id: 'turn-1',
      type: 'voice_downlink_segment' as const,
    }

    cache.accept(frame, 0)
    cache.accept({ ...frame, segment_id: 2, turn_id: 'turn-2' }, 10)
    expect(cache.size()).toBe(1)

    cache.cleanup(111)
    expect(cache.size()).toBe(0)
  })

  test('retracts incomplete segments at or below the requested generation without affecting newer segments', () => {
    const cache = createVoiceDownlinkSegmentReassemblerCache({ maxEntries: 10, ttlMs: 1_000 })
    const frame = {
      call_id: 'call-1',
      op: 'segment_chunk' as const,
      payload: 'a',
      segment_id: 1,
      seq: 1,
      turn_id: 'turn-1',
      type: 'voice_downlink_segment' as const,
    }

    cache.accept({ ...frame, generation: 2 }, 0)
    cache.accept({ ...frame, generation: 3, segment_id: 2 }, 10)
    cache.accept({ ...frame, call_id: 'other-call', generation: 2, segment_id: 3 }, 20)

    cache.clearRetractedGenerations('call-1', 2)

    expect(cache.size()).toBe(2)
    expect(
      cache.accept(
        {
          ...frame,
          done: true,
          generation: 2,
          payload: 'late',
          seq: 1,
        },
        30
      )
    ).toBeNull()
    expect(
      cache.accept(
        {
          ...frame,
          done: true,
          generation: 3,
          payload: 'b',
          segment_id: 2,
          seq: 2,
        },
        40
      )
    ).toEqual(
      expect.objectContaining({
        audio: 'ab',
        call_id: 'call-1',
        generation: 3,
        segment_id: 2,
      })
    )
  })
})

describe('WebRTC file downlink cleanup', () => {
  test('unsubscribes, clears incomplete segment state, and pauses file playback', () => {
    const unsubscribe = vi.fn()
    const reassemblers = { clear: vi.fn() }
    const player = { pause: vi.fn() }
    const unsubscribeRef = { current: unsubscribe }

    cleanupWebRtcFileDownlinkResources({
      player,
      reassemblers,
      unsubscribeRef,
    })

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(unsubscribeRef.current).toBeNull()
    expect(reassemblers.clear).toHaveBeenCalledTimes(1)
    expect(player.pause).toHaveBeenCalledTimes(1)
  })
})
