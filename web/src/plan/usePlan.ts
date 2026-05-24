import { useEffect, useState } from 'react'

import { connectPlanStream, fetchPlan, type ParsedPlan } from '../api.js'

export const usePlan = (workspaceId: string | null) => {
  const [plan, setPlan] = useState<ParsedPlan | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!workspaceId) {
      setPlan(null)
      setLoaded(false)
      return
    }
    let closed = false
    setPlan(null)
    setLoaded(false)
    void fetchPlan(workspaceId)
      .then((nextPlan) => {
        if (closed) return
        setPlan(nextPlan)
        setLoaded(true)
      })
      .catch((error: unknown) => {
        if (closed) return
        console.error('[hive] swallowed:plan.initialLoad', error)
        setLoaded(true)
      })

    const socket = connectPlanStream(workspaceId, (nextPlan) => {
      if (closed) return
      setPlan(nextPlan)
      setLoaded(true)
    })
    socket.onopen = () => {
      void fetchPlan(workspaceId)
        .then((nextPlan) => {
          if (!closed) setPlan(nextPlan)
        })
        .catch((error: unknown) => {
          console.error('[hive] swallowed:plan.getOnReconnect', error)
        })
    }
    socket.onerror = (event) => {
      console.error('[hive] swallowed:plan.socket', event)
    }
    return () => {
      closed = true
      socket.close()
    }
  }, [workspaceId])

  return { loaded, plan }
}
