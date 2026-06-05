import { mkdtempSync, rmSync, statSync } from 'node:fs'
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

type WebRtcMediaRecorder = {
  onError?: { subscribe?: (listener: (error: Error) => void) => unknown }
  stop(): Promise<void> | void
}

type WebRtcMediaRecorderCtor = new (input: {
  path: string
  tracks: unknown[]
}) => WebRtcMediaRecorder

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
  loadMediaRecorder?: () => Promise<WebRtcMediaRecorderCtor>
  logger?: Pick<HiveLogger, 'warn'>
  store: WebRtcUpstreamStore
  tempRoot?: string
}

const loadWeriftMediaRecorder = async (): Promise<WebRtcMediaRecorderCtor> => {
  const moduleName = 'werift'
  const runtime = (await import(moduleName)) as { MediaRecorder?: WebRtcMediaRecorderCtor }
  if (!runtime.MediaRecorder) throw new Error('werift MediaRecorder is unavailable')
  return runtime.MediaRecorder
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
  loadMediaRecorder = loadWeriftMediaRecorder,
  logger,
  store,
  tempRoot = tmpdir(),
}: WebRtcUpstreamAudioSinkOptions): WebRtcRemoteAudioSink => ({
  async start({ callId, track, workspaceId }): Promise<WebRtcRemoteAudioSession> {
    const tempDir = mkdtempSync(join(tempRoot, 'hive-webrtc-upstream-'))
    const audioPath = join(tempDir, `${callId}.webm`)
    const MediaRecorder = await loadMediaRecorder()
    const recorder = new MediaRecorder({ path: audioPath, tracks: [track] })
    let closed = false

    return {
      async close() {
        if (closed) return
        closed = true
        try {
          await recorder.stop()
          const stats = statSync(audioPath)
          if (stats.size <= 0) return
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
