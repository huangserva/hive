import type {
  AgentSummary,
  CommandPresetCapabilities,
  CommandPresetCapabilitiesPayload,
  TeamListItem,
  TeamListItemPayload,
  WorkerRole,
  WorkspaceSummary,
} from '../../src/shared/types.js'

export type {
  AIAction,
  AIActionType,
  CockpitTargetTab,
  ParsedCockpit,
} from '../../src/server/cockpit-doc.js'
export type { ArchivedMonth, ParsedArchive } from '../../src/server/pm-archive-doc.js'
export type { BaselineFile, ParsedBaseline } from '../../src/server/pm-baseline-doc.js'
export type {
  ParsedDecisions,
  PMDecision,
  PMDecisionStatus,
} from '../../src/server/pm-decisions-doc.js'
export type { ParsedIdeas, PMIdea } from '../../src/server/pm-ideas-doc.js'
export type {
  ParsedQuestions,
  PMQuestion,
  PMQuestionPriority,
} from '../../src/server/pm-questions-doc.js'
export type { ParsedReports, PMReportEntry } from '../../src/server/pm-reports-doc.js'
export type { ParsedResearch, PMResearchEntry } from '../../src/server/pm-research-doc.js'
export type {
  ParsedTasks,
  PMTaskItem,
  PMTaskSection,
  PMTaskSubsection,
  PMTasksSectionKey,
} from '../../src/server/pm-tasks-doc.js'

import type { ParsedCockpit } from '../../src/server/cockpit-doc.js'
import {
  createReconnectingWebSocket,
  type ReconnectingWebSocket,
} from './reconnecting-websocket.js'

const fromPayload = (payload: TeamListItemPayload): TeamListItem => ({
  id: payload.id,
  name: payload.name,
  ...(payload.description ? { description: payload.description } : {}),
  role: payload.role,
  status: payload.status,
  pendingTaskCount: payload.pending_task_count,
  workflowAllowed: payload.workflow_allowed,
  ...(payload.last_pty_line ? { lastPtyLine: payload.last_pty_line } : {}),
  ...(payload.command_preset_id ? { commandPresetId: payload.command_preset_id } : {}),
  ...(payload.capabilities
    ? {
        capabilities: {
          features: payload.capabilities.features,
          mode: payload.capabilities.mode,
          providerFamily: payload.capabilities.provider_family,
          riskTier: payload.capabilities.risk_tier,
          unattended: payload.capabilities.unattended,
        },
      }
    : {}),
  ...(payload.thinking_level ? { thinkingLevel: payload.thinking_level } : {}),
  ...(payload.sentinel_interval_ms !== null
    ? { sentinelIntervalMs: payload.sentinel_interval_ms }
    : {}),
})

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Keep the original fallback when the server did not send a JSON error body.
  }
  return fallback
}

const isStaleUiSession = async (response: Response): Promise<boolean> => {
  if (response.status !== 403) return false
  try {
    const body = (await response.clone().json()) as { error?: unknown }
    return body.error === 'UI endpoint requires valid UI token'
  } catch {
    return false
  }
}

export const initializeUiSession = async (): Promise<void> => {
  const response = await fetch('/api/ui/session', { mode: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to initialize UI session'))
  }
  await response.json()
}

const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await fetch(input, init)
  if (!(await isStaleUiSession(response))) return response

  await initializeUiSession()
  return fetch(input, init)
}

export const listWorkspaces = async (): Promise<WorkspaceSummary[]> => {
  const response = await apiFetch('/api/workspaces')

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load workspaces'))
  }

  return (await response.json()) as WorkspaceSummary[]
}

export interface DashboardWorkspace {
  id: string
  name: string
  cwd: string
  workerCount: number
  activeWorkerCount: number
  recentDispatchCount: number
  openDispatchCount: number
  lastActivityAt: number | null
}

