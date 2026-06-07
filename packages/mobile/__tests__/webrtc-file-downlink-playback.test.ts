import { describe, expect, test, vi } from 'vitest'

import { createVoiceDownlinkSegmentReassemblerCache } from '../src/api/voice-downlink-segment-protocol.js'
import {
  cleanupWebRtcFileDownlinkResources,
  cleanupWebRtcRuntimeCallResources,
} from '../src/lib/webrtc-file-downlink-cleanup.js'
import { playWebRtcFileDownlinkSegment } from '../src/lib/webrtc-file-downlink-playback.js'

describe('WebRTC file downlink playback', () => {
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
