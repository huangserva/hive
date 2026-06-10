import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentRunStarter } from '../../src/server/agent-run-starter.js'
import { createAgentTokenRegistry } from '../../src/server/agent-tokens.js'
import { createLiveRunRegistry } from '../../src/server/live-run-registry.js'
import { createNoopRestartPolicy } from '../../src/server/restart-policy.js'
import { SESSION_START_REVIEW_MESSAGE } from '../../src/server/session-start-review-message.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const ORCHESTRATOR_AGENT_ID = 'ws-1:orchestrator'
const WORKER_AGENT_ID = 'ws-1:worker-abc'

const WORKSPACE = {
  id: 'ws-1',
  summary: { id: 'ws-1', name: 'Test', path: '/tmp/ws-1' },
} as const

const PROMPT_READY_OUTPUT = '\n❯ '
const makeAgentManagerMock = () => {
  const writtenInputs: Array<{ runId: string; text: string }> = []
  const getRunCalls = new Map<string, number>()
  const mock = {
    startAgent: vi.fn().mockResolvedValue({
      runId: 'run-test-1',
      pid: 1234,
      status: 'running',
      exitCode: null,
      errorTail: null,
    }),
    writeInput: vi.fn((runId: string, text: string | Buffer) => {
      writtenInputs.push({ runId, text: String(text) })
    }),
    getRun: vi.fn((runId = 'run-test-1') => {
      const calls = getRunCalls.get(runId) ?? 0
      getRunCalls.set(runId, calls + 1)
      return {
        runId,
        status: 'running',
        output: calls === 0 ? '' : PROMPT_READY_OUTPUT,
        pid: 1234,
        exitCode: null,
      }
    }),
    stopRun: vi.fn(),
  }
  return { mock, writtenInputs }
}

const makeStoreMock = () => ({
  insertAgentRun: vi.fn(),
  updatePersistedRun: vi.fn(),
})

const makeSessionStoreMock = () => ({
  getLastSessionId: vi.fn().mockReturnValue(null),
  setLastSessionId: vi.fn(),
  clearLastSessionId: vi.fn(),
  getSessionCaptureSnapshot: vi.fn().mockReturnValue(null),
})

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 150))

