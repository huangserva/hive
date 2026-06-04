import type { TalkbackState } from './push-to-talk'

export type TalkDrivingVisualKind = 'error' | 'idle' | 'listening' | 'processing' | 'speaking'
export type TalkAudioCue = 'error' | 'exit' | 'listen' | 'network' | 'process'
export type TalkHapticCue = 'double' | 'light' | 'warning'

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

export const TALK_STATE_VISUALS: Record<TalkDrivingVisualKind, TalkStateVisual> = {
  error: {
    accent: '#F85149',
    icon: 'alert-circle-outline',
    kind: 'error',
    panel: 'rgba(248, 81, 73, 0.18)',
    soft: '#ff9b96',
  },
  idle: {
    accent: '#8B949E',
    icon: 'mic-outline',
    kind: 'idle',
    panel: 'rgba(139, 148, 158, 0.16)',
    soft: '#cfd6df',
  },
  listening: {
    accent: '#3FB950',
    icon: 'radio-outline',
    kind: 'listening',
    panel: 'rgba(63, 185, 80, 0.18)',
    soft: '#8ff0a4',
  },
  processing: {
    accent: '#D29922',
    icon: 'sync-outline',
    kind: 'processing',
    panel: 'rgba(210, 153, 34, 0.18)',
    soft: '#ffd36a',
  },
  speaking: {
    accent: '#58A6FF',
    icon: 'volume-high-outline',
    kind: 'speaking',
    panel: 'rgba(88, 166, 255, 0.18)',
    soft: '#9dccff',
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
  if (next === 'processing') return { audio: 'process', haptic: null }
  if (previous === 'speaking' && next === 'listening') return { audio: 'listen', haptic: 'light' }
  if (next === 'listening') return { audio: 'listen', haptic: 'light' }
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
