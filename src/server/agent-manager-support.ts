import { execFileSync } from 'node:child_process'

import type { IPty } from 'node-pty'

import type { AgentRunRecord, AgentRunSnapshot } from './agent-manager.js'
import type { HiveLogger } from './logger.js'
import type { PtyOutputBus } from './pty-output-bus.js'

export const MAX_RUN_OUTPUT_LENGTH = 1_000_000
const MAX_ERROR_TAIL_LINES = 200
const FORCE_KILL_DELAY_MS = 750
type ForceKillTimer = ReturnType<typeof setTimeout> & { unref?: () => void }

export const createOutputTailBuffer = (maxLines = MAX_ERROR_TAIL_LINES) => {
  const lines: string[] = []
  let pending = ''
  return {
    append(chunk: string) {
      const parts = (pending + chunk).split(/\r?\n/)
      pending = parts.pop() ?? ''
      for (const line of parts) {
        lines.push(line)
        if (lines.length > maxLines) lines.shift()
      }
    },
    read() {
      const snapshot = pending ? [...lines, pending] : [...lines]
      const tail = snapshot.slice(-maxLines).join('\n')
      return tail || null
    },
  }
}

export const toAgentRunSnapshot = (run: AgentRunRecord): AgentRunSnapshot => ({
  runId: run.runId,
  agentId: run.agentId,
  pid: run.process.pid,
  status:
    run.process.isStopped() && run.status !== 'exited' && run.status !== 'error'
      ? 'error'
      : run.status,
  output: run.output,
  exitCode: run.exitCode,
  errorTail: run.errorTail,
})

export const finishAgentRun = (
  run: AgentRunRecord,
  exitCode: number | null,
  ptyOutputBus: PtyOutputBus
) => {
  const canCorrectPendingError =
    run.status === 'error' && run.exitCode === null && exitCode !== null
  if ((run.status === 'exited' || run.status === 'error') && !canCorrectPendingError) return
  run.status = exitCode === 0 ? 'exited' : 'error'
  run.exitCode = exitCode
  run.errorTail = exitCode === 0 ? null : run.errorTailBuffer.read()
  run.onExit?.({ runId: run.runId, exitCode, errorTail: run.errorTail })
  ptyOutputBus.clear(run.runId)
}

const logHandlerError = (logger: HiveLogger | undefined, label: string, error: unknown) => {
  try {
    logger?.error(label, error)
  } catch {}
}

