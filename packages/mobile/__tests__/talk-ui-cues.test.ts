import { describe, expect, test } from 'vitest'

import {
  getTalkStateVisual,
  resolveConnectionCue,
  resolveTalkStateCue,
  TALK_STATE_VISUALS,
} from '../src/lib/talk-ui-cues'

describe('talk UI driving cues', () => {
  test('maps every talkback state into the five driving color states', () => {
    expect(getTalkStateVisual('idle').kind).toBe('idle')
    expect(getTalkStateVisual('listening').kind).toBe('listening')
    expect(getTalkStateVisual('capturing').kind).toBe('listening')
    expect(getTalkStateVisual('recording').kind).toBe('listening')
    expect(getTalkStateVisual('sending').kind).toBe('processing')
    expect(getTalkStateVisual('waiting_for_orchestrator').kind).toBe('processing')
    expect(getTalkStateVisual('processing').kind).toBe('processing')
    expect(getTalkStateVisual('speaking').kind).toBe('speaking')
    expect(getTalkStateVisual('error').kind).toBe('error')
  })

  test('uses the approved five state hues from the mobile design tokens', () => {
    expect(TALK_STATE_VISUALS.idle.accent).toBe('#8B949E')
    expect(TALK_STATE_VISUALS.listening.accent).toBe('#3FB950')
    expect(TALK_STATE_VISUALS.processing.accent).toBe('#D29922')
    expect(TALK_STATE_VISUALS.speaking.accent).toBe('#58A6FF')
    expect(TALK_STATE_VISUALS.error.accent).toBe('#F85149')
  })

  test('resolves haptic and audio cues without playing audio when entering recording states', () => {
    expect(resolveTalkStateCue('idle', 'listening')).toEqual({
      audio: null,
      haptic: 'light',
    })
    expect(resolveTalkStateCue('capturing', 'processing')).toEqual({
      audio: 'process',
      haptic: null,
    })
    expect(resolveTalkStateCue('processing', 'speaking')).toEqual({
      audio: null,
      haptic: 'light',
    })
    expect(resolveTalkStateCue('speaking', 'listening')).toEqual({
      audio: null,
      haptic: 'light',
    })
    expect(resolveTalkStateCue('listening', 'idle')).toEqual({
      audio: 'exit',
      haptic: 'double',
    })
    expect(resolveTalkStateCue('processing', 'error')).toEqual({
      audio: 'error',
      haptic: 'warning',
    })
  })

  test('cues network disconnects and reconnects with a double short haptic', () => {
    expect(resolveConnectionCue(true, false)).toEqual({
      audio: 'network',
      haptic: 'double',
    })
    expect(resolveConnectionCue(false, true)).toEqual({
      audio: 'listen',
      haptic: 'double',
    })
    expect(resolveConnectionCue(true, true)).toBeNull()
  })
})