export const fetchDashboard = async (): Promise<DashboardWorkspace[]> => {
  const response = await apiFetch('/api/ui/dashboard')

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load dashboard'))
  }

  return (await response.json()) as DashboardWorkspace[]
}

export interface VersionInfo {
  currentVersion: string
  installHint: string
  latestVersion: string
  packageName: string
  releaseUrl: string
  updateAvailable: boolean
}

interface VersionInfoPayload {
  current_version: string
  install_hint: string
  latest_version: string
  package_name: string
  release_url: string
  update_available: boolean
}

export const getVersionInfo = async (): Promise<VersionInfo> => {
  const response = await apiFetch('/api/version')

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load version info'))
  }

  const payload = (await response.json()) as VersionInfoPayload
  return {
    currentVersion: payload.current_version,
    installHint: payload.install_hint,
    latestVersion: payload.latest_version,
    packageName: payload.package_name,
    releaseUrl: payload.release_url,
    updateAvailable: payload.update_available,
  }
}

export interface OrchestratorStartResult {
  ok: boolean
  error: string | null
  run_id: string | null
}

export interface CommandPreset {
  args: string[]
  available: boolean
  capabilities: CommandPresetCapabilities | null
  command: string
  displayName: string
  id: string
  thinkingLevels?: ThinkingLevelOption[]
}

export interface ThinkingLevelOption {
  label: string
  value: string
}

export interface RoleTemplate {
  defaultArgs: string[]
  defaultCommand: string
  defaultEnv: Record<string, string>
  description: string
  id: string
  isBuiltin: boolean
  name: string
  roleType: WorkerRole | 'orchestrator'
}

export type FeishuTransportStatusValue = 'disabled' | 'connected' | 'disconnected' | 'error'

export interface FeishuTransportStatus {
  appId?: string
  reconnectCount?: number
  status: FeishuTransportStatusValue
}

export interface FeishuBinding {
  chatId: string
  chatName: string | null
  createdAt: number
  enabled: boolean
  id: string
  workspaceId: string
}

export type DispatchState = 'queued' | 'submitted' | 'reported' | 'cancelled'

export interface WorkspaceDispatch {
  artifacts: string[]
  createdAt: number
  deliveredAt: number | null
  fromAgentId: string | null
  id: string
  reportedAt: number | null
  reportText: string | null
  state: DispatchState
  submittedAt: number | null
  text: string
  toAgentId: string
  workspaceId: string
}

interface WorkspaceDispatchPayload {
  artifacts: string[]
  created_at: number
  delivered_at: number | null
  from_agent_id: string | null
  id: string
  reported_at: number | null
  report_text: string | null
  state: DispatchState
  submitted_at: number | null
  text: string
  to_agent_id: string
  workspace_id: string
}

export type PlanMilestoneStatus = 'shipped' | 'blocked' | 'proposed' | 'open' | 'in_progress'

export interface ParsedMilestone {
  body: string
  date?: string
  doneCount: number
  id: string
  items: { done: boolean; text: string }[]
  progress: number
  status: PlanMilestoneStatus
  title: string
  totalCount: number
}

export interface ParsedPlan {
  currentPhase: string | null
  frontmatter: {
    title?: string
    started?: string
    current_phase?: string
    status?: string
    last_review?: string
    [key: string]: string | undefined
  }
  goal: string | null
  milestones: ParsedMilestone[]
  parseError: string | null
  raw: string
  risks: string[]
  scope: { in: string[]; out: string[] } | null
}

interface CommandPresetPayload {
  args: string[]
  available: boolean
  capabilities: CommandPresetCapabilitiesPayload | null
  command: string
  display_name: string
  id: string
  thinking_levels?: ThinkingLevelOption[]
}

interface RoleTemplatePayload {
  default_args: string[]
  default_command: string
  default_env: Record<string, string>
  description: string
  id: string
  is_builtin: boolean
  name: string
  role_type: WorkerRole | 'orchestrator'
}

