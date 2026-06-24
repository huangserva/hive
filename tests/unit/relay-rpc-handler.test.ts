import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  MobileChatDirection,
  MobileChatMessage,
  MobileChatMessageType,
} from '../../src/server/mobile-chat-store.js'
import {
  fulfillMobileReplyObligation,
  resetMobileReplyObligationsForTests,
} from '../../src/server/mobile-reply-obligation.js'
import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'
import { __resetVoiceUnderstandingBuffersForTests } from '../../src/server/voice-understanding-buffer.js'
import type { AgentSummary, TeamListItem } from '../../src/shared/types.js'

const localTtsMock = vi.hoisted(() => ({
  detect: vi.fn(),
  synthesize: vi.fn(),
}))

vi.mock('../../src/server/local-tts.js', () => ({
  createLocalTtsProvider: () => localTtsMock,
}))

const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  resetMobileReplyObligationsForTests()
  __resetVoiceUnderstandingBuffersForTests()
  localTtsMock.detect.mockReset()
  localTtsMock.synthesize.mockReset()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

type RelayHandlerDeps = Parameters<typeof createRelayRpcHandler>[0]
type RelayTestStore = RelayHandlerDeps['store']

const agentSummary = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  description: '',
  id: 'worker-1',
  name: 'Alice',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'working',
  workflowAllowed: false,
  workspaceId: 'ws-1',
  ...overrides,
})

const teamListItem = (overrides: Partial<TeamListItem> = {}): TeamListItem => ({
  description: '',
  id: 'worker-1',
  name: 'Alice',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'working',
  ...overrides,
})

const createBaseStore = (overrides: Record<string, unknown> = {}) => {
  const base = {
    approvalLedger: {
      get: vi.fn(),
      markResolved: vi.fn(),
      resolve: vi.fn(),
    },
    addWorker: vi.fn(() => agentSummary({ id: 'worker-2', name: 'Bob', status: 'idle' })),
    dispatchTask: vi.fn(),
    configureAgentLaunch: vi.fn(),
    deleteWorker: vi.fn(),
    getActiveRunByAgentId: vi.fn(),
    getAgent: vi.fn(() => agentSummary()),
    getLastPtyLineForAgent: vi.fn(() => null),
    getPtySnapshotForAgent: vi.fn(),
    getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: '/tmp/hive-workspace' } })),
    getWorker: vi.fn(() => agentSummary()),
    getWorkerConfig: vi.fn(() => ({})),
    insertMobileChatMessage: createInsertMobileChatMessageMock('base-message'),
    listActiveSentinelAlerts: vi.fn(() => []),
    listDispatches: vi.fn(() => []),
    listMobileChatMessages: vi.fn(() => []),
    listTerminalRuns: vi.fn(() => []),
    listWorkspaces: vi.fn(() => [{ id: 'ws-1', name: 'Demo', path: '/tmp/demo' }]),
    listWorkers: vi.fn(() => [teamListItem()]),
    peekAgentLaunchConfig: vi.fn(() => undefined),
    notifyQuestionAnswered: vi.fn(),
    recordUserInput: vi.fn(),
    requireMobileCapability: vi.fn((device: unknown) => device),
    settings: {
      getCommandPreset: vi.fn((id: string) =>
        id === 'codex'
          ? {
              args: ['-lc'],
              command: 'codex',
              displayName: 'Codex',
              env: {},
              id: 'codex',
              isBuiltin: true,
              resumeArgsTemplate: null,
              sessionIdCapture: null,
              yoloArgsTemplate: null,
            }
          : undefined
      ),
      listCommandPresets: vi.fn(() => [
        {
          args: ['-lc'],
          command: 'codex',
          displayName: 'Codex',
          env: {},
          id: 'codex',
          isBuiltin: true,
          resumeArgsTemplate: null,
          sessionIdCapture: null,
          yoloArgsTemplate: null,
        },
      ]),
      getAppState: vi.fn(() => null),
    },
    startAgent: vi.fn(),
    stopAgentRun: vi.fn(),
    updateMobilePushToken: vi.fn(),
  }
  return { ...base, ...overrides } as typeof base & RelayTestStore
}

const createFakeOutputBus = () => {
  const listeners = new Map<string, (chunk: string) => void>()
  return {
    bus: {
      clear: vi.fn(),
      publish: vi.fn((runId: string, chunk: string) => {
        listeners.get(runId)?.(chunk)
      }),
      subscribe: vi.fn((runId: string, listener: (chunk: string) => void) => {
        listeners.set(runId, listener)
        return () => listeners.delete(runId)
      }),
    },
  }
}

