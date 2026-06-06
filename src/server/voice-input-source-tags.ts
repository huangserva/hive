export const VOICE_INPUT_SOURCE = {
  talkContinuous: 'talk_continuous',
  voice: 'voice',
  webRtcCall: 'webrtc_call',
} as const

export type VoiceInputSource = (typeof VOICE_INPUT_SOURCE)[keyof typeof VOICE_INPUT_SOURCE]
