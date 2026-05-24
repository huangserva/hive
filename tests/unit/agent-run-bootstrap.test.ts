import { describe, expect, test } from 'vitest'

import { buildAgentRunBootstrap } from '../../src/server/agent-run-bootstrap.js'
import type { AgentSessionStore } from '../../src/server/agent-session-store.js'
import type { CommandPresetRecord } from '../../src/server/command-preset-store.js'

const codexPreset: CommandPresetRecord = {
  args: [],
  command: 'codex',
  displayName: 'Codex',
  env: {},
  id: 'codex',
  isBuiltin: true,
  resumeArgsTemplate: 'resume {session_id}',
  sessionIdCapture: {
    pattern: '~/.codex/sessions/**/*.jsonl',
    source: 'codex_session_jsonl_dir',
  },
  yoloArgsTemplate: null,
}

const claudePreset: CommandPresetRecord = {
  args: [],
  command: 'claude',
  displayName: 'Claude Code (CC)',
  env: {},
  id: 'claude',
  isBuiltin: true,
  resumeArgsTemplate: '--resume {session_id}',
  sessionIdCapture: {
    pattern: '~/.claude/projects/{encoded_cwd}/*.jsonl',
    source: 'claude_project_jsonl_dir',
  },
  yoloArgsTemplate: null,
}

const opencodePreset: CommandPresetRecord = {
  args: [],
  command: 'opencode',
  displayName: 'OpenCode',
  env: {},
  id: 'opencode',
  isBuiltin: true,
  resumeArgsTemplate: '--session {session_id}',
  sessionIdCapture: {
    pattern: '~/.local/share/opencode/opencode.db',
    source: 'opencode_session_db',
  },
  yoloArgsTemplate: null,
}

const createSessionStore = (sessionId: string): AgentSessionStore => ({
  clearLastSessionId: () => {},
  getLastSessionId: () => sessionId,
  setLastSessionId: () => {},
})

describe('agent run bootstrap', () => {
  test('does not snapshot sessions before spawning when a preset resume id is available', () => {
    const sessionId = '019dc277-0e8e-75c1-9794-94929426288e'
    const bootstrap = buildAgentRunBootstrap(
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/no-such-codex-workspace',
      },
      'agent-1',
      {
        args: [],
        command: 'codex',
        commandPresetId: 'codex',
      },
      createSessionStore(sessionId),
      (id) => (id === 'codex' ? codexPreset : undefined)
    )

    expect(bootstrap.startConfig).toMatchObject({
      args: ['resume', sessionId],
      resumedSessionId: sessionId,
    })
    expect(bootstrap.sessionCaptureSnapshot).toBeUndefined()
  })

  test('injects Claude thinking_level as --effort before launch args', () => {
    const bootstrap = buildAgentRunBootstrap(
      { id: 'workspace-1', name: 'Workspace', path: '/tmp/no-such-workspace' },
      'agent-1',
      {
        args: ['--model', 'sonnet'],
        command: 'claude',
        commandPresetId: 'claude',
        thinkingLevel: 'high',
      },
      createSessionStore(''),
      (id) => (id === 'claude' ? claudePreset : undefined)
    )

    expect(bootstrap.startConfig.args).toEqual(['--effort', 'high', '--model', 'sonnet'])
  })

  test('injects Codex thinking_level as global config before subcommands', () => {
    const bootstrap = buildAgentRunBootstrap(
      { id: 'workspace-1', name: 'Workspace', path: '/tmp/no-such-workspace' },
      'agent-1',
      {
        args: ['resume', 'session-1'],
        command: 'codex',
        commandPresetId: 'codex',
        thinkingLevel: 'xhigh',
      },
      createSessionStore(''),
      (id) => (id === 'codex' ? codexPreset : undefined)
    )

    expect(bootstrap.startConfig.args).toEqual([
      '-c',
      'model_reasoning_effort=xhigh',
      'resume',
      'session-1',
    ])
  })

  test('injects Codex preset MCP browser config before launch args', () => {
    const bootstrap = buildAgentRunBootstrap(
      { id: 'workspace-1', name: 'Workspace', path: '/tmp/no-such-workspace' },
      'agent-1',
      {
        args: ['--model', 'gpt-5-codex'],
        command: 'codex',
        commandPresetId: 'codex',
      },
      createSessionStore(''),
      (id) =>
        id === 'codex'
          ? {
              ...codexPreset,
              yoloArgsTemplate: [
                '--dangerously-bypass-approvals-and-sandbox',
                '-c',
                'mcp_servers.playwright.command="npx"',
                '-c',
                'mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]',
              ],
            }
          : undefined
    )

    expect(bootstrap.startConfig.args).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
      '-c',
      'mcp_servers.playwright.command="npx"',
      '-c',
      'mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]',
      '--model',
      'gpt-5-codex',
    ])
  })

  test('does not inject thinking_level for unsupported presets', () => {
    const bootstrap = buildAgentRunBootstrap(
      { id: 'workspace-1', name: 'Workspace', path: '/tmp/no-such-workspace' },
      'agent-1',
      {
        args: ['--session', 'session-1'],
        command: 'opencode',
        commandPresetId: 'opencode',
        thinkingLevel: 'high',
      },
      createSessionStore(''),
      (id) => (id === 'opencode' ? opencodePreset : undefined)
    )

    expect(bootstrap.startConfig.args).toEqual(['--session', 'session-1'])
  })
})
