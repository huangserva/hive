import type {
  MobileChatDirection,
  MobileChatMessage,
  MobileChatMessageType,
} from './mobile-chat-store.js'
import type { PtyOutputBus } from './pty-output-bus.js'
import { stripTerminalAnsi } from './terminal-state-mirror.js'

const MOBILE_APP_INPUT_RE = /^\[来自手机 Mobile App\]/u
const DEFAULT_FLUSH_DELAY_MS = 120000
const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)
const OSC_PATTERN = new RegExp(`${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, 'gu')

type TimerHandle = ReturnType<typeof setTimeout>

interface PendingReply {
  buffer: string
  flushTimer: TimerHandle | null
}

interface TrackedRun {
  runId: string
  unsubscribe: () => void
}

export interface MobileOrchestratorReplyCapture {
  attach: (workspaceId: string, agentId: string, runId: string) => void
  closeAll: () => void
  detach: (workspaceId: string, agentId: string) => void
  startPendingReply: (workspaceId: string) => void
}

interface CreateMobileOrchestratorReplyCaptureInput {
  flushDelayMs?: number
  insertMobileChatMessage: (
    workspaceId: string,
    direction: MobileChatDirection,
    messageType: MobileChatMessageType,
    contentJson: string
  ) => MobileChatMessage
  outputBus: PtyOutputBus
}

export const isMobileAppUserInput = (text: string) => MOBILE_APP_INPUT_RE.test(text)

const orchestratorIdForWorkspace = (workspaceId: string) => `${workspaceId}:orchestrator`

const stripAnsiAndControl = (value: string) =>
  stripTerminalAnsi(value).replace(OSC_PATTERN, '').replace(/\r/g, '\n')

const stripDecorativePromptPrefix = (line: string) => line.replace(/^\s*[⏺●○✻✽✢✳]\s*/u, '').trim()

const isToolLikeLine = (line: string) =>
  /^(Bash|Read|Write|Edit|MultiEdit|Grep|Glob|LS|TodoWrite|WebFetch|Task)\(/u.test(line) ||
  /^(\+|-|~|\$)\s/u.test(line) ||
  /^←/u.test(line)

const isThinkingLine = (line: string) => {
  const stripped = line.replace(/[^a-zA-Z]/gu, '')
  return (
    (/thinking/iu.test(stripped) && stripped.length <= 20) ||
    /^\.{2,}$/u.test(line) ||
    /^[…⏳⌛]+$/u.test(line)
  )
}

const isClaudeCodeMetaLine = (line: string) =>
  /crunched/iu.test(line) ||
  /tokens?\)?$/iu.test(line) ||
  /context.*compact/iu.test(line) ||
  /^\d+\s*tokens?\s/iu.test(line) ||
  /^\s*\d+(\.\d+)?[km]?\s*tok/iu.test(line) ||
  /^Thought for \d/u.test(line) ||
  /^Saut[ée]/iu.test(line) ||
  /copied.*to clipboard/iu.test(line) ||
  /^for agents/iu.test(line) ||
  /^\d+\s*(file|director)/iu.test(line) ||
  /^read \d+ file/iu.test(line) ||
  /^listed \d+ director/iu.test(line) ||
  /^Updated \d+ file/iu.test(line) ||
  /^Created \d+ file/iu.test(line) ||
  /^Wrote \d+ line/iu.test(line)

const isTerminalArtifact = (line: string) => line.length <= 2

const removeEchoedMobilePrompt = (lines: string[]) => {
  const filtered: string[] = []
  let skippingEcho = false
  for (const line of lines) {
    if (line.includes('[来自手机 Mobile App]')) {
      skippingEcho = true
      continue
    }
    if (skippingEcho) {
      if (line.includes('</hive-system-reminder>')) skippingEcho = false
      continue
    }
    filtered.push(line)
  }
  return filtered
}

const normalizeReplyText = (value: string) => {
  const rawLines = stripAnsiAndControl(value).split('\n').map(stripDecorativePromptPrefix)
  const lines = removeEchoedMobilePrompt(rawLines)
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes('[Hive 系统消息'))
    .filter((line) => line !== '---')
    .filter((line) => !isToolLikeLine(line))
    .filter((line) => !isThinkingLine(line))
    .filter((line) => !isClaudeCodeMetaLine(line))
    .filter((line) => !isTerminalArtifact(line))
  return lines.join('\n').trim()
}

export const createMobileOrchestratorReplyCapture = ({
  flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
  insertMobileChatMessage,
  outputBus,
}: CreateMobileOrchestratorReplyCaptureInput): MobileOrchestratorReplyCapture => {
  const pendingByWorkspace = new Map<string, PendingReply>()
  const trackedByWorkspace = new Map<string, TrackedRun>()
  const recentReplies = new Map<string, string[]>()

  const clearTimer = (pending: PendingReply) => {
    if (pending.flushTimer) clearTimeout(pending.flushTimer)
    pending.flushTimer = null
  }

  const isDuplicate = (workspaceId: string, text: string) => {
    const recent = recentReplies.get(workspaceId) ?? []
    const snippet = text.slice(0, 80)
    if (recent.some((r) => r.includes(snippet) || snippet.includes(r))) return true
    recent.push(snippet)
    if (recent.length > 5) recent.shift()
    recentReplies.set(workspaceId, recent)
    return false
  }

  const flushPending = (workspaceId: string) => {
    const pending = pendingByWorkspace.get(workspaceId)
    if (!pending) return
    clearTimer(pending)
    pendingByWorkspace.delete(workspaceId)

    const text = normalizeReplyText(pending.buffer)
    if (text.length === 0) return
    if (isDuplicate(workspaceId, text)) return
    insertMobileChatMessage(
      workspaceId,
      'outbound',
      'orch_reply',
      JSON.stringify({
        text,
      })
    )
  }

  const scheduleFlush = (workspaceId: string, pending: PendingReply) => {
    clearTimer(pending)
    pending.flushTimer = setTimeout(() => flushPending(workspaceId), flushDelayMs)
    pending.flushTimer.unref?.()
  }

  const handleOutput = (workspaceId: string, chunk: string) => {
    const pending = pendingByWorkspace.get(workspaceId)
    if (!pending) return
    pending.buffer += chunk
    scheduleFlush(workspaceId, pending)
  }

  const detachWorkspace = (workspaceId: string) => {
    const tracked = trackedByWorkspace.get(workspaceId)
    if (!tracked) return
    tracked.unsubscribe()
    trackedByWorkspace.delete(workspaceId)
    flushPending(workspaceId)
  }

  return {
    attach(workspaceId, agentId, runId) {
      if (agentId !== orchestratorIdForWorkspace(workspaceId)) return
      const existing = trackedByWorkspace.get(workspaceId)
      if (existing?.runId === runId) return
      detachWorkspace(workspaceId)
      const unsubscribe = outputBus.subscribe(runId, (chunk) => handleOutput(workspaceId, chunk))
      trackedByWorkspace.set(workspaceId, { runId, unsubscribe })
    },
    closeAll() {
      for (const workspaceId of [...trackedByWorkspace.keys()]) detachWorkspace(workspaceId)
      for (const pending of pendingByWorkspace.values()) clearTimer(pending)
      pendingByWorkspace.clear()
    },
    detach(workspaceId, agentId) {
      if (agentId !== orchestratorIdForWorkspace(workspaceId)) return
      detachWorkspace(workspaceId)
    },
    startPendingReply(_workspaceId: string) {
      // Disabled: capturing raw terminal output produces garbage in mobile chat.
      // Orchestrator replies should use explicit chat message API instead.
    },
  }
}
