import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  appendFastReplyCoordination,
  type FastVoiceReplyProvider,
  maybeInsertFastVoiceReplyWithGatekeeper,
} from './fast-voice-reply.js'
import { createLocalSttProvider, type LocalSttProvider } from './local-stt.js'
import type { HiveLogger } from './logger.js'
import type { RuntimeStore } from './runtime-store.js'
import {
  createStreamingRecognitionSession,
  type StreamingRecognitionOptions,
  type StreamingRecognitionSession,
} from './streaming-stt-online.js'
import { VOICE_INPUT_SOURCE } from './voice-input-source-tags.js'
import {
  createGlmVoiceIntentVerdictProvider,
  createVoiceIntentSession,
  isVoiceIntentFrontEnabled,
  type VoiceIntentSessionUpdate,
  type VoiceIntentVerdict,
} from './voice-intent-front.js'
import type { WebRtcRemoteAudioSession, WebRtcRemoteAudioSink } from './webrtc-callee.js'
import {
  calculateWebRtcInt16Rms,
  createWebRtcUtteranceVad,
  type WebRtcUtteranceVadConfig,
  type WebRtcVadUtterance,
} from './webrtc-vad.js'
import { startWebRtcVoiceLatencyTurn } from './webrtc-voice-latency.js'
import { getOrchestratorId } from './workspace-store-support.js'

type WebRtcAudioSinkFrame = {
  bitsPerSample?: number
  channelCount?: number
  numberOfFrames?: number
  sampleRate?: number
  samples: Buffer | Int16Array | number[]
}

type WebRtcAudioSink = {
  ondata?: (data: WebRtcAudioSinkFrame) => void
  stop?: () => Promise<void> | void
}

type WebRtcAudioSinkCtor = new (track: unknown) => WebRtcAudioSink

type WebRtcUpstreamStore = Pick<
  RuntimeStore,
  | 'getActiveRunByAgentId'
  | 'insertMobileChatMessage'
  | 'listMobileChatMessages'
  | 'listWorkers'
  | 'recordUserInput'
>

type VoiceIntentShadowSession = {
  close(): void
  evaluate(input: {
    context?: string
    isFinal?: boolean
    partialSeq: number
    transcript: string
  }): Promise<VoiceIntentSessionUpdate>
}

type CreateVoiceIntentShadowSession = (options: {
  callId: string
  provider: ReturnType<typeof createGlmVoiceIntentVerdictProvider>
  turnId: string
}) => VoiceIntentShadowSession

interface WebRtcUpstreamAudioSinkOptions {
  createSttProvider?: () => LocalSttProvider
  createStreamingRecognitionSession?: (
    callId: string,
    options: StreamingRecognitionOptions
  ) => Promise<StreamingRecognitionSession | null>
  createVoiceIntentSession?: CreateVoiceIntentShadowSession
  fastVoiceReplyProvider?: FastVoiceReplyProvider
  loadAudioSink?: () => Promise<WebRtcAudioSinkCtor>
  logger?: Pick<HiveLogger, 'info' | 'warn'>
  store: WebRtcUpstreamStore
  tempRoot?: string
  vad?: Partial<WebRtcUtteranceVadConfig>
}

const MAX_SESSION_CONTEXT_SEGMENTS = 10
const MAX_SESSION_CONTEXT_CHARS = 2000

const logDiagnostic = (logger: Pick<HiveLogger, 'info' | 'warn'> | undefined, message: string) => {
  logger?.info?.(message)
  process.stderr.write(`[webrtc-upstream-audio ${new Date().toISOString()}] ${message}\n`)
}

const summarizeVoiceIntent = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80)

const formatVoiceIntentLogText = (text: string) =>
  JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 120))

const sanitizeVoiceIntentInternalText = (text: string) =>
  text
    .replace(/^\s*HIVE_GLM_GATEKEEPER\s*:\s*(?:handled|escalate)\b[^\S\r\n]*/gimu, '')
    .replace(/^\s*HIVE_GLM_GATEKEEPER\s*$/gimu, '')
    .replace(/^\s*(?:handled|escalate)\s*$/gimu, '')
    .replace(/^\s*(?:handled|escalate)\s*[:：]\s*/gimu, '')
    .replace(/([。！？!?])\s*(?:handled|escalate)\s*$/imu, '$1')
    .replace(/\bHIVE_GLM_GATEKEEPER\b/gimu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)

