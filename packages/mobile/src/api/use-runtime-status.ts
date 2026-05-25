import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createRuntimeClient, DEFAULT_RUNTIME_HOST, type RuntimeStatus } from './client'

const RUNTIME_HOST_KEY = 'hippoteam.runtimeHost'

export type RuntimeConnectionState = 'idle' | 'checking' | 'connected' | 'error'

export const useRuntimeStatus = () => {
  const [host, setHost] = useState(DEFAULT_RUNTIME_HOST)
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [state, setState] = useState<RuntimeConnectionState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    SecureStore.getItemAsync(RUNTIME_HOST_KEY)
      .then((storedHost) => {
        if (!cancelled && storedHost) setHost(storedHost)
      })
      .catch(() => {
        // SecureStore can be unavailable on some simulator/web paths. The default host is usable.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const client = useMemo(() => createRuntimeClient({ host }), [host])

  const connect = useCallback(
    async (nextHost = host) => {
      setState('checking')
      setError(null)
      try {
        const runtimeStatus =
          nextHost === host
            ? await client.getRuntimeStatus()
            : await createRuntimeClient({ host: nextHost }).getRuntimeStatus()
        await SecureStore.setItemAsync(RUNTIME_HOST_KEY, nextHost)
        setHost(nextHost)
        setStatus(runtimeStatus)
        setState('connected')
        return runtimeStatus
      } catch (connectError) {
        const message = connectError instanceof Error ? connectError.message : String(connectError)
        setError(message)
        setStatus(null)
        setState('error')
        return null
      }
    },
    [client, host]
  )

  return {
    connect,
    error,
    host,
    setHost,
    state,
    status,
  }
}
