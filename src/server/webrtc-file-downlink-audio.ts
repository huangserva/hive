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
  getPlaybackState?: () => WebRtcFileDownlinkPlaybackState
  interrupt?: () => void
}

export interface WebRtcFileDownlinkPlaybackState {
  bytes?: number
  frames?: number
  generation: number
  messageId?: string
  state: 'closed' | 'idle' | 'interrupted' | 'sending' | 'sent' | 'synthesizing'
  textPreview?: string
  turnId?: string
  updatedAtMs: number
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

const parseVoiceIntentGeneration = (message: MobileChatMessage) => {
  try {
    const parsed = JSON.parse(message.content_json) as { intent_generation?: unknown }
    return typeof parsed.intent_generation === 'number' &&
      Number.isInteger(parsed.intent_generation)
      ? parsed.intent_generation
      : null
  } catch {
    return null
  }
}

const resolveQueuedGeneration = ({
  currentGeneration,
  generationByIntentGeneration,
  latestVoiceIntentGeneration,
  voiceIntentGeneration,
}: {
  currentGeneration: number
  generationByIntentGeneration: Map<number, number>
  latestVoiceIntentGeneration: number | null
  voiceIntentGeneration: number | null
}) => {
  if (voiceIntentGeneration === null) {
    return {
      latestVoiceIntentGeneration,
      nextGeneration: currentGeneration,
      queuedGeneration: currentGeneration,
      retractGeneration: null,
    }
  }

  if (latestVoiceIntentGeneration !== null && voiceIntentGeneration < latestVoiceIntentGeneration) {
    return {
      latestVoiceIntentGeneration,
      nextGeneration: currentGeneration,
      queuedGeneration: null,
      retractGeneration: null,
    }
  }

  const mappedGeneration = generationByIntentGeneration.get(voiceIntentGeneration)
  if (mappedGeneration !== undefined) {
    return {
      latestVoiceIntentGeneration:
        latestVoiceIntentGeneration === null
          ? voiceIntentGeneration
          : Math.max(latestVoiceIntentGeneration, voiceIntentGeneration),
      nextGeneration: currentGeneration,
      queuedGeneration: mappedGeneration,
      retractGeneration: null,
    }
  }

  const shouldAdvanceGeneration = latestVoiceIntentGeneration !== null
  const nextGeneration = shouldAdvanceGeneration ? currentGeneration + 1 : currentGeneration
  generationByIntentGeneration.set(voiceIntentGeneration, nextGeneration)
  return {
    latestVoiceIntentGeneration: voiceIntentGeneration,
    nextGeneration,
    queuedGeneration: nextGeneration,
    retractGeneration: shouldAdvanceGeneration ? currentGeneration : null,
  }
}

const logDiagnostic = (logger: Pick<HiveLogger, 'info' | 'warn'> | undefined, message: string) => {
  logger?.info?.(message)
  process.stderr.write(`[webrtc-file-downlink ${new Date().toISOString()}] ${message}\n`)
}

const summarizeDownlinkText = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80)

const formatPlaybackStateForLog = (state: WebRtcFileDownlinkPlaybackState) =>
  `state=${state.state} generation=${state.generation} message_id=${state.messageId ?? 'none'} turn_id=${state.turnId ?? 'none'} frames=${state.frames ?? 'na'} bytes=${state.bytes ?? 'na'} text=${JSON.stringify(state.textPreview ?? '')}`

