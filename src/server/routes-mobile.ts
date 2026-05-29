import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { parseCockpit } from './cockpit-doc.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import type { ResolvedApproval } from './feishu-approval-ledger.js'
import { BadRequestError, NotFoundError } from './http-errors.js'
import { getLocalRequestRejection } from './local-request-guard.js'
import { createLocalSttProvider } from './local-stt.js'
import {
  extractMobileToken,
  type MobileCapability,
  type MobileDeviceRecord,
} from './mobile-auth.js'
import { answerQuestionInFile } from './pm-questions-doc.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { enrichTeamList } from './team-list-enrichment.js'
import { stripTerminalAnsi } from './terminal-state-mirror.js'
import { readCookie } from './ui-auth-helpers.js'
import { getOrchestratorId } from './workspace-store-support.js'

const pendingUploadPaths = new Map<string, string[]>()

const getPendingUploadKey = (workspaceId: string, deviceId: string) => `${workspaceId}:${deviceId}`

const ALLOWED_AUDIO_FORMATS = new Set(['m4a', 'mp3', 'wav', 'ogg', 'webm', 'opus', 'aac', 'flac'])

export const normalizeMobileAudioFormat = (value: unknown) => {
  if (value === undefined || value === null || value === '') return 'm4a'
  if (typeof value !== 'string') throw new BadRequestError('format must be a string')
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9]+$/u.test(normalized) || !ALLOWED_AUDIO_FORMATS.has(normalized)) {
    throw new BadRequestError('Unsupported audio format')
  }
  return normalized
}

const assertInsideDirectory = (parentDir: string, childPath: string) => {
  const parent = resolve(parentDir)
  const child = resolve(childPath)
  if (child !== parent && !child.startsWith(`${parent}${sep}`)) {
    throw new BadRequestError('Resolved path escapes target directory')
  }
}

export const injectApprovalDecision = (
  store: { recordUserInput: (workspaceId: string, orchestratorId: string, text: string) => void },
  resolved: ResolvedApproval
) => {
  const keyword = resolved.decision === 'allow' ? 'ALLOWED' : 'DENIED'
  const message = [
    `[Hive 系统消息：approval_id=${resolved.approvalId} ${keyword} by ${resolved.operator} at ${new Date(resolved.resolvedAt).toISOString()}]`,
    `action: ${resolved.action}`,
  ].join('\n')
  store.recordUserInput(resolved.workspaceId, resolved.orchAgentId, message)
}

const activeMilestone = (cockpit: ReturnType<typeof parseCockpit>) =>
  cockpit.plan.milestones.find((milestone) => milestone.status === 'in_progress') ??
  cockpit.plan.milestones.find((milestone) => milestone.status === 'open') ??
  null

const activeMilestoneLabel = (milestone: NonNullable<ReturnType<typeof activeMilestone>>) => {
  const title = milestone.title.replace(
    /\s*·\s*(in_progress|open|proposed|blocked|shipped)\s*$/i,
    ''
  )
  return title.startsWith(milestone.id) ? title : `${milestone.id} · ${title}`
}

export const buildMobileDashboard = (
  store: Parameters<RouteDefinition['handler']>[0]['store'],
  workspaceId: string
) => {
  const workspace = store.getWorkspaceSnapshot(workspaceId)
  const cockpit = parseCockpit(workspace.summary.path)
  const milestone = activeMilestone(cockpit)
  const workers = enrichTeamList(workspaceId, store, store.listWorkers(workspaceId)).map(
    (worker) => ({
      id: worker.id,
      name: worker.name,
      preset: worker.commandPresetId ?? null,
      role: worker.role,
      status: worker.status,
    })
  )
  const runs = store.listTerminalRuns(workspaceId).map((run) => ({
    agent_name: run.agent_name,
    id: run.run_id,
    started_at: null,
    status: run.status,
  }))

  return {
    cockpit: {
      ai_actions_count: cockpit.aiActions.length,
      baseline_stale: cockpit.baseline.staleHint !== null,
      high_ai_actions: cockpit.aiActions.filter((action) => action.priority === 'high').length,
      open_questions:
        cockpit.questions.high.length +
        cockpit.questions.medium.length +
        cockpit.questions.low.length,
    },
    generated_at: new Date().toISOString(),
    plan: {
      active_milestone: milestone ? activeMilestoneLabel(milestone) : null,
      current_phase: cockpit.plan.currentPhase ?? cockpit.plan.frontmatter.current_phase ?? null,
    },
    runs,
    tasks: {
      total_done: cockpit.tasks.totalDone,
      total_open: cockpit.tasks.totalOpen,
    },
    workers,
    workspace: workspace.summary,
  }
}