export interface AgentStartResult {
  error: string | null
  ok: boolean
  runId: string | null
}

interface AgentStartPayload {
  error: string | null
  ok: boolean
  run_id: string | null
}

export interface CreateWorkerResult {
  agentStart: AgentStartResult
  worker: TeamListItem
}

type CreateWorkerPayload = TeamListItemPayload & { agent_start?: AgentStartPayload }

export interface CreateWorkspaceResponse extends WorkspaceSummary {
  orchestrator_start: OrchestratorStartResult
}

export const createWorkspace = async (input: {
  name: string
  path: string
  autostart_orchestrator?: boolean
  command_preset_id?: string | null
  startup_command?: string | null
}): Promise<CreateWorkspaceResponse> => {
  const response = await apiFetch('/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create workspace'))
  }

  return (await response.json()) as CreateWorkspaceResponse
}

export const deleteWorkspace = async (workspaceId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete workspace'))
  }
}

export const startAgentRun = async (
  workspaceId: string,
  agentId: string
): Promise<{ runId: string }> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/agents/${agentId}/start`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to start agent run'))
  }
  const body = (await response.json()) as { run_id: string }
  return { runId: body.run_id }
}

export const stopAgentRun = async (runId: string): Promise<void> => {
  const response = await apiFetch(`/api/runtime/runs/${runId}/stop`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to stop agent run'))
  }
}

export const restartAgentRun = async (
  workspaceId: string,
  agentId: string,
  runId: string
): Promise<{ runId: string }> => {
  // Best-effort stop: a 404 here often means the run already exited on its
  // own; either way we proceed to start a fresh one. Swallowed errors land in
  // the dev console for diagnosis.
  await stopAgentRun(runId).catch((error: unknown) => {
    console.error('[hive] swallowed:restartAgentRun.stop', error)
  })
  return startAgentRun(workspaceId, agentId)
}

export const getActiveWorkspaceId = async (): Promise<string | null> => {
  const response = await apiFetch('/api/settings/app-state/active_workspace_id')

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load active workspace'))
  }

  const payload = (await response.json()) as { key: string; value: string | null }
  return payload.value
}

export const saveActiveWorkspaceId = async (workspaceId: string | null): Promise<void> => {
  const response = await apiFetch('/api/settings/app-state/active_workspace_id', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: workspaceId }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to save active workspace'))
  }
}

export const listWorkers = async (workspaceId: string): Promise<TeamListItem[]> => {
  const response = await apiFetch(`/api/ui/workspaces/${workspaceId}/team`, {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load workers'))
  }

  const payload = (await response.json()) as TeamListItemPayload[]
  return payload.map(fromPayload)
}

const fromDispatchPayload = (payload: WorkspaceDispatchPayload): WorkspaceDispatch => ({
  artifacts: payload.artifacts,
  createdAt: payload.created_at,
  deliveredAt: payload.delivered_at,
  fromAgentId: payload.from_agent_id,
  id: payload.id,
  reportedAt: payload.reported_at,
  reportText: payload.report_text,
  state: payload.state,
  submittedAt: payload.submitted_at,
  text: payload.text,
  toAgentId: payload.to_agent_id,
  workspaceId: payload.workspace_id,
})

export const listWorkspaceDispatches = async (
  workspaceId: string,
  options: { limit?: number; offset?: number; state?: DispatchState } = {}
): Promise<WorkspaceDispatch[]> => {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.state) params.set('state', options.state)
  const query = params.size ? `?${params.toString()}` : ''
  const response = await apiFetch(`/api/ui/workspaces/${workspaceId}/dispatches${query}`, {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load dispatches'))
  }

  const payload = (await response.json()) as WorkspaceDispatchPayload[]
  return payload.map(fromDispatchPayload)
}

export const fetchFeishuTransportStatus = async (): Promise<FeishuTransportStatus> => {
  const response = await apiFetch('/api/feishu/transport-status', { mode: 'same-origin' })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load Feishu status'))
  }

  return (await response.json()) as FeishuTransportStatus
}

export const listFeishuBindings = async (workspaceId?: string): Promise<FeishuBinding[]> => {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const response = await apiFetch(`/api/feishu/bindings${query}`, { mode: 'same-origin' })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load Feishu bindings'))
  }

  return (await response.json()) as FeishuBinding[]
}

export const bindFeishuChat = async (input: {
  chatId: string
  chatName?: string | null
  workspaceId: string
}): Promise<FeishuBinding> => {
  const response = await apiFetch('/api/feishu/bindings', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to bind Feishu chat'))
  }

  return (await response.json()) as FeishuBinding
}

export const unbindFeishuChat = async (chatId: string): Promise<{ deleted: boolean }> => {
  const response = await apiFetch(`/api/feishu/bindings/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to unbind Feishu chat'))
  }

  return (await response.json()) as { deleted: boolean }
}