const hasVoiceIntentHandoffClaim = (text: string) =>
  /我(?:已经)?(?:派|安排|让团队|让.+去做)|已派|我来安排/u.test(text)

const hasVoiceIntentResultClaim = (text: string) =>
  /(?:已|已经).{0,8}(?:完成|部署|搞定|做好)|(?:完成|部署|搞定|做好)(?:了|完成)/u.test(text)

const sanitizeVoiceIntentReply = ({
  allowHandoffClaims,
  text,
}: {
  allowHandoffClaims: boolean
  text: string
}) => {
  const sanitized = sanitizeVoiceIntentInternalText(text).slice(0, 180)
  if (hasVoiceIntentResultClaim(sanitized)) return ''
  if (!allowHandoffClaims && hasVoiceIntentHandoffClaim(sanitized)) return ''
  return sanitized
}

const limitSessionContext = (sessionContext: string[]) => {
  const recentContext = sessionContext.slice(-MAX_SESSION_CONTEXT_SEGMENTS)
  const joined = recentContext.join('\n')
  return joined.length > MAX_SESSION_CONTEXT_CHARS
    ? joined.slice(joined.length - MAX_SESSION_CONTEXT_CHARS)
    : joined
}

type AcceptedVoiceIntentUpdate = Extract<VoiceIntentSessionUpdate, { status: 'accepted' }>

const isSafeVoiceIntentFallback = (verdict: VoiceIntentVerdict) =>
  verdict.action === 'drop' && verdict.confidence <= 0 && !verdict.reply_text.trim()

const insertVoiceIntentFrontReply = ({
  reply,
  store,
  workspaceId,
}: {
  reply: string
  store: WebRtcUpstreamStore
  workspaceId: string
}) => {
  if (!reply) return
  store.insertMobileChatMessage(
    workspaceId,
    'outbound',
    'orch_reply',
    JSON.stringify({ source: 'voice_intent_front', text: reply, voice_intent: true })
  )
}

const formatMobileVoicePrompt = (text: string) => `[来自手机 Mobile App]\n---\n${text}`

const applyVoiceIntentDrivenTranscript = ({
  activeRun,
  callId,
  logger,
  store,
  text,
  update,
  workspaceId,
}: {
  activeRun: NonNullable<ReturnType<WebRtcUpstreamStore['getActiveRunByAgentId']>>
  callId?: string | undefined
  logger?: Pick<HiveLogger, 'info' | 'warn'> | undefined
  store: WebRtcUpstreamStore
  text: string
  update: AcceptedVoiceIntentUpdate
  workspaceId: string
}) => {
  const verdict = update.verdict
  if (isSafeVoiceIntentFallback(verdict)) return 'fallback' as const

  const distilledIntent = sanitizeVoiceIntentInternalText(
    update.handoff?.distilledIntent || verdict.distilled_intent
  )
  const shouldForwardToPm =
    Boolean(update.handoff) &&
    verdict.completeness === 'complete' &&
    verdict.action === 'escalate' &&
    verdict.confidence >= 0.75 &&
    Boolean(distilledIntent)
  const reply = sanitizeVoiceIntentReply({
    allowHandoffClaims: shouldForwardToPm,
    text: verdict.reply_text,
  })

  logDiagnostic(
    logger,
    `voiceIntent driven decision: call_id=${callId ?? 'unknown'} completeness=${verdict.completeness} action=${verdict.action} confidence=${verdict.confidence.toFixed(2)} forward_pm=${shouldForwardToPm} distilled_intent=${summarizeVoiceIntent(distilledIntent)}`
  )

  if (verdict.action === 'drop') return 'handled' as const

  if (verdict.completeness !== 'complete') {
    insertVoiceIntentFrontReply({ reply, store, workspaceId })
    return 'handled' as const
  }

  store.insertMobileChatMessage(
    workspaceId,
    'inbound',
    'user_text',
    JSON.stringify({ source: VOICE_INPUT_SOURCE.webRtcCall, text })
  )

  if (shouldForwardToPm) {
    store.recordUserInput(workspaceId, activeRun.agentId, formatMobileVoicePrompt(distilledIntent))
    insertVoiceIntentFrontReply({ reply, store, workspaceId })
    return 'handled' as const
  }

  insertVoiceIntentFrontReply({ reply, store, workspaceId })
  store.recordUserInput(workspaceId, activeRun.agentId, formatMobileVoicePrompt(text), {
    forwardToOrchestrator: false,
  })
  return 'handled' as const
}

