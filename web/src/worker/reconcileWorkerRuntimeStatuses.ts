import type { TeamListItem } from '../../../src/shared/types.js'
import type { TerminalRunSummary } from '../api.js'

export const reconcileWorkerRuntimeStatuses = (
  workers: TeamListItem[],
  terminalRuns: TerminalRunSummary[]
): TeamListItem[] => {
  const agentsWithRun = new Set(terminalRuns.map((run) => run.agent_id))
  return workers.map((worker) => {
    if (worker.status === 'stopped' || agentsWithRun.has(worker.id)) return worker
    return { ...worker, status: 'stopped' }
  })
}
