import { describe, expect, test, vi } from 'vitest'

import type { AgentManager } from '../../src/server/agent-manager.js'
import { handleAgentRunExit } from '../../src/server/agent-run-exit-handler.js'
import type { AgentRunExitContext } from '../../src/server/agent-run-start-context.js'
import { stopLiveRun } from '../../src/server/agent-runtime-stop-run.js'
import type { LiveAgentRun } from '../../src/server/agent-runtime-types.js'
import { createLiveRunRegistry } from '../../src/server/live-run-registry.js'

describe('B1: stopLiveRun on a历史 run not loaded in memory', () => {
  // 历史 run（DB 有、UI 历史可见，但没加载进当前内存）：registry 没有它，
  // agentManager.getRun 会 throw 'Run not found'。点 Stop 必须静默 no-op，不能 500。
  test('is a silent no-op (no throw, no stopRun call) when run is in neither registry nor manager', () => {
    const registry = createLiveRunRegistry()
    const stopRun = vi.fn()
    const agentManager = {
      getRun: (id: string) => {
        throw new Error(`Run not found: ${id}`)
      },
      stopRun,
    } as unknown as AgentManager

    expect(() =>
      stopLiveRun(agentManager, registry, (run) => run, 'historical-run-not-in-memory')
    ).not.toThrow()
    expect(stopRun).not.toHaveBeenCalled()
  })
})

describe('B2: handleAgentRunExit resolves the exit promise even if onAgentExit throws', () => {
  // onAgentExit 抛错绝不能阻止 resolveExit，否则 exit promise 永挂、close() 卡死。
  test('exit promise still resolves and the handler does not rethrow', async () => {
    const registry = createLiveRunRegistry()
    const runId = 'run-with-throwing-onexit'
    const liveRun = {
      agentId: 'agent-1',
      errorTail: null,
      exitCode: null,
      output: '',
      runId,
      startedAt: 1,
      status: 'running',
    } as LiveAgentRun
    registry.add(liveRun)
    registry.createExitEntry(runId)
    const exitEntry = registry.getExitEntry(runId)
    if (!exitEntry) throw new Error('expected exit entry')

    const context = {
      agentId: 'agent-1',
      handledRunExits: new Set<string>(),
      onAgentExit: () => {
        throw new Error('onAgentExit boom')
      },
      registry,
      sessionStore: {
        clearLastSessionId: () => {},
        getLastSessionId: () => undefined,
        setLastSessionId: () => {},
      },
      startConfig: {},
      store: { insertAgentRun: () => {}, updatePersistedRun: () => {} },
      token: 'tok',
      tokenRegistry: { revokeIfMatches: () => {} },
      workspace: { id: 'ws-1', name: 'A', path: '/tmp/a' },
    } as unknown as AgentRunExitContext

    expect(() => handleAgentRunExit(context, { endedAt: 123, exitCode: 0, runId })).not.toThrow()

    const raced = await Promise.race([
      exitEntry.promise.then(() => 'RESOLVED' as const),
      new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), 200)),
    ])
    expect(raced).toBe('RESOLVED')
  })
})