const loadWrtcAudioSink = async (): Promise<WebRtcAudioSinkCtor> => {
  const moduleName = '@roamhq/wrtc'
  const runtime = (await import(moduleName)) as {
    default?: { nonstandard?: { RTCAudioSink?: WebRtcAudioSinkCtor } }
    nonstandard?: { RTCAudioSink?: WebRtcAudioSinkCtor }
  }
  const RTCAudioSink =
    runtime.nonstandard?.RTCAudioSink ?? runtime.default?.nonstandard?.RTCAudioSink
  if (!RTCAudioSink) throw new Error('@roamhq/wrtc RTCAudioSink is unavailable')
  return RTCAudioSink
}

const samplesToBuffer = (samples: WebRtcAudioSinkFrame['samples']) => {
  if (Buffer.isBuffer(samples)) return Buffer.from(samples)
  if (samples instanceof Int16Array) {
    return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  }
  const int16 = Int16Array.from(samples)
  return Buffer.from(int16.buffer)
}

const writeWavFile = ({
  bitsPerSample,
  channelCount,
  frames,
  outputPath,
  sampleRate,
}: {
  bitsPerSample: number
  channelCount: number
  frames: Buffer[]
  outputPath: string
  sampleRate: number
}) => {
  const data = Buffer.concat(frames)
  const byteRate = (sampleRate * channelCount * bitsPerSample) / 8
  const blockAlign = (channelCount * bitsPerSample) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channelCount, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  writeFileSync(outputPath, Buffer.concat([header, data]))
}

export const injectWebRtcVoiceTranscript = async ({
  callId,
  fastVoiceReplyProvider,
  latencyTurnId,
  logger,
  sessionContext,
  store,
  text,
  voiceIntentUpdate,
  workspaceId,
}: {
  callId?: string | undefined
  fastVoiceReplyProvider?: FastVoiceReplyProvider
  latencyTurnId?: string | undefined
  logger?: Pick<HiveLogger, 'info' | 'warn'> | undefined
  sessionContext?: string[]
  store: WebRtcUpstreamStore
  text: string
  voiceIntentUpdate?: VoiceIntentSessionUpdate | null | undefined
  workspaceId: string
}) => {
  const trimmed = text.trim()
  if (!trimmed) return
  const orchId = getOrchestratorId(workspaceId)
  const activeRun = store.getActiveRunByAgentId(workspaceId, orchId)
  if (!activeRun) throw new Error('Orchestrator is not running')

  if (isVoiceIntentFrontEnabled() && voiceIntentUpdate && voiceIntentUpdate.status === 'accepted') {
    const result = applyVoiceIntentDrivenTranscript({
      activeRun,
      callId,
      logger,
      store,
      text: trimmed,
      update: voiceIntentUpdate,
      workspaceId,
    })
    if (result !== 'fallback') return
    logDiagnostic(
      logger,
      `voiceIntent driven fallback: reason=safe_zero_confidence text=${formatVoiceIntentLogText(trimmed)}`
    )
  }

  const formatted =
    sessionContext && sessionContext.length > 0
      ? `[对话上下文（本次通话之前说的）]\n${limitSessionContext(sessionContext)}\n\n[来自手机 Mobile App]\n---\n${trimmed}`
      : `[来自手机 Mobile App]\n---\n${trimmed}`
  const fastReply = await maybeInsertFastVoiceReplyWithGatekeeper({
    ...(fastVoiceReplyProvider ? { provider: fastVoiceReplyProvider } : {}),
    ...(latencyTurnId ? { latencyTurnId } : {}),
    source: 'voice',
    store,
    text: trimmed,
    workspaceId,
  })
  if (fastReply.gatekeeper === 'drop') return

  store.insertMobileChatMessage(
    workspaceId,
    'inbound',
    'user_text',
    JSON.stringify({ source: VOICE_INPUT_SOURCE.webRtcCall, text: trimmed })
  )

  const gatekeeperHandled =
    process.env.HIVE_GLM_GATEKEEPER !== '0' &&
    fastReply.gatekeeper === 'handled' &&
    fastReply.reply !== null
  const promptForOrchestrator =
    process.env.HIVE_GLM_GATEKEEPER !== '0' &&
    fastReply.gatekeeper === 'escalate' &&
    fastReply.reply !== null
      ? appendFastReplyCoordination(formatted, fastReply.reply)
      : formatted

  if (gatekeeperHandled) {
    store.recordUserInput(workspaceId, orchId, formatted, { forwardToOrchestrator: false })
  } else {
    store.recordUserInput(workspaceId, orchId, promptForOrchestrator)
  }
}

