type ReconnectingWebSocketHandlers = {
  onClose?: () => void
  onError?: (event: Event) => void
  onMessage?: (event: MessageEvent) => void
  onOpen?: (event: { isReconnect: boolean }) => void
}

type ReconnectingWebSocketOptions = {
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface ReconnectingWebSocket {
  close: () => void
  onclose: (() => void) | null
  onerror: ((event: Event) => void) | null
  onopen: (() => void) | null
  readonly readyState: number
  send: (data: Parameters<WebSocket['send']>[0]) => boolean
}

const reconnectDelay = (attempt: number, baseDelayMs: number, maxDelayMs: number) =>
  Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)

export const createReconnectingWebSocket = (
  url: string,
  handlers: ReconnectingWebSocketHandlers = {},
  options: ReconnectingWebSocketOptions = {}
): ReconnectingWebSocket => {
  const baseDelayMs = options.baseDelayMs ?? 300
  const maxDelayMs = options.maxDelayMs ?? 5000
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null
  let socket: WebSocket | null = null
  const handle: ReconnectingWebSocket = {
    close() {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    },
    get readyState() {
      return socket?.readyState ?? WebSocket.CLOSED
    },
    onclose: null,
    onerror: null,
    onopen: null,
    send(data) {
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(data)
      return true
    },
  }

  const connect = () => {
    if (closed) return
    const isReconnect = attempt > 0
    socket = new WebSocket(url)
    socket.onopen = () => {
      attempt = 0
      handlers.onOpen?.({ isReconnect })
      handle.onopen?.()
    }
    socket.onmessage = (event) => handlers.onMessage?.(event)
    socket.onerror = (event) => {
      handlers.onError?.(event)
      handle.onerror?.(event)
    }
    socket.onclose = () => {
      handlers.onClose?.()
      handle.onclose?.()
      if (closed) return
      const delay = reconnectDelay(attempt, baseDelayMs, maxDelayMs)
      attempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    }
  }

  connect()

  return handle
}