const MAX_TRANSCRIPT_LINES = 100
const MAX_TASK_SUMMARY_LENGTH = 80

const transcriptLinesFromSnapshot = (snapshot: string | null) => {
  if (!snapshot) return { lines: [] as string[], truncated: false }
  const lines = stripTerminalAnsi(snapshot)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return {
    lines: lines.slice(-MAX_TRANSCRIPT_LINES),
    truncated: lines.length > MAX_TRANSCRIPT_LINES,
  }
}

export const buildMobileWorkerTranscript = async (
  store: Parameters<RouteDefinition['handler']>[0]['store'],
  workspaceId: string,
  workerId: string
) => {
  const worker = store.getAgent(workspaceId, workerId)
  const snapshot = await store.getPtySnapshotForAgent(workspaceId, workerId)
  const transcript = transcriptLinesFromSnapshot(snapshot)
  return {
    lines: transcript.lines,
    status: worker.status,
    truncated: transcript.truncated,
    worker_id: worker.id,
    worker_name: worker.name,
  }
}

const mobileDispatchStatus = (status: DispatchRecord['status']) => {
  if (status === 'reported') return 'done'
  if (status === 'cancelled') return 'cancelled'
  return 'pending'
}

const compactTaskSummary = (text: string) => text.trim().slice(0, MAX_TASK_SUMMARY_LENGTH)

export const buildMobileWorkspaceTasks = (
  store: Parameters<RouteDefinition['handler']>[0]['store'],
  workspaceId: string
) => ({
  dispatches: store.listDispatches(workspaceId).map((dispatch) => ({
    created_at: new Date(dispatch.createdAt).toISOString(),
    id: dispatch.id,
    status: mobileDispatchStatus(dispatch.status),
    task_summary: compactTaskSummary(dispatch.text),
    worker_name: store.getWorker(workspaceId, dispatch.toAgentId).name,
  })),
  workspace_id: workspaceId,
})

const requireMobileCapability = (
  request: Parameters<RouteDefinition['handler']>[0]['request'],
  store: Parameters<RouteDefinition['handler']>[0]['store'],
  capability: MobileCapability
): MobileDeviceRecord => {
  const device = store.authenticateMobileDevice(extractMobileToken(request))
  store.requireMobileCapability(device, capability)
  return device
}

const requireUiSessionOrMobileAdmin = (
  request: Parameters<RouteDefinition['handler']>[0]['request'],
  store: Parameters<RouteDefinition['handler']>[0]['store']
) => {
  const cookieHeader = Array.isArray(request.headers.cookie)
    ? request.headers.cookie.join('; ')
    : request.headers.cookie
  const uiToken = readCookie(cookieHeader, 'hive_ui_token')
  if (!getLocalRequestRejection(request) && store.validateUiToken(uiToken)) {
    return
  }
  requireMobileCapability(request, store, 'admin_runtime')
}

const mobileDeviceSummary = (device: MobileDeviceRecord) => ({
  active: device.revoked_at === null,
  capabilities: device.capabilities,
  created_at: new Date(device.created_at).toISOString(),
  device_type: device.device_type,
  id: device.id,
  last_seen_at: device.last_seen_at === null ? null : new Date(device.last_seen_at).toISOString(),
  name: device.name,
  revoked_at: device.revoked_at === null ? null : new Date(device.revoked_at).toISOString(),
  source: device.source,
})

const readCapabilities = (value: unknown): MobileCapability[] => {
  if (!Array.isArray(value)) throw new BadRequestError('capabilities must be an array')
  return value as MobileCapability[]
}

const readNonEmptyString = (value: unknown, fieldName: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestError(`${fieldName} is required`)
  }
  return value.trim()
}

const readOptionalNonNegativeInteger = (value: string | null, fieldName: string) => {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError(`${fieldName} must be a non-negative integer`)
  }
  return parsed
}