describe('session-start-review via agent-run-starter', () => {
  test('fresh orchestrator start injects session-start review + startup instructions in one write', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()
    const getAgent = vi.fn().mockReturnValue({
      id: ORCHESTRATOR_AGENT_ID,
      name: 'orch',
      role: 'orchestrator',
      description: 'test orch',
    })

    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry,
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry,
      getCommandPreset: vi.fn(),
      getAgent,
      restartPolicy: createNoopRestartPolicy(),
    })

    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      ORCHESTRATOR_AGENT_ID,
      { command: 'claude', args: [] },
      '4100'
    )

    await flushMicrotasks()

    const writes = writtenInputs.filter((w) => w.runId === 'run-test-1')
    expect(writes.length).toBeGreaterThanOrEqual(1)
    const combined = writes.map((w) => w.text).join('')
    expect(combined).toContain('[Hive 系统消息：会话开始]')
    expect(combined).toContain('.hive/baseline')
    expect(combined).toContain('[Hive 系统消息：启动说明]')
  })

  test('worker start does not inject session-start review', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()
    const getAgent = vi.fn().mockReturnValue({
      id: WORKER_AGENT_ID,
      name: 'worker1',
      role: 'coder',
      description: 'test worker',
    })

    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry,
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry,
      getCommandPreset: vi.fn(),
      getAgent,
      restartPolicy: createNoopRestartPolicy(),
    })

    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      WORKER_AGENT_ID,
      { command: 'claude', args: [] },
      '4100'
    )

    await flushMicrotasks()

    const writes = writtenInputs.filter((w) => w.runId === 'run-test-1')
    if (writes.length > 0) {
      const combined = writes.map((w) => w.text).join('')
      expect(combined).not.toContain('[Hive 系统消息：会话开始]')
    }
  })

  test('second orchestrator start within same runtime skips review (dedupe)', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()
    const getAgent = vi.fn().mockReturnValue({
      id: ORCHESTRATOR_AGENT_ID,
      name: 'orch',
      role: 'orchestrator',
      description: 'test orch',
    })

    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry,
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry,
      getCommandPreset: vi.fn(),
      getAgent,
      restartPolicy: createNoopRestartPolicy(),
    })

    agentManager.startAgent.mockResolvedValueOnce({
      runId: 'run-1',
      pid: 100,
      status: 'running',
      exitCode: null,
      errorTail: null,
    })
    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      ORCHESTRATOR_AGENT_ID,
      { command: 'claude', args: [] },
      '4100'
    )
    await flushMicrotasks()

    const firstWrites = writtenInputs.splice(0)

    agentManager.startAgent.mockResolvedValueOnce({
      runId: 'run-2',
      pid: 200,
      status: 'running',
      exitCode: null,
      errorTail: null,
    })
    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      ORCHESTRATOR_AGENT_ID,
      { command: 'claude', args: [] },
      '4100'
    )
    await flushMicrotasks()

    const firstCombined = firstWrites.map((w) => w.text).join('')
    expect(firstCombined).toContain('[Hive 系统消息：会话开始]')

    const secondCombined = writtenInputs.map((w) => w.text).join('')
    expect(secondCombined).not.toContain('[Hive 系统消息：会话开始]')
  })

  test('different orchestrator agentIds get independent review', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()

    const getAgent = (_wsId: string, agentId: string) => ({
      id: agentId,
      name: agentId.includes('ws-2') ? 'orch2' : 'orch1',
      role: 'orchestrator' as const,
      description: 'test orch',
    })

    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry,
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry,
      getCommandPreset: vi.fn(),
      getAgent,
      restartPolicy: createNoopRestartPolicy(),
    })

    agentManager.startAgent.mockResolvedValueOnce({
      runId: 'run-ws1',
      pid: 100,
      status: 'running',
      exitCode: null,
      errorTail: null,
    })
    await startLiveRun(
      { id: 'ws-1', name: 'WS1', path: '/tmp/ws-1' },
      'ws-1:orchestrator',
      { command: 'claude', args: [] },
      '4100'
    )
    await flushMicrotasks()

    const firstWrites = writtenInputs.splice(0)
    const firstCombined = firstWrites.map((w) => w.text).join('')
    expect(firstCombined).toContain('[Hive 系统消息：会话开始]')

    agentManager.startAgent.mockResolvedValueOnce({
      runId: 'run-ws2',
      pid: 200,
      status: 'running',
      exitCode: null,
      errorTail: null,
    })
    await startLiveRun(
      { id: 'ws-2', name: 'WS2', path: '/tmp/ws-2' },
      'ws-2:orchestrator',
      { command: 'claude', args: [] },
      '4100'
    )
    await flushMicrotasks()

    const secondCombined = writtenInputs.map((w) => w.text).join('')
    expect(secondCombined).toContain('[Hive 系统消息：会话开始]')
  })

  test('fresh start with non-interactive command does not inject session-start review (no stdin consumer)', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()
    const getAgent = vi.fn().mockReturnValue({
      id: ORCHESTRATOR_AGENT_ID,
      name: 'orch',
      role: 'orchestrator',
      description: 'test orch',
    })

    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry,
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry,
      getCommandPreset: vi.fn(),
      getAgent,
      restartPolicy: createNoopRestartPolicy(),
    })

    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      ORCHESTRATOR_AGENT_ID,
      { command: '/bin/bash', args: ['-c', 'echo hi'] },
      '4100'
    )

    await flushMicrotasks()

    const writes = writtenInputs.filter((w) => w.runId === 'run-test-1')
    expect(writes).toHaveLength(0)
  })

  test('resume path injects session-start review as separate write', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()
    const getAgent = vi.fn().mockReturnValue({
      id: ORCHESTRATOR_AGENT_ID,
      name: 'orch',
      role: 'orchestrator',
      description: 'test orch',
    })

    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry,
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry,
      getCommandPreset: vi.fn(),
      getAgent,
      restartPolicy: createNoopRestartPolicy(),
    })

    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      ORCHESTRATOR_AGENT_ID,
      { command: 'claude', args: [], resumedSessionId: 'session-abc' },
      '4100'
    )

    await flushMicrotasks()

    const writes = writtenInputs.filter((w) => w.runId === 'run-test-1')
    expect(writes.length).toBeGreaterThanOrEqual(1)
    const combined = writes.map((w) => w.text).join('')
    expect(combined).toContain(SESSION_START_REVIEW_MESSAGE)
  })
})
