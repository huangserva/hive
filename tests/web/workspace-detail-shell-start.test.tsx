// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { TeamListItem, WorkspaceSummary } from '../../src/shared/types.js'
import type { TerminalRunSummary } from '../../web/src/api.js'
import { NotificationProvider } from '../../web/src/notifications/NotificationProvider.js'
import { ToastProvider } from '../../web/src/ui/useToast.js'
import { WorkspaceDetail } from '../../web/src/WorkspaceDetail.js'

const nativeFetch = globalThis.fetch
const servers: Array<{ close: () => Promise<void> }> = []

const workspace = (id: string, name: string): WorkspaceSummary => ({
  id,
  name,
  path: `/tmp/${name.toLowerCase()}`,
})

const worker: TeamListItem = {
  id: 'worker-1',
  name: 'Alice',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'idle',
}

const shellRun = (workspaceId: string, runId: string): TerminalRunSummary => ({
  agent_id: `${workspaceId}:shell`,
  agent_name: 'Shell 1',
  run_id: runId,
  status: 'running',
  terminal_input_profile: 'default',
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

const listen = async (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
  const server = createServer(handler)
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
  servers.push({
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  })
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const value =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    return nativeFetch(value.startsWith('http') ? value : `${baseUrl}${value}`, init)
  })
}

const sendJson = (response: ServerResponse, status: number, payload: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

const renderWorkspaceDetail = ({
  selectedWorkspace = workspace('ws-1', 'Alpha'),
  terminalRuns = [],
}: {
  selectedWorkspace?: WorkspaceSummary
  terminalRuns?: TerminalRunSummary[]
} = {}) =>
  render(
    <ToastProvider>
      <NotificationProvider>
        <WorkspaceDetail
          onCreateWorker={vi.fn()}
          onDeleteWorker={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onOrchestratorResult={vi.fn()}
          onRequestAddWorkspace={vi.fn()}
          onStartWorker={vi.fn()}
          onStopWorkerRun={vi.fn()}
          orchestratorAutostartError={null}
          orchestratorAutostartRunId={null}
          terminalRuns={terminalRuns}
          workers={[worker]}
          workspace={selectedWorkspace}
        />
      </NotificationProvider>
    </ToastProvider>
  )

const workspaceDetailUi = ({
  selectedWorkspace,
  terminalRuns = [],
}: {
  selectedWorkspace: WorkspaceSummary
  terminalRuns?: TerminalRunSummary[]
}) => (
  <ToastProvider>
    <NotificationProvider>
      <WorkspaceDetail
        onCreateWorker={vi.fn()}
        onDeleteWorker={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onOrchestratorResult={vi.fn()}
        onRequestAddWorkspace={vi.fn()}
        onStartWorker={vi.fn()}
        onStopWorkerRun={vi.fn()}
        orchestratorAutostartError={null}
        orchestratorAutostartRunId={null}
        terminalRuns={terminalRuns}
        workers={[worker]}
        workspace={selectedWorkspace}
      />
    </NotificationProvider>
  </ToastProvider>
)

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) await server.close()
  window.localStorage.clear()
})

describe('WorkspaceDetail shell start lifecycle', () => {
  test('guards workspace shell start synchronously against double clicks', async () => {
    let startRequests = 0
    const start = deferred<TerminalRunSummary>()
    await listen((request, response) => {
      if (request.method === 'POST' && request.url === '/api/workspaces/ws-1/shell/start') {
        startRequests += 1
        void start.promise.then((run) => sendJson(response, 200, run))
        return
      }
      sendJson(response, 404, { error: 'not found' })
    })

    renderWorkspaceDetail()
    const openShell = screen.getByTestId('open-workspace-shell')
    fireEvent.click(openShell)
    fireEvent.click(openShell)

    await waitFor(() => expect(startRequests).toBe(1))
    start.resolve(shellRun('ws-1', 'ws-1-shell-1'))
  })

  test('ignores a stale shell start failure after switching workspaces', async () => {
    const ws1Start = deferred<TerminalRunSummary>()
    await listen((request, response) => {
      if (request.method === 'POST' && request.url === '/api/workspaces/ws-1/shell/start') {
        void ws1Start.promise
          .then((run) => sendJson(response, 200, run))
          .catch(() => sendJson(response, 500, { error: 'late ws1 failure' }))
        return
      }
      if (request.method === 'POST' && request.url === '/api/workspaces/ws-2/shell/start') {
        sendJson(response, 200, shellRun('ws-2', 'ws-2-shell-1'))
        return
      }
      sendJson(response, 404, { error: 'not found' })
    })

    const ws1 = workspace('ws-1', 'Alpha')
    const ws2 = workspace('ws-2', 'Beta')
    const view = renderWorkspaceDetail({ selectedWorkspace: ws1 })
    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    view.rerender(workspaceDetailUi({ selectedWorkspace: ws2 }))
    await act(async () => {
      ws1Start.reject(new Error('late ws1 failure'))
      await ws1Start.promise.catch(() => undefined)
    })

    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    const dialog = await screen.findByTestId('workspace-shell-dialog')
    expect(within(dialog).queryByText('late ws1 failure')).toBeNull()
  })

  test('expires an unconfirmed optimistic shell before allowing another start', async () => {
    let startRequests = 0
    await listen((request, response) => {
      if (request.method === 'POST' && request.url === '/api/workspaces/ws-1/shell/start') {
        startRequests += 1
        sendJson(response, 200, shellRun('ws-1', `ws-1-shell-${startRequests}`))
        return
      }
      sendJson(response, 404, { error: 'not found' })
    })

    renderWorkspaceDetail()
    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    await act(async () => {
      await Promise.resolve()
    })

    const dialog = screen.getByTestId('workspace-shell-dialog')
    await waitFor(() =>
      expect(within(dialog).getByTestId('workspace-shell-tab-ws-1-shell-1')).toBeInTheDocument()
    )

    const newTab = within(dialog).getByTestId('workspace-shell-new-tab')
    await waitFor(() => expect(newTab).not.toBeDisabled())
    fireEvent.click(newTab)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(startRequests).toBe(1)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100))
    })
    fireEvent.click(newTab)

    await waitFor(() => expect(startRequests).toBe(2))
  }, 7000)
})
