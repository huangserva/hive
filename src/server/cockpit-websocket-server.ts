import type { IncomingMessage, Server } from 'node:http'

import type { WebSocket as WsSocket } from 'ws'
import { WebSocketServer } from 'ws'
import { parseCockpit } from './cockpit-doc.js'
import { resolveCockpitUnreviewedCode } from './cockpit-unreviewed-augment.js'
import { getLocalRequestRejection } from './local-request-guard.js'
import type { HiveLogger } from './logger.js'
import type { RuntimeStore } from './runtime-store.js'
import { readCookie } from './ui-auth-helpers.js'

const matchCockpitPath = (pathname: string) => {
  const match = /^\/ws\/cockpit\/(?<workspaceId>[^/]+)$/.exec(pathname)
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
    logger?.error('ws upgrade [cockpit]', error)
  } catch {}
}

export interface CockpitWebSocketServer {
  close: () => void
  publish: (workspaceId: string) => void
}

export const createCockpitWebSocketServer = (
  server: Server,
  store: RuntimeStore,
  logger?: HiveLogger
): CockpitWebSocketServer => {
  const wss = new WebSocketServer({ noServer: true })
  const socketsByWorkspaceId = new Map<string, Set<WsSocket>>()

  const validateUpgradeSession = (request: IncomingMessage) => {
    const cookieHeader = Array.isArray(request.headers.cookie)
      ? request.headers.cookie.join('; ')
      : request.headers.cookie
    const token = readCookie(cookieHeader, 'hive_ui_token')
    return store.validateUiToken(token)
  }

  // M34：在 serve-cockpit 边界把 DB 派生的「未审代码改动」action 合并进 file-only 的 aiActions。
  // parseCockpit 仍只读文件（契约不破）；合并是 best-effort，失败回落纯文件快照、绝不阻断同步。
  const buildCockpitPayload = (workspaceId: string, workspacePath: string) => {
    const cockpit = parseCockpit(workspacePath)
    try {
      return {
        ...cockpit,
        aiActions: resolveCockpitUnreviewedCode(store, workspaceId).apply(cockpit.aiActions),
      }
    } catch (error) {
      logger?.warn?.(`cockpit unreviewed-code augment failed workspace_id=${workspaceId}`, error)
      return cockpit
    }
  }

  const sendSnapshot = (
    ws: WsSocket,
    workspaceId: string,
    workspacePath: string,
    kind: 'cockpit-snapshot' | 'cockpit-update'
  ) => {
    ws.send(JSON.stringify({ kind, payload: buildCockpitPayload(workspaceId, workspacePath) }))
  }

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const workspaceId = matchCockpitPath(url.pathname)
      if (!workspaceId) return
      if (getLocalRequestRejection(request)) {
        rejectUpgrade(socket, '403 Forbidden')
        return
      }
      if (!validateUpgradeSession(request)) {
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
        let sockets: Set<WsSocket> | null = null
        ws.on('close', () => {
          if (!sockets) return
          sockets.delete(ws)
          if (sockets.size === 0) socketsByWorkspaceId.delete(workspaceId)
        })
        setImmediate(() => {
          if (ws.readyState !== ws.OPEN) return
          try {
            const workspacePath = store.getWorkspaceSnapshot(workspaceId).summary.path
            sendSnapshot(ws, workspaceId, workspacePath, 'cockpit-snapshot')
          } catch (error) {
            logUpgradeError(logger, error)
          }
          if (ws.readyState !== ws.OPEN) return
          sockets = socketsByWorkspaceId.get(workspaceId) ?? new Set<WsSocket>()
          sockets.add(ws)
          socketsByWorkspaceId.set(workspaceId, sockets)
        })
      })
    } catch (error) {
      logUpgradeError(logger, error)
      socket.destroy()
    }
  })

  wss.on('error', (error) => {
    logger?.error('cockpit websocket error', error)
  })

  return {
    close: () => {
      for (const sockets of socketsByWorkspaceId.values()) {
        for (const socket of sockets) socket.close()
      }
      socketsByWorkspaceId.clear()
      wss.close()
    },
    publish: (workspaceId) => {
      const sockets = socketsByWorkspaceId.get(workspaceId)
      if (!sockets) return
      let workspacePath: string
      try {
        workspacePath = store.getWorkspaceSnapshot(workspaceId).summary.path
      } catch {
        return
      }
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          try {
            sendSnapshot(socket, workspaceId, workspacePath, 'cockpit-update')
          } catch (error) {
            logger?.error('cockpit websocket publish failed', error)
          }
        }
      }
    },
  }
}
