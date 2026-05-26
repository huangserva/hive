export const DEFAULT_RUNTIME_HOST = '192.168.1.100:4010'

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
  token?: string | null
}

export interface MobilePairResponse {
  host: string
  port: number
  token: string
}

export interface MobileDeviceSummary {
  capabilities?: string[]
  created_at?: string
  device_type?: string
  id: string
  last_seen_at?: string | null
  name: string
  revoked_at?: string | null
}

export interface MobilePairRedeemResponse {
  device: MobileDeviceSummary
  expires_after_inactive_days?: number
  token: string
}

export interface MobileWorkspace {
  id: string
  name: string
  path: string
}

export interface MobileDashboardWorker {
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

export const normalizeRuntimeHost = (host: string) => {
  const trimmed = host.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `http://${trimmed || DEFAULT_RUNTIME_HOST}`
}

export const createRuntimeClient = ({
  fetchImpl = fetch,
  host = DEFAULT_RUNTIME_HOST,
  token = null,
}: RuntimeClientOptions = {}) => {
  const baseUrl = normalizeRuntimeHost(host)
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
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: jsonHeaders(auth, hasBody),
      ...(init.method === undefined ? {} : { method: init.method }),
    })
    if (!response.ok) {
      throw new Error(`${path} failed: HTTP ${response.status}`)
    }
    return (await response.json()) as T
  }

  return {
    async pairMobile(): Promise<MobilePairResponse> {
      return readJson<MobilePairResponse>('/api/mobile/pair')
    },
    async redeemPairingCode(code: string): Promise<MobilePairRedeemResponse> {
      return readJson<MobilePairRedeemResponse>('/api/mobile/pair/redeem', false, {
        body: { code },
        method: 'POST',
      })
    },
    async getRuntimeStatus(): Promise<RuntimeStatus> {
      return readJson<RuntimeStatus>('/api/runtime/status')
    },
    async getMobileRuntimeStatus(): Promise<RuntimeStatus> {
      return readJson<RuntimeStatus>('/api/mobile/runtime/status', true)
    },
    async listMobileWorkspaces(): Promise<MobileWorkspace[]> {
      return readJson<MobileWorkspace[]>('/api/mobile/workspaces', true)
    },
    async getMobileDashboard(workspaceId: string): Promise<MobileDashboard> {
      return readJson<MobileDashboard>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/dashboard`,
        true
      )
    },
    async stopWorker(workspaceId: string, workerId: string): Promise<void> {
      await readJson<{ ok: true }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/workers/${encodeURIComponent(workerId)}/stop`,
        true,
        { method: 'POST' }
      )
    },
    async restartWorker(workspaceId: string, workerId: string): Promise<void> {
      await readJson<{ ok: true }>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/workers/${encodeURIComponent(workerId)}/restart`,
        true,
        { method: 'POST' }
      )
    },
    async dispatchTask(
      workspaceId: string,
      workerId: string,
      task: string
    ): Promise<MobileDispatchResponse> {
      return readJson<MobileDispatchResponse>(
        `/api/mobile/workspaces/${encodeURIComponent(workspaceId)}/dispatch`,
        true,
        {
          body: { task, worker_id: workerId },
          method: 'POST',
        }
      )
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