export const createWebRtcFileDownlinkAudio = ({
  chunkSize = DEFAULT_CHUNK_SIZE,
  createTtsProvider = () => createLocalTtsProvider(),
  logger,
  store,
}: WebRtcFileDownlinkAudioOptions): WebRtcFileDownlinkAudio => ({
  startCall({ callId, send, workspaceId }) {
    let closed = false
    let generation = 0
    let latestVoiceIntentGeneration: number | null = null
    const generationByIntentGeneration = new Map<number, number>()
    let queue = Promise.resolve()
    let playbackState: WebRtcFileDownlinkPlaybackState = {
      generation,
      state: 'idle',
      updatedAtMs: Date.now(),
    }
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
        playbackState = {
          generation: queuedGeneration,
          messageId: message.id,
          state: 'synthesizing',
          textPreview: summarizeDownlinkText(sanitizedText),
          turnId: message.id,
          updatedAtMs: Date.now(),
        }
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
        playbackState = {
          bytes: result.audio.byteLength,
          frames: frames.length,
          generation: queuedGeneration,
          messageId: message.id,
          state: 'sending',
          textPreview: summarizeDownlinkText(sanitizedText),
          turnId: message.id,
          updatedAtMs: Date.now(),
        }
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
          playbackState = {
            bytes: result.audio.byteLength,
            frames: frames.length,
            generation: queuedGeneration,
            messageId: message.id,
            state: 'sent',
            textPreview: summarizeDownlinkText(sanitizedText),
            turnId: message.id,
            updatedAtMs: Date.now(),
          }
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
      const voiceIntentGeneration = parseVoiceIntentGeneration(message)
      const voiceIntentReply = isVoiceIntentFrontReply(message)
      const correlatedTurnId = parseVoiceLatencyTurnId(message)
      const exactLatencyTurn = claimWebRtcVoiceLatencyTurnForMessage(message.id)
      const correlatedLatencyTurn = claimWebRtcVoiceLatencyTurnForId(correlatedTurnId, {
        callId,
        workspaceId,
      })
      const latencyTurn =
        exactLatencyTurn ??
        correlatedLatencyTurn ??
        (voiceIntentReply ? null : claimPendingLegacyWebRtcVoiceLatencyTurn(workspaceId))
      const resolvedIntentGeneration =
        voiceIntentGeneration ?? latencyTurn?.intentGeneration ?? null
      const resolvedGeneration = resolveQueuedGeneration({
        currentGeneration: generation,
        generationByIntentGeneration,
        latestVoiceIntentGeneration,
        voiceIntentGeneration: resolvedIntentGeneration,
      })
      latestVoiceIntentGeneration = resolvedGeneration.latestVoiceIntentGeneration
      if (resolvedGeneration.retractGeneration !== null) {
        generation = resolvedGeneration.nextGeneration
        queue = Promise.resolve()
        send(
          createVoiceDownlinkSegmentFrame('retract', {
            callId,
            generation,
            retractGeneration: resolvedGeneration.retractGeneration,
            segmentId: 0,
            seq: 0,
            turnId: `retract-${generation}`,
          })
        )
        logDiagnostic(
          logger,
          `file downlink retract sent: call_id=${callId} retract_generation=${resolvedGeneration.retractGeneration} next_generation=${generation} message_id=${message.id} voice_intent_generation=${resolvedIntentGeneration ?? 'none'}`
        )
      } else {
        generation = resolvedGeneration.nextGeneration
      }
      if (resolvedGeneration.queuedGeneration === null) {
        logDiagnostic(
          logger,
          `file downlink stale reply dropped: call_id=${callId} message_id=${message.id} current_generation=${generation} voice_intent_generation=${resolvedIntentGeneration ?? 'none'}`
        )
        discardWebRtcVoiceLatencyTurn(latencyTurn?.turnId)
        return
      }
      const queuedGeneration = resolvedGeneration.queuedGeneration
      logDiagnostic(
        logger,
        `file downlink reply queued: call_id=${callId} message_id=${message.id} generation=${queuedGeneration} source=${voiceIntentReply ? 'voice_intent_front' : 'orch_reply'} voice_intent_generation=${resolvedIntentGeneration ?? 'none'} text_len=${text.length} text=${JSON.stringify(summarizeDownlinkText(text))}`
      )
      // TODO(M40): route PM results back through the intent front for a true single-voice persona.
      // This queue only guarantees front and PM audio never play at the same time.
      queue = queue.then(() => processReply(message, text, latencyTurn, queuedGeneration))
    })

    return {
      async close() {
        if (closed) return
        closed = true
        playbackState = {
          ...playbackState,
          state: 'closed',
          updatedAtMs: Date.now(),
        }
        callStateSender.close()
        unsubscribe()
        await queue
      },
      async flush() {
        await queue
      },
      getPlaybackState() {
        return { ...playbackState }
      },
      interrupt() {
        if (closed) return
        const previousState = { ...playbackState }
        generation += 1
        playbackState = {
          ...previousState,
          generation,
          state: 'interrupted',
          updatedAtMs: Date.now(),
        }
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
        logDiagnostic(
          logger,
          `file downlink interrupted: call_id=${callId} ${formatPlaybackStateForLog(previousState)} next_generation=${generation}`
        )
      },
    }
  },
})
