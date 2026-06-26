import { basename } from 'node:path'

import type { AgentManager } from './agent-manager.js'

const INTERACTIVE_COMMANDS = new Set(['claude', 'codex', 'gemini', 'opencode'])
const READY_CHECK_INTERVAL_MS = 50
const READY_TIMEOUT_MS = 8000
const CLAUDE_BUSY_READY_TIMEOUT_MS = 120_000
const MIN_SUBMIT_AFTER_PASTE_DELAY_MS = 600
const MAX_SUBMIT_AFTER_PASTE_DELAY_MS = 1500
const PASTE_CHARS_PER_DELAY_MS = 4
const PASTE_ACK_CHECK_INTERVAL_MS = 50
const PASTE_ACK_SETTLE_DELAY_MS = 100
const PASTE_ACK_TIMEOUT_MS = 3000
const CLAUDE_MAX_PASTE_ATTEMPTS = 2
const COMMANDS_WITH_BRACKETED_PASTE = new Set(['claude', 'codex', 'opencode'])

export const toBracketedPasteSubmission = (text: string) => `\u001b[200~${text}\u001b[201~`

export interface PostStartInputWriterOptions {
  onPasteAck?: () => void
  onPasteGaveUp?: () => void
}

const getSubmitAfterPasteDelayMs = (text: string) =>
  Math.min(
    MAX_SUBMIT_AFTER_PASTE_DELAY_MS,
    Math.max(MIN_SUBMIT_AFTER_PASTE_DELAY_MS, Math.ceil(text.length / PASTE_CHARS_PER_DELAY_MS))
  )

export const isInteractiveAgentCommand = (command: string) =>
  INTERACTIVE_COMMANDS.has(basename(command).toLowerCase())

const getCommandName = (command: string) => basename(command).toLowerCase()

const hasGeminiPromptReady = (output: string) => /\bType your message\b/u.test(output)
const hasOpenCodePromptReady = (output: string) => /Ask anything/u.test(output)

export const hasInteractivePromptReady = (output: string, command = '') => {
  const commandName = getCommandName(command)
  return (
    /(?:^|[\r\n])\s*[❯›]\s*/u.test(output) ||
    (commandName === 'gemini' && hasGeminiPromptReady(output)) ||
    (commandName === 'opencode' && hasOpenCodePromptReady(output))
  )
}

const CLAUDE_WORKING_WITH_INTERRUPT_PATTERN =
  /(?:\b(?:Working|Thinking|Processing)\b[\s\S]{0,120}\besc(?:ape)? to interrupt\b|\besc(?:ape)? to interrupt\b[\s\S]{0,120}\b(?:Working|Thinking|Processing)\b)/iu

export const hasClaudeBusyOutput = (output: string) =>
  /Compacting conversation(?:\.{3}|…)?/iu.test(output) ||
  CLAUDE_WORKING_WITH_INTERRUPT_PATTERN.test(output)

