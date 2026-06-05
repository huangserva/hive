import { describe, expect, test, vi } from 'vitest'

import { runWithWebRtcAudioInterlock } from '../src/lib/webrtc-audio-interlock'

describe('WebRTC audio interlock', () => {
  test('stops expo recording before a WebRTC audio session and restores it afterwards', async () => {
    const events: string[] = []

    const result = await runWithWebRtcAudioInterlock({
      isExpoRecordingActive: () => true,
      restoreExpoRecording: async () => {
        events.push('restore')
      },
      runSession: async () => {
        events.push('session')
        return 'ok'
      },
      setExpoRecordingAudioMode: async (allowsRecording) => {
        events.push(`mode:${allowsRecording}`)
      },
      shouldRestoreExpoRecording: () => true,
      stopExpoRecording: async () => {
        events.push('stop')
      },
    })

    expect(result).toBe('ok')
    expect(events).toEqual(['stop', 'mode:false', 'session', 'mode:true', 'restore'])
  })

  test('does not stop or restore expo recording when it was inactive', async () => {
    const stopExpoRecording = vi.fn()
    const restoreExpoRecording = vi.fn()
    const setExpoRecordingAudioMode = vi.fn()

    await runWithWebRtcAudioInterlock({
      isExpoRecordingActive: () => false,
      restoreExpoRecording,
      runSession: async () => 'ok',
      setExpoRecordingAudioMode,
      shouldRestoreExpoRecording: () => true,
      stopExpoRecording,
    })

    expect(stopExpoRecording).not.toHaveBeenCalled()
    expect(restoreExpoRecording).not.toHaveBeenCalled()
    expect(setExpoRecordingAudioMode).not.toHaveBeenCalled()
  })

  test('restores expo recording after a failed WebRTC session before rethrowing', async () => {
    const events: string[] = []

    await expect(
      runWithWebRtcAudioInterlock({
        isExpoRecordingActive: () => true,
        restoreExpoRecording: async () => {
          events.push('restore')
        },
        runSession: async () => {
          events.push('session')
          throw new Error('webrtc failed')
        },
        setExpoRecordingAudioMode: async (allowsRecording) => {
          events.push(`mode:${allowsRecording}`)
        },
        shouldRestoreExpoRecording: () => true,
        stopExpoRecording: async () => {
          events.push('stop')
        },
      })
    ).rejects.toThrow('webrtc failed')

    expect(events).toEqual(['stop', 'mode:false', 'session', 'mode:true', 'restore'])
  })

  test('leaves expo recording stopped when restore is no longer allowed', async () => {
    const restoreExpoRecording = vi.fn()
    const events: string[] = []

    await runWithWebRtcAudioInterlock({
      isExpoRecordingActive: () => true,
      restoreExpoRecording,
      runSession: async () => {
        events.push('session')
      },
      setExpoRecordingAudioMode: async (allowsRecording) => {
        events.push(`mode:${allowsRecording}`)
      },
      shouldRestoreExpoRecording: () => false,
      stopExpoRecording: async () => {
        events.push('stop')
      },
    })

    expect(events).toEqual(['stop', 'mode:false', 'session'])
    expect(restoreExpoRecording).not.toHaveBeenCalled()
  })
})
