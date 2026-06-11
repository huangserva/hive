// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { TerminalView } from '../../web/src/terminal/TerminalView.js'

let latestCustomKeyHandler: ((event: KeyboardEvent) => boolean) | undefined
let latestTerminal:
  | {
      buffer: { active: { baseY: number; viewportY: number } }
      scrollToBottom: () => void
    }
  | undefined
let terminalScrollToBottomCount = 0
let terminalWrites: string[] = []
let terminalConstructCount = 0

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly OPEN = 1
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  sent: string[] = []

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = this.OPEN
      this.onopen?.()
    })
  }

  close() {}
  send(payload: string) {
    this.sent.push(payload)
  }
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = []

  constructor(readonly callback: () => void) {
    MockResizeObserver.instances.push(this)
  }

  disconnect() {}
  observe() {}
  trigger() {
    this.callback()
  }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    buffer = { active: { baseY: 0, viewportY: 0 } }
    cols = 132
    rows = 43
    unicode = { activeVersion: '' }
    constructor() {
      terminalConstructCount += 1
      latestTerminal = this
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      latestCustomKeyHandler = handler
    }
    loadAddon() {}
    onData() {
      return { dispose() {} }
    }
    open() {}
    write(chunk?: string, callback?: () => void) {
      if (chunk !== undefined) terminalWrites.push(chunk)
      this.buffer.active.baseY += chunk?.split('\n').length ?? 0
      callback?.()
    }
    scrollToBottom() {
      this.buffer.active.viewportY = this.buffer.active.baseY
      terminalScrollToBottomCount += 1
    }
    dispose() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
    dispose() {}
  },
}))

afterEach(() => {
  cleanup()
  // 显式清 module-level singleton DOM (parking lot + portal slot leftovers)：
  // cleanup() 只卸 React rendered roots，TerminalView 用的 portal target slots
  // 和 parking lot 是 document.body 直挂 DOM，不会被 RTL 清。cold-start 跑得
  // 慢、disposeTimer 时序漂移时如果残留 DOM，下条测会拿到 stale parking-lot。
  document.body.innerHTML = ''
  MockWebSocket.instances = []
  MockResizeObserver.instances = []
  latestCustomKeyHandler = undefined
  latestTerminal = undefined
  terminalScrollToBottomCount = 0
  terminalWrites = []
  terminalConstructCount = 0
  vi.unstubAllGlobals()
})

const addPortalSlot = (runId: string, kind: 'orch' | 'shell' | 'worker' = 'orch') => {
  const slot = document.createElement('div')
  slot.id = `${kind}-pty-${runId}`
  document.body.appendChild(slot)
  return slot
}