export const attachAgentPty = (
  run: AgentRunRecord,
  pty: IPty,
  ptyOutputBus: PtyOutputBus,
  logger?: HiveLogger
) => {
  let stdinClosed = false
  let forceKillTimer: ForceKillTimer | undefined
  let pendingErrorFinishTimer: ForceKillTimer | undefined
  const resolveProcessGroupForPid = (pid: number) => {
    try {
      const value = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      const groupId = Number(value)
      if (Number.isInteger(groupId) && groupId > 0) return groupId
    } catch {}
    return null
  }
  const resolveProcessGroupId = () => {
    if (process.platform === 'win32' || pty.pid <= 0) return null
    try {
      const groupId = resolveProcessGroupForPid(pty.pid)
      const currentGroupId = resolveProcessGroupForPid(process.pid)
      const currentProcessGroupId = (process as NodeJS.Process & { pgid?: number }).pgid
      if (
        groupId !== null &&
        currentGroupId !== null &&
        groupId !== process.pid &&
        (typeof currentProcessGroupId !== 'number' || groupId !== currentProcessGroupId) &&
        groupId !== currentGroupId
      ) {
        return groupId
      }
    } catch {
      return pty.pid
    }
    return pty.pid
  }
  const processGroupId = resolveProcessGroupId()
  const stopped = () => run.status === 'exited' || run.status === 'error'
  const ignoreMissingProcess = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code
    const message = error instanceof Error ? error.message : ''
    if (code !== 'ESRCH' && !/already exited/iu.test(message)) throw error
  }
  const ignoreBestEffortGroupKillError = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code !== 'ESRCH' && code !== 'EPERM') throw error
  }
  const killProcessGroup = (signal: NodeJS.Signals) => {
    if (process.platform === 'win32' || processGroupId === null) return
    try {
      process.kill(-processGroupId, signal)
    } catch (error) {
      ignoreBestEffortGroupKillError(error)
    }
  }
  const killPty = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') pty.kill()
      else pty.kill(signal)
    } catch (error) {
      ignoreMissingProcess(error)
    }
    killProcessGroup(signal)
  }
  const clearForceKillTimer = () => {
    if (!forceKillTimer) return
    clearTimeout(forceKillTimer)
    forceKillTimer = undefined
  }
  const clearPendingErrorFinishTimer = () => {
    if (!pendingErrorFinishTimer) return
    clearTimeout(pendingErrorFinishTimer)
    pendingErrorFinishTimer = undefined
  }
  const cleanupProcessGroup = () => {
    clearForceKillTimer()
    killProcessGroup('SIGKILL')
  }
  const scheduleForceKill = () => {
    if (forceKillTimer) return
    forceKillTimer = setTimeout(() => {
      forceKillTimer = undefined
      try {
        if (process.platform === 'win32') pty.kill()
        else pty.kill('SIGKILL')
      } catch (error) {
        ignoreMissingProcess(error)
      }
      killProcessGroup('SIGKILL')
    }, FORCE_KILL_DELAY_MS) as ForceKillTimer
    forceKillTimer.unref?.()
  }
  const schedulePendingErrorFinish = () => {
    clearPendingErrorFinishTimer()
    pendingErrorFinishTimer = setTimeout(() => {
      pendingErrorFinishTimer = undefined
      try {
        finishAgentRun(run, null, ptyOutputBus)
      } catch (finishError) {
        logHandlerError(logger, 'pty.onError finish', finishError)
      }
    }, FORCE_KILL_DELAY_MS) as ForceKillTimer
    pendingErrorFinishTimer.unref?.()
  }
  run.process = {
    isStopped() {
      return stopped()
    },
    pause() {
      pty.pause()
    },
    pid: pty.pid,
    resize(cols, rows) {
      if (stopped()) return
      try {
        pty.resize(cols, rows)
      } catch (error) {
        ignoreMissingProcess(error)
      }
    },
    resume() {
      pty.resume()
    },
    stop() {
      if (stopped()) {
        cleanupProcessGroup()
        return
      }
      killPty('SIGTERM')
      stdinClosed = true
      scheduleForceKill()
    },
    write(input) {
      if (stdinClosed || run.status === 'exited' || run.status === 'error') {
        throw new Error(`PTY is not active for run: ${run.runId}`)
      }
      pty.write(input)
    },
  }

  pty.onData((chunk) => {
    try {
      if (run.status === 'starting') run.status = 'running'
      run.output += chunk
      run.errorTailBuffer.append(chunk)
      if (run.output.length > MAX_RUN_OUTPUT_LENGTH)
        run.output = run.output.slice(-MAX_RUN_OUTPUT_LENGTH)
      ptyOutputBus.publish(run.runId, chunk)
    } catch (error) {
      logHandlerError(logger, 'pty.onData', error)
    }
  })

  const ptyWithError = pty as IPty & {
    onError?: (handler: (error: Error) => void) => void
  }
  ptyWithError.onError?.((error) => {
    stdinClosed = true
    try {
      cleanupProcessGroup()
    } catch (cleanupError) {
      logHandlerError(logger, 'pty.onError cleanup', cleanupError)
    }
    try {
      run.errorTailBuffer.append(error.stack ?? error.message)
    } catch (tailError) {
      logHandlerError(logger, 'pty.onError errorTail', tailError)
    }
    schedulePendingErrorFinish()
  })

  pty.onExit((event) => {
    stdinClosed = true
    clearPendingErrorFinishTimer()
    try {
      cleanupProcessGroup()
    } catch (cleanupError) {
      logHandlerError(logger, 'pty.onExit cleanup', cleanupError)
    }
    try {
      finishAgentRun(run, event.exitCode, ptyOutputBus)
    } catch (finishError) {
      logHandlerError(logger, 'pty.onExit finish', finishError)
    }
  })
}
