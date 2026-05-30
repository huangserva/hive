import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { parseCockpit } from './cockpit-doc.js'
import { createLocalSttProvider } from './local-stt.js'
import type { MobileCapability, MobileDeviceRecord } from './mobile-auth.js'
import { answerQuestionInFile } from './pm-questions-doc.js'
import type { RuntimeInfo } from './route-types.js'
import {
  buildMobileDashboard,
  buildMobileWorkerTranscript,
  buildMobileWorkspaceTasks,
  createMobileWorker,
  injectApprovalDecision,
  listMobileCommandPresets,
  normalizeMobileAudioFormat,
} from './routes-mobile.js'
import type { RuntimeStore } from './runtime-store.js'
import { getOrchestratorId } from './workspace-store-support.js'

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
    | 'addWorker'
    | 'approvalLedger'
    | 'configureAgentLaunch'
    | 'deleteWorker'
    | 'dispatchTask'
    | 'getActiveRunByAgentId'
    | 'getAgent'
    | 'getPtySnapshotForAgent'
    | 'getWorkspaceSnapshot'
    | 'getWorker'
    | 'listDispatches'
    | 'listWorkspaces'
    | 'listMobileChatMessages'
    | 'recordUserInput'
    | 'requireMobileCapability'
    | 'settings'
    | 'startAgent'
    | 'stopAgentRun'
    | 'updateMobilePushToken'
    | 'insertMobileChatMessage'
    | 'notifyQuestionAnswered'
  > &
    Partial<RuntimeStore>
}

type RelayRpcParams = Record<string, unknown>
const pendingUploadPaths = new Map<string, string[]>()
const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024

const asParams = (value: unknown): RelayRpcParams =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RelayRpcParams) : {}