describe('TerminalView', () => {
  test('opens io and control sockets for the provided run id', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-123')

    render(<TerminalView runId="run-123" title="Alice" />)

    await waitFor(() => {
      const urls = MockWebSocket.instances.map((socket) => new URL(socket.url))
      expect(urls.map((url) => url.pathname)).toEqual([
        '/ws/terminal/run-123/io',
        '/ws/terminal/run-123/control',
      ])
      expect(urls[0]?.searchParams.get('clientId')).toBeTruthy()
      expect(urls[1]?.searchParams.get('clientId')).toBe(urls[0]?.searchParams.get('clientId'))
      expect(urls[0]?.searchParams.get('cols')).toBe('132')
      expect(urls[0]?.searchParams.get('rows')).toBe('43')
    })
  })

  test('mounts into a workspace shell portal slot', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    const slot = addPortalSlot('run-shell', 'shell')

    render(<TerminalView runId="run-shell" title="Shell" />)

    await waitFor(() => {
      expect(slot.querySelector('[data-testid="terminal-run-shell"]')).not.toBeNull()
    })
  })

  test('sends the initial fit resize after the control socket opens', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-resize')

    render(<TerminalView runId="run-resize" title="Alice" />)

    await waitFor(() => {
      const controlSocket = MockWebSocket.instances[1]
      expect(controlSocket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({
        type: 'resize',
        cols: 132,
        rows: 43,
      })
    })
  })

  test('resizes again when the terminal container changes size', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    vi.stubGlobal('ResizeObserver', MockResizeObserver as never)
    addPortalSlot('run-observer')

    render(<TerminalView runId="run-observer" title="Alice" />)

    await waitFor(() => {
      expect(MockWebSocket.instances[1]?.sent).toHaveLength(1)
    })

    MockResizeObserver.instances[0]?.trigger()

    await waitFor(() => {
      expect(MockWebSocket.instances[1]?.sent).toHaveLength(2)
    })
  })

  test('does not render an inline terminal before a portal slot exists', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)

    render(<TerminalView runId="run-detached" title="Alice" />)

    expect(document.querySelector('[data-testid="terminal-run-detached"]')).toBeNull()
    expect(document.querySelector('section[aria-label="Terminal Alice"]')).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(0)

    const slot = addPortalSlot('run-detached')

    await waitFor(() => {
      expect(slot.querySelector('[data-testid="terminal-run-detached"]')).not.toBeNull()
      expect(MockWebSocket.instances).toHaveLength(2)
    })
    expect(MockWebSocket.instances.map((socket) => new URL(socket.url).pathname)).toEqual([
      '/ws/terminal/run-detached/io',
      '/ws/terminal/run-detached/control',
    ])
  })

  test('buffers live output until the restore snapshot is written', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-restore-order')

    render(<TerminalView runId="run-restore-order" title="Alice" />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2)
    })
    const [ioSocket, controlSocket] = MockWebSocket.instances
    ioSocket?.onmessage?.({ data: 'live-after-attach' })

    expect(terminalWrites).toEqual([])

    controlSocket?.onmessage?.({
      data: JSON.stringify({ type: 'restore', snapshot: 'restored-history' }),
    })

    expect(terminalWrites).toEqual(['restored-history', 'live-after-attach'])
    expect(controlSocket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'restore_complete',
    })
    expect(controlSocket?.sent.map((payload) => JSON.parse(payload))).toContainEqual({
      type: 'output_ack',
      bytes: new TextEncoder().encode('live-after-attach').byteLength,
    })
  })

  test('keeps the terminal pinned to the prompt when live output arrives at bottom', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-live-bottom')

    render(<TerminalView runId="run-live-bottom" title="Alice" />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2)
      expect(latestTerminal).toBeDefined()
    })
    const [ioSocket, controlSocket] = MockWebSocket.instances
    controlSocket?.onmessage?.({ data: JSON.stringify({ type: 'restore', snapshot: '' }) })
    if (!latestTerminal) throw new Error('terminal missing')
    latestTerminal.buffer.active.viewportY = latestTerminal.buffer.active.baseY

    ioSocket?.onmessage?.({
      data: Array.from({ length: 320 }, (_, index) => `line-${index}`).join('\n'),
    })

    expect(terminalWrites.at(-1)).toContain('line-319')
    expect(terminalScrollToBottomCount).toBeGreaterThan(0)
    expect(latestTerminal.buffer.active.viewportY).toBe(latestTerminal.buffer.active.baseY)
  })

  test('maps Shift+Enter to a modified Enter sequence instead of submit Enter', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)
    addPortalSlot('run-shift-enter')

    render(<TerminalView runId="run-shift-enter" title="Alice" />)

    await waitFor(() => {
      expect(latestCustomKeyHandler).toBeDefined()
      expect(MockWebSocket.instances[0]?.readyState).toBe(1)
    })

    const keydownHandled = latestCustomKeyHandler?.(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true })
    )
    const keypressHandled = latestCustomKeyHandler?.(
      new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, shiftKey: true })
    )

    expect(keydownHandled).toBe(false)
    expect(keypressHandled).toBe(false)
    expect(MockWebSocket.instances[0]?.sent).toEqual(['\u001b[13;2u'])
  })

  test('reparents terminal to a new slot without reconstructing xterm or reopening sockets', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)

    const slot1 = addPortalSlot('run-parking')
    const { rerender } = render(<TerminalView runId="run-parking" title="Parking" />)

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(2)
      expect(slot1.querySelector('[data-testid="terminal-run-parking"]')).not.toBeNull()
    })
    expect(terminalConstructCount).toBe(1)
    const wsCountAfterFirstMount = MockWebSocket.instances.length

    slot1.remove()

    await new Promise((resolve) => setTimeout(resolve, 150))
    rerender(<TerminalView runId="run-parking" title="Parking" />)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const parkingLot = document.getElementById('hive-terminal-parking-lot')
    expect(parkingLot).not.toBeNull()
    expect(parkingLot?.querySelector('[data-testid="terminal-run-parking"]')).not.toBeNull()

    const slot2 = document.createElement('div')
    slot2.id = 'orch-pty-run-parking'
    document.body.appendChild(slot2)

    await waitFor(
      () => {
        expect(slot2.querySelector('[data-testid="terminal-run-parking"]')).not.toBeNull()
      },
      { timeout: 3000 }
    )

    expect(terminalConstructCount).toBe(1)
    expect(MockWebSocket.instances).toHaveLength(wsCountAfterFirstMount)
  })

  test('disposes and reconstructs terminal after parking timeout elapses', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as never)

    const slot1 = addPortalSlot('run-timeout')
    const { rerender } = render(<TerminalView runId="run-timeout" title="Timeout" />)

    await waitFor(() => {
      expect(terminalConstructCount).toBe(1)
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    slot1.remove()

    await new Promise((resolve) => setTimeout(resolve, 150))
    rerender(<TerminalView runId="run-timeout" title="Timeout" />)
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(document.querySelector('[data-testid="terminal-run-timeout"]')).toBeNull()

    const slot2 = addPortalSlot('run-timeout')
    rerender(<TerminalView runId="run-timeout" title="Timeout" />)

    await waitFor(
      () => {
        expect(slot2.querySelector('[data-testid="terminal-run-timeout"]')).not.toBeNull()
      },
      { timeout: 3000 }
    )

    expect(terminalConstructCount).toBe(2)
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(4)
  })
})
