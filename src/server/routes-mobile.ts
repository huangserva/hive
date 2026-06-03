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

import type { WorkerRole } from '../shared/types.js'
import { resolveCommandPresetLaunchConfig } from './agent-launch-resolver.js'
import { parseCockpit } from './cockpit-doc.js'
import { resolveCockpitUnreviewedCode } from './cockpit-unreviewed-augment.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import { maybeInsertFastVoiceReply } from './fast-voice-reply.js'
import type { ResolvedApproval } from './feishu-approval-ledger.js'
import { BadRequestError, NotFoundError } from './http-errors.js'
import { getLocalRequestRejection } from './local-request-guard.js'
import { createLocalSttProvider } from './local-stt.js'
import { createLocalTtsProvider } from './local-tts.js'
import {
  extractMobileToken,
  type MobileCapability,
  type MobileDeviceRecord,
} from './mobile-auth.js'
import { answerQuestionInFile } from './pm-questions-doc.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { serializeCommandPreset } from './routes-settings.js'
import type { RuntimeStore } from './runtime-store.js'
import { summarizeStaleDispatches } from './stale-dispatch-status.js'
import { enrichTeamList } from './team-list-enrichment.js'
import { stripTerminalAnsi } from './terminal-state-mirror.js'
import { readCookie, requireUiTokenFromRequest } from './ui-auth-helpers.js'
import { getOrchestratorId } from './workspace-store-support.js'

type PendingUploadPath = {
  path: string
  uploadedAt: number
}

const PENDING_UPLOAD_TTL_MS = 5 * 60 * 1000
const pendingUploadPaths = new Map<string, PendingUploadPath[]>()

const getPendingUploadKey = (workspaceId: string, deviceId: string) => `${workspaceId}:${deviceId}`

const prunePendingUploads = (uploads: PendingUploadPath[], now = Date.now()) =>
  uploads.filter((upload) => now - upload.uploadedAt <= PENDING_UPLOAD_TTL_MS)

const consumePendingUploadPaths = (key: string) => {
  const uploadPaths = prunePendingUploads(pendingUploadPaths.get(key) ?? []).map(
    (upload) => upload.path
  )
  pendingUploadPaths.delete(key)
  return uploadPaths
}