const readStringParam = (params: RelayRpcParams, key: string) => {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

const readOptionalNumberParam = (params: RelayRpcParams, key: string, fallback: number) => {
  const value = params[key]
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a number`)
  }
  return parsed
}

const getPendingUploadKey = (workspaceId: string, deviceId: string) => `${workspaceId}:${deviceId}`

const requireCapability = (
  store: RelayRpcHandlerDeps['store'],
  deviceId: string,
  capabilities: string[],
  capability: Parameters<RuntimeStore['requireMobileCapability']>[1]
): MobileDeviceRecord => {
  const device: MobileDeviceRecord = {
    capabilities: capabilities as MobileCapability[],
    created_at: Date.now(),
    device_type: 'relay',
    id: deviceId,
    last_seen_at: Date.now(),
    name: 'Relay device',
    push_token: null,
    revoked_at: null,
    source: 'manual',
    token: '',
  }
  store.requireMobileCapability(device, capability)
  return device
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
      requireCapability(deps.store, deviceId, capabilities, 'read_terminal')
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

    if (method === 'workspace.chat.messages') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      const workspaceId = readStringParam(params, 'workspace_id')
      const limit = readOptionalNumberParam(params, 'limit', 50)
      const since =
        params.since === undefined || params.since === null || params.since === ''
          ? undefined
          : readOptionalNumberParam(params, 'since', 0)
      return {
        messages: deps.store.listMobileChatMessages(workspaceId, since, limit),
      }
    }

    if (method === 'workspace.cockpit') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      const workspaceId = readStringParam(params, 'workspace_id')
      const workspace = deps.store.getWorkspaceSnapshot(workspaceId)
      const cockpit = parseCockpit(workspace.summary.path)
      return {
        aiActions: cockpit.aiActions,
        ideas: cockpit.ideas,
        plan: cockpit.plan,
        questions: cockpit.questions,
        tasks: cockpit.tasks,
      }
    }

    if (method === 'workspace.cockpit.question.answer') {
      requireCapability(deps.store, deviceId, capabilities, 'send_prompt')
      const workspaceId = readStringParam(params, 'workspace_id')
      const questionId = readStringParam(params, 'question_id')
      const answer = readStringParam(params, 'answer')
      const workspace = deps.store.getWorkspaceSnapshot(workspaceId)
      answerQuestionInFile(workspace.summary.path, questionId, answer)
      deps.store.notifyQuestionAnswered(workspaceId, questionId, answer)
      return { ok: true }
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
      injectApprovalDecision(deps.store, resolved)
      return { approval_id: approvalId, decision, ok: true }
    }

    if (method === 'workspace.approve') {
      requireCapability(deps.store, deviceId, capabilities, 'approve_risk')
      const workspaceId = readStringParam(params, 'workspace_id')
      const approvalId = readStringParam(params, 'approval_id')
      const decision = readStringParam(params, 'decision')
      if (decision !== 'allow' && decision !== 'deny') {
        throw new Error('decision must be allow or deny')
      }
      const approval = deps.store.approvalLedger.get(approvalId)
      if (!approval || approval.workspaceId !== workspaceId) {
        throw new Error(`Approval not found: ${approvalId}`)
      }
      const resolved = deps.store.approvalLedger.resolve(approvalId, decision, `relay:${deviceId}`)
      if (!resolved) throw new Error(`Approval not found or already resolved: ${approvalId}`)
      injectApprovalDecision(deps.store, resolved)
      return { approval_id: approvalId, decision, ok: true, status: 'recorded' }
    }

    if (method === 'workspace.prompt') {
      const device = requireCapability(deps.store, deviceId, capabilities, 'send_prompt')
      const workspaceId = readStringParam(params, 'workspace_id')
      const text = readStringParam(params, 'text')
      const orchId = getOrchestratorId(workspaceId)
      const activeRun = deps.store.getActiveRunByAgentId(workspaceId, orchId)
      if (!activeRun) {
        throw new Error('Orchestrator is not running')
      }
      const pendingUploadKey = getPendingUploadKey(workspaceId, device.id)
      const uploadPaths = pendingUploadPaths.get(pendingUploadKey) ?? []
      pendingUploadPaths.delete(pendingUploadKey)
      const pathHints = uploadPaths.map((p) => `[Image: source: ${p}]`).join('\n')
      const formatted = pathHints
        ? `[来自手机 Mobile App]\n---\n${text}\n\n${pathHints}`
        : `[来自手机 Mobile App]\n---\n${text}`
      deps.store.recordUserInput(workspaceId, orchId, formatted)
      deps.store.insertMobileChatMessage(
        workspaceId,
        'inbound',
        'user_text',
        JSON.stringify({ text })
      )
      return { ok: true, workspace_id: workspaceId }
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

    if (method === 'workspace.upload') {
      const device = requireCapability(deps.store, deviceId, capabilities, 'send_prompt')
      const workspaceId = readStringParam(params, 'workspace_id')
      deps.store.getWorkspaceSnapshot(workspaceId)
      const data = readStringParam(params, 'data')
      const filename =
        typeof params.filename === 'string' && params.filename.trim()
          ? params.filename.trim()
          : 'upload'
      const mimeType =
        typeof params.mime_type === 'string' && params.mime_type.trim()
          ? params.mime_type.trim()
          : 'application/octet-stream'
      const dataBuffer = Buffer.from(data, 'base64')
      if (dataBuffer.length > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error('File too large (max 50MB)')
      }
      const dataDir = deps.runtimeInfo?.dataDir ?? join(homedir(), '.config', 'hive')
      const uploadsDir = join(dataDir, 'uploads')
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })
      const fileId = randomUUID()
      const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
      const storageName = `${fileId}${ext}`
      const diskPath = join(uploadsDir, storageName)
      writeFileSync(diskPath, dataBuffer)
      const url = `/api/mobile/uploads/${fileId}${ext}`
      const pendingUploadKey = getPendingUploadKey(workspaceId, device.id)
      const pending = pendingUploadPaths.get(pendingUploadKey) ?? []
      pending.push(diskPath)
      pendingUploadPaths.set(pendingUploadKey, pending)
      deps.store.insertMobileChatMessage(
        workspaceId,
        'inbound',
        'user_text',
        JSON.stringify({
          media: { file_id: fileId, filename, mime_type: mimeType, size: dataBuffer.length, url },
          text: `[${filename}]`,
        })
      )
      return {
        file_id: fileId,
        filename,
        mime_type: mimeType,
        ok: true,
        size: dataBuffer.length,
        url,
      }
    }

    if (method === 'command_presets.list') {
      requireCapability(deps.store, deviceId, capabilities, 'admin_runtime')
      return listMobileCommandPresets(deps.store as RuntimeStore)
    }

    if (method === 'worker.create') {
      requireCapability(deps.store, deviceId, capabilities, 'admin_runtime')
      const workspaceId = readStringParam(params, 'workspace_id')
      return createMobileWorker(
        deps.store as RuntimeStore,
        workspaceId,
        params,
        String(deps.runtimeInfo.port ?? '')
      )
    }

    if (method === 'device.register_push_token') {
      requireCapability(deps.store, deviceId, capabilities, 'read_dashboard')
      const pushToken = readStringParam(params, 'push_token')
      deps.store.updateMobilePushToken(deviceId, pushToken)
      return { ok: true }
    }

    if (method === 'voice.transcribe') {
      requireCapability(deps.store, deviceId, capabilities, 'send_prompt')
      const audioBase64 = readStringParam(params, 'audio')
      const format = normalizeMobileAudioFormat(params.format)
      const sttProvider = createLocalSttProvider()
      const cli = await sttProvider.detect()
      if (!cli) return { error: 'stt_unavailable' }
      const audioBuffer = Buffer.from(audioBase64, 'base64')
      const ext = `.${format}`
      const tmpDir = mkdtempSync(join(tmpdir(), 'hive-voice-'))
      const audioPath = join(tmpDir, `voice${ext}`)
      const resolvedTmpDir = resolve(tmpDir)
      const resolvedAudioPath = resolve(audioPath)
      if (!resolvedAudioPath.startsWith(`${resolvedTmpDir}${sep}`)) {
        throw new Error('Resolved audio path escapes temp directory')
      }
      try {
        writeFileSync(audioPath, audioBuffer)
        const result = await sttProvider.transcribeAudioFile(audioPath)
        if (!result) return { error: 'transcription_failed' }
        return { text: result.text }
      } finally {
        rmSync(tmpDir, { force: true, recursive: true })
      }
    }

    throw new Error(`Unknown relay RPC method: ${method}`)
  }
}