export const listCommandPresets = async (): Promise<CommandPreset[]> => {
  const response = await apiFetch('/api/settings/command-presets')

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load command presets'))
  }

  return ((await response.json()) as CommandPresetPayload[]).map((preset) => ({
    args: preset.args,
    available: preset.available,
    capabilities: preset.capabilities
      ? {
          features: preset.capabilities.features,
          mode: preset.capabilities.mode,
          providerFamily: preset.capabilities.provider_family,
          riskTier: preset.capabilities.risk_tier,
          unattended: preset.capabilities.unattended,
        }
      : null,
    command: preset.command,
    displayName: preset.display_name,
    id: preset.id,
    thinkingLevels: preset.thinking_levels ?? [],
  }))
}

export interface TerminalRunSummary {
  agent_id: string
  agent_name: string
  run_id: string
  status: string
  terminal_input_profile: TerminalInputProfile
}

export type TerminalInputProfile = 'default' | 'opencode'

export const workspaceShellAgentId = (workspaceId: string): string => `${workspaceId}:shell`

export const isWorkspaceShellRun = (run: TerminalRunSummary, workspaceId: string): boolean =>
  run.agent_id === workspaceShellAgentId(workspaceId)

export const startWorkspaceShell = async (workspaceId: string): Promise<TerminalRunSummary> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/shell/start`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to start workspace terminal'))
  }

  return (await response.json()) as TerminalRunSummary
}

export const closeWorkspaceShell = async (workspaceId: string, runId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/shell/${runId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to close workspace terminal'))
  }
}

export const listRoleTemplates = async (): Promise<RoleTemplate[]> => {
  const response = await apiFetch('/api/settings/role-templates', {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load role templates'))
  }

  const payload = (await response.json()) as RoleTemplatePayload[]
  return payload.map((template) => ({
    defaultArgs: template.default_args,
    defaultCommand: template.default_command,
    defaultEnv: template.default_env,
    description: template.description,
    id: template.id,
    isBuiltin: template.is_builtin,
    name: template.name,
    roleType: template.role_type,
  }))
}

export const listTerminalRuns = async (workspaceId: string): Promise<TerminalRunSummary[]> => {
  const response = await apiFetch(`/api/ui/workspaces/${workspaceId}/runs`, {
    mode: 'same-origin',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load terminal runs'))
  }

  return (await response.json()) as TerminalRunSummary[]
}

export const createWorker = async (
  workspaceId: string,
  input: Pick<AgentSummary, 'name'> & {
    autostart?: boolean
    command_preset_id?: string | null
    description?: string
    role: WorkerRole
    role_template_id?: string | null
    startup_command?: string | null
    thinking_level?: string | null
  }
): Promise<CreateWorkerResult> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to create worker'))
  }

  const payload = (await response.json()) as CreateWorkerPayload
  return {
    agentStart: {
      error: payload.agent_start?.error ?? null,
      ok: payload.agent_start?.ok ?? false,
      runId: payload.agent_start?.run_id ?? null,
    },
    worker: fromPayload(payload),
  }
}

export const deleteWorker = async (workspaceId: string, workerId: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workers/${workerId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to delete worker'))
  }
}

export const updateWorker = async (
  workspaceId: string,
  workerId: string,
  patch: {
    command_preset_id?: string
    description?: string
    name?: string
    sentinel_interval_ms?: number
    thinking_level?: string | null
  }
): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/workers/${workerId}`, {
    body: JSON.stringify(patch),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to update worker'))
  }
}

