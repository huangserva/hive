import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentSpawnEnv } from '../../src/server/agent-manager.js'

describe('agent spawn env', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('strips nested Claude Code markers while preserving agent runtime env', () => {
    const env = createAgentSpawnEnv({
      AI_AGENT: 'claude',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/Applications/Claude.app',
      CLAUDE_CODE_SESSION_ID: 'outer-session',
      CLAUDE_EFFORT: 'high',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '4096',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_PROJECTS_ROOT: '/tmp/claude-projects',
      CODEX_HOME: '/tmp/codex',
      HIVE_AGENT_ID: 'worker-1',
      HIVE_PORT: '4010',
      PATH: '/tmp/bin',
    })

    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_EXECPATH).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDE_EFFORT).toBeUndefined()
    expect(env.AI_AGENT).toBeUndefined()
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('4096')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.HIVE_AGENT_ID).toBe('worker-1')
    expect(env.HIVE_PORT).toBe('4010')
    expect(env.PATH).toBe('/tmp/bin')
    expect(env.CODEX_HOME).toBe('/tmp/codex')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test')
    expect(env.CLAUDE_PROJECTS_ROOT).toBe('/tmp/claude-projects')
  })

  test('strips nested markers inherited from the Hive process env', () => {
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'outer-session')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'oauth-token-from-parent')
    vi.stubEnv('HIVE_PARENT_ENV_CHECK', 'kept')

    const env = createAgentSpawnEnv({ HIVE_AGENT_ID: 'worker-process-env' })

    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token-from-parent')
    expect(env.HIVE_PARENT_ENV_CHECK).toBe('kept')
    expect(env.HIVE_AGENT_ID).toBe('worker-process-env')
  })
})
