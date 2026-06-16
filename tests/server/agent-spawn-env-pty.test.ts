import { afterEach, describe, expect, test, vi } from 'vitest'

import { type AgentEnvScope, createAgentManager } from '../../src/server/agent-manager.js'

const parsePrintedEnv = (output: string) => {
  const match = /__HIVE_ENV__(.*?)__HIVE_ENV_END__/s.exec(output)
  if (!match) throw new Error(`env marker not found in output: ${output}`)
  return JSON.parse(match[1] ?? '{}') as Record<string, string | undefined>
}

const createEnvPrinterScript = () => `
const keys = [
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'GLM_API_KEY',
  'HIVE_AGENT_ID',
  'HIVE_AGENT_TOKEN',
  'OPENAI_API_KEY',
  'PATH',
  'RELAY_AUTH_TOKEN'
];
const picked = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
process.stdout.write('__HIVE_ENV__' + JSON.stringify(picked) + '__HIVE_ENV_END__');
`

const runEnvPrinter = async (envScope: AgentEnvScope) => {
  const manager = createAgentManager()
  let resolveExit = () => {}
  const exited = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('run did not exit')), 3_000)
    resolveExit = () => {
      clearTimeout(timeout)
      resolve()
    }
  })
  const run = await manager.startAgent({
    agentId: 'env-worker',
    args: ['-e', createEnvPrinterScript()],
    command: process.execPath,
    cwd: process.cwd(),
    env: {
      HIVE_AGENT_ID: 'env-worker',
      HIVE_AGENT_TOKEN: 'child-token',
      NODE_ENV: 'test',
    },
    envScope,
    onExit: () => resolveExit(),
  })

  await exited
  return parsePrintedEnv(manager.getRun(run.runId).output)
}

describe('agent spawn env via real node-pty', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('codex scoped worker gets OpenAI auth but not unrelated host secrets', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-secret')
    vi.stubEnv('DATABASE_URL', 'postgres://secret')
    vi.stubEnv('GLM_API_KEY', 'glm-secret')
    vi.stubEnv('HIVE_AGENT_TOKEN', 'parent-token')
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')
    vi.stubEnv('RELAY_AUTH_TOKEN', 'relay-secret')

    const env = await runEnvPrinter({ providerFamily: 'codex' })

    expect(env.OPENAI_API_KEY).toBe('openai-secret')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.GLM_API_KEY).toBeUndefined()
    expect(env.HIVE_AGENT_ID).toBe('env-worker')
    expect(env.HIVE_AGENT_TOKEN).toBe('child-token')
    expect(env.RELAY_AUTH_TOKEN).toBeUndefined()
    expect(env.PATH).toBeTruthy()
  })

  test('custom scoped worker gets explicit Hive env but no provider auth from the host', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-secret')
    vi.stubEnv('GEMINI_API_KEY', 'gemini-secret')
    vi.stubEnv('OPENAI_API_KEY', 'openai-secret')

    const env = await runEnvPrinter({ providerFamily: 'custom' })

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.GEMINI_API_KEY).toBeUndefined()
    expect(env.HIVE_AGENT_ID).toBe('env-worker')
    expect(env.HIVE_AGENT_TOKEN).toBe('child-token')
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.PATH).toBeTruthy()
  })
})
