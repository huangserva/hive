import { describe, expect, test } from 'vitest'

import type { AgentRunSnapshot } from '../../src/server/agent-manager.js'
import { completeLiveRun, syncPersistedRun } from '../../src/server/agent-run-sync.js'
import type { LiveAgentRun } from '../../src/server/agent-runtime-types.js'

// bug #1：run 退出后每次 syncPersistedRun 都把 endedAt 刷成当前 Date.now()，
// 导致 DB 里结束时间被持续往后推。修复后终态 run 必须复用首次写入的 endedAt。
describe('syncPersistedRun endedAt stability (bug #1)', () => {
  const makeStore = () => {
    const endedAtWrites: Array<number | null> = []
    return {
      endedAtWrites,
      store: {
        updatePersistedRun: (
          _runId: string,
          _status: AgentRunSnapshot['status'],
          _exitCode: number | null,
          endedAt: number | null
        ) => {
          endedAtWrites.push(endedAt)
        },
      },
    }
  }

  const makeSnapshot = (output: string): AgentRunSnapshot => ({
    agentId: 'agent-1',
    exitCode: 0,
    output,
    pid: 1,
    runId: 'run-1',
    status: 'exited',
  })

  test('repeated syncs after exit keep the original endedAt instead of pushing it forward', () => {
    const { store, endedAtWrites } = makeStore()
    const run: LiveAgentRun = {
      agentId: 'agent-1',
      errorTail: null,
      exitCode: null,
      output: '',
      pid: 1,
      runId: 'run-1',
      startedAt: 1000,
      status: 'running',
    }

    // PTY 退出，结束时间确定为 5000。
    const exitEndedAt = 5000
    completeLiveRun(run, 0, exitEndedAt, store)
    expect(run.endedAt).toBe(exitEndedAt)

    // 之后多次 syncPersistedRun（output 每次都不同，绕过早返回守卫），
    // 模拟 getActiveRunByAgent / getLiveRun / close 反复轮询。
    syncPersistedRun(run, makeSnapshot('aaa'), store)
    syncPersistedRun(run, makeSnapshot('aaabbb'), store)
    syncPersistedRun(run, makeSnapshot('aaabbbccc'), store)

    // completeLiveRun + 3 次 sync，全部写入的 endedAt 必须恒为 5000，不被往后推。
    expect(endedAtWrites).toEqual([exitEndedAt, exitEndedAt, exitEndedAt, exitEndedAt])
  })

  test('non-terminal sync still writes null endedAt', () => {
    const { store, endedAtWrites } = makeStore()
    const run: LiveAgentRun = {
      agentId: 'agent-1',
      errorTail: null,
      exitCode: null,
      output: '',
      pid: 1,
      runId: 'run-1',
      startedAt: 1000,
      status: 'starting',
    }

    syncPersistedRun(
      run,
      {
        agentId: 'agent-1',
        exitCode: null,
        output: 'live',
        pid: 1,
        runId: 'run-1',
        status: 'running',
      },
      store
    )

    expect(endedAtWrites).toEqual([null])
    expect(run.endedAt).toBeUndefined()
  })
})