const addPendingUploadPath = (key: string, path: string) => {
  const pending = prunePendingUploads(pendingUploadPaths.get(key) ?? [])
  pending.push({ path, uploadedAt: Date.now() })
  pendingUploadPaths.set(key, pending)
}

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
  workspaceId: string,
  // M34：可注入 now（默认 Date.now()），供边界集成测试越过 reported 宽限期断言「未审」真出现。
  now: number = Date.now()
) => {
  const workspace = store.getWorkspaceSnapshot(workspaceId)
  const cockpit = parseCockpit(workspace.summary.path)
  const milestone = activeMilestone(cockpit)
  const rawWorkers = store.listWorkers(workspaceId)
  const workers = enrichTeamList(workspaceId, store, rawWorkers).map((worker) => ({
    capabilities: worker.capabilities
      ? {
          features: worker.capabilities.features,
          mode: worker.capabilities.mode,
          provider_family: worker.capabilities.providerFamily,
          risk_tier: worker.capabilities.riskTier,
          unattended: worker.capabilities.unattended,
        }
      : null,
    id: worker.id,
    name: worker.name,
    preset: worker.commandPresetId ?? null,
    role: worker.role,
    status: worker.status,
  }))
  const runs = store.listTerminalRuns(workspaceId).map((run) => ({
    agent_name: run.agent_name,
    id: run.run_id,
    started_at: new Date(run.started_at).toISOString(),
    status: run.status,
  }))

  // 「派单超时未汇报」醒目计数：worker 干完不报 / 卡住时，user 在看板直接看见，不靠 LLM nudge。
  const staleDispatches = summarizeStaleDispatches(
    store.listDispatches(workspaceId, { status: 'submitted' }),
    Date.now()
  )

  // M34「未审代码改动」醒目计数 + 合并进 aiActions（DB 派生，在边界合并，不污染 parseCockpit）。
  // 经 resolveCockpitUnreviewedCode 统一解析 commandPresetId（BLOCKER 返工：rawWorkers 不含 preset）。
  const unreviewedCode = resolveCockpitUnreviewedCode(store, workspaceId, now)
  const aiActions = unreviewedCode.apply(cockpit.aiActions)

  return {
    cockpit: {
      ai_actions_count: aiActions.length,
      baseline_stale: cockpit.baseline.staleHint !== null,
      escalated_dispatches: staleDispatches.escalatedCount,
      high_ai_actions: aiActions.filter((action) => action.priority === 'high').length,
      open_questions:
        cockpit.questions.high.length +
        cockpit.questions.medium.length +
        cockpit.questions.low.length,
      stale_dispatches: staleDispatches.staleCount,
      unreviewed_code_dispatches: unreviewedCode.count,
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

// 解一行内的 \r 覆盖：终端原地重绘只显示最后一次 \r 之后的内容（如 progress1%\rprogress2%
// → progress2%）。先剥掉行尾的 \r（\r\n 行结束符的残留），再按 \r 取最后一段。
const resolveLineCarriageReturns = (line: string): string => {
  const withoutTrailingCr = line.replace(/\r+$/u, '')
  if (!withoutTrailingCr.includes('\r')) return withoutTrailingCr
  const segments = withoutTrailingCr.split('\r')
  return segments[segments.length - 1] ?? withoutTrailingCr
}

const transcriptLinesFromSnapshot = (snapshot: string | null) => {
  if (!snapshot) return { lines: [] as string[], truncated: false }
  // 只按真正的换行 \n 切行（不再把 \r 全量替成 \n——那样会把"原地重绘"拆成多行残影、
  // 还顺手 trim 掉前导缩进）。每行内的 \r 覆盖在此解析；只 trimEnd 保前导缩进/Tab；
  // 空行判断用 trim 后长度，不真删被保留行的缩进。客户端 terminal-text 对此幂等。
  const lines = stripTerminalAnsi(snapshot)
    .split('\n')
    .map((line) => resolveLineCarriageReturns(line).trimEnd())
    .filter((line) => line.trim().length > 0)
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
    worker_id: dispatch.toAgentId,
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

// 移动端只允许创建这几类普通 worker；sentinel 唯一且 PC 专属，移动端不开放。
const MOBILE_CREATABLE_ROLES = new Set<WorkerRole>(['coder', 'reviewer', 'tester', 'custom'])

type CreateMobileWorkerStore = Pick<
  RuntimeStore,
  'addWorker' | 'configureAgentLaunch' | 'deleteWorker' | 'settings' | 'startAgent'
>

export interface CreateMobileWorkerBody {
  autostart?: unknown
  command_preset_id?: unknown
  description?: unknown
  name?: unknown
  role?: unknown
  thinking_level?: unknown
}

// 移动端创建 worker 的下拉列表数据源（PC 端 /api/settings/command-presets 的 mobile 版）。
export const listMobileCommandPresets = (store: Pick<RuntimeStore, 'settings'>) =>
  store.settings.listCommandPresets().map(serializeCommandPreset)

// 移动端创建 worker 共享逻辑（LAN route + relay RPC 都调它，保证校验/安全约束单一来源）。
// 安全要点：绝不接收 startup_command（避免任意 shell 命令注入），只允许已有 command preset；
// role=sentinel 直接拒绝。复用 PC 同款 addWorker → configureAgentLaunch →(autostart) startAgent。
export const createMobileWorker = async (
  store: CreateMobileWorkerStore,
  workspaceId: string,
  body: CreateMobileWorkerBody,
  hivePort: string
) => {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw new BadRequestError('name is required')

  const role = typeof body.role === 'string' ? body.role : ''
  if (role === 'sentinel') {
    throw new BadRequestError('Sentinel workers cannot be created from mobile')
  }
  if (!MOBILE_CREATABLE_ROLES.has(role as WorkerRole)) {
    throw new BadRequestError('role must be one of: coder, reviewer, tester, custom')
  }

  const presetId =
    typeof body.command_preset_id === 'string' && body.command_preset_id.trim()
      ? body.command_preset_id.trim()
      : null
  const thinkingLevel =
    typeof body.thinking_level === 'string' && body.thinking_level.trim()
      ? body.thinking_level.trim()
      : null
  const description = typeof body.description === 'string' ? body.description : undefined

  const launchConfig = presetId
    ? resolveCommandPresetLaunchConfig(store.settings, presetId, thinkingLevel)
    : undefined
  if (presetId && !launchConfig) {
    throw new BadRequestError(`Command preset not found: ${presetId}`)
  }

  const worker = store.addWorker(workspaceId, {
    name,
    role: role as WorkerRole,
    ...(description === undefined ? {} : { description }),
  })
  if (launchConfig) {
    try {
      store.configureAgentLaunch(workspaceId, worker.id, launchConfig)
    } catch (error) {
      store.deleteWorker(workspaceId, worker.id)
      throw error
    }
  }

  let agentStart: { error: string | null; ok: boolean; run_id: string | null } = {
    error: null,
    ok: false,
    run_id: null,
  }
  if (body.autostart === true) {
    if (!launchConfig) {
      agentStart = { error: 'No worker launch config available', ok: false, run_id: null }
    } else {
      try {
        const run = await store.startAgent(workspaceId, worker.id, { hivePort })
        agentStart = { error: null, ok: true, run_id: run.runId }
      } catch (error) {
        // worker 已建好，仅自启失败：保留 worker（同 PC autostart 语义），把错误带回前端。
        agentStart = {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
          run_id: null,
        }
      }
    }
  }

  return {
    agent_start: agentStart,
    name: worker.name,
    ok: true,
    role: worker.role,
    worker_id: worker.id,
    workspace_id: workspaceId,
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
  route('GET', '/api/mobile/tokens/:deviceId', ({ params, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const deviceId = getRequiredParam(response, params, 'deviceId', 'Device id is required')
    if (!deviceId) return
    const device = store.listMobileDevices().find((item) => item.id === deviceId)
    if (!device) throw new NotFoundError(`Mobile device not found: ${deviceId}`)
    sendJson(response, 200, {
      token: device.token,
      device: mobileDeviceSummary(device),
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
      // M34：边界合并 DB 派生「未审」action（parseCockpit 仍 file-only；preset 经 resolveCommandPresetId 解析）。
      const aiActions = resolveCockpitUnreviewedCode(store, workspaceId).apply(cockpit.aiActions)
      sendJson(response, 200, {
        aiActions,
        archive: cockpit.archive,
        baseline: cockpit.baseline,
        decisions: cockpit.decisions,
        ideas: cockpit.ideas,
        plan: cockpit.plan,
        questions: cockpit.questions,
        reports: cockpit.reports,
        research: cockpit.research,
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
      const body = await readJsonBody<{ source?: unknown; text?: unknown }>(request)
      const text = readNonEmptyString(body.text, 'text')
      const source = typeof body.source === 'string' ? body.source : undefined
      const orchId = getOrchestratorId(workspaceId)
      const activeRun = store.getActiveRunByAgentId(workspaceId, orchId)
      if (!activeRun) {
        throw new BadRequestError('Orchestrator is not running')
      }
      const pendingUploadKey = getPendingUploadKey(workspaceId, device.id)
      const uploadPaths = consumePendingUploadPaths(pendingUploadKey)
      const pathHints = uploadPaths.map((p) => `[Image: source: ${p}]`).join('\n')
      const formatted = pathHints
        ? `[来自手机 Mobile App]\n---\n${text}\n\n${pathHints}`
        : `[来自手机 Mobile App]\n---\n${text}`
      store.recordUserInput(workspaceId, orchId, formatted)
      store.insertMobileChatMessage(
        workspaceId,
        'inbound',
        'user_text',
        JSON.stringify(source === 'voice' ? { source, text } : { text })
      )
      await maybeInsertFastVoiceReply({ source, store, text, workspaceId })
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
      // getAgent（非 getWorker）以同样支持 orchestrator（orch role 不是 worker，getWorker 会抛）。
      store.getAgent(workspaceId, workerId)
      const activeRun = store.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) store.stopAgentRun(activeRun.runId)
      sendJson(response, 200, {
        ok: true,
        status: store.getAgent(workspaceId, workerId).status,
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
      // getAgent（非 getWorker）以同样支持 orchestrator（orch role 不是 worker，getWorker 会抛）。
      store.getAgent(workspaceId, workerId)
      const activeRun = store.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) store.stopAgentRun(activeRun.runId)
      const run = await store.startAgent(workspaceId, workerId, {
        hivePort: String(request.socket.localPort ?? ''),
      })
      sendJson(response, 200, {
        ok: true,
        run_id: run.runId,
        status: store.getAgent(workspaceId, workerId).status,
        worker_id: workerId,
        workspace_id: workspaceId,
      })
    }
  ),
  route('GET', '/api/mobile/command-presets', ({ request, response, store }) => {
    requireMobileCapability(request, store, 'admin_runtime')
    sendJson(response, 200, listMobileCommandPresets(store))
  }),
  route(
    'POST',
    '/api/mobile/workspaces/:workspaceId/workers',
    async ({ params, request, response, store }) => {
      requireMobileCapability(request, store, 'admin_runtime')
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return
      const body = await readJsonBody<CreateMobileWorkerBody>(request)
      const result = await createMobileWorker(
        store,
        workspaceId,
        body,
        String(request.socket.localPort ?? '')
      )
      sendJson(response, 201, result)
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
  route('POST', '/api/mobile/voice/synthesize', async ({ request, response, store }) => {
    requireMobileCapability(request, store, 'send_prompt')
    const body = await readJsonBody<{ text?: unknown; voice?: unknown }>(request, {
      limitBytes: 1024 * 1024,
    })
    if (typeof body.text !== 'string' || !body.text.trim()) {
      throw new BadRequestError('text string is required')
    }
    const ttsProvider = createLocalTtsProvider()
    const cli = await ttsProvider.detect()
    if (!cli) {
      sendJson(response, 200, { error: 'tts_unavailable' })
      return
    }
    const voice = typeof body.voice === 'string' ? body.voice : undefined
    const result = await ttsProvider.synthesize(body.text, voice ? { voice } : undefined)
    if (!result) {
      sendJson(response, 200, { error: 'synthesis_failed' })
      return
    }
    sendJson(response, 200, {
      audio: result.audio.toString('base64'),
      format: result.format,
      mime: result.mime,
    })
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
      addPendingUploadPath(pendingUploadKey, diskPath)
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
