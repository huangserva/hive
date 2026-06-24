import type { IncomingMessage } from 'node:http'
import { assertAutostartCommandPresetAvailable } from './agent-cli-autostart-gate.js'
import { applyManualCliPathToLaunchConfig } from './agent-cli-manual-paths.js'
import {
  resolveCommandPresetLaunchConfig,
  resolveStartupCommandLaunchConfig,
} from './agent-launch-resolver.js'
import type { AgentLaunchConfigInput } from './agent-run-store.js'
import { BadRequestError, ConflictError } from './http-errors.js'
import { autostartAgent, autostartOrchestrator } from './orchestrator-autostart.js'
import { seedOrchestratorLaunchConfig } from './orchestrator-launch.js'
import type { RoleTemplateRecord } from './role-template-store.js'
import { CLAUDE_WORKFLOW_ROLE_ID } from './role-templates.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type {
  CreateWorkerBody,
  CreateWorkspaceBody,
  RouteDefinition,
  UserInputBody,
} from './route-types.js'
import type { RuntimeStore } from './runtime-store.js'
import { authenticateCliAgent, requireCommandForRole } from './team-authz.js'
import { enrichTeamList } from './team-list-enrichment.js'
import { serializeTeamListItem } from './team-list-serializer.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'
import { validateWorkspacePath } from './workspace-path-validation.js'
import { getOrchestratorId } from './workspace-store-support.js'

const getSerializedWorker = (workspaceId: string, workerId: string, store: RuntimeStore) => {
  const worker = store.listWorkers(workspaceId).find((item) => item.id === workerId)
  if (!worker) {
    throw new Error(`Worker not found: ${workerId}`)
  }
  const [enriched] = enrichTeamList(workspaceId, store, [worker])
  if (!enriched) throw new Error(`Worker enrichment failed: ${workerId}`)
  return serializeTeamListItem(enriched)
}

const getRuntimePort = (request: IncomingMessage) => String(request.socket.localPort ?? '')

const applyRoleTemplateLaunchDefaults = (
  launchConfig: AgentLaunchConfigInput | undefined,
  template: RoleTemplateRecord | undefined,
  workflowAllowed: boolean
) => {
  if (!launchConfig && !template) return undefined
  if (!launchConfig && template) {
    return {
      args: template.defaultArgs,
      command: template.defaultCommand,
      commandPresetId: template.defaultCommand,
      env: template.defaultEnv,
      workflowAllowed,
    }
  }
  if (!launchConfig) return undefined
  if (!template) return { ...launchConfig, workflowAllowed }
  return {
    ...launchConfig,
    args: launchConfig.args ?? template.defaultArgs,
    command: launchConfig.command || template.defaultCommand,
    env: { ...template.defaultEnv, ...(launchConfig.env ?? {}) },
    workflowAllowed,
  }
}

interface PatchWorkerBody {
  command_preset_id?: unknown
  description?: unknown
  name?: unknown
  sentinel_interval_ms?: unknown
  thinking_level?: unknown
}

const getPatchedThinkingLevel = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new BadRequestError('thinking_level must be a string')
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const getPatchedCommandPresetId = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestError('command_preset_id must be a non-empty string')
  }
  return value.trim()
}

const getPatchedSentinelIntervalMs = (value: unknown): number | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestError('sentinel_interval_ms must be a positive number')
  }
  return Math.floor(value)
}

