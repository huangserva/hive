import { useEffect, useState } from 'react'

import { connectCockpitStream, fetchCockpit, type ParsedCockpit } from '../api.js'

export const useCockpit = (workspaceId: string | null) => {
  const [cockpit, setCockpit] = useState<ParsedCockpit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!workspaceId) {
      setCockpit(null)
      setError(null)
      setIsConnected(false)
      return
    }

    let closed = false
    setCockpit(null)
    setError(null)
    setIsConnected(false)

    void fetchCockpit(workspaceId)
      .then((nextCockpit) => {
        if (closed) return
        setCockpit(nextCockpit)
      })
      .catch((loadError: unknown) => {
        if (closed) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })

    const stream = connectCockpitStream(workspaceId, (nextCockpit) => {
      if (closed) return
      setCockpit(nextCockpit)
      setError(null)
      setIsConnected(true)
    })
    return () => {
      closed = true
      setIsConnected(false)
      stream.close()
    }
  }, [workspaceId])

  return { cockpit, error, isConnected }
}
