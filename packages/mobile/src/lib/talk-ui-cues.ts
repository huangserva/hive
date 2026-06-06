import type { TalkbackState } from './push-to-talk'

export type TalkDrivingVisualKind = 'error' | 'idle' | 'listening' | 'processing' | 'speaking'
export type TalkAudioCue = 'error' | 'exit' | 'listen' | 'network' | 'process'
export type TalkHapticCue = 'double' | 'light' | 'medium' | 'warning'

export type TalkCue = {
  audio: TalkAudioCue | null
  haptic: TalkHapticCue | null
}

export type TalkStateVisual = {
  accent: string
  icon: string
  kind: TalkDrivingVisualKind
  panel: string
  soft: string
}

// Premium driving palette (talk-ui-redesign 2026-06-05): brighter, higher-chroma
// state hues that read at a glance in sunlight while keeping the five-state model.
export const TALK_STATE_VISUALS: Record<TalkDrivingVisualKind, TalkStateVisual> = {
  error: {
    accent: '#FF6B6B',
    icon: 'alert-circle-outline',
    kind: 'error',
    panel: 'rgba(255, 107, 107, 0.16)',
    soft: '#ffb0b0',
  },
  idle: {
    accent: '#B5BDC8',
    icon: 'mic-outline',
    kind: 'idle',
    panel: 'rgba(181, 189, 200, 0.16)',
    soft: '#d7dde4',
  },
  listening: {
    accent: '#46E6A9',
    icon: 'radio-outline',
    kind: 'listening',
    panel: 'rgba(70, 230, 169, 0.16)',
    soft: '#7cffcb',
  },
  processing: {
    accent: '#FFD166',
    icon: 'sync-outline',
    kind: 'processing',
    panel: 'rgba(255, 209, 102, 0.16)',
    soft: '#ffe08a',
  },
  speaking: {
    accent: '#74B8FF',
    icon: 'volume-high-outline',
    kind: 'speaking',
    panel: 'rgba(116, 184, 255, 0.16)',
    soft: '#a9d2ff',
  },
}

export const getTalkDrivingVisualKind = (state: TalkbackState): TalkDrivingVisualKind => {
  if (state === 'error') return 'error'
  if (state === 'speaking') return 'speaking'
  if (state === 'sending' || state === 'waiting_for_orchestrator' || state === 'processing') {
    return 'processing'
  }
  if (state === 'listening' || state === 'capturing' || state === 'recording') {
    return 'listening'
  }
  return 'idle'
}

export const getTalkStateVisual = (state: TalkbackState) =>
  TALK_STATE_VISUALS[getTalkDrivingVisualKind(state)]

export const resolveTalkStateCue = (
  previousState: TalkbackState,
  nextState: TalkbackState
): TalkCue | null => {
  if (previousState === nextState) return null
  const previous = getTalkDrivingVisualKind(previousState)
  const next = getTalkDrivingVisualKind(nextState)
  if (previous === next) return null
  if (next === 'error') return { audio: 'error', haptic: 'warning' }
  if (next === 'speaking') return { audio: null, haptic: 'light' }
  if (next === 'processing') return { audio: 'process', haptic: 'medium' }
  if (previous === 'speaking' && next === 'listening') return { audio: null, haptic: 'light' }
  if (next === 'listening') return { audio: null, haptic: 'light' }
  if (previous === 'listening' && next === 'idle') return { audio: 'exit', haptic: 'double' }
  return null
}

export const resolveConnectionCue = (
  previousConnected: boolean,
  nextConnected: boolean
): TalkCue | null => {
  if (previousConnected === nextConnected) return null
  return nextConnected
    ? { audio: 'listen', haptic: 'double' }
    : { audio: 'network', haptic: 'double' }
}
