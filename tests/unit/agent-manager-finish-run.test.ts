import { afterEach, describe, expect, test, vi } from 'vitest'

const exitSequences: Array<Array<number | null>> = []
const loggerErrors: Array<{ error: unknown; message: string }> = []

const waitFor = async (assertion: () => void, timeoutMs = 1000, intervalMs = 10) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() <= deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  throw lastError
}

vi.mock('node-pty', () => ({
  spawn: () => {
    const exitCodes = exitSequences.shift() ?? [0, 0]
    let exitHandler: ((event: { exitCode: number | null }) => void) | undefined

    queueMicrotask(() => {
      for (const exitCode of exitCodes) {
        exitHandler?.({ exitCode })
      }
    })

    return {
      pid: 4242,
      kill() {},
      onData() {},
      onExit(handler: (event: { exitCode: number | null }) => void) {
        exitHandler = handler
      },
      write() {},
    }
  },
}))

import { createAgentManager } from '../../src/server/agent-manager.js'

afterEach(() => {
  exitSequences.length = 0
  loggerErrors.length = 0
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('agent manager finishRun', () => {
  test('invokes onExit only once when PTY exit fires twice', async () => {
    exitSequences.push([0, 0])
    const manager = createAgentManager()
    const onExitSpy = vi.fn()

    const run = await manager.startAgent({
      agentId: 'agent-1',
      command: '/bin/bash',
      cwd: '/tmp',
      onExit: onExitSpy,
    })

    await waitFor(() => {
      expect(manager.getRun(run.runId).status).toBe('exited')
    })

    expect(onExitSpy).toHaveBeenCalledTimes(1)
    expect(onExitSpy).toHaveBeenCalledWith({ errorTail: null, exitCode: 0, runId: run.runId })
  })

  test('preserves the first exit result when PTY exit fires twice with different codes', async () => {
    exitSequences.push([1, 0])
    const manager = createAgentManager()
    const onExitSpy = vi.fn()

    const run = await manager.startAgent({
      agentId: 'agent-2',
      command: '/bin/bash',
      cwd: '/tmp',
      onExit: onExitSpy,
    })

    await waitFor(() => {
      expect(manager.getRun(run.runId).status).toBe('error')
    })

    expect(onExitSpy).toHaveBeenCalledTimes(1)
    expect(onExitSpy).toHaveBeenCalledWith({ errorTail: null, exitCode: 1, runId: run.runId })
    expect(manager.getRun(run.runId)).toMatchObject({ exitCode: 1, status: 'error' })
  })

  test('treats a null exit result as terminal when PTY exit fires twice', async () => {
    exitSequences.push([null, 0])
    const manager = createAgentManager()
    const onExitSpy = vi.fn()

    const run = await manager.startAgent({
      agentId: 'agent-3',
      command: '/bin/bash',
      cwd: '/tmp',
      onExit: onExitSpy,
    })

    await waitFor(() => {
      expect(manager.getRun(run.runId).status).toBe('error')
    })

    expect(onExitSpy).toHaveBeenCalledTimes(1)
    expect(onExitSpy).toHaveBeenCalledWith({ errorTail: null, exitCode: null, runId: run.runId })
    expect(manager.getRun(run.runId)).toMatchObject({ exitCode: null, status: 'error' })
  })

  test('logs pty.onExit cleanup errors and still finishes the run', async () => {
    exitSequences.push([1])
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -4242 && signal === 'SIGKILL') {
        const error = new Error('cleanup failed') as NodeJS.ErrnoException
        error.code = 'EINVAL'
        throw error
      }
      return true
    })
    const logger = {
      close: async () => {},
      error: (message: string, error?: unknown) => {
        loggerErrors.push({ error, message })
      },
      info: () => {},
      warn: () => {},
    }
    const manager = createAgentManager({ logger })
    const onExitSpy = vi.fn()

    const run = await manager.startAgent({
      agentId: 'agent-4',
      command: '/bin/bash',
      cwd: '/tmp',
      onExit: onExitSpy,
    })

    await waitFor(() => {
      expect(manager.getRun(run.runId).status).toBe('error')
    })

    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGKILL')
    expect(loggerErrors).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ message: 'cleanup failed' }),
        message: 'pty.onExit cleanup',
      }),
    ])
    expect(onExitSpy).toHaveBeenCalledWith({ errorTail: null, exitCode: 1, runId: run.runId })
  })
})
