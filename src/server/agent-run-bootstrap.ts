import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isThinkingLevelSupported } from '../shared/thinking-levels.js'
import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'
import type { AgentLaunchConfigInput } from './agent-run-store.js'
import type { AgentSessionStorePort } from './agent-runtime-ports.js'
import {
  buildAgentLegacyIdentityMarker,
  buildAgentSessionBindingMarker,
} from './agent-startup-instructions.js'
import type { CommandPresetRecord } from './command-preset-store.js'
import { withPresetResumeArgs } from './preset-launch-support.js'
import {
  isClaudeCaptureSource,
  isClaudeManagedHomeEnabled,
  isCodexCaptureSource,
  materializeClaudeManagedProfile,
  materializeCodexManagedProfile,
} from './provider-runtime-profile.js'
import {
  captureSessionIdForCapture,
  getSessionCaptureEnvironment,
  type SessionCaptureSnapshot,
  snapshotSessionIdsForCapture,
} from './session-capture.js'

const resolveHiveBinDir = () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const packageRoot = resolve(moduleDir, '../..')
  return resolve(packageRoot, 'bin')
}

const HIVE_BIN_DIR = resolveHiveBinDir()
const SESSION_CAPTURE_TIMEOUT_MS = 30_000

type LaunchPreset = Pick<
  CommandPresetRecord,
  'resumeArgsTemplate' | 'sessionIdCapture' | 'yoloArgsTemplate'
>

const resolveLaunchPreset = (
  config: AgentLaunchConfigInput,
  getCommandPreset: (id: string) => CommandPresetRecord | undefined
): LaunchPreset | undefined => {
  if (config.presetAugmentationDisabled) return undefined
  if (config.commandPresetId) return getCommandPreset(config.commandPresetId)

  const implicitPreset = getCommandPreset(config.command)
  if (!implicitPreset || implicitPreset.command !== config.command) return undefined

  return {
    resumeArgsTemplate: null,
    sessionIdCapture: null,
    yoloArgsTemplate: implicitPreset.yoloArgsTemplate,
  }
}

const createSessionCaptureDiscriminator = (
  workspace: WorkspaceSummary,
  agent: AgentSummary | undefined
) => {
  if (!agent) return undefined
  return {
    contentIncludes: [
      buildAgentSessionBindingMarker({ agent, workspace }),
      buildAgentLegacyIdentityMarker({ agent, workspace }),
    ],
  }
}

const getThinkingLevelArgs = (presetId: string, thinkingLevel: string): string[] => {
  if (presetId === 'claude') return ['--effort', thinkingLevel]
  if (presetId === 'codex') return ['-c', `model_reasoning_effort=${thinkingLevel}`]
  return []
}

const hasThinkingLevelArgs = (presetId: string, args: string[]) => {
  if (presetId === 'claude') return args.includes('--effort')
  if (presetId !== 'codex') return false
  return args.some((arg, index) => {
    if (arg.startsWith('model_reasoning_effort=')) return true
    return arg === '-c' && args[index + 1]?.startsWith('model_reasoning_effort=')
  })
}

const withThinkingLevelArgs = (config: AgentLaunchConfigInput): AgentLaunchConfigInput => {
  if (config.presetAugmentationDisabled || !config.thinkingLevel) return config
  const presetId = config.commandPresetId ?? config.command
  if (!isThinkingLevelSupported(presetId, config.thinkingLevel)) return config
  const args = config.args ?? []
  if (hasThinkingLevelArgs(presetId, args)) return config
  const thinkingArgs = getThinkingLevelArgs(presetId, config.thinkingLevel)
  if (thinkingArgs.length === 0) return config
  return { ...config, args: [...thinkingArgs, ...args] }
}

