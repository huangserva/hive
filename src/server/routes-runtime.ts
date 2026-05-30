import { networkInterfaces } from 'node:os'
import { join } from 'node:path'

import { loadRelayConnectionInfo } from './relay-config.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { ConfigureAgentLaunchBody, RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'
import { getWorkspaceShellAgentId } from './workspace-shell-runtime.js'

export const listLanIpv4Addresses = (): string[] => {
  const addresses = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address === '127.0.0.1') continue
      addresses.add(entry.address)
    }
  }
  return [...addresses].sort((left, right) => {
    const leftPreferred = isPrivateLanIpv4(left)
    const rightPreferred = isPrivateLanIpv4(right)
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1
    return left.localeCompare(right)
  })
}

const isPrivateLanIpv4 = (address: string): boolean => {
  const parts = address.split('.').map((part) => Number(part))
  const [first, second] = parts
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  if (first === undefined || second === undefined) return false
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

export const runtimeRoutes: RouteDefinition[] = [
  route(
    'GET',
    '/api/runtime/status',
    async ({ request, response, runtimeInfo, store, versionService }) => {
      requireUiTokenFromRequest(request, store.validateUiToken)
      const version = await versionService.getVersionInfo()
      sendJson(response, 200, {
        port: runtimeInfo.port ?? 0,
        pid: process.pid,
        cwd: process.cwd(),
        log_path: join(runtimeInfo.dataDir, 'logs', `runtime-${runtimeInfo.port ?? 0}.log`),
        db_path: join(runtimeInfo.dataDir, 'runtime.sqlite'),
        lan_addresses: listLanIpv4Addresses(),
        version: version.current_version,
      })
    }
  ),
  route('GET', '/api/ui/workspaces/:workspaceId/runs', ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) {
      return
    }

    requireUiTokenFromRequest(request, store.validateUiToken)

    sendJson(response, 200, store.listTerminalRuns(workspaceId))
  }),
  route(
    'POST',
    '/api/workspaces/:workspaceId/shell/start',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)

      const run = await store.startWorkspaceShell(workspaceId)
      const summary = store
        .listTerminalRuns(workspaceId)
        .find((terminalRun) => terminalRun.run_id === run.runId)
      sendJson(response, 201, {
        agent_id: getWorkspaceShellAgentId(workspaceId),
        agent_name: summary?.agent_name ?? 'Shell',
        run_id: run.runId,
        status: run.status,
        terminal_input_profile: summary?.terminal_input_profile ?? 'default',
      })
    }
  ),
  route(
    'DELETE',
    '/api/workspaces/:workspaceId/shell/:runId',
    ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and run id are required'
      )
      const runId = getRequiredParam(
        response,
        params,
        'runId',
        'Workspace id and run id are required'
      )
      if (!workspaceId || !runId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)
      if (!store.closeWorkspaceShell(workspaceId, runId)) {
        sendJson(response, 404, { error: 'Shell run not found' })
        return
      }
      response.statusCode = 204
      response.end()
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/agents/:agentId/config',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and agent id are required'
      )
      const agentId = getRequiredParam(
        response,
        params,
        'agentId',
        'Workspace id and agent id are required'
      )
      if (!workspaceId || !agentId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)

      const body = await readJsonBody<ConfigureAgentLaunchBody>(request)
      store.configureAgentLaunch(workspaceId, agentId, {
        command: body.command,
        commandPresetId: body.command_preset_id ?? null,
        ...(body.args ? { args: body.args } : {}),
      })
      response.statusCode = 204
      response.end()
    }
  ),
  route('POST', '/api/runtime/runs/:runId/stop', ({ params, request, response, store }) => {
    const runId = getRequiredParam(response, params, 'runId', 'Run id is required')
    if (!runId) {
      return
    }

    requireUiTokenFromRequest(request, store.validateUiToken)

    store.stopAgentRun(runId)
    sendJson(response, 202, { ok: true })
  }),
  route('GET', '/api/runtime/runs/:runId', ({ params, request, response, store }) => {
    const runId = getRequiredParam(response, params, 'runId', 'Run id is required')
    if (!runId) {
      return
    }

    requireUiTokenFromRequest(request, store.validateUiToken)

    sendJson(response, 200, store.getLiveRun(runId))
  }),
  route('GET', '/api/relay/status', ({ relayConnector, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(
      response,
      200,
      relayConnector?.status() ?? {
        connected_at: null,
        last_error: null,
        last_heartbeat_at: null,
        mode: 'disabled',
        relay_url: null,
        room_id: null,
      }
    )
  }),
  // 给配对二维码用的 relay 公开连接信息（relay_url / room_id / daemon 公钥）。
  // relay.json 未配置则 { enabled:false }，QR 退回纯 host/token。只暴露公钥，不含 auth token / 私钥。
  route('GET', '/api/relay/connection-info', async ({ request, response, runtimeInfo, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(response, 200, await loadRelayConnectionInfo({ dataDir: runtimeInfo.dataDir }))
  }),
]
