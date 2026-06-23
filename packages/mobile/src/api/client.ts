import type { RelayTransport } from './relay-transport.js'

export const DEFAULT_RUNTIME_HOST = '192.168.110.155:4010'

export interface RuntimeStatus {
  cwd?: string
  db_path?: string
  log_path?: string
  pid?: number
  port?: number
  version?: string
  [key: string]: unknown
}

type FetchLike = typeof fetch

interface RuntimeClientOptions {
  fetchImpl?: FetchLike
  host?: string
  // LAN fetch 超时（毫秒）。4G 下连不通的 LAN 会让裸 fetch 挂几十秒，
  // catch 永不触发 → relay 回落永不发生。超时即 abort → 抛错 → 进 catch 回落 relay。
  lanTimeoutMs?: number
  // relayTransport.connect() 超时（毫秒），防止 WebSocket 既不 open 也不 error 时静默挂死。
  relayConnectTimeoutMs?: number
  // LAN 确认不可达后的 relay-only 冷却窗口（毫秒）。4G 下 LAN 一旦失败，窗口内的请求
  // 直接走 relay、跳过每请求 ~4s 的 LAN 空试；窗口到期后再探一次 LAN，回到 WiFi 即恢复直连优先。
  lanCooldownMs?: number
  relayTransport?: RelayTransport | null
  onDiagnosticsEvent?: (event: RuntimeClientDiagnosticEvent) => void
  token?: string | null
}

export interface RuntimeClientDiagnosticEvent {
  durationMs?: number
  error?: string
  method?: string
  ok: boolean
  path?: string
  status?: string
  ts: number
  type: 'lan_attempt' | 'relay_rpc'
}

export type MobilePromptSource = 'text' | 'voice'

export interface MobileVoiceSynthesisOptions {
  voice?: string
}

export interface MobileDeviceSummary {
  active?: boolean
  capabilities?: string[]
  created_at?: string
  device_type?: string
  id: string
  last_seen_at?: string | null
  name: string
  revoked_at?: string | null
  source?: 'manual'
}

export interface MobileWorkspace {
  id: string
  name: string
  path: string
}

export type MobileCommandPresetRiskTier = 'high' | 'moderate' | 'unknown'
export type MobileCommandPresetUnattended = boolean | 'unknown'

export interface MobileCommandPresetCapabilities {
  features: string[]
  mode: 'cli_agent' | 'unknown' | string
  provider_family: 'claude' | 'codex' | 'custom' | 'gemini' | 'opencode' | string
  risk_tier: MobileCommandPresetRiskTier
  unattended: MobileCommandPresetUnattended
}

export interface MobileCommandPreset {
  available?: boolean
  display_name: string
  id: string
  is_builtin?: boolean
  thinking_levels?: MobileCommandPresetThinkingLevel[]
}

export interface MobileCommandPresetThinkingLevel {
  label: string
  value: string
}

export interface MobileCreateWorkerInput {
  autostart?: boolean
  command_preset_id?: string | null
  description?: string
  name: string
  role: string
  thinking_level?: string | null
}

export interface MobileCreateWorkerResponse {
  agent_start?: { error: string | null; ok: boolean; run_id: string | null }
  name?: string
  ok: boolean
  role?: string
  worker_id?: string
  workspace_id?: string
}

export interface MobileDashboardWorker {
  capabilities?: MobileCommandPresetCapabilities | null
  id: string
  name: string
  preset: string | null
  role: string
  status: 'idle' | 'working' | 'stopped' | string
}

export interface MobileDashboardRun {
  agent_name: string
  id: string
  started_at: string | null
  status: string
}

export interface MobileDashboard {
  cockpit: {
    ai_actions_count: number
    baseline_stale: boolean
    high_ai_actions: number
    open_questions: number
  }
  generated_at: string
  plan: {
    active_milestone: string | null
    current_phase: string | null
  }
  runs: MobileDashboardRun[]
  tasks: {
    total_done: number
    total_open: number
  }
  workers: MobileDashboardWorker[]
  workspace: MobileWorkspace
}