const isInside = (root: string, candidate: string) => {
  const relative = candidate.slice(root.length)
  return candidate === root || relative.startsWith(sep)
}

const hasParentTraversal = (requestedPath: string) =>
  requestedPath.split(/[\\/]+/).some((segment) => segment === '..')

const readWorkspaceMobileCockpitDocFile = (workspacePath: string, requestedPath: string) => {
  const trimmed = requestedPath.trim()
  if (!trimmed) throw new BadRequestError('path must not be empty')
  const lower = trimmed.toLowerCase()
  if (!lower.endsWith('.md') && !lower.endsWith('.html')) {
    throw new BadRequestError('doc path must be a .md or .html file')
  }
  if (!trimmed.startsWith('.hive/')) {
    throw new BadRequestError('doc path must stay inside .hive')
  }
  if (hasParentTraversal(trimmed)) {
    throw new BadRequestError('doc path must stay inside .hive')
  }

  const workspaceRoot = resolve(workspacePath)
  const hiveRoot = resolve(workspaceRoot, '.hive')
  const candidate = resolve(workspaceRoot, trimmed)
  if (!isInside(hiveRoot, candidate)) {
    throw new BadRequestError('doc path must stay inside .hive')
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    throw new NotFoundError(`Document not found: ${requestedPath}`)
  }

  return {
    content: readFileSync(candidate, 'utf8'),
    contentType: lower.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
  }
}