export const workspaceRoutes: RouteDefinition[] = [
  route('GET', '/api/workspaces', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    sendJson(response, 200, store.listWorkspaces())
  }),
  route('POST', '/api/workspaces', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const body = await readJsonBody<CreateWorkspaceBody>(request)
    const startupCommand = typeof body.startup_command === 'string' ? body.startup_command : null
    const workspacePath = validateWorkspacePath(body.path)
    const workspace = store.createWorkspace(workspacePath, body.name)
    seedOrchestratorLaunchConfig(
      store,
      store.settings,
      workspace.id,
      body.command_preset_id ?? null,
      startupCommand
    )

    const autostart = body.autostart_orchestrator !== false
    if (!autostart) {
      sendJson(response, 201, {
        ...workspace,
        orchestrator_start: { ok: false, error: null, run_id: null },
      })
      return
    }

    // Spawn failure must NOT block workspace creation — see AGENTS.md §1
    // (no try/catch fallbacks in production code, but `autostartOrchestrator`
    // captures the failure as a structured result instead of throwing).
    const orchestratorStart = await autostartOrchestrator(
      store,
      workspace.id,
      getOrchestratorId(workspace.id),
      getRuntimePort(request),
      'ui_workspace_create'
    )
    sendJson(response, 201, { ...workspace, orchestrator_start: orchestratorStart })
  }),
  route('DELETE', '/api/workspaces/:workspaceId', async ({ params, request, response, store }) => {
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
    await store.deleteWorkspace(workspaceId)
    response.statusCode = 204
    response.end()
  }),
  route('GET', '/api/ui/workspaces/:workspaceId/team', ({ params, request, response, store }) => {
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

    sendJson(
      response,
      200,
      enrichTeamList(workspaceId, store, store.listWorkers(workspaceId)).map(serializeTeamListItem)
    )
  }),
  route('GET', '/api/workspaces/:workspaceId/team', ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) {
      return
    }

    const agentId = request.headers['x-hive-agent-id']
    const token = request.headers['x-hive-agent-token']
    const agent = authenticateCliAgent({
      fromAgentId: typeof agentId === 'string' ? agentId : undefined,
      getAgent: store.getAgent,
      token: typeof token === 'string' ? token : undefined,
      validateToken: store.validateAgentToken,
      workspaceId,
    })
    requireCommandForRole(agent, 'list')

    sendJson(
      response,
      200,
      enrichTeamList(workspaceId, store, store.listWorkers(workspaceId)).map(serializeTeamListItem)
    )
  }),
  route(
    'POST',
    '/api/workspaces/:workspaceId/workers',
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

      const body = await readJsonBody<CreateWorkerBody>(request)
      if (
        body.role === 'sentinel' &&
        store.listWorkers(workspaceId).some((worker) => worker.role === 'sentinel')
      ) {
        throw new ConflictError('Workspace already has a sentinel worker')
      }
      const workerBody: CreateWorkerBody =
        body.role === 'sentinel'
          ? {
              ...body,
              command_preset_id: 'claude',
              role_template_id: null,
              startup_command: null,
              thinking_level: null,
            }
          : body
      const roleTemplateId =
        typeof workerBody.role_template_id === 'string' && workerBody.role_template_id.trim()
          ? workerBody.role_template_id.trim()
          : null
      const roleTemplate = roleTemplateId
        ? store.settings.listRoleTemplates().find((template) => template.id === roleTemplateId)
        : undefined
      if (roleTemplateId && !roleTemplate) {
        throw new BadRequestError(`Role template not found: ${roleTemplateId}`)
      }
      const workflowAllowed = roleTemplate?.id === CLAUDE_WORKFLOW_ROLE_ID
      const presetId = workerBody.command_preset_id ?? null
      const startupCommand =
        typeof workerBody.startup_command === 'string' ? workerBody.startup_command : null
      const thinkingLevel =
        typeof workerBody.thinking_level === 'string' && workerBody.thinking_level.trim()
          ? workerBody.thinking_level.trim()
          : null
      const launchConfig = startupCommand?.trim()
        ? resolveStartupCommandLaunchConfig(store.settings, startupCommand, presetId)
        : presetId
          ? resolveCommandPresetLaunchConfig(store.settings, presetId, thinkingLevel)
          : undefined
      if (presetId && !startupCommand?.trim() && !launchConfig) {
        throw new Error(`Command preset not found: ${presetId}`)
      }
      const launchConfigWithTemplate = applyManualCliPathToLaunchConfig(
        store.settings,
        applyRoleTemplateLaunchDefaults(launchConfig, roleTemplate, workflowAllowed)
      )
      if (workerBody.autostart === true) {
        assertAutostartCommandPresetAvailable(launchConfigWithTemplate)
      }

      const workerInput = {
        ...workerBody,
        workflowAllowed,
      }
      const description = workerBody.description ?? roleTemplate?.description
      if (description !== undefined) workerInput.description = description
      const worker = store.addWorker(workspaceId, workerInput)
      if (launchConfigWithTemplate) {
        try {
          store.configureAgentLaunch(workspaceId, worker.id, launchConfigWithTemplate)
        } catch (error) {
          store.deleteWorker(workspaceId, worker.id)
          throw error
        }
      }

      const agentStart =
        workerBody.autostart === true
          ? await autostartAgent(store, workspaceId, worker.id, getRuntimePort(request), {
              missingConfigError: 'No worker launch config available',
            })
          : { ok: false, error: null, run_id: null }

      sendJson(response, 201, {
        ...getSerializedWorker(workspaceId, worker.id, store),
        agent_start: agentStart,
      })
    }
  ),
  route(
    'DELETE',
    '/api/workspaces/:workspaceId/workers/:workerId',
    ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and worker id are required'
      )
      const workerId = getRequiredParam(
        response,
        params,
        'workerId',
        'Workspace id and worker id are required'
      )
      if (!workspaceId || !workerId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)
      store.deleteWorker(workspaceId, workerId)
      response.statusCode = 204
      response.end()
    }
  ),
  route(
    'PATCH',
    '/api/workspaces/:workspaceId/workers/:workerId',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id and worker id are required'
      )
      const workerId = getRequiredParam(
        response,
        params,
        'workerId',
        'Workspace id and worker id are required'
      )
      if (!workspaceId || !workerId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<PatchWorkerBody>(request)
      const worker = store.getWorker(workspaceId, workerId)
      const commandPresetId = getPatchedCommandPresetId(body.command_preset_id)
      const thinkingLevel = getPatchedThinkingLevel(body.thinking_level)
      const sentinelIntervalMs = getPatchedSentinelIntervalMs(body.sentinel_interval_ms)

      if (typeof body.name === 'string') {
        store.renameWorker(workspaceId, workerId, body.name)
      } else if (body.name !== undefined) {
        throw new BadRequestError('name must be a string')
      }

      if (typeof body.description === 'string') {
        store.updateWorkerDescription(workspaceId, workerId, body.description)
      } else if (body.description !== undefined) {
        throw new BadRequestError('description must be a string')
      }

      if (sentinelIntervalMs !== undefined) {
        if (worker.role !== 'sentinel') {
          throw new BadRequestError('sentinel_interval_ms can only be set on sentinel workers')
        }
        store.updateWorkerConfig(workspaceId, workerId, {
          heartbeat_interval_ms: sentinelIntervalMs,
        })
      }

      if (commandPresetId !== undefined || thinkingLevel !== undefined) {
        const currentConfig = store.peekAgentLaunchConfig(workspaceId, workerId)
        if (commandPresetId !== undefined) {
          if (worker.role === 'sentinel' && commandPresetId !== 'claude') {
            throw new BadRequestError('sentinel workers must use the claude command preset')
          }
          const nextConfig = resolveCommandPresetLaunchConfig(
            store.settings,
            commandPresetId,
            thinkingLevel === undefined ? (currentConfig?.thinkingLevel ?? null) : thinkingLevel
          )
          if (!nextConfig) throw new BadRequestError(`Command preset not found: ${commandPresetId}`)
          store.configureAgentLaunch(workspaceId, workerId, {
            ...nextConfig,
            env: currentConfig?.env ?? {},
            workflowAllowed: currentConfig?.workflowAllowed ?? worker.workflowAllowed,
          })
        } else {
          if (!currentConfig) {
            throw new BadRequestError(`Worker launch config not found: ${workerId}`)
          }
          store.configureAgentLaunch(workspaceId, workerId, {
            ...currentConfig,
            thinkingLevel: thinkingLevel ?? null,
          })
        }
      }

      sendJson(response, 200, getSerializedWorker(workspaceId, workerId, store))
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/user-input',
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

      const body = await readJsonBody<UserInputBody>(request)
      store.recordUserInput(workspaceId, `${workspaceId}:orchestrator`, body.text)
      sendJson(response, 202, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/agents/:agentId/start',
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

      if (
        agentId === getOrchestratorId(workspaceId) &&
        !store.peekAgentLaunchConfig(workspaceId, agentId)
      ) {
        seedOrchestratorLaunchConfig(store, store.settings, workspaceId)
      }
      const run = await store.startAgent(workspaceId, agentId, {
        hivePort: getRuntimePort(request),
        source: 'ui',
      })
      sendJson(response, 201, { run_id: run.runId })
    }
  ),
]
