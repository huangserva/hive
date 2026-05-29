import { EventEmitter } from 'node:events'

import { describe, expect, test, vi } from 'vitest'
import type WebSocket from 'ws'

import type { RuntimeStore } from '../../src/server/runtime-store.js'
import { createTerminalStreamHub } from '../../src/server/terminal-stream-hub.js'

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = this.OPEN
  close = vi.fn(() => {
    this.readyState = 3
    this.emit('close')
  })
  send = vi.fn()
}

const createFakeStore = () => {
  const outputHandlers = new Map<string, (chunk: string) => void>()
  const outputUnsubscribes = new Map<string, ReturnType<typeof vi.fn>>()
  return {
    getLiveRun: vi.fn(() => ({ exitCode: null, output: '', status: 'running' })),
    getPtyOutputBus: vi.fn(() => ({
      subscribe: vi.fn((runId: string, handler: (chunk: string) => void) => {
        outputHandlers.set(runId, handler)
        const unsubscribe = vi.fn(() => outputHandlers.delete(runId))
        outputUnsubscribes.set(runId, unsubscribe)
        return unsubscribe
      }),
    })),
    pauseTerminalRun: vi.fn(),
    resizeAgentRun: vi.fn(),
    resumeTerminalRun: vi.fn(),
    stopAgentRun: vi.fn(),
    writeRunInput: vi.fn(),
    emitOutput(runId: string, chunk: string) {
      outputHandlers.get(runId)?.(chunk)
    },
    getOutputUnsubscribe(runId: string) {
      return outputUnsubscribes.get(runId)
    },
  }
}

describe('terminal stream hub', () => {
  test('late close from a replaced io socket does not close the active replacement flow', () => {
    const store = createFakeStore()
    const hub = createTerminalStreamHub(store as unknown as RuntimeStore)
    const oldSocket = new FakeSocket()
    const newSocket = new FakeSocket()

    hub.attachIo('run-1', 'viewer-a', oldSocket as unknown as WebSocket)
    hub.attachIo('run-1', 'viewer-a', newSocket as unknown as WebSocket)

    oldSocket.emit('close')
    store.emitOutput('run-1', 'still-live')

    expect(oldSocket.send).not.toHaveBeenCalledWith('still-live')
    expect(newSocket.send).toHaveBeenCalledWith('still-live')
    expect(store.writeRunInput).not.toHaveBeenCalled()

    hub.close()
  })

  test('missing live run during exit polling sends exit and releases run state', async () => {
    vi.useFakeTimers()
    const store = createFakeStore()
    const hub = createTerminalStreamHub(store as unknown as RuntimeStore)
    const controlSocket = new FakeSocket()

    hub.attachControl('run-removed', 'viewer-a', controlSocket as unknown as WebSocket)
    store.getLiveRun.mockImplementation(() => {
      throw new Error('Live run not found: run-removed')
    })

    await vi.advanceTimersByTimeAsync(30)

    const payloads = controlSocket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    expect(payloads).toContainEqual({ type: 'exit', code: null })
    expect(store.getOutputUnsubscribe('run-removed')).toHaveBeenCalledTimes(1)

    controlSocket.close()
    store.emitOutput('run-removed', 'after-cleanup')

    expect(controlSocket.send).not.toHaveBeenCalledWith('after-cleanup')

    hub.close()
    vi.useRealTimers()
  })
})
