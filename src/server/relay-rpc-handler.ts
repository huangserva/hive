import { join } from 'node:path'
import type { MobileCapability } from './mobile-auth.js'
import type { RuntimeInfo } from './route-types.js'
import {
  buildMobileDashboard,
  buildMobileWorkerTranscript,
  buildMobileWorkspaceTasks,
} from './routes-mobile.js'
import type { RuntimeStore } from './runtime-store.js'

export type RelayRpcHandler = (
  method: string,
  params: unknown,
  deviceId: string,
  capabilities: string[]
) => Promise<unknown>

interface RelayRpcHandlerDeps {
  runtimeInfo: RuntimeInfo
  store: Pick<
    RuntimeStore,
    | 'approvalLedger'
    | 'dispatchTask'
    | 'getActiveRunByAgentId'
    | 'getPtySnapshotForAgent'
    | 'getWorker'
    | 'listDispatches'
    | 'listWorkspaces'
    | 'requireMobileCapability'
    | 'startAgent'
    | 'stopAgentRun'
  > &
    Partial<RuntimeStore>
}

type RelayRpcParams = Record<string, unknown>

const asParams = (value: unknown): RelayRpcParams =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RelayRpcParams) : {}

const readStringParam = (params: RelayRpcParams, key: string) => {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

const requireCapability = (
  store: RelayRpcHandlerDeps['store'],
  deviceId: string,
  capabilities: string[],
  capability: Parameters<RuntimeStore['requireMobileCapability']>[1]
) => {
  store.requireMobileCapability(
    {
      capabilities: capabilities as MobileCapability[],
      created_at: Date.now(),
      device_type: 'relay',
      id: deviceId,
      last_seen_at: Date.now(),
      name: 'Relay device',
      revoked_at: null,
      token: '',
    },
    capability
  )
}

export const createRelayRpcHandler = (deps: RelayRpcHandlerDeps): RelayRpcHandler => {
  return async (method, rawParams, deviceId, capabilities) => {
    const params = asParams(rawParams)

    if (method === 'runtime.status') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      return {
        cwd: process.cwd(),
        db_path: join(deps.runtimeInfo.dataDir, 'runtime.sqlite'),
        pid: process.pid,
        port: deps.runtimeInfo.port ?? 0,
      }
    }

    if (method === 'workspaces.list') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      return deps.store.listWorkspaces()
    }

    if (method === 'workspace.dashboard.get') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      return buildMobileDashboard(
        deps.store as RuntimeStore,
        readStringParam(params, 'workspace_id')
      )
    }

    if (method === 'worker.transcript') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      return buildMobileWorkerTranscript(
        deps.store as RuntimeStore,
        readStringParam(params, 'workspace_id'),
        readStringParam(params, 'worker_id')
      )
    }

    if (method === 'workspace.tasks') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      return buildMobileWorkspaceTasks(
        deps.store as RuntimeStore,
        readStringParam(params, 'workspace_id')
      )
    }

    if (method === 'workspace.dispatch') {
      requireCapability(deps.store, deviceId, capabilities, 'send_prompt')
      const workspaceId = readStringParam(params, 'workspace_id')
      const workerId = readStringParam(params, 'worker_id')
      const task = readStringParam(params, 'task')
      const dispatch = await deps.store.dispatchTask(workspaceId, workerId, task)
      return {
        dispatch_id: dispatch.id,
        ok: true,
        worker_id: workerId,
        workspace_id: workspaceId,
      }
    }

    if (method === 'approval.resolve') {
      requireCapability(deps.store, deviceId, capabilities, 'approve_risk')
      const approvalId = readStringParam(params, 'approval_id')
      const decision = readStringParam(params, 'decision')
      if (decision !== 'allow' && decision !== 'deny') {
        throw new Error('decision must be allow or deny')
      }
      const resolved = deps.store.approvalLedger.resolve(approvalId, decision, `relay:${deviceId}`)
      if (!resolved) throw new Error(`Approval not found or already resolved: ${approvalId}`)
      return { approval_id: approvalId, decision, ok: true }
    }

    if (method === 'worker.stop') {
      requireCapability(deps.store, deviceId, capabilities, 'admin_runtime')
      const workspaceId = readStringParam(params, 'workspace_id')
      const workerId = readStringParam(params, 'worker_id')
      deps.store.getWorker(workspaceId, workerId)
      const activeRun = deps.store.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) deps.store.stopAgentRun(activeRun.runId)
      return { ok: true, worker_id: workerId, workspace_id: workspaceId }
    }

    if (method === 'worker.restart') {
      requireCapability(deps.store, deviceId, capabilities, 'admin_runtime')
      const workspaceId = readStringParam(params, 'workspace_id')
      const workerId = readStringParam(params, 'worker_id')
      deps.store.getWorker(workspaceId, workerId)
      const activeRun = deps.store.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) deps.store.stopAgentRun(activeRun.runId)
      const run = await deps.store.startAgent(workspaceId, workerId, {
        hivePort: String(deps.runtimeInfo.port ?? ''),
      })
      return { ok: true, run_id: run.runId, worker_id: workerId, workspace_id: workspaceId }
    }

    throw new Error(`Unknown relay RPC method: ${method}`)
  }
}