export interface MobileDispatchResponse {
  dispatch_id: string
  ok?: boolean
  pending_task_count?: number
  worker_id?: string
  workspace_id?: string
}

export interface MobilePushTokenResponse {
  ok: true
}

export interface MobileWorkerTranscript {
  lines: string[]
  status: string
  truncated: boolean
  worker_id: string
  worker_name: string
}

export interface MobileWorkspaceTask {
  created_at: string
  id: string
  status: 'pending' | 'done' | 'cancelled'
  task_summary: string
  worker_id?: string
  worker_name: string
}

export interface MobileWorkspaceTasks {
  dispatches: MobileWorkspaceTask[]
  workspace_id: string
}

export interface MobileCockpitMilestone {
  id: string
  title: string
  status: 'shipped' | 'blocked' | 'proposed' | 'open' | 'in_progress'
  date?: string
  items: { text: string; done: boolean }[]
  doneCount: number
  totalCount: number
  progress: number
  body: string
}

export interface MobileCockpitPlan {
  frontmatter: { title?: string; current_phase?: string; [key: string]: string | undefined }
  goal: string | null
  milestones: MobileCockpitMilestone[]
  currentPhase: string | null
}

export interface MobileCockpitQuestion {
  id: string
  text: string
  priority: 'high' | 'medium' | 'low'
  answered?: boolean
  answer?: string
}

export interface MobileCockpitQuestions {
  high: MobileCockpitQuestion[]
  medium: MobileCockpitQuestion[]
  low: MobileCockpitQuestion[]
  answered: MobileCockpitQuestion[]
}

export interface MobileCockpitIdea {
  id: string
  text: string
  addedAt: string | null
  promoted: boolean
}

export interface MobileCockpitIdeas {
  inbox: MobileCockpitIdea[]
  promoted: MobileCockpitIdea[]
}

export interface MobileCockpitAction {
  id: string
  text: string
  action: string
  priority: 'high' | 'medium' | 'low'
  type: string
  targetTab: string
}

// tasks.md sprint 段（与后端 pm-tasks-doc.ts 的 ParsedTasks / PMTaskSection 对齐，
// cockpit endpoint 直接发 cockpit.tasks，web TasksTab 用同一结构渲染）。
export interface MobileTaskItem {
  done: boolean
  raw: string
  text: string
}

export interface MobileTaskSubsection {
  doneCount: number
  openCount: number
  title: string
  totalCount: number
  items: MobileTaskItem[]
}

export interface MobileTaskSection {
  doneCount: number
  key: 'in_progress' | 'open' | 'done' | 'other'
  openCount: number
  subsections: MobileTaskSubsection[]
  title: string
  totalCount: number
  items: MobileTaskItem[]
}

export interface MobileCockpitTasks {
  parseError?: string | null
  sections: MobileTaskSection[]
  totalDone: number
  totalOpen: number
}

export interface MobileCockpitData {
  aiActions: MobileCockpitAction[]
  ideas: MobileCockpitIdeas
  plan: MobileCockpitPlan
  questions: MobileCockpitQuestions
  tasks: MobileCockpitTasks
}

export interface MobileRelayConfig {
  daemon_public_key: string
  daemon_signing_public_key?: string
  relay_auth_token?: string
  relay_protocol_version?: 1 | 2
  relay_url: string
  room_auth_token?: string
  room_id: string
}

export interface ChatMessage {
  id: string
  direction: 'inbound' | 'outbound'
  message_type: 'user_text' | 'orch_reply' | 'worker_report' | 'approval_request' | 'system_event'
  content_json: string
  created_at: number
}

export interface ChatMessagesResponse {
  messages: ChatMessage[]
}

export type MobileConnectionMode = 'disconnected' | 'lan' | 'relay'

export const normalizeRuntimeHost = (host: string) => {
  const trimmed = host.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `http://${trimmed || DEFAULT_RUNTIME_HOST}`
}

