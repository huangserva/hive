import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

type WritableDownlinkTrack = WebRtcLocalAudioTrack & {
  writeAudio?: (audio: Buffer, metadata: { format: string; mime: string }) => Promise<void> | void
}

type WebRtcDownlinkTrackSession = {
  close?: () => Promise<void> | void
  track: WritableDownlinkTrack
}

type WebRtcTrackFactory = () => Promise<WebRtcDownlinkTrackSession> | WebRtcDownlinkTrackSession

const WEBRTC_DOWNLINK_TTS_VOICE = 'zh-CN-XiaoxiaoNeural'

interface WebRtcDownlinkAudioOptions {
  createTtsProvider?: () => LocalTtsProvider
  env?: NodeJS.ProcessEnv
  logger?: Pick<HiveLogger, 'warn'>
  store: WebRtcDownlinkStore
  tempRoot?: string
  trackFactory?: WebRtcTrackFactory
}

type WeriftTrackFactoryRuntime = {
  MediaStreamTrackFactory?: {
    rtpSource(input: {
      kind: 'audio'
    }): Promise<readonly [WritableDownlinkTrack, number, () => void]>
  }
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

const createWeriftRtpAudioTrack = async ({
  env,
  tempRoot,
}: {
  env: NodeJS.ProcessEnv
  tempRoot: string
}): Promise<WebRtcDownlinkTrackSession> => {
  const moduleName = 'werift'
  const runtime = (await import(moduleName)) as WeriftTrackFactoryRuntime
  const rtpSource = runtime.MediaStreamTrackFactory?.rtpSource
  if (!rtpSource) throw new Error('werift MediaStreamTrackFactory.rtpSource is unavailable')
  const [track, port, dispose] = await rtpSource({ kind: 'audio' })
  const ffmpeg = findExecutable('ffmpeg', env)
  if (!ffmpeg) throw new Error('ffmpeg is required for WebRTC downlink audio RTP')
  track.writeAudio = async (audio, metadata) => {
    const outputDir = mkdtempSync(join(tempRoot, 'hive-webrtc-downlink-'))
    try {
      const inputPath = join(outputDir, `tts.${metadata.format || 'audio'}`)
      writeFileSync(inputPath, audio)
      await execFileP(
        ffmpeg,
        [
          '-i',
          inputPath,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-c:a',
          'libopus',
          '-f',
          'rtp',
          `rtp://127.0.0.1:${port}`,
        ],
        { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 }
      )
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  return {
    close: () => {
      dispose()
      track.stop?.()
    },
    track,
  }
}

export const createWebRtcDownlinkAudio = ({
  createTtsProvider = () => createLocalTtsProvider(),
  env = process.env,
  logger,
  store,
  tempRoot = tmpdir(),
  trackFactory = () => createWeriftRtpAudioTrack({ env, tempRoot }),
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
          await trackSession.track.writeAudio?.(result.audio, {
            format: result.format,
            mime: result.mime,
          })
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
