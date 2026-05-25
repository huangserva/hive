export const DEFAULT_RUNTIME_HOST = '192.168.1.100:4010'

export interface RuntimeStatus {
  cwd?: string
  pid?: number
  port?: number
  version?: string
  [key: string]: unknown
}

type FetchLike = typeof fetch

interface RuntimeClientOptions {
  fetchImpl?: FetchLike
  host?: string
}

export const normalizeRuntimeHost = (host: string) => {
  const trimmed = host.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `http://${trimmed || DEFAULT_RUNTIME_HOST}`
}

export const createRuntimeClient = ({
  fetchImpl = fetch,
  host = DEFAULT_RUNTIME_HOST,
}: RuntimeClientOptions = {}) => {
  const baseUrl = normalizeRuntimeHost(host)

  return {
    async getRuntimeStatus(): Promise<RuntimeStatus> {
      const response = await fetchImpl(`${baseUrl}/api/runtime/status`, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(`Runtime status failed: HTTP ${response.status}`)
      }
      return (await response.json()) as RuntimeStatus
    },
    buildWebSocketUrl(path: string) {
      const url = new URL(path, `${baseUrl}/`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      return url.toString()
    },
  }
}
