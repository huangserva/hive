import { createLocalTtsProvider, type LocalTtsProvider } from './local-tts.js'
import type { HiveLogger } from './logger.js'
import type { MobileChatMessage } from './mobile-chat-store.js'
import { sanitizeForSpeech } from './speech-text-sanitizer.js'
import {
  createVoiceDownlinkSegmentFrame,
  splitAudioBase64ToVoiceDownlinkSegmentFrames,
  type VoiceDownlinkSegmentFrame,
} from './voice-downlink-segment-protocol.js'
import {
  buildVoiceLatencyBreakdownLog,
  claimPendingWebRtcVoiceLatencyTurn,
  discardWebRtcVoiceLatencyTurn,
  finishWebRtcVoiceLatencyTurn,
  markWebRtcVoiceLatency,
} from './webrtc-voice-latency.js'

type WebRtcFileDownlinkStore = {
  registerMobileChatListener: (
    listener: (workspaceId: string, message: MobileChatMessage) => void
  ) => () => void
}

export type WebRtcDownlinkMode = 'file_segments' | 'webrtc_track'

export interface WebRtcFileDownlinkAudioSession {
  close(): Promise<void> | void
  flush(): Promise<void>
  interrupt?: () => void
}

export interface WebRtcFileDownlinkAudio {
  startCall(input: {
    callId: string
    send: (frame: VoiceDownlinkSegmentFrame) => void
    workspaceId: string
  }): Promise<WebRtcFileDownlinkAudioSession> | WebRtcFileDownlinkAudioSession
}

interface WebRtcFileDownlinkAudioOptions {
  chunkSize?: number
  createTtsProvider?: () => LocalTtsProvider
  logger?: Pick<HiveLogger, 'info' | 'warn'>
  store: WebRtcFileDownlinkStore
}

const WEBRTC_FILE_DOWNLINK_TTS_VOICE = 'zh-CN-XiaoxiaoNeural'
const DEFAULT_CHUNK_SIZE = 8192

export const resolveWebRtcDownlinkMode = (
  env: Record<string, unknown> = process.env
): WebRtcDownlinkMode =>
  env.HIVE_WEBRTC_DOWNLINK_MODE === 'file_segments' ? 'file_segments' : 'webrtc_track'

const parseReplyText = (message: MobileChatMessage) => {
  try {
    const parsed = JSON.parse(message.content_json) as { text?: unknown }
    return typeof parsed.text === 'string' ? parsed.text.trim() : ''
  } catch {
    return ''
  }
}

const logDiagnostic = (logger: Pick<HiveLogger, 'info' | 'warn'> | undefined, message: string) => {
  logger?.info?.(message)
  process.stderr.write(`[webrtc-file-downlink ${new Date().toISOString()}] ${message}\n`)
}

export const createWebRtcFileDownlinkAudio = ({
  chunkSize = DEFAULT_CHUNK_SIZE,
  createTtsProvider = () => createLocalTtsProvider(),
  logger,
  store,
}: WebRtcFileDownlinkAudioOptions): WebRtcFileDownlinkAudio => ({
  startCall({ callId, send, workspaceId }) {
    let closed = false
    let generation = 0
    let queue = Promise.resolve()

    const processReply = async (
      message: MobileChatMessage,
      text: string,
      latencyTurn: ReturnType<typeof claimPendingWebRtcVoiceLatencyTurn>,
      queuedGeneration: number
    ) => {
      let latencyTurnCompleted = false
      if (closed || queuedGeneration !== generation) {
        discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
        return
      }
      const sanitizedText = sanitizeForSpeech(text)
      if (!sanitizedText) {
        discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
        return
      }
      try {
        markWebRtcVoiceLatency(latencyTurn?.turnId, { ttsStartAt: Date.now() })
        const result = await createTtsProvider().synthesize(sanitizedText, {
          voice: WEBRTC_FILE_DOWNLINK_TTS_VOICE,
        })
        markWebRtcVoiceLatency(latencyTurn?.turnId, { ttsEndAt: Date.now() })
        if (!result || closed || queuedGeneration !== generation) return
        const frames = splitAudioBase64ToVoiceDownlinkSegmentFrames({
          audio: result.audio.toString('base64'),
          callId,
          chunkSize,
          format: result.format,
          generation: queuedGeneration,
          isFinal: true,
          mime: result.mime,
          segmentId: 1,
          text: sanitizedText,
          turnId: message.id,
        })
        for (const frame of frames) {
          if (closed || queuedGeneration !== generation) break
          send(frame)
          if (!latencyTurnCompleted && latencyTurn) {
            const completedTurn = markWebRtcVoiceLatency(latencyTurn.turnId, {
              firstDownlinkFrameAt: Date.now(),
            })
            if (completedTurn) {
              logDiagnostic(
                logger,
                buildVoiceLatencyBreakdownLog(completedTurn, {
                  finalDownlinkField: 'final_to_segment_ms',
                  includeTtsToFirstFrame: false,
                })
              )
              finishWebRtcVoiceLatencyTurn(completedTurn.turnId)
              latencyTurnCompleted = true
            }
          }
        }
        logDiagnostic(
          logger,
          `file downlink segment sent: call_id=${callId} turn_id=${message.id} frames=${frames.length} bytes=${result.audio.byteLength}`
        )
      } catch (error) {
        logger?.warn?.('failed to send WebRTC file downlink audio', error)
      } finally {
        if (!latencyTurnCompleted) discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
      }
    }

    const unsubscribe = store.registerMobileChatListener((messageWorkspaceId, message) => {
      if (closed || messageWorkspaceId !== workspaceId) return
      if (message.direction !== 'outbound' || message.message_type !== 'orch_reply') return
      const text = parseReplyText(message)
      if (!text) return
      const latencyTurn = claimPendingWebRtcVoiceLatencyTurn(workspaceId)
      const queuedGeneration = generation
      queue = queue.then(() => processReply(message, text, latencyTurn, queuedGeneration))
    })

    return {
      async close() {
        if (closed) return
        closed = true
        unsubscribe()
        await queue
      },
      async flush() {
        await queue
      },
      interrupt() {
        if (closed) return
        generation += 1
        queue = Promise.resolve()
        send(
          createVoiceDownlinkSegmentFrame('interrupt', {
            callId,
            generation,
            segmentId: 0,
            seq: 0,
            turnId: `interrupt-${generation}`,
          })
        )
        logDiagnostic(logger, `file downlink interrupted: call_id=${callId}`)
      },
    }
  },
})
