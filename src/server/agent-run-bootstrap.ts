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
  agent?: AgentSummary
) => {
  const preset = resolveLaunchPreset(config, getCommandPreset)
  const discriminator = createSessionCaptureDiscriminator(workspace, agent)
  const startConfig = withPresetResumeArgs(
    config,
    preset,
    sessionStore.getLastSessionId(workspace.id, agentId),
    workspace.path,
    discriminator,
    () => sessionStore.clearLastSessionId(workspace.id, agentId)
  )
  const startConfigWithThinking = withThinkingLevelArgs(startConfig)
  const sessionCaptureSnapshot = startConfig.resumedSessionId
    ? undefined
    : snapshotSessionIdsForCapture(
        workspace.path,
        startConfigWithThinking.sessionIdCapture,
        discriminator
      )
  return {
    sessionCaptureSnapshot,
    startConfig: startConfigWithThinking,
    startEnv: {
      ...getSessionCaptureEnvironment(sessionCaptureSnapshot),
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
