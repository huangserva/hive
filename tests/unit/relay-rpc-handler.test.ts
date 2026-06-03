import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'

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
  localTtsMock.detect.mockReset()
  localTtsMock.synthesize.mockReset()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createBaseStore = (overrides: Record<string, unknown> = {}) => ({
  approvalLedger: {
    get: vi.fn(),
    resolve: vi.fn(),
  },
  addWorker: vi.fn(() => ({ id: 'worker-2', name: 'Bob', role: 'coder', status: 'idle' })),
  dispatchTask: vi.fn(),
  configureAgentLaunch: vi.fn(),
  deleteWorker: vi.fn(),
  getActiveRunByAgentId: vi.fn(),
  getAgent: vi.fn(),
  getLastPtyLineForAgent: vi.fn(() => null),
  getPtySnapshotForAgent: vi.fn(),
  getWorkspaceSnapshot: vi.fn(() => ({ summary: { path: '/tmp/hive-workspace' } })),
  getWorker: vi.fn(() => ({ id: 'worker-1', name: 'Alice', status: 'working' })),
  getWorkerConfig: vi.fn(() => ({})),
  insertMobileChatMessage: vi.fn(),
  listDispatches: vi.fn(() => []),
  listMobileChatMessages: vi.fn(() => []),
  listTerminalRuns: vi.fn(() => []),
  listWorkspaces: vi.fn(() => [{ id: 'ws-1', name: 'Demo', path: '/tmp/demo' }]),
  listWorkers: vi.fn(() => [{ id: 'worker-1', name: 'Alice', role: 'worker', status: 'working' }]),
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
  },
  startAgent: vi.fn(),
  stopAgentRun: vi.fn(),
  updateMobilePushToken: vi.fn(),
  ...overrides,
})

describe('relay RPC handler', () => {
  it('requires read_dashboard for dashboard reads', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        listWorkspaces: () => [{ id: 'ws-1', name: 'Demo', path: '/tmp/demo' }],
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
      },
    })

    await expect(handler('workspaces.list', {}, 'device-1', ['read_dashboard'])).resolves.toEqual([
      { id: 'ws-1', name: 'Demo', path: '/tmp/demo' },
    ])
  })

  it('rejects dispatch RPC without send_prompt capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        requireMobileCapability: () => {
          throw new Error('Missing mobile capability: send_prompt')
        },
      },
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
      store: {
        getAgent: () => ({ id: 'worker-1', name: 'Alice', status: 'working' }),
        getPtySnapshotForAgent: async () => '\u001b[32mfirst\u001b[0m\nsecond\n',
        getWorker: () => ({ id: 'worker-1', name: 'Alice', status: 'working' }),
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_terminal') throw new Error(`wrong capability ${capability}`)
        },
      },
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
      store: {
        getWorker: () => ({ id: 'worker-1', name: 'Alice', status: 'stopped' }),
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
      },
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
      store: {
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
        updateMobilePushToken,
      },
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
      insertMobileChatMessage: vi.fn(),
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
    const insertMobileChatMessage = vi.fn()
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

    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      '[来自手机 Mobile App]\n---\n让关羽汇报'
    )
    expect(fastVoiceReplyProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: '让关羽汇报' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'inbound',
      'user_text',
      JSON.stringify({ source: 'voice', text: '让关羽汇报' })
    )
    expect(store.insertMobileChatMessage).toHaveBeenCalledWith(
      'ws-1',
      'outbound',
      'orch_reply',
      JSON.stringify({ fast_reply: true, source: 'voice_fast_reply', text: '好，我先安排。' })
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
      JSON.stringify({ text: '普通文字' })
    )
  })
})