export const createWebRtcUpstreamAudioSink = ({
  createSttProvider = () => createLocalSttProvider(),
  createStreamingRecognitionSession: createStreamingSession = createStreamingRecognitionSession,
  createVoiceIntentSession: createIntentSession = createVoiceIntentSession,
  fastVoiceReplyProvider,
  loadAudioSink = loadWrtcAudioSink,
  logger,
  store,
  tempRoot = tmpdir(),
  vad,
}: WebRtcUpstreamAudioSinkOptions): WebRtcRemoteAudioSink => ({
  async start({ callId, onSpeechStart, track, workspaceId }): Promise<WebRtcRemoteAudioSession> {
    const tempDir = mkdtempSync(join(tempRoot, 'hive-webrtc-upstream-'))
    const AudioSink = await loadAudioSink()
    const sink = new AudioSink(track)
    let chunkCount = 0
    let sampleRate = 48_000
    let bitsPerSample = 16
    let channelCount = 1
    let totalPcmFrames = 0
    let utteranceIndex = 0
    let closed = false
    let rmsMin = Number.POSITIVE_INFINITY
    let rmsMax = 0
    let processingQueue = Promise.resolve()
    const sessionTranscript: string[] = []
    let voiceIntentPartialSeq = 0
    let latestVoiceIntentUpdate: VoiceIntentSessionUpdate | null = null
    const voiceIntentSession = isVoiceIntentFrontEnabled()
      ? createIntentSession({
          callId,
          provider: createGlmVoiceIntentVerdictProvider(),
          turnId: callId,
        })
      : null
    const evaluateVoiceIntentShadow = async (
      text: string,
      isFinal: boolean,
      contextSegments = sessionTranscript
    ) => {
      if (!voiceIntentSession) return null
      voiceIntentPartialSeq += 1
      try {
        const context = limitSessionContext(contextSegments)
        const update = await voiceIntentSession.evaluate({
          context,
          isFinal,
          partialSeq: voiceIntentPartialSeq,
          transcript: text,
        })
        if (update.status === 'accepted') {
          latestVoiceIntentUpdate = update
          logDiagnostic(
            logger,
            `voiceIntent shadow verdict: call_id=${callId} partial_seq=${voiceIntentPartialSeq} text=${formatVoiceIntentLogText(text)} completeness=${update.verdict.completeness} action=${update.verdict.action} confidence=${update.verdict.confidence.toFixed(2)} would_handoff=${Boolean(update.handoff)} distilled_intent=${summarizeVoiceIntent(update.verdict.distilled_intent)}`
          )
        } else if (update.status !== 'throttled') {
          logDiagnostic(
            logger,
            `voiceIntent shadow skipped: call_id=${callId} partial_seq=${voiceIntentPartialSeq} status=${update.status}`
          )
        }
        return update
      } catch (error) {
        logger?.warn?.('voice intent shadow evaluation failed', error)
        return null
      }
    }
    const logVoiceIntentEndpointComparison = (finalText: string) => {
      if (!voiceIntentSession) return
      const verdict =
        latestVoiceIntentUpdate?.status === 'accepted' ? latestVoiceIntentUpdate.verdict : null
      logDiagnostic(
        logger,
        `voiceIntent shadow endpoint_compare: call_id=${callId} partial_seq=${voiceIntentPartialSeq} endpoint=final final_text=${formatVoiceIntentLogText(finalText)} latest_completeness=${verdict?.completeness ?? 'none'} latest_action=${verdict?.action ?? 'none'} latest_confidence=${verdict ? verdict.confidence.toFixed(2) : 'none'}`
      )
    }
    let streamingSession = await createStreamingSession(callId, {
      onError: (error) => logger?.warn?.('streaming WebRTC STT error', error),
      onFinal: async (text) => {
        const priorContext = sessionTranscript.slice()
        const segment = priorContext.length + 1
        const latencyTurn = startWebRtcVoiceLatencyTurn({
          callId,
          segment,
          workspaceId,
        })
        logDiagnostic(
          logger,
          `audioSink streaming final: call_id=${callId} turn_id=${latencyTurn.turnId} segments=${segment} text_len=${text.trim().length}`
        )
        const finalVoiceIntentUpdate = await evaluateVoiceIntentShadow(text, true, priorContext)
        logVoiceIntentEndpointComparison(text)
        sessionTranscript.push(text)
        await injectWebRtcVoiceTranscript({
          ...(fastVoiceReplyProvider ? { fastVoiceReplyProvider } : {}),
          callId,
          latencyTurnId: latencyTurn.turnId,
          logger,
          sessionContext: priorContext,
          store,
          text,
          voiceIntentUpdate: finalVoiceIntentUpdate,
          workspaceId,
        })
      },
      onPartial: async (text) => {
        logDiagnostic(
          logger,
          `audioSink streaming partial: call_id=${callId} text_len=${text.length}`
        )
        await evaluateVoiceIntentShadow(text, false)
      },
    })
    const utteranceVad = createWebRtcUtteranceVad({
      ...vad,
      ...(onSpeechStart ? { onSpeechStart } : {}),
    })
    const pushToBatchVad = (buffer: Buffer) => {
      const utterance = utteranceVad.push({
        bitsPerSample,
        channelCount,
        pcm: buffer,
        sampleRate,
      })
      if (utterance) void processUtterance(utterance)
    }
    const pushToBargeInOnsetVad = (buffer: Buffer) => {
      utteranceVad.push({
        bitsPerSample,
        channelCount,
        pcm: buffer,
        sampleRate,
      })
    }
    const processUtterance = (utterance: WebRtcVadUtterance) => {
      utteranceIndex += 1
      const currentUtteranceIndex = utteranceIndex
      processingQueue = processingQueue
        .then(async () => {
          const utterancePath = join(tempDir, `${callId}-utterance-${currentUtteranceIndex}.wav`)
          writeWavFile({
            bitsPerSample: utterance.bitsPerSample,
            channelCount: utterance.channelCount,
            frames: [utterance.pcm],
            outputPath: utterancePath,
            sampleRate: utterance.sampleRate,
          })
          logDiagnostic(
            logger,
            `audioSink utterance ready: call_id=${callId} utterance=${currentUtteranceIndex} bytes=${utterance.pcm.byteLength} sample_rate=${utterance.sampleRate} bits=${utterance.bitsPerSample} channels=${utterance.channelCount} rms_avg=${utterance.averageRms.toFixed(5)} rms_peak=${utterance.peakRms.toFixed(5)}`
          )
          try {
            const provider = createSttProvider()
            const cli = await provider.detect()
            if (!cli) return
            const result = await provider.transcribeAudioFile(utterancePath)
            if (!result) return
            const latencyTurn = startWebRtcVoiceLatencyTurn({
              callId,
              segment: currentUtteranceIndex,
              workspaceId,
            })
            await injectWebRtcVoiceTranscript({
              ...(fastVoiceReplyProvider ? { fastVoiceReplyProvider } : {}),
              latencyTurnId: latencyTurn.turnId,
              store,
              text: result.text,
              workspaceId,
            })
            logDiagnostic(
              logger,
              `audioSink utterance injected: call_id=${callId} utterance=${currentUtteranceIndex}`
            )
          } finally {
            rmSync(utterancePath, { force: true })
          }
        })
        .catch((error) => {
          logger?.warn?.('failed to process WebRTC upstream utterance', error)
        })
      return processingQueue
    }
    logDiagnostic(
      logger,
      `audioSink started: call_id=${callId} track_kind=${typeof track === 'object' && track !== null && 'kind' in track ? String((track as { kind?: unknown }).kind) : 'unknown'}`
    )
    sink.ondata = (data) => {
      if (closed) return
      if (data.bitsPerSample) bitsPerSample = data.bitsPerSample
      if (data.channelCount) channelCount = data.channelCount
      if (data.sampleRate) sampleRate = data.sampleRate
      const buffer = samplesToBuffer(data.samples)
      const pcmFrames =
        data.numberOfFrames ??
        Math.floor(buffer.byteLength / Math.max(1, (bitsPerSample / 8) * channelCount))
      chunkCount += 1
      totalPcmFrames += pcmFrames
      const currentRms = bitsPerSample === 16 ? calculateWebRtcInt16Rms(buffer) : 0
      rmsMin = Math.min(rmsMin, currentRms)
      rmsMax = Math.max(rmsMax, currentRms)
      if (streamingSession) {
        try {
          streamingSession.pushFrame(buffer, sampleRate, bitsPerSample)
          pushToBargeInOnsetVad(buffer)
        } catch (error) {
          logger?.warn?.('streaming WebRTC STT failed; falling back to batch VAD', error)
          streamingSession.close()
          streamingSession = null
          pushToBatchVad(buffer)
        }
      } else {
        pushToBatchVad(buffer)
      }
      if (chunkCount === 1) {
        logDiagnostic(
          logger,
          `audioSink first frame: call_id=${callId} chunks=${chunkCount} pcm_frames=${totalPcmFrames} sample_rate=${sampleRate} bits=${bitsPerSample} channels=${channelCount} rms_current=${currentRms.toFixed(5)} rms_min=${rmsMin.toFixed(5)} rms_max=${rmsMax.toFixed(5)}`
        )
      } else if (chunkCount % 50 === 0) {
        logDiagnostic(
          logger,
          `audioSink frames: call_id=${callId} chunks=${chunkCount} pcm_frames=${totalPcmFrames} sample_rate=${sampleRate} bits=${bitsPerSample} channels=${channelCount} rms_current=${currentRms.toFixed(5)} rms_min=${rmsMin.toFixed(5)} rms_max=${rmsMax.toFixed(5)}`
        )
        rmsMin = Number.POSITIVE_INFINITY
        rmsMax = 0
      }
    }

    return {
      async close() {
        if (closed) return
        closed = true
        try {
          await Promise.resolve(sink.stop?.())
          logDiagnostic(
            logger,
            `audioSink closing: call_id=${callId} chunks=${chunkCount} pcm_frames=${totalPcmFrames} sample_rate=${sampleRate} bits=${bitsPerSample} channels=${channelCount}`
          )
          if (streamingSession) {
            try {
              await streamingSession.flush()
            } finally {
              streamingSession.close()
            }
          } else {
            const finalUtterance = utteranceVad.flush({ force: true })
            if (finalUtterance) void processUtterance(finalUtterance)
          }
          await processingQueue
        } catch (error) {
          logger?.warn?.('failed to process WebRTC upstream audio', error)
        } finally {
          voiceIntentSession?.close()
          rmSync(tempDir, { force: true, recursive: true })
        }
      },
    }
  },
})
