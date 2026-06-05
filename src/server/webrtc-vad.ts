export interface WebRtcUtteranceVadConfig {
  minSpeechMs: number
  silenceMs: number
  speechRmsThreshold: number
}

export interface WebRtcPcmVadFrame {
  bitsPerSample: number
  channelCount: number
  pcm: Buffer
  sampleRate: number
}

export interface WebRtcVadUtterance {
  bitsPerSample: number
  channelCount: number
  pcm: Buffer
  sampleRate: number
}

export const DEFAULT_WEBRTC_UTTERANCE_VAD_CONFIG: WebRtcUtteranceVadConfig = {
  minSpeechMs: 250,
  silenceMs: 900,
  speechRmsThreshold: 0.018,
}

const calculateInt16Rms = (pcm: Buffer) => {
  if (pcm.byteLength < 2) return 0
  let sumSquares = 0
  const samples = Math.floor(pcm.byteLength / 2)
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    const sample = pcm.readInt16LE(offset) / 32768
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / samples)
}

const frameDurationMs = ({ bitsPerSample, channelCount, pcm, sampleRate }: WebRtcPcmVadFrame) => {
  const bytesPerSample = bitsPerSample / 8
  const bytesPerFrame = Math.max(1, bytesPerSample * channelCount)
  const frames = Math.floor(pcm.byteLength / bytesPerFrame)
  return (frames / sampleRate) * 1000
}

export const createWebRtcUtteranceVad = (
  config: Partial<WebRtcUtteranceVadConfig> = {}
): {
  flush: (options?: { force?: boolean }) => WebRtcVadUtterance | null
  push: (frame: WebRtcPcmVadFrame) => WebRtcVadUtterance | null
} => {
  const resolved = { ...DEFAULT_WEBRTC_UTTERANCE_VAD_CONFIG, ...config }
  let activeFrames: Buffer[] = []
  let activeBitsPerSample = 16
  let activeChannelCount = 1
  let activeSampleRate = 48_000
  let speechMs = 0
  let silenceMs = 0

  const reset = () => {
    activeFrames = []
    speechMs = 0
    silenceMs = 0
  }

  const emit = (): WebRtcVadUtterance | null => {
    if (activeFrames.length <= 0) return null
    if (speechMs < resolved.minSpeechMs) {
      reset()
      return null
    }
    const utterance = {
      bitsPerSample: activeBitsPerSample,
      channelCount: activeChannelCount,
      pcm: Buffer.concat(activeFrames),
      sampleRate: activeSampleRate,
    }
    reset()
    return utterance
  }

  return {
    flush: () => emit(),
    push: (frame) => {
      if (frame.bitsPerSample !== 16) return null
      const durationMs = frameDurationMs(frame)
      const isSpeech = calculateInt16Rms(frame.pcm) >= resolved.speechRmsThreshold

      if (isSpeech) {
        if (activeFrames.length <= 0) {
          activeBitsPerSample = frame.bitsPerSample
          activeChannelCount = frame.channelCount
          activeSampleRate = frame.sampleRate
        }
        activeFrames.push(frame.pcm)
        speechMs += durationMs
        silenceMs = 0
        return null
      }

      if (activeFrames.length <= 0) return null
      silenceMs += durationMs
      if (silenceMs >= resolved.silenceMs) return emit()
      return null
    },
  }
}