export const renameWorker = async (
  workspaceId: string,
  workerId: string,
  name: string
): Promise<void> => updateWorker(workspaceId, workerId, { name })

export const getWorkspaceTasks = async (workspaceId: string): Promise<{ content: string }> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/tasks`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load tasks'))
  }

  return (await response.json()) as { content: string }
}

export const fetchPlan = async (workspaceId: string): Promise<ParsedPlan> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/plan`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load plan'))
  }

  return (await response.json()) as ParsedPlan
}

export const fetchCockpit = async (workspaceId: string): Promise<ParsedCockpit> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/cockpit`)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load cockpit'))
  }

  return (await response.json()) as ParsedCockpit
}

export const answerCockpitQuestion = async (
  workspaceId: string,
  questionId: string,
  answer: string
): Promise<void> => {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/cockpit/questions/${encodeURIComponent(questionId)}/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer }),
    }
  )

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to answer question'))
  }
}

export type PromoteIdeaTarget = 'adr' | 'plan' | 'question'

export const promoteCockpitIdea = async (
  workspaceId: string,
  ideaId: string,
  target: PromoteIdeaTarget
): Promise<void> => {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/cockpit/ideas/${encodeURIComponent(ideaId)}/promote`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    }
  )

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to promote idea'))
  }
}

export const confirmCockpitDecision = async (
  workspaceId: string,
  decisionId: string
): Promise<void> => {
  const response = await apiFetch(
    `/api/workspaces/${workspaceId}/cockpit/decisions/${encodeURIComponent(decisionId)}/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }
  )

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to confirm decision'))
  }
}

export const openWorkspaceFile = async (workspaceId: string, path: string): Promise<void> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/open-file`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to open file'))
  }
}

