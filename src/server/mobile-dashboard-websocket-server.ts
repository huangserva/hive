import type { Server } from 'node:http'

import type { WebSocket as WsSocket } from 'ws'
import { WebSocketServer } from 'ws'

import type { HiveLogger } from './logger.js'
import { buildMobileDashboard } from './routes-mobile.js'
import type { RuntimeStore } from './runtime-store.js'

const matchMobileDashboardPath = (pathname: string) => {
  const match = /^\/ws\/mobile\/workspaces\/(?<workspaceId>[^/]+)\/dashboard$/.exec(pathname)
  const workspaceId = match?.groups?.workspaceId
  return workspaceId ? decodeURIComponent(workspaceId) : null
}

const rejectUpgrade = (
  socket: Parameters<Server['on']>[1] extends (...args: infer T) => void ? T[1] : never,
  status: string
) => {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`)
  socket.destroy()
}

const logUpgradeError = (logger: HiveLogger | undefined, error: unknown) => {
  try {
    logger?.error('ws upgrade [mobile-dashboard]', error)
  } catch {}
}

export interface MobileDashboardWebSocketServer {
  close: () => void
  publishChatMessage: (
    workspaceId: string,
    message: Parameters<Parameters<RuntimeStore['registerMobileChatListener']>[0]>[1]
  ) => void
  publish: (workspaceId: string) => void
}

export const createMobileDashboardWebSocketServer = (
  server: Server,
  store: RuntimeStore,
  logger?: HiveLogger
): MobileDashboardWebSocketServer => {
  const wss = new WebSocketServer({ noServer: true })
  const socketsByWorkspaceId = new Map<string, Set<WsSocket>>()

  const sendSnapshot = (
    ws: WsSocket,
    workspaceId: string,
    kind: 'mobile-dashboard-snapshot' | 'mobile-dashboard-update'
  ) => {
    ws.send(JSON.stringify({ kind, payload: buildMobileDashboard(store, workspaceId) }))
  }

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const workspaceId = matchMobileDashboardPath(url.pathname)
      if (!workspaceId) return
      try {
        const device = store.authenticateMobileDevice(url.searchParams.get('token') ?? undefined)
        store.requireMobileCapability(device, 'read_dashboard')
      } catch {
        rejectUpgrade(socket, '401 Unauthorized')
        return
      }
      try {
        store.getWorkspaceSnapshot(workspaceId)
      } catch {
        rejectUpgrade(socket, '404 Not Found')
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const sockets = socketsByWorkspaceId.get(workspaceId) ?? new Set<WsSocket>()
        sockets.add(ws)
        socketsByWorkspaceId.set(workspaceId, sockets)
        ws.on('close', () => {
          sockets.delete(ws)
          if (sockets.size === 0) socketsByWorkspaceId.delete(workspaceId)
        })
        setImmediate(() => {
          if (ws.readyState !== ws.OPEN) return
          try {
            sendSnapshot(ws, workspaceId, 'mobile-dashboard-snapshot')
          } catch (error) {
            logUpgradeError(logger, error)
          }
        })
      })
    } catch (error) {
      logUpgradeError(logger, error)
      socket.destroy()
    }
  })

  wss.on('error', (error) => {
    logger?.error('mobile dashboard websocket error', error)
  })

  return {
    close: () => {
      for (const sockets of socketsByWorkspaceId.values()) {
        for (const socket of sockets) socket.close()
      }
      socketsByWorkspaceId.clear()
      wss.close()
    },
    publishChatMessage: (workspaceId, message) => {
      const sockets = socketsByWorkspaceId.get(workspaceId)
      if (!sockets) return
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ kind: 'mobile-chat-message', payload: message }))
        }
      }
    },
    publish: (workspaceId) => {
      const sockets = socketsByWorkspaceId.get(workspaceId)
      if (!sockets) return
      try {
        store.getWorkspaceSnapshot(workspaceId)
      } catch {
        return
      }
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          sendSnapshot(socket, workspaceId, 'mobile-dashboard-update')
        }
      }
    },
  }
}