export const hasBracketedPasteAcknowledgement = (output: string, baselineLength: number) =>
  /\[Pasted text #\d+/u.test(output.slice(baselineLength))

const isClaudeCommand = (command: string) => getCommandName(command) === 'claude'
const usesBracketedPaste = (command: string) =>
  COMMANDS_WITH_BRACKETED_PASTE.has(getCommandName(command))
const canTimeoutBeforePromptReady = (command: string) => getCommandName(command) !== 'gemini'
const isWritableRunStatus = (status: string | undefined) =>
  status === undefined || status === 'starting' || status === 'running'

const writeIfRunWritable = (agentManager: AgentManager, runId: string, text: string) => {
  let run: ReturnType<AgentManager['getRun']>
  try {
    run = agentManager.getRun(runId)
  } catch {
    return false
  }
  if (!isWritableRunStatus(run.status)) return false
  agentManager.writeInput(runId, text)
  return true
}

const submitPastedInteractiveInput = (
  agentManager: AgentManager,
  runId: string,
  text: string,
  baselineLength: number,
  waitForPasteAck: boolean,
  onPasteAck?: () => void,
  onPasteAckTimeout?: () => void
) => {
  const pastedAt = Date.now()
  const minDelay = getSubmitAfterPasteDelayMs(text)
  let acknowledgedAt: number | null = null

  const getWritableOutput = () => {
    try {
      const run = agentManager.getRun(runId)
      return isWritableRunStatus(run.status) ? run.output : null
    } catch {
      return null
    }
  }

  const submit = () => {
    try {
      writeIfRunWritable(agentManager, runId, '\r')
    } catch {
      // The PTY may have exited between paste and submit.
    }
  }

  const trySubmit = () => {
    if (!waitForPasteAck) {
      submit()
      return
    }

    const output = getWritableOutput()
    if (output === null) {
      return
    }
    if (acknowledgedAt === null && hasBracketedPasteAcknowledgement(output, baselineLength)) {
      acknowledgedAt = Date.now()
      onPasteAck?.()
    }

    const elapsed = Date.now() - pastedAt
    const ackSettled =
      acknowledgedAt !== null && Date.now() - acknowledgedAt >= PASTE_ACK_SETTLE_DELAY_MS
    if (ackSettled && elapsed >= minDelay) {
      submit()
      return
    }
    if (elapsed >= PASTE_ACK_TIMEOUT_MS) {
      onPasteAckTimeout?.()
      return
    }
    setTimeout(trySubmit, PASTE_ACK_CHECK_INTERVAL_MS)
  }

  setTimeout(trySubmit, minDelay)
}

export const createPostStartInputWriter = (
  agentManager: AgentManager,
  command: string,
  options: PostStartInputWriterOptions = {}
): ((runId: string, text: string) => void) => {
  if (!isInteractiveAgentCommand(command)) {
    return (runId, text) => {
      if (writeIfRunWritable(agentManager, runId, `${text}\n`)) options.onPasteAck?.()
    }
  }

  return (runId, text) => {
    const startedAt = Date.now()
    let isInitialAttempt = true
    // 注入起点 baseline：第一次拿到可写 output 时捕获一次，之后不刷新。
    // resume 后 run.output 仍含 restart 前的旧提示符（❯/›），若检测累积的全量输出会被旧提示符
    // 立刻误触发——在 CLI 还没真正就绪时就粘贴 + 回车，注入落空，派单卡在 submitted。
    // 故提示符就绪只检测 baseline 之后的【新输出】，让 resume 后等真正的新提示符再注入。
    let readinessBaseline: number | null = null
    let firstBusyAt: number | null = null
    let pasteInFlight = false
    let pasteAttempts = 0
    let requiresFreshPromptForRetry = false
    let ackReported = false
    let gaveUpReported = false

    const reportAck = () => {
      if (ackReported) return
      ackReported = true
      options.onPasteAck?.()
    }

    const reportGaveUp = () => {
      if (ackReported || gaveUpReported) return
      gaveUpReported = true
      options.onPasteGaveUp?.()
    }

    const tryWrite = () => {
      let output: string | null
      try {
        const run = agentManager.getRun(runId)
        output = isWritableRunStatus(run.status) ? run.output : null
      } catch {
        return
      }
      if (output === null) return
      if (readinessBaseline === null) readinessBaseline = output.length
      if (pasteInFlight) return
      const outputSinceBaseline = output.slice(readinessBaseline)
      if (
        isClaudeCommand(command) &&
        hasClaudeBusyOutput(outputSinceBaseline) &&
        firstBusyAt === null
      ) {
        firstBusyAt = Date.now()
      }
      const timedOut = Date.now() - startedAt >= READY_TIMEOUT_MS
      const claudeBusyTimedOut =
        firstBusyAt !== null && Date.now() - firstBusyAt >= CLAUDE_BUSY_READY_TIMEOUT_MS
      const shouldKeepWaitingForClaudeBusy =
        isClaudeCommand(command) && firstBusyAt !== null && !claudeBusyTimedOut
      const promptReady = hasInteractivePromptReady(outputSinceBaseline, command)
      const timeoutFallbackReady =
        canTimeoutBeforePromptReady(command) &&
        timedOut &&
        !shouldKeepWaitingForClaudeBusy &&
        !requiresFreshPromptForRetry
      if (promptReady || timeoutFallbackReady) {
        if (isClaudeCommand(command) && pasteAttempts >= CLAUDE_MAX_PASTE_ATTEMPTS) {
          reportGaveUp()
          return
        }
        const baselineLength = output.length
        const input = usesBracketedPaste(command) ? toBracketedPasteSubmission(text) : text
        try {
          if (!writeIfRunWritable(agentManager, runId, input)) return
        } catch (error) {
          if (isInitialAttempt) throw error
          return
        }
        pasteAttempts += 1
        pasteInFlight = true
        if (!isClaudeCommand(command)) reportAck()
        submitPastedInteractiveInput(
          agentManager,
          runId,
          text,
          baselineLength,
          isClaudeCommand(command),
          isClaudeCommand(command) ? reportAck : undefined,
          isClaudeCommand(command)
            ? () => {
                let latestOutputLength = baselineLength
                try {
                  const run = agentManager.getRun(runId)
                  if (!isWritableRunStatus(run.status)) return
                  latestOutputLength = run.output.length
                } catch {
                  return
                }
                if (pasteAttempts >= CLAUDE_MAX_PASTE_ATTEMPTS) {
                  pasteInFlight = false
                  reportGaveUp()
                  return
                }
                pasteInFlight = false
                readinessBaseline = latestOutputLength
                firstBusyAt = null
                requiresFreshPromptForRetry = true
                setTimeout(tryWrite, READY_CHECK_INTERVAL_MS)
              }
            : undefined
        )
        return
      }
      if (timedOut && !shouldKeepWaitingForClaudeBusy && !requiresFreshPromptForRetry) return
      setTimeout(tryWrite, READY_CHECK_INTERVAL_MS)
    }
    try {
      tryWrite()
    } finally {
      isInitialAttempt = false
    }
  }
}
