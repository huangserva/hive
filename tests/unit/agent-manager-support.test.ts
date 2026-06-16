import { execFileSync } from 'node:child_process'

import type { IPty } from 'node-pty'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { AgentRunRecord } from '../../src/server/agent-manager.js'
import { attachAgentPty, createOutputTailBuffer } from '../../src/server/agent-manager-support.js'
import type { PtyOutputBus } from '../../src/server/pty-output-bus.js'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

type ExitHandler = Parameters<IPty['onExit']>[0]
type DataHandler = Parameters<IPty['onData']>[0]

interface FakePty extends IPty {
  emitError(error: Error): void
  emitExit(exitCode: number): void
  killCalls: NodeJS.Signals[]
  onError(handler: (error: Error) => void): void
}

const createFakePty = (pid: number): FakePty => {
  let exitHandler: ExitHandler | null = null
  let errorHandler: ((error: Error) => void) | null = null
  let dataHandler: DataHandler | null = null
  const killCalls: NodeJS.Signals[] = []
  return {
    clear: vi.fn(),
    cols: 80,
    emitError(error: Error) {
      errorHandler?.(error)
    },
    emitExit(exitCode: number) {
      exitHandler?.({ exitCode, signal: 0 })
    },
    handleFlowControl: false,
    kill(signal?: string) {
      if (signal) killCalls.push(signal as NodeJS.Signals)
    },
    killCalls,
    onData(handler: DataHandler) {
      dataHandler = handler
      return { dispose: vi.fn() }
    },
    onError(handler: (error: Error) => void) {
      errorHandler = handler
    },
    onExit(handler: ExitHandler) {
      exitHandler = handler
      return { dispose: vi.fn() }
    },
    pause: vi.fn(),
    pid,
    process: 'fake-pty',
    resize: vi.fn(),
    resume: vi.fn(),
    rows: 24,
    write(input: string) {
      dataHandler?.(input)
    },
  }
}

const createRun = (): AgentRunRecord => ({
  agentId: 'agent-1',
  errorTail: null,
  errorTailBuffer: createOutputTailBuffer(),
  exitCode: null,
  onExit: vi.fn(),
  output: '',
  pid: null,
  process: {
    isStopped: () => false,
    pause: vi.fn(),
    pid: null,
    resize: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    write: vi.fn(),
  },
  runId: 'run-1',
  status: 'starting',
})

const createOutputBus = (): PtyOutputBus =>
  ({
    clear: vi.fn(),
    publish: vi.fn(),
  }) as Pick<PtyOutputBus, 'clear' | 'publish'> as PtyOutputBus

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('attachAgentPty process-group safety', () => {
  test('does not send a negative kill to the hive process group when ps reports the current pid', () => {
    const currentPid = process.pid
    vi.mocked(execFileSync).mockReturnValue(`${currentPid}\n`)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = createRun()
    const pty = createFakePty(4242)

    attachAgentPty(run, pty, createOutputBus())
    run.process.stop()

    expect(killSpy).not.toHaveBeenCalledWith(-currentPid, expect.anything())
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
  })

  test('does not kill the current process group when it differs from process.pid', () => {
    vi.mocked(execFileSync).mockReturnValueOnce('111\n').mockReturnValueOnce('111\n')
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = createRun()
    const pty = createFakePty(4242)

    attachAgentPty(run, pty, createOutputBus())
    run.process.stop()

    expect(killSpy).not.toHaveBeenCalledWith(-111, expect.anything())
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
  })

  test('falls back to the PTY pid when the current process group cannot be verified', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce('111\n')
      .mockImplementationOnce(() => {
        throw new Error('ps failed')
      })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = createRun()
    const pty = createFakePty(4242)

    attachAgentPty(run, pty, createOutputBus())
    run.process.stop()

    expect(killSpy).not.toHaveBeenCalledWith(-111, expect.anything())
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
  })
})

describe('attachAgentPty exit/error ordering', () => {
  test('preserves the real exitCode when onError fires before onExit', () => {
    vi.mocked(execFileSync).mockReturnValue('4242\n')
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = createRun()
    const pty = createFakePty(4242)

    attachAgentPty(run, pty, createOutputBus())
    pty.emitError(new Error('pty stream error'))
    pty.emitExit(7)

    expect(run.status).toBe('error')
    expect(run.exitCode).toBe(7)
    expect(run.onExit).toHaveBeenCalledWith(
      expect.objectContaining({ exitCode: 7, runId: 'run-1' })
    )
  })

  test('keeps a normal onExit(0) path as exited', () => {
    vi.mocked(execFileSync).mockReturnValue('4242\n')
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = createRun()
    const pty = createFakePty(4242)

    attachAgentPty(run, pty, createOutputBus())
    pty.emitExit(0)

    expect(run.status).toBe('exited')
    expect(run.exitCode).toBe(0)
    expect(run.errorTail).toBeNull()
  })

  test('lets a delayed onExit correct the timer fallback from error/null to exited/0', () => {
    vi.useFakeTimers()
    vi.mocked(execFileSync).mockReturnValue('4242\n')
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const run = createRun()
    const pty = createFakePty(4242)

    attachAgentPty(run, pty, createOutputBus())
    pty.emitError(new Error('pty stream error'))
    vi.advanceTimersByTime(751)
    expect(run.status).toBe('error')
    expect(run.exitCode).toBeNull()

    pty.emitExit(0)

    expect(run.status).toBe('exited')
    expect(run.exitCode).toBe(0)
    expect(run.errorTail).toBeNull()
    vi.useRealTimers()
  })
})
