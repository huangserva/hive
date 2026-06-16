import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentManager } from '../../src/server/agent-manager.js'
import { createAgentRunStarter } from '../../src/server/agent-run-starter.js'
import { createAgentTokenRegistry } from '../../src/server/agent-tokens.js'
import { createLiveRunRegistry } from '../../src/server/live-run-registry.js'
import { createPtyOutputBus } from '../../src/server/pty-output-bus.js'
import { createNoopRestartPolicy } from '../../src/server/restart-policy.js'
import { SESSION_START_REVIEW_MESSAGE } from '../../src/server/session-start-review-message.js'
import type { AgentSummary } from '../../src/shared/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const ORCHESTRATOR_AGENT_ID = 'ws-1:orchestrator'
const WORKER_AGENT_ID = 'ws-1:worker-abc'

const WORKSPACE = {
  id: 'ws-1',
  summary: { id: 'ws-1', name: 'Test', path: '/tmp/ws-1' },
} as const

const makeAgentSummary = (
  id: string,
  role: AgentSummary['role'],
  name: string,
  description: string,
  workspaceId: string = WORKSPACE.id
): AgentSummary => ({
  description,
  id,
  name,
  pendingTaskCount: 0,
  role,
  status: 'idle',
  workspaceId,
  workflowAllowed: false,
})

