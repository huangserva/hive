// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createTerminalClient } from '../../web/src/terminal/terminal-client.js'

const WS_OPEN = 1

// Controllable fake WebSocket so we can drive open/message ordering deterministically.
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readyState = 0
  url: string
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  // test helpers
  open() {
    this.readyState = WS_OPEN
    this.onopen?.()
  }

  emit(data: unknown) {
    this.onmessage?.({ data })
  }
}

const findSocket = (fragment: string): FakeWebSocket => {
  const socket = FakeWebSocket.instances.find((s) => s.url.includes(fragment))
  if (!socket) throw new Error(`socket not created: ${fragment}`)
  return socket
}
const ioSocket = () => findSocket('/io')
const controlSocket = () => findSocket('/control')
const sentAckBytes = (socket: FakeWebSocket) =>
  socket.sent
    .map((raw) => JSON.parse(raw) as { bytes?: number; type: string })
    .filter((frame) => frame.type === 'output_ack')
    .reduce((total, frame) => total + (frame.bytes ?? 0), 0)

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const makeClient = (overrides: Partial<Parameters<typeof createTerminalClient>[0]> = {}) => {
  const onError = vi.fn()
  const onExit = vi.fn()
  const onOutput = vi.fn()
  const onRestore = vi.fn()
  const client = createTerminalClient({
    onError,
    onExit,
    onOutput,
    onRestore,
    runId: 'run-1',
    ...overrides,
  })
  return { client, onError, onExit, onOutput, onRestore }
}

describe('terminal-client ack accumulation (Blocking 1)', () => {
  test('output dropped while the control socket is not open is acked once control opens', () => {
    // maxEntries:1 → the second buffered chunk drops the first (control still
    // CONNECTING), so its ack would be lost under the old code. It must instead
    // accumulate and flush when control opens.
    makeClient({ pendingOutputLimits: { maxBytes: 1_000_000, maxEntries: 1 } })
    const io = ioSocket()
    const control = controlSocket()
    io.open() // io open, control still CONNECTING

    io.emit('aaa') // buffered (3 bytes)
    io.emit('bbbbb') // over cap → 'aaa' dropped, ack(3) attempted while control closed
    expect(sentAckBytes(control)).toBe(0) // nothing sent yet — control not open

    control.open() // → flushPendingAck
    expect(sentAckBytes(control)).toBe(3) // the dropped 3 bytes were not lost
  })

  test('a normal ack also waits for control to be open instead of being dropped', () => {
    const { onOutput } = makeClient()
    const io = ioSocket()
    const control = controlSocket()
    io.open()
    control.open()
    // restore so buffered output flushes to onOutput, whose acknowledge is called.
    control.emit(JSON.stringify({ snapshot: 'snap', type: 'restore' }))
    io.emit('hello')
    // onOutput is called with (chunk, acknowledge); invoke the ack it was given.
    const ack = onOutput.mock.calls.at(-1)?.[1] as (bytes: number) => void
    ack(5)
    expect(sentAckBytes(control)).toBe(5)
  })
})

describe('terminal-client control frame validation (Blocking 2)', () => {
  test('an invalid restore frame does not call onRestore (no async throw into xterm)', () => {
    const { onRestore } = makeClient()
    const control = controlSocket()
    control.open()
    control.emit(JSON.stringify({ snapshot: { not: 'a string' }, type: 'restore' }))
    expect(onRestore).not.toHaveBeenCalled()
    // a valid one still works
    control.emit(JSON.stringify({ snapshot: 'ok', type: 'restore' }))
    expect(onRestore).toHaveBeenCalledWith('ok')
  })

  test('invalid error/exit frames do not call onError/onExit; valid ones do', () => {
    const { onError, onExit } = makeClient()
    const control = controlSocket()
    control.open()
    control.emit(JSON.stringify({ message: 123, type: 'error' }))
    control.emit(JSON.stringify({ code: 'nope', type: 'exit' }))
    expect(onError).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    control.emit(JSON.stringify({ message: 'real error', type: 'error' }))
    control.emit(JSON.stringify({ code: 0, type: 'exit' }))
    expect(onError).toHaveBeenCalledWith('real error')
    expect(onExit).toHaveBeenCalledWith(0)
  })

  test('a malformed-JSON control frame is dropped, not thrown', () => {
    const { onRestore } = makeClient()
    const control = controlSocket()
    control.open()
    expect(() => control.emit('not json {')).not.toThrow()
    expect(onRestore).not.toHaveBeenCalled()
  })
})
