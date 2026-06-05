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
import type { WebRtcRemoteAudioSession, WebRtcRemoteAudioSink } from './webrtc-callee.js'
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

interface WebRtcUpstreamAudioSinkOptions {
  createSttProvider?: () => LocalSttProvider
  fastVoiceReplyProvider?: FastVoiceReplyProvider
  loadAudioSink?: () => Promise<WebRtcAudioSinkCtor>
  logger?: Pick<HiveLogger, 'warn'>
  store: WebRtcUpstreamStore
  tempRoot?: string
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
  fastVoiceReplyProvider,
  store,
  text,
  workspaceId,
}: {
  fastVoiceReplyProvider?: FastVoiceReplyProvider
  store: WebRtcUpstreamStore
  text: string
  workspaceId: string
}) => {
  const trimmed = text.trim()
  if (!trimmed) return
  const orchId = getOrchestratorId(workspaceId)
  const activeRun = store.getActiveRunByAgentId(workspaceId, orchId)
  if (!activeRun) throw new Error('Orchestrator is not running')

  const formatted = `[来自手机 Mobile App]\n---\n${trimmed}`
  const fastReply = await maybeInsertFastVoiceReplyWithGatekeeper({
    ...(fastVoiceReplyProvider ? { provider: fastVoiceReplyProvider } : {}),
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
    JSON.stringify({ source: 'voice', text: trimmed })
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
  fastVoiceReplyProvider,
  loadAudioSink = loadWrtcAudioSink,
  logger,
  store,
  tempRoot = tmpdir(),
}: WebRtcUpstreamAudioSinkOptions): WebRtcRemoteAudioSink => ({
  async start({ callId, track, workspaceId }): Promise<WebRtcRemoteAudioSession> {
    const tempDir = mkdtempSync(join(tempRoot, 'hive-webrtc-upstream-'))
    const audioPath = join(tempDir, `${callId}.wav`)
    const AudioSink = await loadAudioSink()
    const sink = new AudioSink(track)
    const frames: Buffer[] = []
    let sampleRate = 48_000
    let bitsPerSample = 16
    let channelCount = 1
    let closed = false
    sink.ondata = (data) => {
      if (closed) return
      if (data.bitsPerSample) bitsPerSample = data.bitsPerSample
      if (data.channelCount) channelCount = data.channelCount
      if (data.sampleRate) sampleRate = data.sampleRate
      frames.push(samplesToBuffer(data.samples))
    }

    return {
      async close() {
        if (closed) return
        closed = true
        try {
          await Promise.resolve(sink.stop?.())
          if (frames.length <= 0) return
          writeWavFile({ bitsPerSample, channelCount, frames, outputPath: audioPath, sampleRate })
          const provider = createSttProvider()
          const cli = await provider.detect()
          if (!cli) return
          const result = await provider.transcribeAudioFile(audioPath)
          if (!result) return
          await injectWebRtcVoiceTranscript({
            ...(fastVoiceReplyProvider ? { fastVoiceReplyProvider } : {}),
            store,
            text: result.text,
            workspaceId,
          })
        } catch (error) {
          logger?.warn?.('failed to process WebRTC upstream audio', error)
        } finally {
          rmSync(tempDir, { force: true, recursive: true })
        }
      },
    }
  },
})