const toWorkspaceSocketUrl = (path: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

export const connectPlanStream = (
  workspaceId: string,
  onUpdate: (plan: ParsedPlan) => void
): ReconnectingWebSocket => {
  return createReconnectingWebSocket(toWorkspaceSocketUrl(`/ws/plan/${workspaceId}`), {
    onMessage(event) {
      const payload = JSON.parse(event.data) as { plan?: ParsedPlan; type: string }
      if ((payload.type === 'plan-snapshot' || payload.type === 'plan-updated') && payload.plan) {
        onUpdate(payload.plan)
      }
    },
  })
}

export const connectCockpitStream = (
  workspaceId: string,
  onUpdate: (cockpit: ParsedCockpit) => void
): { close: () => void } => {
  const socket = createReconnectingWebSocket(toWorkspaceSocketUrl(`/ws/cockpit/${workspaceId}`), {
    onMessage(event) {
      const message = JSON.parse(event.data) as { kind?: string; payload?: ParsedCockpit }
      if (
        (message.kind === 'cockpit-snapshot' || message.kind === 'cockpit-update') &&
        message.payload
      ) {
        onUpdate(message.payload)
      }
    },
  })
  return { close: () => socket.close() }
}

export const saveWorkspaceTasks = async (
  workspaceId: string,
  input: { content: string }
): Promise<{ content: string }> => {
  const response = await apiFetch(`/api/workspaces/${workspaceId}/tasks`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to save tasks'))
  }

  return (await response.json()) as { content: string }
}

export interface FsBrowseEntryPayload {
  is_dir: true
  is_git_repository: boolean
  name: string
  path: string
}

export interface FsBrowseResponse {
  current_path: string
  entries: FsBrowseEntryPayload[]
  error: string | null
  ok: boolean
  parent_path: string | null
  root_path: string
}

export interface FsProbeResponse {
  current_branch: string | null
  exists: boolean
  is_dir: boolean
  is_git_repository: boolean
  ok: boolean
  path: string
  suggested_name: string
}

export const browseFs = async (path: string): Promise<FsBrowseResponse> => {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  const response = await apiFetch(`/api/fs/browse${query}`, { mode: 'same-origin' })
  const body = (await response.json()) as FsBrowseResponse
  return body
}

export const probeFs = async (path: string): Promise<FsProbeResponse> => {
  const response = await apiFetch(`/api/fs/probe?path=${encodeURIComponent(path)}`, {
    mode: 'same-origin',
  })
  return (await response.json()) as FsProbeResponse
}

export type MobileCapability =
  | 'read_dashboard'
  | 'read_terminal'
  | 'send_prompt'
  | 'approve_risk'
  | 'admin_runtime'

export interface MobileDevice {
  active: boolean
  capabilities: MobileCapability[]
  created_at: string
  device_type: string | null
  id: string
  last_seen_at: string | null
  name: string
  revoked_at: string | null
  source: 'manual'
}

export interface MobileTokenCreated {
  device_id: string
  token: string
}

export interface MobileDeviceToken {
  device: MobileDevice
  token: string
}

export const createMobileToken = async (
  name: string,
  capabilities: MobileCapability[]
): Promise<MobileTokenCreated> => {
  const response = await apiFetch('/api/mobile/tokens', {
    body: JSON.stringify({ capabilities, name }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to create token'))
  return (await response.json()) as MobileTokenCreated
}

export const listMobileDevices = async (): Promise<MobileDevice[]> => {
  const response = await apiFetch('/api/mobile/tokens')
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load devices'))
  const body = (await response.json()) as { tokens: MobileDevice[] }
  return body.tokens
}

export const getMobileDeviceToken = async (deviceId: string): Promise<MobileDeviceToken> => {
  const response = await apiFetch(`/api/mobile/tokens/${encodeURIComponent(deviceId)}`)
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to load device token'))
  return (await response.json()) as MobileDeviceToken
}

export type RelayConnectionInfo =
  | { enabled: false }
  | {
      daemon_public_key: string
      enabled: true
      relay_auth_token: string
      relay_url: string
      room_id: string
    }

export const getRelayConnectionInfo = async (): Promise<RelayConnectionInfo> => {
  const response = await apiFetch('/api/relay/connection-info')
  if (!response.ok)
    throw new Error(await readErrorMessage(response, 'Failed to load relay connection info'))
  return (await response.json()) as RelayConnectionInfo
}

export const updateMobileDevice = async (
  deviceId: string,
  patch: { capabilities?: MobileCapability[]; name?: string }
): Promise<MobileDevice> => {
  const response = await apiFetch(`/api/mobile/tokens/${encodeURIComponent(deviceId)}`, {
    body: JSON.stringify(patch),
    headers: { 'content-type': 'application/json' },
    method: 'PATCH',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to update device'))
  const body = (await response.json()) as { token: MobileDevice }
  return body.token
}

export const revokeMobileDevice = async (deviceId: string): Promise<void> => {
  const response = await apiFetch(`/api/mobile/tokens/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Failed to delete token'))
}

export interface PickFolderResponse {
  canceled: boolean
  error: string | null
  path: string | null
  probe: FsProbeResponse | null
  supported: boolean
}

export const pickFolder = async (): Promise<PickFolderResponse> => {
  const response = await apiFetch('/api/fs/pick-folder', {
    method: 'POST',
    mode: 'same-origin',
  })
  return (await response.json()) as PickFolderResponse
}
