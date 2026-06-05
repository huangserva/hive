import { execFile } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { createLocalTtsProvider, type LocalTtsProvider } from './local-tts.js'
import type { HiveLogger } from './logger.js'
import type { MobileChatMessage } from './mobile-chat-store.js'
import { sanitizeForSpeech } from './speech-text-sanitizer.js'
import type {
  WebRtcDownlinkAudio,
  WebRtcDownlinkAudioSession,
  WebRtcLocalAudioTrack,
} from './webrtc-callee.js'

const execFileP = promisify(execFile)

type WebRtcDownlinkStore = {
  registerMobileChatListener: (
    listener: (workspaceId: string, message: MobileChatMessage) => void
  ) => () => void
}

type WritableDownlinkTrack = WebRtcLocalAudioTrack

type WebRtcDownlinkTrackSession = {
  close?: () => Promise<void> | void
  onData: (frame: WebRtcPcmAudioFrame) => Promise<void> | void
  track: WritableDownlinkTrack
}

type WebRtcTrackFactory = () => Promise<WebRtcDownlinkTrackSession> | WebRtcDownlinkTrackSession
type WebRtcPcmAudioFrame = {
  bitsPerSample: number
  channelCount: number
  numberOfFrames: number
  sampleRate: number
  samples: Int16Array
}
type DecodeAudioToPcmFrames = (
  audio: Buffer,
  metadata: { format: string; mime: string }
) => Promise<WebRtcPcmAudioFrame[]>

const WEBRTC_DOWNLINK_TTS_VOICE = 'zh-CN-XiaoxiaoNeural'

interface WebRtcDownlinkAudioOptions {
  createTtsProvider?: () => LocalTtsProvider
  decodeAudioToPcmFrames?: DecodeAudioToPcmFrames
  env?: NodeJS.ProcessEnv
  logger?: Pick<HiveLogger, 'warn'>
  store: WebRtcDownlinkStore
  tempRoot?: string
  trackFactory?: WebRtcTrackFactory
}

type WrtcAudioSource = {
  createTrack(): WritableDownlinkTrack
  onData(frame: WebRtcPcmAudioFrame): void
}

type WrtcAudioSourceCtor = new () => WrtcAudioSource

type WrtcAudioSourceRuntime = {
  default?: { nonstandard?: { RTCAudioSource?: WrtcAudioSourceCtor } }
  nonstandard?: { RTCAudioSource?: WrtcAudioSourceCtor }
}

const isExecutable = (filePath: string) => {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const findExecutable = (name: string, env: NodeJS.ProcessEnv) => {
  if (name.includes('/')) {
    const absolute = resolve(name)
    return existsSync(absolute) && isExecutable(absolute) ? absolute : null
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate) && isExecutable(candidate)) return candidate
  }
  return null
}

const parseReplyText = (message: MobileChatMessage) => {
  try {
    const parsed = JSON.parse(message.content_json) as { text?: unknown }
    return typeof parsed.text === 'string' ? parsed.text.trim() : ''
  } catch {
    return ''
  }
}

const createWrtcAudioTrack = async (): Promise<WebRtcDownlinkTrackSession> => {
  const moduleName = '@roamhq/wrtc'
  const runtime = (await import(moduleName)) as WrtcAudioSourceRuntime
  const RTCAudioSource =
    runtime.nonstandard?.RTCAudioSource ?? runtime.default?.nonstandard?.RTCAudioSource
  if (!RTCAudioSource) throw new Error('@roamhq/wrtc RTCAudioSource is unavailable')
  const source = new RTCAudioSource()
  const track = source.createTrack()
  return {
    onData: (frame) => source.onData(frame),
    track,
  }
}

const bufferToInt16Array = (buffer: Buffer) =>
  new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2))

const decodeAudioToPcm48kFrames = async ({
  audio,
  env,
  metadata,
  tempRoot,
}: {
  audio: Buffer
  env: NodeJS.ProcessEnv
  metadata: { format: string; mime: string }
  tempRoot: string
}): Promise<WebRtcPcmAudioFrame[]> => {
  const ffmpeg = findExecutable('ffmpeg', env)
  if (!ffmpeg) throw new Error('ffmpeg is required for WebRTC downlink audio PCM')
  const outputDir = mkdtempSync(join(tempRoot, 'hive-webrtc-downlink-'))
  try {
    const inputPath = join(outputDir, `tts.${metadata.format || 'audio'}`)
    const outputPath = join(outputDir, 'tts.s16le')
    writeFileSync(inputPath, audio)
    await execFileP(
      ffmpeg,
      ['-i', inputPath, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', outputPath],
      { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 }
    )
    const pcm = readFileSync(outputPath)
    const samples = bufferToInt16Array(pcm)
    const frames: WebRtcPcmAudioFrame[] = []
    const samplesPerFrame = 480
    for (let offset = 0; offset < samples.length; offset += samplesPerFrame) {
      const frameSamples = new Int16Array(samplesPerFrame)
      frameSamples.set(samples.slice(offset, Math.min(offset + samplesPerFrame, samples.length)))
      if (frameSamples.length <= 0) continue
      frames.push({
        bitsPerSample: 16,
        channelCount: 1,
        numberOfFrames: samplesPerFrame,
        sampleRate: 48_000,
        samples: frameSamples,
      })
    }
    return frames
  } finally {
    rmSync(outputDir, { force: true, recursive: true })
  }
}

export const createWebRtcDownlinkAudio = ({
  createTtsProvider = () => createLocalTtsProvider(),
  decodeAudioToPcmFrames,
  env = process.env,
  logger,
  store,
  tempRoot = tmpdir(),
  trackFactory = createWrtcAudioTrack,
}: WebRtcDownlinkAudioOptions): WebRtcDownlinkAudio & {
  startCall(input: { callId: string; workspaceId: string }): Promise<
    WebRtcDownlinkAudioSession & {
      flush(): Promise<void>
    }
  >
} => ({
  async startCall({ workspaceId }) {
    const trackSession = await trackFactory()
    let queue = Promise.resolve()
    let closed = false
    const unsubscribe = store.registerMobileChatListener((messageWorkspaceId, message) => {
      if (closed || messageWorkspaceId !== workspaceId) return
      if (message.direction !== 'outbound' || message.message_type !== 'orch_reply') return
      const text = parseReplyText(message)
      if (!text) return
      queue = queue.then(async () => {
        try {
          const sanitizedText = sanitizeForSpeech(text)
          if (!sanitizedText) return
          const result = await createTtsProvider().synthesize(sanitizedText, {
            voice: WEBRTC_DOWNLINK_TTS_VOICE,
          })
          if (!result) return
          const frames = await (
            decodeAudioToPcmFrames ??
            ((audio, metadata) => decodeAudioToPcm48kFrames({ audio, env, metadata, tempRoot }))
          )(result.audio, {
            format: result.format,
            mime: result.mime,
          })
          for (const frame of frames) {
            await trackSession.onData(frame)
          }
        } catch (error) {
          logger?.warn?.('failed to send WebRTC downlink audio', error)
        }
      })
    })

    return {
      async close() {
        if (closed) return
        closed = true
        unsubscribe()
        try {
          await queue
        } finally {
          await Promise.resolve(trackSession.close?.())
          trackSession.track.stop?.()
        }
      },
      async flush() {
        await queue
      },
      track: trackSession.track,
    }
  },
})