export const buildAgentRunBootstrap = (
  workspace: WorkspaceSummary,
  agentId: string,
  config: AgentLaunchConfigInput,
  sessionStore: AgentSessionStorePort,
  getCommandPreset: (id: string) => CommandPresetRecord | undefined,
  agent?: AgentSummary,
  // M25 Phase 1：runtime state 目录。提供时，codex agent 获得物理隔离的 managed CODEX_HOME；
  // 未提供（如内存 runtime / 老测试）时退回原全局 `~/.codex` 行为，保持向后兼容。
  dataDir?: string
) => {
  const preset = resolveLaunchPreset(config, getCommandPreset)
  const discriminator = createSessionCaptureDiscriminator(workspace, agent)

  // M25 Phase 2：claude 且有 dataDir 且显式开启门控 → 物化 per-agent managed HOME（私有 ~/.claude）。
  // 默认关闭（HIVE_CLAUDE_MANAGED_HOME=1）：claude 登录态在 macOS 走 Keychain，重定位 HOME 有鉴权风险，
  // 需真机验证后再默认开。必须在 withPresetResumeArgs **之前**物化：claude 的 resume 会校验会话文件存在，
  // 该校验必须扫 managed projects 根（`<HOME>/.claude/projects`）而非全局 ~/.claude/projects，否则
  // per-agent 隔离的会话找不到、resume 被错误丢弃。与 M32 cwd 维解耦：本维只设 HOME / CLAUDE_PROJECTS_ROOT。
  const effectiveCaptureSource = (config.sessionIdCapture ?? preset?.sessionIdCapture)?.source
  const claudeManaged =
    dataDir && isClaudeManagedHomeEnabled() && isClaudeCaptureSource(effectiveCaptureSource)
      ? materializeClaudeManagedProfile(dataDir, agentId)
      : undefined

  const startConfig = withPresetResumeArgs(
    config,
    preset,
    sessionStore.getLastSessionId(workspace.id, agentId),
    workspace.path,
    discriminator,
    () => sessionStore.clearLastSessionId(workspace.id, agentId),
    claudeManaged?.projectsRoot
  )
  const startConfigWithThinking = withThinkingLevelArgs(startConfig)

  // codex 且有 dataDir → 物化 per-agent managed home（建目录 + 投影 config/auth），
  // 拿到要钉死的 CODEX_HOME / CODEX_SESSION_ROOT。fresh-start 与 resume 都要设这套 env：
  // resume 时 snapshot 为 undefined，若不在此显式注入，codex 会回落全局 home 找不到 managed session。
  const codexManaged =
    dataDir && isCodexCaptureSource(startConfigWithThinking.sessionIdCapture?.source)
      ? materializeCodexManagedProfile(dataDir, agentId)
      : undefined

  const sessionCaptureSnapshot = startConfig.resumedSessionId
    ? undefined
    : snapshotSessionIdsForCapture(
        workspace.path,
        startConfigWithThinking.sessionIdCapture,
        discriminator,
        codexManaged?.home,
        claudeManaged?.projectsRoot
      )
  return {
    sessionCaptureSnapshot,
    startConfig: startConfigWithThinking,
    startEnv: {
      ...getSessionCaptureEnvironment(sessionCaptureSnapshot),
      // managed CODEX_HOME / CODEX_SESSION_ROOT 必须压过 snapshot env，且 resume 路径也要带。
      ...(codexManaged ? codexManaged.env : {}),
      // managed Claude HOME / CLAUDE_PROJECTS_ROOT 同理压过 snapshot env，fresh + resume 都带。
      ...(claudeManaged ? claudeManaged.env : {}),
      HIVE_PORT: '',
      HIVE_PROJECT_ID: workspace.id,
      HIVE_AGENT_ID: agentId,
      HIVE_AGENT_TOKEN: '',
      PATH: `${HIVE_BIN_DIR}${delimiter}${process.env.PATH ?? ''}`,
    },
  }
}

export const startAgentRunCapture = ({
  agentId,
  sessionCaptureSnapshot,
  sessionStore,
  startConfig,
  workspace,
}: {
  agentId: string
  sessionCaptureSnapshot: SessionCaptureSnapshot | undefined
  sessionStore: AgentSessionStorePort
  startConfig: AgentLaunchConfigInput
  workspace: WorkspaceSummary
}) => {
  if (!sessionCaptureSnapshot || !startConfig.sessionIdCapture) return
  void captureSessionIdForCapture(
    workspace.path,
    startConfig.sessionIdCapture,
    sessionCaptureSnapshot,
    (sessionId) => {
      sessionStore.setLastSessionId(workspace.id, agentId, sessionId)
    },
    SESSION_CAPTURE_TIMEOUT_MS
  )
}