const PROMPT_READY_OUTPUT = '\n❯ '
const makeAgentManagerMock = () => {
  const writtenInputs: Array<{ runId: string; text: string }> = []
  const getRunCalls = new Map<string, number>()
  const outputBus = createPtyOutputBus()
  const startAgent = vi.fn<AgentManager['startAgent']>().mockResolvedValue({
    runId: 'run-test-1',
    pid: 1234,
    status: 'running',
    exitCode: null,
    errorTail: null,
    output: '',
    agentId: ORCHESTRATOR_AGENT_ID,
  })
  const writeInput = vi.fn<AgentManager['writeInput']>((runId, text) => {
    writtenInputs.push({ runId, text: String(text) })
  })
  const getRun = vi.fn<AgentManager['getRun']>((runId = 'run-test-1') => {
    const calls = getRunCalls.get(runId) ?? 0
    getRunCalls.set(runId, calls + 1)
    return {
      agentId: ORCHESTRATOR_AGENT_ID,
      runId,
      status: 'running',
      output: calls === 0 ? '' : PROMPT_READY_OUTPUT,
      pid: 1234,
      exitCode: null,
      errorTail: null,
    }
  })
  const mock = {
    getOutputBus: vi.fn(() => outputBus),
    startAgent,
    writeInput,
    getRun,
    pauseRun: vi.fn(),
    resizeRun: vi.fn(),
    resumeRun: vi.fn(),
    removeRun: vi.fn(),
    stopRun: vi.fn(),
  } satisfies AgentManager
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
  test('logs custom startup_command launch with source and command details', async () => {
    const { mock: agentManager } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const logger = { close: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry: createLiveRunRegistry(),
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry: createAgentTokenRegistry(),
      getCommandPreset: vi.fn(),
      getAgent: vi
        .fn()
        .mockReturnValue(
          makeAgentSummary(ORCHESTRATOR_AGENT_ID, 'orchestrator', 'orch', 'test orch')
        ),
      logger,
      restartPolicy: createNoopRestartPolicy(),
    })

    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      ORCHESTRATOR_AGENT_ID,
      {
        args: ['-lic', 'qwen --resume session-1'],
        command: '/bin/zsh',
        commandPresetId: null,
        interactiveCommand: 'qwen',
        presetAugmentationDisabled: true,
      },
      '4100',
      'ui_workspace_create'
    )

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('custom_agent_command_start'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('source=ui_workspace_create'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('agent_id=ws-1:orchestrator'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('command="/bin/zsh"'))
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('args=["-lic","qwen --resume session-1"]')
    )
  })

  test('logs custom command preset launch but not builtin preset launch', async () => {
    const { mock: agentManager } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const logger = { close: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry: createLiveRunRegistry(),
      onAgentExit: vi.fn(),
      store,
      sessionStore,
      tokenRegistry: createAgentTokenRegistry(),
      getCommandPreset: vi.fn((id: string) =>
        id === 'custom-qwen'
          ? {
              args: [],
              command: 'qwen',
              displayName: 'Qwen',
              env: {},
              id: 'custom-qwen',
              isBuiltin: false,
              resumeArgsTemplate: null,
              sessionIdCapture: null,
              yoloArgsTemplate: null,
            }
          : {
              args: [],
              command: 'claude',
              displayName: 'Claude',
              env: {},
              id: 'claude',
              isBuiltin: true,
              resumeArgsTemplate: null,
              sessionIdCapture: null,
              yoloArgsTemplate: null,
            }
      ),
      getAgent: vi
        .fn()
        .mockReturnValue(makeAgentSummary(WORKER_AGENT_ID, 'coder', 'worker', 'test worker')),
      logger,
      restartPolicy: createNoopRestartPolicy(),
    })

    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      WORKER_AGENT_ID,
      { args: ['--model', 'qwen'], command: 'qwen', commandPresetId: 'custom-qwen' },
      '4100',
      'ui'
    )
    await startLiveRun(
      { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
      `${WORKSPACE.id}:worker-builtin`,
      { args: [], command: 'claude', commandPresetId: 'claude' },
      '4100',
      'ui'
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('preset_id=custom-qwen'))
  })

  test('rejects mobile or relay sourced custom command starts before spawning', async () => {
    const { mock: agentManager } = makeAgentManagerMock()
    const logger = { close: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const startLiveRun = createAgentRunStarter({
      agentManager,
      registry: createLiveRunRegistry(),
      onAgentExit: vi.fn(),
      store: makeStoreMock(),
      sessionStore: makeSessionStoreMock(),
      tokenRegistry: createAgentTokenRegistry(),
      getCommandPreset: vi.fn(),
      getAgent: vi
        .fn()
        .mockReturnValue(makeAgentSummary(WORKER_AGENT_ID, 'coder', 'worker', 'test worker')),
      logger,
      restartPolicy: createNoopRestartPolicy(),
    })

    await expect(
      startLiveRun(
        { id: WORKSPACE.id, name: WORKSPACE.summary.name, path: WORKSPACE.summary.path },
        WORKER_AGENT_ID,
        {
          args: ['-lic', 'dangerous-custom-wrapper'],
          command: '/bin/zsh',
          commandPresetId: null,
          presetAugmentationDisabled: true,
        },
        '4100',
        'mobile'
      )
    ).rejects.toThrow(/custom command.*requires local UI/i)
    expect(agentManager.startAgent).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('custom_agent_command_reject'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('source=mobile'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('kind=startup_command'))
  })

  test('fresh orchestrator start injects session-start review + startup instructions in one write', async () => {
    const { mock: agentManager, writtenInputs } = makeAgentManagerMock()
    const store = makeStoreMock()
    const sessionStore = makeSessionStoreMock()
    const tokenRegistry = createAgentTokenRegistry()
    const registry = createLiveRunRegistry()
    const getAgent = vi
      .fn()
      .mockReturnValue(makeAgentSummary(ORCHESTRATOR_AGENT_ID, 'orchestrator', 'orch', 'test orch'))

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
    const getAgent = vi
      .fn()
      .mockReturnValue(makeAgentSummary(WORKER_AGENT_ID, 'coder', 'worker1', 'test worker'))

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
    const getAgent = vi
      .fn()
      .mockReturnValue(makeAgentSummary(ORCHESTRATOR_AGENT_ID, 'orchestrator', 'orch', 'test orch'))

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
      agentId: ORCHESTRATOR_AGENT_ID,
      runId: 'run-1',
      pid: 100,
      status: 'running',
      output: '',
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
      agentId: ORCHESTRATOR_AGENT_ID,
      runId: 'run-2',
      pid: 200,
      status: 'running',
      output: '',
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

    const getAgent = (workspaceId: string, agentId: string) =>
      makeAgentSummary(
        agentId,
        'orchestrator',
        agentId.includes('ws-2') ? 'orch2' : 'orch1',
        'test orch',
        workspaceId
      )

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
      agentId: 'ws-1:orchestrator',
      runId: 'run-ws1',
      pid: 100,
      status: 'running',
      output: '',
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
      agentId: 'ws-2:orchestrator',
      runId: 'run-ws2',
      pid: 200,
      status: 'running',
      output: '',
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
    const getAgent = vi
      .fn()
      .mockReturnValue(makeAgentSummary(ORCHESTRATOR_AGENT_ID, 'orchestrator', 'orch', 'test orch'))

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
    const getAgent = vi
      .fn()
      .mockReturnValue(makeAgentSummary(ORCHESTRATOR_AGENT_ID, 'orchestrator', 'orch', 'test orch'))

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
