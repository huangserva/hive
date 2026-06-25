import { randomUUID } from 'node:crypto'
import { spawn } from 'node-pty'
import type { CommandPresetProviderFamily } from '../shared/types.js'
import { resolveSpawnCommand } from './agent-command-resolver.js'
import {
  attachAgentPty,
  createOutputTailBuffer,
  toAgentRunSnapshot,
} from './agent-manager-support.js'
import type { HiveLogger } from './logger.js'
import { createPtyOutputBus, type PtyOutputBus } from './pty-output-bus.js'
import { CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL } from './role-templates.js'

type RunStatus = 'starting' | 'running' | 'exited' | 'error'
type RunExitEvent = { runId: string; exitCode: number | null; errorTail?: string | null }
interface AgentEnvScope {
  commandPresetId?: string | null
  providerFamily: CommandPresetProviderFamily
  workflowAllowed?: boolean
}

interface StartAgentInput {
  agentId: string
  command: string
  args?: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  envScope?: AgentEnvScope
  onExit?: (event: RunExitEvent) => void
}

interface AgentRunSnapshot {
  runId: string
  agentId: string
  pid: number | null
  status: RunStatus
  output: string
  exitCode: number | null
  errorTail?: string | null
}

interface AgentRunRecord extends AgentRunSnapshot {
  process: {
    isStopped: () => boolean
    pause: () => void
    pid: number | null
    resize: (cols: number, rows: number) => void
    resume: () => void
    stop: () => void
    write: (input: Buffer | string) => void
  }
  onExit?: (event: RunExitEvent) => void
  errorTail: string | null
  errorTailBuffer: {
    append: (chunk: string) => void
    read: () => string | null
  }
}

interface AgentManager {
  getOutputBus: () => PtyOutputBus
  pauseRun: (runId: string) => void
  resizeRun: (runId: string, cols: number, rows: number) => void
  resumeRun: (runId: string) => void
  startAgent: (input: StartAgentInput) => Promise<AgentRunSnapshot>
  writeInput: (runId: string, input: Buffer | string) => void
  getRun: (runId: string) => AgentRunSnapshot
  removeRun: (runId: string) => void
  stopRun: (runId: string) => void
}

const createRunId = () => randomUUID()

const NESTED_CLAUDE_CODE_ENV_KEYS = new Set([
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_EFFORT',
])

const isNestedClaudeCodeEnvKey = (key: string) => NESTED_CLAUDE_CODE_ENV_KEYS.has(key)

const COMMON_PARENT_ENV_KEYS = new Set([
  'APPDATA',
  'ComSpec',
  'COLORTERM',
  'FORCE_COLOR',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LOCALAPPDATA',
  'LOGNAME',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'SHELL',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
])
const COMMON_PARENT_ENV_KEY_LOOKUP = new Set(
  [...COMMON_PARENT_ENV_KEYS].map((key) => key.toUpperCase())
)

const CLAUDE_PARENT_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_MAX_THINKING_TOKENS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
])

const CODEX_PARENT_ENV_KEYS = new Set([
  'CODEX_HOME',
  'CODEX_SESSION_ROOT',
  'OPENAI_API_KEY',
  'OPENAI_API_VERSION',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT',
])

const GEMINI_PARENT_ENV_KEYS = new Set([
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
])

const OPENCODE_PARENT_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'OPENCODE_CONFIG',
  'XAI_API_KEY',
])

const BEDROCK_PARENT_ENV_KEYS = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
])

const VERTEX_PARENT_ENV_KEYS = new Set([
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
])

// 出网代理（Clash/VPN 隧道等）。worker 在受限网络下必须继承，否则直连 Anthropic
// 会被回 403 Request not allowed。这只是网络隧道，不是 relay，不会带入
// ANTHROPIC_BASE_URL / AUTH_TOKEN —— GLM/嵌套清洗逻辑不受影响。
const PROXY_PARENT_ENV_KEYS = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'])

const isCommonParentEnvKey = (key: string) =>
  COMMON_PARENT_ENV_KEY_LOOKUP.has(key.toUpperCase()) ||
  key.startsWith('LC_') ||
  PROXY_PARENT_ENV_KEYS.has(key.toUpperCase())

const copyParentEnvKeys = (target: NodeJS.ProcessEnv, keys: Iterable<string>) => {
  for (const key of keys) {
    const value = process.env[key]
    if (value !== undefined) target[key] = value
  }
}

const getProviderParentEnvKeys = (scope: AgentEnvScope) => {
  switch (scope.providerFamily) {
    case 'claude':
      return CLAUDE_PARENT_ENV_KEYS
    case 'codex':
      return CODEX_PARENT_ENV_KEYS
    case 'gemini':
      return GEMINI_PARENT_ENV_KEYS
    case 'opencode':
      return OPENCODE_PARENT_ENV_KEYS
    case 'custom':
      return new Set<string>()
  }
}

