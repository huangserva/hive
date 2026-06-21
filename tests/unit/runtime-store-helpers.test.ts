import { describe, expect, test } from 'vitest'

import type { AgentRunSnapshot } from '../../src/server/agent-manager.js'
import type { LiveAgentRun } from '../../src/server/agent-runtime-types.js'
import { resolveCompactRecoveryRunStatus } from '../../src/server/runtime-store-helpers.js'

const makeManagerRun = (status: AgentRunSnapshot['status']): AgentRunSnapshot => ({
  agentId: 'worker-1',
  exitCode: null,
  output: '',
  pid: 1,
  runId: 'run-1',
  status,
})

const makeLiveRun = (input: Partial<LiveAgentRun> = {}): LiveAgentRun => ({
  ...makeManagerRun('running'),
  startedAt: 1_000,
  ...input,
})

describe('runtime store helpers', () => {
  test('treats a stopRequested live run as terminal for compact recovery status checks', () => {
    const status = resolveCompactRecoveryRunStatus('run-1', {
      getLiveRun: () => makeLiveRun({ stopRequested: true, status: 'running' }),
      getManagerRun: () => makeManagerRun('running'),
    })

    expect(status).toBe('exited')
  })

  test('falls back to AgentManager status when a run is not live', () => {
    const status = resolveCompactRecoveryRunStatus('run-1', {
      getLiveRun: () => {
        throw new Error('not live')
      },
      getManagerRun: () => makeManagerRun('error'),
    })

    expect(status).toBe('error')
  })
})
