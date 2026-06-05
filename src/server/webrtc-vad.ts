export interface WebRtcUtteranceVadConfig {
  minSpeechMs: number
  onSpeechStart?: () => void
  silenceMs: number
  speechStartConfirmationFrames: number
  speechRmsThreshold: number
}

export interface WebRtcPcmVadFrame {
  bitsPerSample: number
  channelCount: number
  pcm: Buffer
  sampleRate: number
}

export interface WebRtcVadUtterance {
  averageRms: number
  bitsPerSample: number
  channelCount: number
  peakRms: number
  pcm: Buffer
  sampleRate: number
}

export const DEFAULT_WEBRTC_UTTERANCE_VAD_CONFIG: WebRtcUtteranceVadConfig = {
  minSpeechMs: 250,
  silenceMs: 900,
  speechStartConfirmationFrames: 3,
  speechRmsThreshold: 0.006,
}

export const calculateWebRtcInt16Rms = (pcm: Buffer) => {
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
  let rmsWeightedTotal = 0
  let peakRms = 0
  let consecutiveSpeechFrames = 0
  let speechStartFired = false

  const reset = () => {
    activeFrames = []
    speechMs = 0
    silenceMs = 0
    rmsWeightedTotal = 0
    peakRms = 0
    consecutiveSpeechFrames = 0
    speechStartFired = false
  }

  const emit = (): WebRtcVadUtterance | null => {
    if (activeFrames.length <= 0) return null
    if (speechMs < resolved.minSpeechMs) {
      reset()
      return null
    }
    const utterance = {
      averageRms: rmsWeightedTotal / speechMs,
      bitsPerSample: activeBitsPerSample,
      channelCount: activeChannelCount,
      peakRms,
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
      const rms = calculateWebRtcInt16Rms(frame.pcm)
      const isSpeech = rms >= resolved.speechRmsThreshold

      if (isSpeech) {
        consecutiveSpeechFrames += 1
        if (
          !speechStartFired &&
          consecutiveSpeechFrames >= resolved.speechStartConfirmationFrames
        ) {
          speechStartFired = true
          resolved.onSpeechStart?.()
        }
        if (activeFrames.length <= 0) {
          activeBitsPerSample = frame.bitsPerSample
          activeChannelCount = frame.channelCount
          activeSampleRate = frame.sampleRate
        }
        activeFrames.push(frame.pcm)
        speechMs += durationMs
        rmsWeightedTotal += rms * durationMs
        peakRms = Math.max(peakRms, rms)
        silenceMs = 0
        return null
      }

      consecutiveSpeechFrames = 0
      if (activeFrames.length <= 0) return null
      silenceMs += durationMs
      if (silenceMs >= resolved.silenceMs) return emit()
      return null
    },
  }
}