export const createRuntimeClient = ({
  fetchImpl = fetch,
  host = DEFAULT_RUNTIME_HOST,
  lanCooldownMs = 30_000,
  lanTimeoutMs = 4000,
  onDiagnosticsEvent,
  relayConnectTimeoutMs = 8000,
  relayTransport = null,
  token = null,
}: RuntimeClientOptions = {}) => {
  const baseUrl = normalizeRuntimeHost(host)
  const modeListeners = new Set<(mode: string) => void>()
  let mode: MobileConnectionMode = 'disconnected'
  // LAN 不可达冷却到期时间戳（0 = 不冷却，正常 LAN 优先）。
  let lanCooldownUntil = 0

  const setMode = (nextMode: MobileConnectionMode) => {
    if (mode === nextMode) return
    mode = nextMode
    for (const listener of modeListeners) listener(nextMode)
  }

  const jsonHeaders = (auth = false, hasBody = false) => {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (hasBody) headers['Content-Type'] = 'application/json'
    if (auth) {
      if (!token) throw new Error('Mobile token is required')
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }

  const readJson = async <T>(
    path: string,
    auth = false,
    init: { body?: unknown; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' } = {}
  ): Promise<T> => {
    const hasBody = init.body !== undefined
    // 给 LAN fetch 套 AbortController 超时：连不通的 LAN（如 4G 下的 192.168.x）
    // 不会再无限 hang，超时即 abort → 抛 AbortError → readMobileJson 的 catch 回落 relay。
    const controller = new AbortController()
    const startedAt = Date.now()
    const timer = setTimeout(() => controller.abort(), lanTimeoutMs)
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        headers: jsonHeaders(auth, hasBody),
        signal: controller.signal,
        ...(init.method === undefined ? {} : { method: init.method }),
      })
      if (!response.ok) {
        let serverMessage = ''
        try {
          const body = (await response.json()) as { error?: string }
          if (body.error) serverMessage = body.error
        } catch {}
        throw new Error(serverMessage || `${path} failed: HTTP ${response.status}`)
      }
      const result = (await response.json()) as T
      onDiagnosticsEvent?.({
        durationMs: Date.now() - startedAt,
        ok: true,
        path,
        ts: Date.now(),
        type: 'lan_attempt',
      })
      return result
    } catch (error) {
      onDiagnosticsEvent?.({
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        path,
        ts: Date.now(),
        type: 'lan_attempt',
      })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  const connectRelay = async (transport: RelayTransport): Promise<void> => {
    // connect() 失败必须抛错（别静默挂死）：套一层超时，WebSocket 若既不 open
    // 也不 error，到点 reject，relayCall 抛错上抛 → 上层进 error 态而非永久卡住。
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Relay connect timed out')), relayConnectTimeoutMs)
    })
    try {
      await Promise.race([transport.connect(), timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const relayCall = async <T>(method: string, params?: unknown): Promise<T> => {
    if (!relayTransport) throw new Error('Relay transport is not configured')
    try {
      if (relayTransport.status() !== 'ready') await connectRelay(relayTransport)
      setMode('relay')
      const result =
        params === undefined
          ? await relayTransport.call<T>(method)
          : await relayTransport.call<T>(method, params)
      onDiagnosticsEvent?.({
        method,
        ok: true,
        status: relayTransport.status(),
        ts: Date.now(),
        type: 'relay_rpc',
      })
      return result
    } catch (error) {
      onDiagnosticsEvent?.({
        error: error instanceof Error ? error.message : String(error),
        method,
        ok: false,
        status: relayTransport.status(),
        ts: Date.now(),
        type: 'relay_rpc',
      })
      throw error
    }
  }

  const readMobileJson = async <T>(
    path: string,
    relayMethod: string,
    relayParams?: unknown,
    init: { body?: unknown; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' } = {}
  ): Promise<T> => {
    // relay-only 冷却窗口内（LAN 刚确认不可达）直接走 relay，跳过每请求 ~4s 的 LAN 空试，
    // 也不再每请求闪"连接中"。窗口外仍 LAN 优先（在家 WiFi 直连快）。
    if (relayTransport !== null && lanCooldownUntil > Date.now()) {
      return relayCall<T>(relayMethod, relayParams)
    }
    try {
      const result = await readJson<T>(path, true, init)
      setMode('lan')
      lanCooldownUntil = 0 // LAN 成功 → 解除冷却，恢复 LAN 优先
      return result
    } catch (error) {
      if (!relayTransport) throw error
      // LAN 确认不可达 → 开冷却窗口，后续请求在窗口内跳过 LAN 直接走 relay。
      lanCooldownUntil = Date.now() + lanCooldownMs
      return relayCall<T>(relayMethod, relayParams)
    }
  }

  return {
    async getRuntimeStatus(): Promise<RuntimeStatus> {
      return readJson<RuntimeStatus>('/api/runtime/status')
    },
    async getMobileRuntimeStatus(): Promise<RuntimeStatus> {
      return readMobileJson<RuntimeStatus>('/api/mobile/runtime/status', 'runtime.status')
    },
    async listMobileWorkspaces(): Promise<MobileWorkspace[]> {
      return readMobileJson<MobileWorkspace[]>('/api/mobile/workspaces', 'workspaces.list')
    },
    async getMobileDashboard(workspaceId: string): Promise<MobileDashboard> {
      return readMobileJson<MobileDashboard>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/dashboard`,
        'workspace.dashboard.get',
        { workspace_id: workspaceId }
      )
    },
    async getWorkerTranscript(
      workspaceId: string,
      workerId: string
    ): Promise<MobileWorkerTranscript> {
      return readMobileJson<MobileWorkerTranscript>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/workers/${encodeURIComponent(workerId)}/transcript`,
        'worker.transcript',
        { worker_id: workerId, workspace_id: workspaceId }
      )
    },
    async getWorkspaceTasks(workspaceId: string): Promise<MobileWorkspaceTasks> {
      return readMobileJson<MobileWorkspaceTasks>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/tasks`,
        'workspace.tasks',
        { workspace_id: workspaceId }
      )
    },
    async getCockpit(workspaceId: string): Promise<MobileCockpitData> {
      return readMobileJson<MobileCockpitData>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/cockpit`,
        'workspace.cockpit',
        { workspace_id: workspaceId }
      )
    },
    async answerQuestion(
      workspaceId: string,
      questionId: string,
      answer: string
    ): Promise<{ ok: boolean }> {
      return readMobileJson<{ ok: boolean }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/cockpit/questions/${encodeURIComponent(questionId)}/answer`,
        'workspace.cockpit.question.answer',
        { answer, question_id: questionId, workspace_id: workspaceId },
        {
          body: { answer },
          method: 'POST',
        }
      )
    },
    async stopWorker(workspaceId: string, workerId: string): Promise<void> {
      await readMobileJson<{ ok: true }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/workers/${encodeURIComponent(workerId)}/stop`,
        'worker.stop',
        { worker_id: workerId, workspace_id: workspaceId },
        { method: 'POST' }
      )
    },
    async restartWorker(workspaceId: string, workerId: string): Promise<void> {
      await readMobileJson<{ ok: true }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/workers/${encodeURIComponent(workerId)}/restart`,
        'worker.restart',
        { worker_id: workerId, workspace_id: workspaceId },
        { method: 'POST' }
      )
    },
    async listCommandPresets(): Promise<MobileCommandPreset[]> {
      return readMobileJson<MobileCommandPreset[]>(
        '/api/mobile/command-presets',
        'command_presets.list'
      )
    },
    async createWorker(
      workspaceId: string,
      input: MobileCreateWorkerInput
    ): Promise<MobileCreateWorkerResponse> {
      return readMobileJson<MobileCreateWorkerResponse>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/workers`,
        'worker.create',
        { workspace_id: workspaceId, ...input },
        { body: input, method: 'POST' }
      )
    },
    async dispatchTask(
      workspaceId: string,
      workerId: string,
      task: string
    ): Promise<MobileDispatchResponse> {
      return readMobileJson<MobileDispatchResponse>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/dispatch`,
        'workspace.dispatch',
        { task, worker_id: workerId, workspace_id: workspaceId },
        {
          body: { task, worker_id: workerId },
          method: 'POST',
        }
      )
    },
    async transcribeVoice(audioBase64: string, format = 'm4a'): Promise<{ text: string }> {
      return readMobileJson<{ text: string }>(
        '/api/mobile/voice/transcribe',
        'voice.transcribe',
        { audio: audioBase64, format },
        {
          body: { audio: audioBase64, format },
          method: 'POST',
        }
      )
    },
    async synthesizeVoice(
      text: string,
      options: MobileVoiceSynthesisOptions = {}
    ): Promise<{ audio: string; format: string; mime: string } | { error: string }> {
      const body = options.voice ? { text, voice: options.voice } : { text }
      return readMobileJson<{ audio: string; format: string; mime: string } | { error: string }>(
        '/api/mobile/voice/synthesize',
        'voice.synthesize',
        body,
        {
          body,
          method: 'POST',
        }
      )
    },
    async sendPromptToOrchestrator(
      workspaceId: string,
      text: string,
      options: { source?: MobilePromptSource } = {}
    ): Promise<{ ok: boolean }> {
      const relayParams = options.source
        ? { source: options.source, text, workspace_id: workspaceId }
        : { text, workspace_id: workspaceId }
      const body = options.source ? { source: options.source, text } : { text }
      return readMobileJson<{ ok: boolean }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/prompt`,
        'workspace.prompt',
        relayParams,
        {
          body,
          method: 'POST',
        }
      )
    },
    async registerPushToken(pushToken: string): Promise<MobilePushTokenResponse> {
      return readMobileJson<MobilePushTokenResponse>(
        '/api/mobile/push-token',
        'device.register_push_token',
        { push_token: pushToken },
        {
          body: { push_token: pushToken },
          method: 'POST',
        }
      )
    },
    async getChatMessages(
      workspaceId: string,
      since?: number,
      limit = 50
    ): Promise<ChatMessagesResponse> {
      const params = new URLSearchParams({ limit: String(limit) })
      if (since !== undefined) params.set('since', String(since))
      return readMobileJson<ChatMessagesResponse>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/chat/messages?${params}`,
        'workspace.chat.messages',
        { limit, since, workspace_id: workspaceId }
      )
    },
    async uploadMedia(
      workspaceId: string,
      data: string,
      filename: string,
      mimeType: string
    ): Promise<{ file_id: string; url: string; ok: boolean }> {
      return readMobileJson<{ file_id: string; url: string; ok: boolean }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/upload`,
        'workspace.upload',
        { data, filename, mime_type: mimeType, workspace_id: workspaceId },
        {
          body: { data, filename, mime_type: mimeType },
          method: 'POST',
        }
      )
    },
    async approveRequest(
      workspaceId: string,
      approvalId: string,
      decision: 'allow' | 'deny'
    ): Promise<{ ok: boolean }> {
      return readMobileJson<{ ok: boolean }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/approve/${encodeURIComponent(approvalId)}`,
        'workspace.approve',
        { approval_id: approvalId, decision, workspace_id: workspaceId },
        { body: { decision }, method: 'POST' }
      )
    },
    connectionMode() {
      return mode
    },
    // 强制下次 readMobileJson 立即重探 LAN（context 可在网络变化 / 回前台时调，
    // 比等冷却自然到期更快恢复 WiFi 直连优先）。
    resetLanCooldown() {
      lanCooldownUntil = 0
    },
    // 手动偏向 relay，直到用户再次点 LAN 重置；这样切回中继不会过一会儿自己弹回 LAN。
    preferRelayUntilReset() {
      lanCooldownUntil = Number.POSITIVE_INFINITY
    },
    onConnectionModeChange(cb: (mode: string) => void) {
      modeListeners.add(cb)
      return () => modeListeners.delete(cb)
    },
    buildWebSocketUrl(path: string) {
      const url = new URL(path, `${baseUrl}/`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return url.toString()
    },
    buildMobileDashboardWebSocketUrl(workspaceId: string) {
      if (!token) throw new Error('Mobile token is required')
      const path = `/ws/mobile/workspaces/${encodeURIComponent(workspaceId)}/dashboard`
      const url = new URL(path, `${baseUrl}/`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('token', token)
      return url.toString()
    },
  }
}