export const mobileRoutes: RouteDefinition[] = [
  route('GET', '/api/mobile/devices', ({ request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    sendJson(response, 200, {
      devices: store.listMobileDevices().map(mobileDeviceSummary),
    })
  }),
  route('POST', '/api/mobile/tokens', async ({ request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    const body = await readJsonBody<{ capabilities?: unknown; name?: unknown }>(request)
    const created = store.createMobileDeviceToken(
      readNonEmptyString(body.name, 'name'),
      readCapabilities(body.capabilities)
    )
    sendJson(response, 200, {
      device_id: created.device.id,
      token: created.token,
    })
  }),
  route('GET', '/api/mobile/tokens', ({ request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    sendJson(response, 200, {
      tokens: store.listMobileDevices().map(mobileDeviceSummary),
    })
  }),
  route('PATCH', '/api/mobile/tokens/:deviceId', async ({ params, request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    const deviceId = getRequiredParam(response, params, 'deviceId', 'Device id is required')
    if (!deviceId) return
    const body = await readJsonBody<{ capabilities?: unknown; name?: unknown }>(request)
    const patch: { capabilities?: MobileCapability[]; name?: string } = {}
    if (body.name !== undefined) patch.name = readNonEmptyString(body.name, 'name')
    if (body.capabilities !== undefined) patch.capabilities = readCapabilities(body.capabilities)
    sendJson(response, 200, {
      token: mobileDeviceSummary(store.updateMobileDevice(deviceId, patch)),
    })
  }),
  route('DELETE', '/api/mobile/tokens/:deviceId', ({ params, request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    const deviceId = getRequiredParam(response, params, 'deviceId', 'Device id is required')
    if (!deviceId) return
    store.deleteMobileDevice(deviceId)
    sendJson(response, 200, {
      device_id: deviceId,
      ok: true,
    })
  }),
  route('POST', '/api/mobile/push-token', async ({ request, response, store }) => {
    const device = store.authenticateMobileDevice(extractMobileToken(request))
    const body = await readJsonBody<{ push_token?: unknown }>(request)
    store.updateMobilePushToken(device.id, readNonEmptyString(body.push_token, 'push_token'))
    sendJson(response, 200, { ok: true })
  }),
  route('PATCH', '/api/mobile/devices/:deviceId', async ({ params, request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    const deviceId = getRequiredParam(response, params, 'deviceId', 'Device id is required')
    if (!deviceId) return
    const body = await readJsonBody<{ capabilities?: unknown; name?: unknown }>(request)
    const patch: { capabilities?: MobileCapability[]; name?: string } = {}
    if (body.name !== undefined) patch.name = readNonEmptyString(body.name, 'name')
    if (body.capabilities !== undefined) patch.capabilities = readCapabilities(body.capabilities)
    sendJson(response, 200, {
      device: mobileDeviceSummary(store.updateMobileDevice(deviceId, patch)),
    })
  }),
  route('DELETE', '/api/mobile/devices/:deviceId', ({ params, request, response, store }) => {
    requireUiSessionOrMobileAdmin(request, store)
    const deviceId = getRequiredParam(response, params, 'deviceId', 'Device id is required')
    if (!deviceId) return
    const device = store.revokeMobileDevice(deviceId)
    sendJson(response, 200, {
      device_id: device.id,
      ok: true,
      revoked_at: device.revoked_at,
    })
  }),
  route(
    'GET',
    '/api/mobile/runtime/status',
    async ({ request, response, runtimeInfo, store, versionService }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const version = await versionService.getVersionInfo()
      sendJson(response, 200, {
        port: runtimeInfo.port ?? 0,
        pid: process.pid,
        cwd: process.cwd(),
        log_path: join(runtimeInfo.dataDir, 'logs', `runtime-${runtimeInfo.port ?? 0}.log`),
        db_path: join(runtimeInfo.dataDir, 'runtime.sqlite'),
        version: version.current_version,
      })
    }
  ),
  route('GET', '/api/mobile/workspaces', ({ request, response, store }) => {
    requireMobileCapability(request, store, 'read_dashboard')
    sendJson(response, 200, store.listWorkspaces())
  }),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/dashboard',
    ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      sendJson(response, 200, buildMobileDashboard(store, workspaceId))
    }
  ),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/chat/messages',
    ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      store.getWorkspaceSnapshot(workspaceId)
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const since = readOptionalNonNegativeInteger(url.searchParams.get('since'), 'since')
      const limit = readOptionalNonNegativeInteger(url.searchParams.get('limit'), 'limit')
      sendJson(response, 200, {
        messages: store.listMobileChatMessages(workspaceId, since, limit),
      })
    }
  ),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/cockpit',
    ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const cockpit = parseCockpit(workspace.summary.path)
      sendJson(response, 200, {
        aiActions: cockpit.aiActions,
        ideas: cockpit.ideas,
        plan: cockpit.plan,
        questions: cockpit.questions,
        tasks: cockpit.tasks,
      })
    }
  ),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/cockpit/doc-file',
    ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const docPath = url.searchParams.get('path')
      if (!docPath) throw new BadRequestError('path is required')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const doc = readWorkspaceMobileCockpitDocFile(workspace.summary.path, docPath)
      response.statusCode = 200
      response.setHeader('content-type', doc.contentType)
      response.end(doc.content)
    }
  ),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/cockpit/questions/:questionId/answer',
    async ({ logger, params, request, response, store }) => {
      requireMobileCapability(request, store, 'send_prompt')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const questionId = getRequiredParam(response, params, 'questionId', 'Question id is required')
      if (!workspaceId || !questionId) return
      const body = await readJsonBody<{ answer?: unknown }>(request)
      if (typeof body.answer !== 'string') throw new BadRequestError('answer must be a string')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      answerQuestionInFile(workspace.summary.path, questionId, body.answer)
      try {
        store.notifyQuestionAnswered(workspaceId, questionId, body.answer)
      } catch (error) {
        logger?.warn(`mobile cockpit question answer nudge failed question_id=${questionId}`, error)
      }
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/workers/:workerId/transcript',
    async ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'read_terminal')
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
      if (!workspaceId || !workerId) return
      sendJson(response, 200, await buildMobileWorkerTranscript(store, workspaceId, workerId))
    }
  ),
  route(
    'GET',
    '/api/mobile/workspaces/:workspaceId/tasks',
    ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      sendJson(response, 200, buildMobileWorkspaceTasks(store, workspaceId))
    }
  ),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/dispatch',
    async ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'send_prompt')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const body = await readJsonBody<{ task?: unknown; worker_id?: unknown }>(request)
      const workerId = readNonEmptyString(body.worker_id, 'worker_id')
      const task = readNonEmptyString(body.task, 'task')
      const worker = store.getWorker(workspaceId, workerId)
      if (worker.role === 'sentinel') throw new BadRequestError('Cannot dispatch to sentinel')
      const dispatch = await store.dispatchTask(workspaceId, workerId, task)
      sendJson(response, 200, {
        dispatch_id: dispatch.id,
        ok: true,
        pending_task_count: store.getWorker(workspaceId, workerId).pendingTaskCount,
        worker_id: workerId,
        workspace_id: workspaceId,
      })
    }
  ),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/prompt',
    async ({ params, request, response, store }) => {
      const device = requireMobileCapability(request, store, 'send_prompt')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const body = await readJsonBody<{ text?: unknown }>(request)
      const text = readNonEmptyString(body.text, 'text')
      const orchId = getOrchestratorId(workspaceId)
      const activeRun = store.getActiveRunByAgentId(workspaceId, orchId)
      if (!activeRun) {
        throw new BadRequestError('Orchestrator is not running')
      }
      const pendingUploadKey = getPendingUploadKey(workspaceId, device.id)
      const uploadPaths = pendingUploadPaths.get(pendingUploadKey) ?? []
      pendingUploadPaths.delete(pendingUploadKey)
      const pathHints = uploadPaths.map((p) => `[Image: source: ${p}]`).join('\n')
      const formatted = pathHints
        ? `[来自手机 Mobile App]\n---\n${text}\n\n${pathHints}`
        : `[来自手机 Mobile App]\n---\n${text}`
      store.recordUserInput(workspaceId, orchId, formatted)
      store.insertMobileChatMessage(workspaceId, 'inbound', 'user_text', JSON.stringify({ text }))
      sendJson(response, 200, { ok: true, workspace_id: workspaceId })
    }
  ),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/approve/:approvalId',
    async ({ params, request, response, store }) => {
      const device = requireMobileCapability(request, store, 'approve_risk')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const approvalId = getRequiredParam(response, params, 'approvalId', 'Approval id is required')
      if (!workspaceId || !approvalId) return
      const approval = store.approvalLedger.get(approvalId)
      if (!approval || approval.workspaceId !== workspaceId) {
        throw new NotFoundError(`Approval not found: ${approvalId}`)
      }
      const body = await readJsonBody<{ decision?: unknown }>(request)
      const decision = readNonEmptyString(body.decision, 'decision')
      if (decision !== 'allow' && decision !== 'deny') {
        throw new BadRequestError('decision must be allow or deny')
      }
      const resolved = store.approvalLedger.resolve(approvalId, decision, `mobile:${device.id}`)
      if (!resolved) throw new BadRequestError(`Approval already resolved: ${approvalId}`)
      injectApprovalDecision(store, resolved)
      sendJson(response, 200, {
        approval_id: approvalId,
        decision,
        ok: true,
        status: 'recorded',
      })
    }
  ),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/workers/:workerId/stop',
    ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'admin_runtime')
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
      if (!workspaceId || !workerId) return
      store.getWorker(workspaceId, workerId)
      const activeRun = store.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) store.stopAgentRun(activeRun.runId)
      sendJson(response, 200, {
        ok: true,
        status: store.getWorker(workspaceId, workerId).status,
        worker_id: workerId,
        workspace_id: workspaceId,
      })
    }
  ),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/workers/:workerId/restart',
    async ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'admin_runtime')
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
      if (!workspaceId || !workerId) return
      store.getWorker(workspaceId, workerId)
      const activeRun = store.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) store.stopAgentRun(activeRun.runId)
      const run = await store.startAgent(workspaceId, workerId, {
        hivePort: String(request.socket.localPort ?? ''),
      })
      sendJson(response, 200, {
        ok: true,
        run_id: run.runId,
        status: store.getWorker(workspaceId, workerId).status,
        worker_id: workerId,
        workspace_id: workspaceId,
      })
    }
  ),
  route('POST', '/api/mobile/voice/transcribe', async ({ request, response, store }) => {
    requireMobileCapability(request, store, 'send_prompt')
    const body = await readJsonBody<{ audio?: unknown; format?: unknown }>(request, {
      limitBytes: 20 * 1024 * 1024,
    })
    if (typeof body.audio !== 'string' || !body.audio.trim()) {
      throw new BadRequestError('audio base64 string is required')
    }
    const sttProvider = createLocalSttProvider()
    const cli = await sttProvider.detect()
    if (!cli) {
      sendJson(response, 200, { error: 'stt_unavailable' })
      return
    }
    const audioBuffer = Buffer.from(body.audio, 'base64')
    const ext = `.${normalizeMobileAudioFormat(body.format)}`
    const tmpDir = mkdtempSync(join(tmpdir(), 'hive-voice-'))
    const audioPath = join(tmpDir, `voice${ext}`)
    assertInsideDirectory(tmpDir, audioPath)
    try {
      writeFileSync(audioPath, audioBuffer)
      const result = await sttProvider.transcribeAudioFile(audioPath)
      if (!result) {
        sendJson(response, 200, { error: 'transcription_failed' })
        return
      }
      sendJson(response, 200, { text: result.text })
    } finally {
      rmSync(tmpDir, { force: true, recursive: true })
    }
  }),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/upload',
    async ({ params, request, response, store, runtimeInfo }) => {
      const device = requireMobileCapability(request, store, 'send_prompt')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      store.getWorkspaceSnapshot(workspaceId)
      const body = await readJsonBody<{
        data?: unknown
        filename?: unknown
        mime_type?: unknown
      }>(request, { limitBytes: 50 * 1024 * 1024 })
      if (typeof body.data !== 'string' || !body.data.trim()) {
        throw new BadRequestError('data (base64) is required')
      }
      const filename = typeof body.filename === 'string' ? body.filename.trim() : 'upload'
      const mimeType =
        typeof body.mime_type === 'string' ? body.mime_type.trim() : 'application/octet-stream'
      const dataBuffer = Buffer.from(body.data, 'base64')
      if (dataBuffer.length > 50 * 1024 * 1024) {
        throw new BadRequestError('File too large (max 50MB)')
      }
      const dataDir = runtimeInfo?.dataDir ?? join(homedir(), '.config', 'hive')
      const uploadsDir = join(dataDir, 'uploads')
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })
      const fileId = randomUUID()
      const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
      const storageName = `${fileId}${ext}`
      writeFileSync(join(uploadsDir, storageName), dataBuffer)
      const diskPath = join(uploadsDir, storageName)
      const url = `/api/mobile/uploads/${fileId}${ext}`
      const pendingUploadKey = getPendingUploadKey(workspaceId, device.id)
      const pending = pendingUploadPaths.get(pendingUploadKey) ?? []
      pending.push(diskPath)
      pendingUploadPaths.set(pendingUploadKey, pending)
      store.insertMobileChatMessage(
        workspaceId,
        'inbound',
        'user_text',
        JSON.stringify({
          media: { file_id: fileId, filename, mime_type: mimeType, size: dataBuffer.length, url },
          text: `[${filename}]`,
        })
      )
      sendJson(response, 200, {
        file_id: fileId,
        filename,
        mime_type: mimeType,
        ok: true,
        size: dataBuffer.length,
        url,
      })
    }
  ),
  route(
    'GET',
    '/api/mobile/uploads/:fileId',
    ({ params, request, response, runtimeInfo, store }) => {
      requireMobileCapability(request, store, 'read_dashboard')
      const fileId = params?.fileId
      if (!fileId) {
        sendJson(response, 404, { error: 'Not found' })
        return
      }
      const dataDir = runtimeInfo?.dataDir ?? join(homedir(), '.config', 'hive')
      const uploadsDir = join(dataDir, 'uploads')
      if (!existsSync(uploadsDir)) {
        sendJson(response, 404, { error: 'Not found' })
        return
      }
      const candidates = [fileId]
      const commonExts = [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.mp4',
        '.mov',
        '.pdf',
        '.doc',
        '.docx',
        '.zip',
      ]
      for (const ext of commonExts) {
        candidates.push(`${fileId}${ext}`)
      }
      let found: string | null = null
      for (const candidate of candidates) {
        const filePath = join(uploadsDir, candidate)
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const resolved = resolve(filePath)
          if (resolved.startsWith(`${resolve(uploadsDir)}${sep}`)) {
            found = resolved
            break
          }
        }
      }
      if (!found) {
        sendJson(response, 404, { error: 'File not found' })
        return
      }
      const data = readFileSync(found)
      const ext = found.includes('.') ? found.slice(found.lastIndexOf('.')) : ''
      const mimeMap: Record<string, string> = {
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.gif': 'image/gif',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.mov': 'video/quicktime',
        '.mp4': 'video/mp4',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.zip': 'application/zip',
      }
      response.setHeader('content-type', mimeMap[ext] ?? 'application/octet-stream')
      response.setHeader('cache-control', 'public, max-age=86400')
      response.statusCode = 200
      response.end(data)
    }
  ),
]
