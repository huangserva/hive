import { useEffect, useState } from 'react'

import { listTerminalRuns, type TerminalRunSummary } from '../api.js'

const REFRESH_INTERVAL_MS = 500

export const orchestratorAgentId = (workspaceId: string) => `${workspaceId}:orchestrator`

export type TerminalRunsState = {
  loaded: boolean
  runs: TerminalRunSummary[]
}

export const useTerminalRuns = (workspaceId: string | null): TerminalRunsState => {
  const [terminalRuns, setTerminalRuns] = useState<TerminalRunSummary[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!workspaceId) {
      setTerminalRuns([])
      setLoaded(false)
      return
    }
    let cancelled = false
    const loadRuns = () => {
      void listTerminalRuns(workspaceId)
        .then((runs) => {
          if (!cancelled) {
            setTerminalRuns(runs)
            setLoaded(true)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setTerminalRuns([])
            setLoaded(false)
          }
          console.error('[hive] swallowed:terminalRuns.list', error)
        })
    }
    setLoaded(false)
    loadRuns()
    const interval = window.setInterval(loadRuns, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [workspaceId])

  return { loaded, runs: terminalRuns }
}

export const findOrchestratorRun = (
  runs: TerminalRunSummary[],
  workspaceId: string
): TerminalRunSummary | undefined =>
  runs.find((run) => run.agent_id === orchestratorAgentId(workspaceId))

export const findRunByAgentId = (
  runs: TerminalRunSummary[],
  agentId: string
): TerminalRunSummary | undefined => runs.find((run) => run.agent_id === agentId)
