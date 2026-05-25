type TerminalControlServerMessage =
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null }
  | { type: 'restore'; snapshot: string }

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
  const pendingOutput: Array<{ chunk: string; acknowledge: (bytes: number) => void }> = []
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
    pendingOutput.splice(0)
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
      const acknowledge = (bytes: number) => {
        if (controlSocket?.readyState !== WS_OPEN) return
        controlSocket.send(JSON.stringify({ type: 'output_ack', bytes }))
      }
      if (!restored) {
        pendingOutput.push({ chunk, acknowledge })
        return
      }
      onOutput(chunk, acknowledge)
    }
    controlSocket.onopen = () => {
      reconnectAttempt = 0
      sendResize()
    }
    controlSocket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as TerminalControlServerMessage
      if (message.type === 'exit') onExit(message.code)
      if (message.type === 'error') onError(message.message)
      if (message.type === 'restore') {
        onRestore(message.snapshot)
        restored = true
        if (controlSocket?.readyState === WS_OPEN) {
          controlSocket.send(JSON.stringify({ type: 'restore_complete' }))
        }
        for (const output of pendingOutput.splice(0)) {
          onOutput(output.chunk, output.acknowledge)
        }
      }
    }
  }

  connect()

  return {
    dispose() {
      disposed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
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