const insertedEventNames = (insertMobileChatMessage: ReturnType<typeof vi.fn>) =>
  insertMobileChatMessage.mock.calls
    .filter((call) => call[2] === 'system_event')
    .map((call) => JSON.parse(String(call[3])) as { event?: string })
    .map((event) => event.event)

const createInsertMobileChatMessageMock = (idPrefix: string) => {
  let count = 0
  return vi.fn(
    (
      _workspaceId: string,
      direction: MobileChatDirection,
      messageType: MobileChatMessageType,
      contentJson: string
    ): MobileChatMessage => ({
      content_json: contentJson,
      created_at: Date.now(),
      direction,
      id: `${idPrefix}-${count++}`,
      message_type: messageType,
      workspace_id: _workspaceId,
    })
  )
}

describe('relay RPC handler', () => {
  it('requires read_dashboard for dashboard reads', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        listWorkspaces: () => [{ id: 'ws-1', name: 'Demo', path: '/tmp/demo' }],
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
      }),
    })

    await expect(handler('workspaces.list', {}, 'device-1', ['read_dashboard'])).resolves.toEqual([
      { id: 'ws-1', name: 'Demo', path: '/tmp/demo' },
    ])
  })

  it('rejects dispatch RPC without send_prompt capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        requireMobileCapability: () => {
          throw new Error('Missing mobile capability: send_prompt')
        },
      }),
    })

    await expect(
      handler(
        'workspace.dispatch',
        { task: 'hello', worker_id: 'worker-1', workspace_id: 'ws-1' },
        'device-1',
        ['read_dashboard']
      )
    ).rejects.toThrow('Missing mobile capability: send_prompt')
  })

  it('serves worker transcript RPC with read_terminal capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        getAgent: () => agentSummary({ id: 'worker-1', name: 'Alice', status: 'working' }),
        getPtySnapshotForAgent: async () => '\u001b[32mfirst\u001b[0m\nsecond\n',
        getWorker: () => agentSummary({ id: 'worker-1', name: 'Alice', status: 'working' }),
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_terminal') throw new Error(`wrong capability ${capability}`)
        },
      }),
    })

    await expect(
      handler('worker.transcript', { worker_id: 'worker-1', workspace_id: 'ws-1' }, 'device-1', [
        'read_terminal',
      ])
    ).resolves.toEqual({
      lines: ['first', 'second'],
      status: 'working',
      truncated: false,
      worker_id: 'worker-1',
      worker_name: 'Alice',
    })
  })

  it('serves workspace task RPC with read_dashboard capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        getWorker: () => agentSummary({ id: 'worker-1', name: 'Alice', status: 'stopped' }),
        listDispatches: () => [
          {
            artifacts: [],
            createdAt: Date.parse('2026-05-26T00:00:00.000Z'),
            deliveredAt: null,
            fromAgentId: null,
            id: 'dispatch-1',
            reportedAt: null,
            reportText: null,
            sequence: 1,
            status: 'submitted',
            submittedAt: Date.parse('2026-05-26T00:00:01.000Z'),
            text: 'Run the mobile task endpoint smoke test',
            toAgentId: 'worker-1',
            workspaceId: 'ws-1',
          },
        ],
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
      }),
    })

    await expect(
      handler('workspace.tasks', { workspace_id: 'ws-1' }, 'device-1', ['read_dashboard'])
    ).resolves.toEqual({
      dispatches: [
        {
          created_at: '2026-05-26T00:00:00.000Z',
          id: 'dispatch-1',
          status: 'pending',
          task_summary: 'Run the mobile task endpoint smoke test',
          worker_id: 'worker-1',
          worker_name: 'Alice',
        },
      ],
      workspace_id: 'ws-1',
    })
  })

  it('registers push tokens over relay RPC for the authenticated device', async () => {
    const updateMobilePushToken = vi.fn()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
        updateMobilePushToken,
      }),
    })

    await expect(
      handler(
        'device.register_push_token',
        { push_token: 'ExponentPushToken[relay]' },
        'device-1',
        ['read_dashboard']
      )
    ).resolves.toEqual({ ok: true })
    expect(updateMobilePushToken).toHaveBeenCalledWith('device-1', 'ExponentPushToken[relay]')
  })

  it('accepts every relay method emitted by the mobile client', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-rpc-all-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'open-questions.md'),
      ['# Open Questions', '', '## 🟠 medium — 影响下一步规划', '', '- [ ] **Q1** Relay?'].join(
        '\n'
      ),
      'utf8'
    )
    tempDirs.push(dataDir)

    const store = createBaseStore({
      approvalLedger: {
        get: vi.fn(() => ({
          action: 'Review screenshot',
          approvalId: 'approval-1',
          chatId: 'chat-1',
          createdAt: Date.now(),
          messageId: 'message-1',
          orchAgentId: 'ws-1:orchestrator',
          risk: 'high',
          target: null,
          workspaceId: 'ws-1',
        })),
        markResolved: vi.fn(),
        resolve: vi.fn(() => ({
          action: 'Review screenshot',
          approvalId: 'approval-1',
          chatId: 'chat-1',
          createdAt: Date.now(),
          decision: 'allow',
          messageId: 'message-1',
          orchAgentId: 'ws-1:orchestrator',
          operator: 'relay:device-1',
          resolvedAt: Date.now(),
          risk: 'high',
          target: null,
          workspaceId: 'ws-1',
        })),
      },
      dispatchTask: vi.fn(async () => ({ id: 'dispatch-1' })),
      getAgent: vi.fn(() => ({ id: 'worker-1', name: 'Alice', status: 'working' })),
      getActiveRunByAgentId: vi.fn(() => ({ runId: 'run-1' })),
      getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
      getPtySnapshotForAgent: vi.fn(async () => '\u001b[32mhello\u001b[0m\n'),
      insertMobileChatMessage: createInsertMobileChatMessageMock('all-method-message'),
      listMobileChatMessages: vi.fn(() => []),
      notifyQuestionAnswered: vi.fn(),
      recordUserInput: vi.fn(),
      requireMobileCapability: vi.fn((device: unknown) => device),
      startAgent: vi.fn(async () => ({ runId: 'run-2' })),
    })
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store,
    })

    await expect(
      handler('runtime.status', {}, 'device-1', ['read_dashboard'])
    ).resolves.toMatchObject({
      db_path: join(dataDir, 'runtime.sqlite'),
      pid: expect.any(Number),
      port: 4010,
    })
    await expect(handler('workspaces.list', {}, 'device-1', ['read_dashboard'])).resolves.toEqual([
      { id: 'ws-1', name: 'Demo', path: '/tmp/demo' },
    ])
    await expect(
      handler('workspace.dashboard.get', { workspace_id: 'ws-1' }, 'device-1', ['read_dashboard'])
    ).resolves.toBeDefined()
    await expect(
      handler('worker.transcript', { worker_id: 'worker-1', workspace_id: 'ws-1' }, 'device-1', [
        'read_terminal',
      ])
    ).resolves.toMatchObject({ worker_id: 'worker-1' })
    await expect(
      handler('workspace.tasks', { workspace_id: 'ws-1' }, 'device-1', ['read_dashboard'])
    ).resolves.toMatchObject({ workspace_id: 'ws-1' })
    await expect(
      handler('workspace.chat.messages', { limit: 5, workspace_id: 'ws-1' }, 'device-1', [
        'read_dashboard',
      ])
    ).resolves.toEqual({ messages: [] })
    await expect(
      handler('workspace.cockpit', { workspace_id: 'ws-1' }, 'device-1', ['read_dashboard'])
    ).resolves.toMatchObject({ aiActions: expect.any(Array) })
    await expect(
      handler(
        'workspace.cockpit.question.answer',
        { answer: 'Done', question_id: 'Q1', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true })
    await expect(
      handler(
        'workspace.dispatch',
        { task: 'hello', worker_id: 'worker-1', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toMatchObject({ ok: true, workspace_id: 'ws-1' })
    await expect(
      handler('workspace.prompt', { text: 'hello', workspace_id: 'ws-1' }, 'device-1', [
        'send_prompt',
      ])
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })
    await expect(
      handler(
        'workspace.approve',
        { approval_id: 'approval-1', decision: 'allow', workspace_id: 'ws-1' },
        'device-1',
        ['approve_risk']
      )
    ).resolves.toEqual({
      approval_id: 'approval-1',
      decision: 'allow',
      ok: true,
      status: 'recorded',
    })
    await expect(
      handler(
        'workspace.upload',
        {
          data: Buffer.from('image-bytes').toString('base64'),
          filename: 'screenshot.png',
          mime_type: 'image/png',
          workspace_id: 'ws-1',
        },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toMatchObject({ ok: true, filename: 'screenshot.png', mime_type: 'image/png' })
    await expect(
      handler('command_presets.list', {}, 'device-1', ['admin_runtime'])
    ).resolves.toBeDefined()
    await expect(
      handler(
        'worker.create',
        { command_preset_id: 'codex', name: 'Bob', role: 'coder', workspace_id: 'ws-1' },
        'device-1',
        ['admin_runtime']
      )
    ).resolves.toBeDefined()
    await expect(
      handler(
        'worker.create',
        {
          command_preset_id: 'codex',
          name: 'Mallory',
          role: 'coder',
          startup_command: 'rm -rf /',
          workspace_id: 'ws-1',
        },
        'device-1',
        ['admin_runtime']
      )
    ).resolves.toBeDefined()
    expect(store.configureAgentLaunch).toHaveBeenLastCalledWith(
      'ws-1',
      expect.any(String),
      expect.objectContaining({ command: 'codex', commandPresetId: 'codex' })
    )
    expect(JSON.stringify(store.configureAgentLaunch.mock.calls.at(-1)?.[2] ?? {})).not.toContain(
      'rm -rf'
    )
    await expect(
      handler(
        'device.register_push_token',
        { push_token: 'ExponentPushToken[relay]' },
        'device-1',
        ['read_dashboard']
      )
    ).resolves.toEqual({ ok: true })
    const originalPath = process.env.PATH
    const originalHome = process.env.HOME
    const isolatedBin = join(dataDir, 'isolated-bin')
    const isolatedHome = join(dataDir, 'isolated-home')
    mkdirSync(isolatedBin, { recursive: true })
    mkdirSync(isolatedHome, { recursive: true })
    process.env.PATH = isolatedBin
    process.env.HOME = isolatedHome
    try {
      await expect(
        handler('voice.transcribe', { audio: 'fake' }, 'device-1', ['send_prompt'])
      ).resolves.toMatchObject({
        error: 'stt_unavailable',
      })
    } finally {
      process.env.PATH = originalPath
      process.env.HOME = originalHome
    }
    await expect(
      handler('worker.stop', { workspace_id: 'ws-1', worker_id: 'worker-1' }, 'device-1', [
        'admin_runtime',
      ])
    ).resolves.toMatchObject({ ok: true })
    await expect(
      handler('worker.restart', { workspace_id: 'ws-1', worker_id: 'worker-1' }, 'device-1', [
        'admin_runtime',
      ])
    ).resolves.toMatchObject({ ok: true })

    expect(store.requireMobileCapability).toHaveBeenCalled()
  })

  it('serves chat messages over relay RPC', async () => {
    const listMobileChatMessages = vi.fn(() => [
      {
        id: 'm-6',
        content_json: '{}',
        created_at: 6,
        direction: 'inbound',
        message_type: 'user_text',
      },
    ])
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({ listMobileChatMessages }),
    })

    await expect(
      handler(
        'workspace.chat.messages',
        { limit: 5, since: 123, workspace_id: 'ws-1' },
        'device-1',
        ['read_dashboard']
      )
    ).resolves.toEqual({
      messages: [
        {
          id: 'm-6',
          content_json: '{}',
          created_at: 6,
          direction: 'inbound',
          message_type: 'user_text',
        },
      ],
    })
    expect(listMobileChatMessages).toHaveBeenCalledWith('ws-1', 123, 5)
  })

  it('passes voice through relay voice synthesis RPC', async () => {
    localTtsMock.detect.mockResolvedValue({ command: 'edge-tts', provider: 'edge-tts' })
    localTtsMock.synthesize.mockResolvedValue({
      audio: Buffer.from('audio'),
      format: 'mp3',
      mime: 'audio/mpeg',
      provider: 'edge-tts',
    })
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore(),
    })

    await expect(
      handler('voice.synthesize', { text: '正式回复', voice: 'zh-CN-YunxiNeural' }, 'device-1', [
        'send_prompt',
      ])
    ).resolves.toMatchObject({ format: 'mp3', mime: 'audio/mpeg' })

    expect(localTtsMock.synthesize).toHaveBeenCalledWith('正式回复', {
      voice: 'zh-CN-YunxiNeural',
    })
  })

  it('starts relay-created workers with relay as the launch source', async () => {
    const store = createBaseStore({
      startAgent: vi.fn(async () => ({ runId: 'run-relay-worker' })),
    })
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'worker.create',
        {
          autostart: true,
          command_preset_id: 'codex',
          name: 'Relay Worker',
          role: 'coder',
          workspace_id: 'ws-1',
        },
        'device-1',
        ['admin_runtime']
      )
    ).resolves.toMatchObject({
      agent_start: { ok: true, run_id: 'run-relay-worker' },
      ok: true,
    })

    expect(store.startAgent).toHaveBeenCalledWith('ws-1', expect.any(String), {
      hivePort: '4010',
      source: 'relay',
    })
  })

  it('sanitizes relay voice synthesis text before TTS without mutating the RPC payload', async () => {
    localTtsMock.detect.mockResolvedValue({ command: 'edge-tts', provider: 'edge-tts' })
    localTtsMock.synthesize.mockResolvedValue({
      audio: Buffer.from('audio'),
      format: 'mp3',
      mime: 'audio/mpeg',
      provider: 'edge-tts',
    })
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore(),
    })
    const params = {
      text: '✅ 下载 https://example.com/app-release-2.7.4-a1b2c3d4.apk commit 5aea765',
      voice: 'zh-CN-YunxiNeural',
    }

    await expect(handler('voice.synthesize', params, 'device-1', ['send_prompt'])).resolves.toEqual(
      expect.objectContaining({ format: 'mp3', mime: 'audio/mpeg' })
    )

    expect(localTtsMock.synthesize).toHaveBeenCalledWith('完成 下载 链接 commit 一个版本', {
      voice: 'zh-CN-YunxiNeural',
    })
    expect(params.text).toContain('https://example.com/app-release')
  })

  it('serves cockpit data over relay RPC', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-cockpit-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'open-questions.md'),
      ['# Open Questions', '', '## 🟠 medium — 影响下一步规划', '', '- [ ] **Q1** Relay?'].join(
        '\n'
      ),
      'utf8'
    )
    tempDirs.push(dataDir)

    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store: createBaseStore({
        getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
      }),
    })

    await expect(
      handler('workspace.cockpit', { workspace_id: 'ws-1' }, 'device-1', ['read_dashboard'])
    ).resolves.toMatchObject({
      aiActions: expect.any(Array),
      ideas: expect.any(Object),
      plan: expect.any(Object),
      questions: expect.any(Object),
      tasks: expect.any(Object),
    })
  })

  it('answers cockpit questions over relay RPC', async () => {
    const notifyQuestionAnswered = vi.fn()
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-question-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'open-questions.md'),
      ['# Open Questions', '', '## 🟠 medium — 影响下一步规划', '', '- [ ] **Q1** Relay?'].join(
        '\n'
      ),
      'utf8'
    )
    tempDirs.push(dataDir)

    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store: createBaseStore({
        getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
        notifyQuestionAnswered,
      }),
    })

    await expect(
      handler(
        'workspace.cockpit.question.answer',
        { answer: 'Use the relay path', question_id: 'Q1', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true })
    expect(notifyQuestionAnswered).toHaveBeenCalledWith('ws-1', 'Q1', 'Use the relay path')
  })

  it('uploads media and reuses the uploaded absolute path when prompting the orchestrator', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-upload-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'open-questions.md'),
      ['# Open Questions', '', '## 🟠 medium — 影响下一步规划', '', '（暂无）'].join('\n'),
      'utf8'
    )
    tempDirs.push(dataDir)

    const recordUserInput = vi.fn()
    const insertMobileChatMessage = createInsertMobileChatMessageMock('upload-message')
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store: createBaseStore({
        getActiveRunByAgentId: vi.fn(() => ({ runId: 'run-1' })),
        getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
        insertMobileChatMessage,
        recordUserInput,
      }),
    })

    await expect(
      handler(
        'workspace.upload',
        {
          data: Buffer.from('image-bytes').toString('base64'),
          filename: 'screenshot.png',
          mime_type: 'image/png',
          workspace_id: 'ws-1',
        },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toMatchObject({ ok: true, filename: 'screenshot.png', mime_type: 'image/png' })
    expect(insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      expect.stringContaining('"media":')
    )

    await expect(
      handler(
        'workspace.prompt',
        { text: 'Please review this screenshot', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })
    expect(recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('[Image: source: ')
    )
    expect(existsSync(join(dataDir, 'uploads'))).toBe(true)
  })

  it('accepts relay workspace uploads above 50MB up to the 100MB video limit', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-large-upload-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    tempDirs.push(dataDir)

    const insertMobileChatMessage = createInsertMobileChatMessageMock('large-upload-message')
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store: createBaseStore({
        getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
        insertMobileChatMessage,
      }),
    })

    await expect(
      handler(
        'workspace.upload',
        {
          data: Buffer.alloc(51 * 1024 * 1024, 1).toString('base64'),
          filename: 'clip.mp4',
          mime_type: 'video/mp4',
          workspace_id: 'ws-1',
        },
        'device-large-upload',
        ['send_prompt']
      )
    ).resolves.toMatchObject({
      filename: 'clip.mp4',
      mime_type: 'video/mp4',
      ok: true,
      size: 51 * 1024 * 1024,
    })
    expect(existsSync(join(dataDir, 'uploads'))).toBe(true)
  })

  it('rejects relay workspace uploads over the 100MB video limit with the shared message', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-oversized-upload-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    tempDirs.push(dataDir)

    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store: createBaseStore({
        getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
      }),
    })

    await expect(
      handler(
        'workspace.upload',
        {
          data: Buffer.alloc(101 * 1024 * 1024, 1).toString('base64'),
          filename: 'too-big.mp4',
          mime_type: 'video/mp4',
          workspace_id: 'ws-1',
        },
        'device-1',
        ['send_prompt']
      )
    ).rejects.toThrow('File too large (max 100MB)')
  })

  it('expires stale uploaded media before prompting the orchestrator over relay RPC', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-upload-expire-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'open-questions.md'),
      ['# Open Questions', '', '## 🟠 medium — 影响下一步规划', '', '（暂无）'].join('\n'),
      'utf8'
    )
    tempDirs.push(dataDir)

    const recordUserInput = vi.fn()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 4010 },
      store: createBaseStore({
        getActiveRunByAgentId: vi.fn(() => ({ runId: 'run-1' })),
        getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: workspacePath } })),
        recordUserInput,
      }),
    })

    await expect(
      handler(
        'workspace.upload',
        {
          data: Buffer.from('stale-image-bytes').toString('base64'),
          filename: 'stale.png',
          mime_type: 'image/png',
          workspace_id: 'ws-1',
        },
        'device-expire',
        ['send_prompt']
      )
    ).resolves.toMatchObject({ ok: true, filename: 'stale.png' })

    vi.setSystemTime(new Date('2026-06-01T00:06:00.000Z'))

    await expect(
      handler(
        'workspace.prompt',
        { text: 'This message should not inherit stale media', workspace_id: 'ws-1' },
        'device-expire',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })
    expect(recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.not.stringContaining('[Image: source:')
    )
  })

  it('adds a fast voice reply while still injecting voice prompts to orchestrator', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi.fn().mockResolvedValue('好，我先安排。'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '让关羽汇报', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    const injected = store.recordUserInput.mock.calls[0]?.[2]
    expect(injected).toContain('[来自手机 Mobile App]\n---\n让关羽汇报')
    expect(injected).toContain('GLM 已经对用户回复了:"好，我先安排。"')
    expect(injected).toContain('绝不重复')
    expect(fastVoiceReplyProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '让关羽汇报' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ source: 'talk_continuous', text: '让关羽汇报' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({ fast_reply: true, source: 'voice_fast_reply', text: '好，我先安排。' })
    )
  })

  it('merges relay voice prompt fragments before invoking the fast voice layer', async () => {
    vi.useFakeTimers()
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '1200')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到，转给主管。'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '让关羽查一下', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })
    await vi.advanceTimersByTimeAsync(500)
    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: 'WebRTC 为什么断续', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    await vi.advanceTimersByTimeAsync(1199)
    expect(fastVoiceReplyProvider.generate).not.toHaveBeenCalled()
    expect(store.recordUserInput).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(fastVoiceReplyProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '让关羽查一下\nWebRTC 为什么断续' })
    )
    const injected = store.recordUserInput.mock.calls[0]?.[2] as string
    expect(injected).toContain('[来自手机 Mobile App]\n---\n让关羽查一下\nWebRTC 为什么断续')
  })

  it('injects handled voice context to orchestrator without starting a mobile reply obligation', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n现在关羽正在 working。'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '关羽现在在干嘛', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    const injected = store.recordUserInput.mock.calls[0]?.[2] as string
    expect(injected).toContain('[来自手机 Mobile App]\n---\n关羽现在在干嘛')
    expect(injected).toContain('前台(GLM)已就此条答复用户')
    expect(injected).toContain('仅供你保持上下文，无需回复')
    expect(injected).toContain('现在关羽正在 working。')
    expect(store.recordUserInput.mock.calls[0]?.[3]).toBeUndefined()
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ source: 'talk_continuous', text: '关羽现在在干嘛' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({
        fast_reply: true,
        gatekeeper: 'handled',
        source: 'voice_fast_reply',
        text: '现在关羽正在 working。',
      })
    )
  })

  it('forces operation-like continuous voice prompts to orchestrator even if GLM gatekeeper says handled', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n我直接答。'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '让关羽重启 4010 服务', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('[来自手机 Mobile App]\n---\n让关羽重启 4010 服务')
    )
    expect(store.recordUserInput).not.toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.any(String),
      { forwardToOrchestrator: false }
    )
    expect(
      store.insertMobileChatMessage.mock.calls.some(
        ([workspaceId, direction, messageType, contentJson]) =>
          workspaceId === 'ws-1' &&
          direction === 'outbound' &&
          messageType === 'orch_reply' &&
          JSON.parse(contentJson as string).source === 'voice_fast_reply'
      )
    ).toBe(false)
  })

  it('forwards handled voice prompts when the fast reply cannot be recorded', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
      insertMobileChatMessage: vi.fn(
        (_workspaceId: string, direction: string, messageType: string, _contentJson: string) => {
          if (direction === 'outbound' && messageType === 'orch_reply') {
            throw new Error('database is locked')
          }
        }
      ),
    })
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider: {
        generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n现在暂无未完成派单。'),
      },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '现在有未完成派单吗', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      '[来自手机 Mobile App]\n---\n现在有未完成派单吗'
    )
    expect(store.recordUserInput).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { forwardToOrchestrator: false }
    )
  })

  it('still injects operation-like voice prompts when GLM gatekeeper escalates', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi
        .fn()
        .mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n好，我让 orchestrator 去办。'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '让关羽修一下对讲', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    const injected = store.recordUserInput.mock.calls[0]?.[2]
    expect(injected).toContain('[来自手机 Mobile App]\n---\n让关羽修一下对讲')
    expect(injected).toContain('GLM 已经对用户回复了:"好，我让 orchestrator 去办。"')
    expect(injected).toContain('绝不重复')
    expect(injected).toContain('无需补充')
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({
        fast_reply: true,
        gatekeeper: 'escalate',
        source: 'voice_fast_reply',
        text: '好，我让 orchestrator 去办。',
      })
    )
  })

  it('drops team-name prompt echo noise before GLM or orchestrator over relay', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n我在。'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '团队成员：关羽、马超、赵云、钟馗、吕布', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    expect(fastVoiceReplyProvider.generate).not.toHaveBeenCalled()
    expect(store.recordUserInput).not.toHaveBeenCalled()
    expect(store.insertMobileChatMessage).not.toHaveBeenCalled()
  })

  it('defaults to orchestrator injection when GLM gatekeeper fails or returns an unclear marker', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    const unclearStore = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const unclearHandler = createRelayRpcHandler({
      fastVoiceReplyProvider: {
        generate: vi.fn().mockResolvedValue('这个问题我可以答。'),
      },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: unclearStore,
    })

    await expect(
      unclearHandler(
        'workspace.prompt',
        { source: 'voice', text: '现在进度怎么样', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })
    const unclearInjected = unclearStore.recordUserInput.mock.calls[0]?.[2]
    expect(unclearInjected).toContain('[来自手机 Mobile App]\n---\n现在进度怎么样')
    expect(unclearInjected).toContain('GLM 已经对用户回复了:"这个问题我可以答。"')
    expect(unclearInjected).toContain('绝不重复')

    const failedStore = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const failedHandler = createRelayRpcHandler({
      fastVoiceReplyProvider: {
        generate: vi.fn(async () => {
          throw new Error('glm timeout')
        }),
      },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: failedStore,
    })

    await expect(
      failedHandler(
        'workspace.prompt',
        { source: 'voice', text: '现在进度怎么样', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })
    const failedInjected = failedStore.recordUserInput.mock.calls[0]?.[2]
    expect(failedInjected).toContain('[来自手机 Mobile App]\n---\n现在进度怎么样')
    expect(failedInjected).toContain('GLM 已经对用户回复了:')
    expect(failedInjected).toContain('绝不重复')
  })

  it('injects all prompts when the GLM gatekeeper feature flag is disabled', async () => {
    vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider: {
        generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: handled\n现在没有未完成派单。'),
      },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler(
        'workspace.prompt',
        { source: 'voice', text: '现在有未完成派单吗', workspace_id: 'ws-1' },
        'device-1',
        ['send_prompt']
      )
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      '[来自手机 Mobile App]\n---\n现在有未完成派单吗'
    )
  })

  it('records relay mobile reply obligation stdout and stalled events', async () => {
    vi.useFakeTimers()
    vi.stubEnv('HIVE_MOBILE_REPLY_WATCHDOG_MS', '50')
    const { bus } = createFakeOutputBus()
    const warnLogs: string[] = []
    const insertMobileChatMessage = createInsertMobileChatMessageMock('message')
    const handler = createRelayRpcHandler({
      logger: { warn: (message) => warnLogs.push(message) },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        getActiveRunByAgentId: vi.fn(() => ({ agentId: 'ws-1:orchestrator', runId: 'run-1' })),
        getPtyOutputBus: vi.fn(() => bus),
        insertMobileChatMessage,
      }),
    })

    await expect(
      handler('workspace.prompt', { text: '普通文字', workspace_id: 'ws-1' }, 'device-1', [
        'send_prompt',
      ])
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    bus.publish('run-1', 'PM 只往 stdout 写了，没调用 team mobile-reply')
    await vi.advanceTimersByTimeAsync(50)

    expect(warnLogs.some((message) => message.includes('stdout without mobile-reply'))).toBe(true)
    expect(warnLogs.some((message) => message.includes('mobile reply obligation stalled'))).toBe(
      true
    )
    expect(insertedEventNames(insertMobileChatMessage)).toEqual(
      expect.arrayContaining([
        'mobile_reply_plain_output_without_mobile_reply',
        'mobile_reply_obligation_stalled',
      ])
    )
  })

  it('fulfills relay mobile reply obligations through explicit reply correlation', async () => {
    vi.useFakeTimers()
    vi.stubEnv('HIVE_MOBILE_REPLY_WATCHDOG_MS', '50')
    const { bus } = createFakeOutputBus()
    const infoLogs: string[] = []
    const warnLogs: string[] = []
    const insertMobileChatMessage = createInsertMobileChatMessageMock('relay-message')
    const handler = createRelayRpcHandler({
      logger: {
        info: (message) => infoLogs.push(message),
        warn: (message) => warnLogs.push(message),
      },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        getActiveRunByAgentId: vi.fn(() => ({ agentId: 'ws-1:orchestrator', runId: 'run-1' })),
        getPtyOutputBus: vi.fn(() => bus),
        insertMobileChatMessage,
      }),
    })

    await expect(
      handler('workspace.prompt', { text: '请 PM 回手机', workspace_id: 'ws-1' }, 'device-1', [
        'send_prompt',
      ])
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    const inbound = insertMobileChatMessage.mock.results[0]?.value
    expect(inbound).toMatchObject({ id: 'relay-message-0' })
    fulfillMobileReplyObligation({
      fromAgentId: 'ws-1:orchestrator',
      insertMobileChatMessage,
      logger: {
        info: (message) => infoLogs.push(message),
        warn: (message) => warnLogs.push(message),
      },
      replyToUserMessageId: 'relay-message-0',
      workspaceId: 'ws-1',
    })
    await vi.advanceTimersByTimeAsync(60)

    expect(infoLogs.some((message) => message.includes('mobile reply obligation fulfilled'))).toBe(
      true
    )
    expect(warnLogs.some((message) => message.includes('mobile reply obligation stalled'))).toBe(
      false
    )
    expect(insertedEventNames(insertMobileChatMessage)).not.toContain(
      'mobile_reply_obligation_stalled'
    )
  })

  it('surfaces relay mobile reply obligation unavailable when output bus is missing', async () => {
    const warnLogs: string[] = []
    const insertMobileChatMessage = createInsertMobileChatMessageMock('relay-message')
    const handler = createRelayRpcHandler({
      logger: { warn: (message) => warnLogs.push(message) },
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: createBaseStore({
        getActiveRunByAgentId: vi.fn(() => ({ agentId: 'ws-1:orchestrator', runId: 'run-1' })),
        getPtyOutputBus: vi.fn(() => undefined),
        insertMobileChatMessage,
      }),
    })

    await expect(
      handler('workspace.prompt', { text: 'relay 缺 bus', workspace_id: 'ws-1' }, 'device-1', [
        'send_prompt',
      ])
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    expect(
      warnLogs.some((message) => message.includes('mobile reply obligation unavailable'))
    ).toBe(true)
    expect(insertedEventNames(insertMobileChatMessage)).toContain(
      'mobile_reply_obligation_unavailable'
    )
  })

  it('does not call the fast voice layer for ordinary text prompts', async () => {
    const store = createBaseStore({
      getActiveRunByAgentId: vi.fn(() => ({ agentId: 'orch', runId: 'run-1' })),
    })
    const fastVoiceReplyProvider = {
      generate: vi.fn().mockResolvedValue('不应触发'),
    }
    const handler = createRelayRpcHandler({
      fastVoiceReplyProvider,
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store,
    })

    await expect(
      handler('workspace.prompt', { text: '普通文字', workspace_id: 'ws-1' }, 'device-1', [
        'send_prompt',
      ])
    ).resolves.toEqual({ ok: true, workspace_id: 'ws-1' })

    expect(fastVoiceReplyProvider.generate).not.toHaveBeenCalled()
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ reply_sink: 'mobile', source: 'mobile', text: '普通文字' })
    )
  })
})
