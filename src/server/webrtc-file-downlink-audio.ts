import { createLocalTtsProvider, type LocalTtsProvider } from './local-tts.js'
import type { HiveLogger } from './logger.js'
import type { MobileChatMessage } from './mobile-chat-store.js'
import { sanitizeForSpeech } from './speech-text-sanitizer.js'
import {
  createVoiceCallStateFrame,
  createVoiceCallStateSender,
  type VoiceCallStateFrame,
  type VoiceCallStatePhase,
} from './voice-call-state-protocol.js'
import {
  createVoiceDownlinkSegmentFrame,
  splitAudioBase64ToVoiceDownlinkSegmentFrames,
  type VoiceDownlinkSegmentFrame,
} from './voice-downlink-segment-protocol.js'
import {
  buildVoiceLatencyBreakdownLog,
  buildVoiceTurnTimelineLog,
  claimPendingLegacyWebRtcVoiceLatencyTurn,
  type claimPendingWebRtcVoiceLatencyTurn,
  claimWebRtcVoiceLatencyTurnForId,
  claimWebRtcVoiceLatencyTurnForMessage,
  discardWebRtcVoiceLatencyTurn,
  finishWebRtcVoiceLatencyTurn,
  markWebRtcVoiceLatency,
} from './webrtc-voice-latency.js'

type WebRtcFileDownlinkStore = {
  registerMobileChatListener: (
    listener: (workspaceId: string, message: MobileChatMessage) => void
  ) => () => void
}

type WebRtcFileDownlinkFrame = VoiceCallStateFrame | VoiceDownlinkSegmentFrame

export type WebRtcDownlinkMode = 'file_segments' | 'webrtc_track'

export interface WebRtcFileDownlinkAudioSession {
  close(): Promise<void> | void
  flush(): Promise<void>
  interrupt?: () => void
}

export interface WebRtcFileDownlinkAudio {
  startCall(input: {
    callId: string
    send: (frame: WebRtcFileDownlinkFrame) => void
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

const parseVoiceLatencyTurnId = (message: MobileChatMessage) => {
  try {
    const parsed = JSON.parse(message.content_json) as { voice_latency_turn_id?: unknown }
    return typeof parsed.voice_latency_turn_id === 'string'
      ? parsed.voice_latency_turn_id.trim()
      : ''
  } catch {
    return ''
  }
}

const isVoiceIntentFrontReply = (message: MobileChatMessage) => {
  try {
    const parsed = JSON.parse(message.content_json) as { source?: unknown; voice_intent?: unknown }
    return parsed.source === 'voice_intent_front' || parsed.voice_intent === true
  } catch {
    return false
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
    const callStateSender = createVoiceCallStateSender<VoiceDownlinkSegmentFrame>({
      callId,
      logger,
      send,
    })

    const sendCallState = (phase: VoiceCallStatePhase, turnId: string | undefined) => {
      if (!turnId) return
      callStateSender.send(createVoiceCallStateFrame({ callId, phase, turnId }))
    }

    const processReply = async (
      message: MobileChatMessage,
      text: string,
      latencyTurn: ReturnType<typeof claimPendingWebRtcVoiceLatencyTurn>,
      queuedGeneration: number
    ) => {
      let latencyTurnCompleted = false
      const callStateTurnId = latencyTurn?.turnId ?? message.id
      let sentAudioFrame = false
      let shouldResetCallState =
        Boolean(callStateTurnId) && !closed && queuedGeneration === generation
      if (closed || queuedGeneration !== generation) {
        discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
        return
      }
      const sanitizedText = sanitizeForSpeech(text)
      if (!sanitizedText) {
        discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
        sendCallState('listening', callStateTurnId)
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
          if (!sentAudioFrame) {
            sentAudioFrame = true
            sendCallState('responding', callStateTurnId)
          }
          if (!latencyTurnCompleted && latencyTurn) {
            const completedTurn = markWebRtcVoiceLatency(latencyTurn.turnId, {
              firstDownlinkFrameAt: Date.now(),
            })
            if (completedTurn) {
              const timelineLog = completedTurn.branch
                ? buildVoiceTurnTimelineLog(completedTurn)
                : buildVoiceLatencyBreakdownLog(completedTurn, {
                    finalDownlinkField: 'final_to_segment_ms',
                    includeTtsToFirstFrame: false,
                  })
              logDiagnostic(logger, timelineLog)
              finishWebRtcVoiceLatencyTurn(completedTurn.turnId)
              latencyTurnCompleted = true
            }
          }
        }
        if (sentAudioFrame && !closed && queuedGeneration === generation) {
          sendCallState('listening', callStateTurnId)
          shouldResetCallState = false
        }
        logDiagnostic(
          logger,
          `file downlink segment sent: call_id=${callId} turn_id=${message.id} frames=${frames.length} bytes=${result.audio.byteLength}`
        )
      } catch (error) {
        logger?.warn?.('failed to send WebRTC file downlink audio', error)
      } finally {
        if (!sentAudioFrame && shouldResetCallState && !closed && queuedGeneration === generation) {
          sendCallState('listening', callStateTurnId)
        }
        if (!latencyTurnCompleted) discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
      }
    }

    const unsubscribe = store.registerMobileChatListener((messageWorkspaceId, message) => {
      if (closed || messageWorkspaceId !== workspaceId) return
      if (message.direction !== 'outbound' || message.message_type !== 'orch_reply') return
      const text = parseReplyText(message)
      if (!text) return
      const correlatedTurnId = parseVoiceLatencyTurnId(message)
      const exactLatencyTurn = claimWebRtcVoiceLatencyTurnForMessage(message.id)
      const correlatedLatencyTurn = claimWebRtcVoiceLatencyTurnForId(correlatedTurnId, {
        callId,
        workspaceId,
      })
      const latencyTurn =
        exactLatencyTurn ??
        correlatedLatencyTurn ??
        (isVoiceIntentFrontReply(message)
          ? null
          : claimPendingLegacyWebRtcVoiceLatencyTurn(workspaceId))
      const queuedGeneration = generation
      queue = queue.then(() => processReply(message, text, latencyTurn, queuedGeneration))
    })

    return {
      async close() {
        if (closed) return
        closed = true
        callStateSender.close()
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
        sendCallState('listening', `interrupt-${generation}`)
        logDiagnostic(logger, `file downlink interrupted: call_id=${callId}`)
      },
    }
  },
})