const createScopedParentEnv = (scope: AgentEnvScope): NodeJS.ProcessEnv => {
  const env = {} as NodeJS.ProcessEnv
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isCommonParentEnvKey(key)) env[key] = value
  }
  copyParentEnvKeys(env, getProviderParentEnvKeys(scope))
  const usesBedrock =
    scope.providerFamily === 'claude' &&
    (process.env.CLAUDE_CODE_USE_BEDROCK === '1' || process.env.CLAUDE_CODE_USE_BEDROCK === 'true')
  const usesVertex =
    scope.providerFamily === 'claude' &&
    (process.env.CLAUDE_CODE_USE_VERTEX === '1' || process.env.CLAUDE_CODE_USE_VERTEX === 'true')
  if (usesBedrock) copyParentEnvKeys(env, BEDROCK_PARENT_ENV_KEYS)
  if (usesVertex) copyParentEnvKeys(env, VERTEX_PARENT_ENV_KEYS)
  return env
}

/** Builds the child agent env and strips nested Claude Code session markers and out-of-scope secrets. */
export const createAgentSpawnEnv = (
  inputEnv?: Record<string, string | undefined>,
  scope: AgentEnvScope = { providerFamily: 'custom' }
): NodeJS.ProcessEnv => {
  const env = { ...createScopedParentEnv(scope), ...inputEnv }
  // workflow worker 一律 strip 父进程真 Anthropic 凭据（钟馗 round 2 抓的真泄漏）：
  // 无论 ANTHROPIC_BASE_URL 是否指 GLM route，只要这是 workflow worker，宿主机真
  // ANTHROPIC_API_KEY 都不能流过去。原来把 strip 关进 GLM 分支内 → user 误改 base URL
  // 或历史 launch config 漏迁移时，不进 GLM 分支 → 父进程 ANTHROPIC_API_KEY 透传到
  // workflow worker（越权 + 可能被 worker 拿去打真 Anthropic 端）。
  // GLM_API_KEY → ANTHROPIC_AUTH_TOKEN 的合成仅在 GLM route + GLM_API_KEY 非空时【额外】触发。
  if (scope.workflowAllowed === true && env.HIVE_WORKFLOW_ALLOWED === '1') {
    delete env.ANTHROPIC_API_KEY
    if (
      env.ANTHROPIC_BASE_URL === CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL &&
      typeof process.env.GLM_API_KEY === 'string' &&
      process.env.GLM_API_KEY.trim().length > 0
    ) {
      env.ANTHROPIC_AUTH_TOKEN = process.env.GLM_API_KEY
    }
  }
  if (env.GLM_API_KEY !== inputEnv?.GLM_API_KEY) delete env.GLM_API_KEY
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || isNestedClaudeCodeEnvKey(key)) delete env[key]
  }
  return env
}

export const createAgentManager = ({
  logger,
  ptyOutputBus = createPtyOutputBus(),
}: {
  logger?: HiveLogger
  ptyOutputBus?: PtyOutputBus
} = {}): AgentManager => {
  const runs = new Map<string, AgentRunRecord>()

  const getRunRecord = (runId: string) => {
    const run = runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    return run
  }

  return {
    getOutputBus() {
      return ptyOutputBus
    },
    pauseRun(runId) {
      getRunRecord(runId).process.pause()
    },
    async startAgent(input) {
      const env = createAgentSpawnEnv(input.env, input.envScope)
      const spawnCommand = resolveSpawnCommand(input.command, input.cwd, env, input.args ?? [])

      const runId = createRunId()

      const run: AgentRunRecord = {
        runId,
        agentId: input.agentId,
        pid: null,
        status: 'starting',
        output: '',
        exitCode: null,
        errorTail: null,
        errorTailBuffer: createOutputTailBuffer(),
        process: {
          isStopped() {
            return false
          },
          pause() {},
          pid: null,
          resize() {},
          resume() {},
          stop() {},
          write() {},
        },
      }

      if (input.onExit) run.onExit = input.onExit

      runs.set(runId, run)

      try {
        attachAgentPty(
          run,
          spawn(spawnCommand.command, spawnCommand.args, {
            cwd: input.cwd,
            env,
            name: 'xterm-256color',
          }),
          ptyOutputBus,
          logger
        )
      } catch (error) {
        runs.delete(runId)
        throw error
      }

      return toAgentRunSnapshot(run)
    },

    resizeRun(runId, cols, rows) {
      getRunRecord(runId).process.resize(cols, rows)
    },

    resumeRun(runId) {
      getRunRecord(runId).process.resume()
    },

    writeInput(runId, text) {
      getRunRecord(runId).process.write(text)
    },

    getRun(runId) {
      return toAgentRunSnapshot(getRunRecord(runId))
    },

    removeRun(runId) {
      runs.delete(runId)
    },

    stopRun(runId) {
      const run = getRunRecord(runId)
      run.process.stop()
    },
  }
}

export type {
  AgentEnvScope,
  AgentManager,
  AgentRunRecord,
  AgentRunSnapshot,
  RunStatus,
  StartAgentInput,
}
