import {
  createPendingOutputBuffer,
  type PendingOutputBufferOptions,
} from './pending-output-buffer.js'
import { parseTerminalControlFrame } from './terminal-control-frame.js'

// If the restore snapshot never arrives (server stall) we stop buffering and go
// live so pre-restore output can't accumulate indefinitely. The buffer cap is
// the hard memory bound; this is the "don't wait forever" backstop.
const RESTORE_TIMEOUT_MS = 15_000

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength

interface TerminalClientOptions {
  initialSize?: {
    cols: number
    pixelHeight?: number
    pixelWidth?: number
    rows: number
  }
  onError: (message: string) => void
  onExit: (code: number | null) => void
  onOutput: (chunk: string, acknowledge: (bytes: number) => void) => void
  onRestore: (snapshot: string) => void
  // Caps for the pre-restore output buffer; defaults to DEFAULT_PENDING_OUTPUT_LIMITS.
  pendingOutputLimits?: PendingOutputBufferOptions
  runId: string
}

export interface TerminalClient {
  dispose: () => void
  resize: (cols: number, rows: number, pixelWidth?: number, pixelHeight?: number) => void
  sendBinaryInput: (chunk: string) => void
  sendInput: (chunk: string) => void
}

const WS_OPEN = 1

const toWebSocketUrl = (path: string, params: Record<string, number | string | undefined> = {}) => {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export const createTerminalClient = ({
  initialSize,
  onError,
  onExit,
  onOutput,
  onRestore,
  pendingOutputLimits,
  runId,
}: TerminalClientOptions): TerminalClient => {
  const clientId = crypto.randomUUID()
  const connectionParams = { ...initialSize, clientId }
  let ioSocket: WebSocket | null = null
  let controlSocket: WebSocket | null = null
  let restored = false
  let disposed = false
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null
  let restoreTimer: ReturnType<typeof window.setTimeout> | null = null
  const pendingOutput = createPendingOutputBuffer(pendingOutputLimits)
  // Output-ack bytes that could not be sent yet because the control socket was
  // not open. Without this, acks for dropped/buffered output before control opens
  // are lost forever → server terminal-flow-control unackedBytes stays high → PTY
  // output gets paused (stuck). We accumulate and flush once control is writable.
  let pendingAckBytes = 0

  const sendAck = (bytes: number) => {
    if (bytes <= 0) return
    if (controlSocket?.readyState === WS_OPEN) {
      controlSocket.send(JSON.stringify({ type: 'output_ack', bytes }))
    } else {
      pendingAckBytes += bytes
    }
  }

  const flushPendingAck = () => {
    if (pendingAckBytes > 0 && controlSocket?.readyState === WS_OPEN) {
      controlSocket.send(JSON.stringify({ type: 'output_ack', bytes: pendingAckBytes }))
      pendingAckBytes = 0
    }
  }

  const flushPendingOutput = () => {
    for (const output of pendingOutput.drain()) onOutput(output.chunk, output.acknowledge)
  }

  const clearRestoreTimer = () => {
    if (restoreTimer) {
      window.clearTimeout(restoreTimer)
      restoreTimer = null
    }
  }
  let pendingResize: {
    cols: number
    rows: number
    pixelWidth?: number
    pixelHeight?: number
  } | null = null

  const sendResize = () => {
    if (!pendingResize || controlSocket?.readyState !== WS_OPEN) return
    controlSocket.send(JSON.stringify({ type: 'resize', ...pendingResize }))
    pendingResize = null
  }

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return
    const delay = Math.min(5000, 300 * 2 ** reconnectAttempt)
    reconnectAttempt += 1
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const connect = () => {
    if (disposed) return
    if (ioSocket) {
      ioSocket.onclose = null
      ioSocket.onerror = null
    }
    if (controlSocket) {
      controlSocket.onclose = null
      controlSocket.onerror = null
    }
    ioSocket?.close()
    controlSocket?.close()
    restored = false
    clearRestoreTimer()
    pendingOutput.clear()
    // Stale acks from a previous (dead) connection must not be sent to the fresh
    // flow controller, which starts at 0 unacked bytes.
    pendingAckBytes = 0
    restoreTimer = window.setTimeout(() => {
      restoreTimer = null
      if (disposed || restored) return
      // Restore never arrived — go live so the buffer stops growing. We lose the
      // historical snapshot but keep streaming current output (graceful degrade).
      console.warn('[hive] terminal restore timed out; going live without snapshot')
      restored = true
      flushPendingOutput()
    }, RESTORE_TIMEOUT_MS)
    ioSocket = new WebSocket(toWebSocketUrl(`/ws/terminal/${runId}/io`, connectionParams))
    controlSocket = new WebSocket(toWebSocketUrl(`/ws/terminal/${runId}/control`, connectionParams))

    ioSocket.onopen = () => {
      reconnectAttempt = 0
    }
    ioSocket.onclose = scheduleReconnect
    controlSocket.onclose = scheduleReconnect
    ioSocket.onerror = () => scheduleReconnect()
    controlSocket.onerror = () => scheduleReconnect()
    ioSocket.onmessage = (event) => {
      const chunk = typeof event.data === 'string' ? event.data : ''
      // Route every ack through sendAck so it is accumulated (not lost) when the
      // control socket is not yet open.
      if (!restored) {
        pendingOutput.push({ acknowledge: sendAck, bytes: byteLength(chunk), chunk })
        return
      }
      onOutput(chunk, sendAck)
    }
    controlSocket.onopen = () => {
      reconnectAttempt = 0
      sendResize()
      flushPendingAck()
    }
    controlSocket.onmessage = (event) => {
      // Validate the frame shape before touching state/callbacks — a stale or
      // malformed frame in this async handler would throw past every ErrorBoundary.
      const message = parseTerminalControlFrame(event.data)
      if (!message) {
        console.error('[hive] dropped invalid terminal control frame', event.data)
        return
      }
      if (message.type === 'exit') onExit(message.code)
      if (message.type === 'error') onError(message.message)
      if (message.type === 'restore') {
        clearRestoreTimer()
        onRestore(message.snapshot)
        restored = true
        if (controlSocket?.readyState === WS_OPEN) {
          controlSocket.send(JSON.stringify({ type: 'restore_complete' }))
        }
        flushPendingOutput()
      }
    }
  }

  connect()

  return {
    dispose() {
      disposed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      clearRestoreTimer()
      ioSocket?.close()
      controlSocket?.close()
    },
    resize(cols, rows, pixelWidth, pixelHeight) {
      pendingResize = { cols, rows }
      if (pixelWidth !== undefined) pendingResize.pixelWidth = pixelWidth
      if (pixelHeight !== undefined) pendingResize.pixelHeight = pixelHeight
      sendResize()
    },
    sendBinaryInput(chunk) {
      if (ioSocket?.readyState !== WS_OPEN) return
      const bytes = new Uint8Array(chunk.length)
      for (let index = 0; index < chunk.length; index += 1) {
        bytes[index] = chunk.charCodeAt(index) & 0xff
      }
      ioSocket.send(bytes)
    },
    sendInput(chunk) {
      if (ioSocket?.readyState !== WS_OPEN) return
      ioSocket.send(chunk)
    },
  }
}
