import type { AgentRunSnapshot } from './agent-manager.js'
import type { PersistedAgentRun } from './agent-run-store.js'
import type { LiveAgentRun } from './agent-runtime-types.js'

type PersistedRunStatus = PersistedAgentRun['status']

interface AgentRunSyncStore {
  updatePersistedRun: (
    runId: string,
    status: PersistedRunStatus,
    exitCode: number | null,
    endedAt: number | null,
    errorTail?: string | null
  ) => void
}

const MAX_RUN_OUTPUT_LENGTH = 1_000_000

const toPersistedStatus = (run: Pick<AgentRunSnapshot, 'status'> & { exitCode: number | null }) => {
  if (run.status === 'error' || run.status === 'exited' || run.status === 'starting') {
    return run.status
  }
  return run.exitCode === null ? 'running' : run.exitCode === 0 ? 'exited' : 'error'
}

export const syncPersistedRun = (
  run: LiveAgentRun,
  snapshot: AgentRunSnapshot,
  store: AgentRunSyncStore
) => {
  const nextStatus = toPersistedStatus(snapshot)
  const output = snapshot.output.slice(-MAX_RUN_OUTPUT_LENGTH)
  if (
    run.status === nextStatus &&
    run.exitCode === snapshot.exitCode &&
    run.output === output &&
    run.errorTail === (snapshot.errorTail ?? null)
  ) {
    return run
  }

  // 终态时复用首次记录的 endedAt；只有从未记录过才用当前时间。这样重复轮询不会把结束时间往后推（bug #1）。
  const isTerminal = nextStatus === 'exited' || nextStatus === 'error'
  const endedAt = isTerminal ? (run.endedAt ?? Date.now()) : null

  run.status = nextStatus
  run.output = output
  run.exitCode = snapshot.exitCode
  run.errorTail = snapshot.errorTail ?? null
  if (endedAt !== null) run.endedAt = endedAt
  store.updatePersistedRun(
    run.runId,
    nextStatus,
    snapshot.exitCode,
    endedAt,
    nextStatus === 'error' ? (snapshot.errorTail ?? null) : undefined
  )
  return run
}

export const completeLiveRun = (
  run: LiveAgentRun,
  exitCode: number | null,
  endedAt: number,
  store: AgentRunSyncStore
) => {
  run.status = exitCode === 0 ? 'exited' : 'error'
  run.exitCode = exitCode
  // 记录首次结束时间，供后续 syncPersistedRun 复用而非反复刷新（bug #1）。
  run.endedAt = endedAt
  store.updatePersistedRun(run.runId, run.status, exitCode, endedAt, run.errorTail)
}
