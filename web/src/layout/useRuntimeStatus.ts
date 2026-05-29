import { useEffect, useState } from 'react'

import { initializeUiSession } from '../api.js'

export interface RuntimeStatus {
  cwd: string
  dbPath: string
  lanAddresses: string[]
  logPath: string
  pid: number
  port: number
  version: string
}

interface RuntimeStatusPayload {
  cwd: string
  db_path: string
  lan_addresses?: string[]
  log_path: string
  pid: number
  port: number
  version: string
}

export const fetchRuntimeStatus = async (): Promise<RuntimeStatus> => {
  let response = await fetch('/api/runtime/status')
  if (response.status === 403) {
    await initializeUiSession()
    response = await fetch('/api/runtime/status')
  }
  if (!response.ok) throw new Error('Failed to load runtime status')
  const payload = (await response.json()) as RuntimeStatusPayload
  return {
    cwd: payload.cwd,
    dbPath: payload.db_path,
    lanAddresses: payload.lan_addresses ?? [],
    logPath: payload.log_path,
    pid: payload.pid,
    port: payload.port,
    version: payload.version,
  }
}

export const useRuntimeStatus = (): RuntimeStatus | null => {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)

  useEffect(() => {
    let alive = true
    fetchRuntimeStatus()
      .then((nextStatus) => {
        if (alive) setStatus(nextStatus)
      })
      .catch(() => {
        if (alive) setStatus(null)
      })
    return () => {
      alive = false
    }
  }, [])

  return status
}
