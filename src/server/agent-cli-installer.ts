import { spawnSync } from 'node:child_process'

import { resolveCommandPath } from './agent-command-resolver.js'
import { getBuiltinCommandPreset } from './command-preset-defaults.js'

export interface AgentCliInstallCommand {
  args: string[]
  command: string
  description: string
}

export interface AgentCliInstallPlan {
  command: string
  install: AgentCliInstallCommand | null
  installed: boolean
  path: string | null
  presetId: string
  version: string | null
}

export interface AgentCliDetectionOptions {
  commandExists?: (command: string) => boolean
  commandOverride?: string | null
  commandResolver?: (command: string) => string | null
  cwd?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  versionReader?: (command: string) => string | null
}

export const SUPPORTED_AGENT_CLI_PRESETS = ['claude', 'codex', 'opencode', 'gemini'] as const

const DEFAULT_INSTALLERS: Record<string, AgentCliInstallCommand> = {
  claude: {
    args: ['-lc', 'curl -fsSL https://claude.ai/install.sh | sh'],
    command: '/bin/sh',
    description: 'Install Claude Code via the official claude.ai installer.',
  },
  codex: {
    args: ['install', '-g', '@openai/codex'],
    command: 'npm',
    description: 'Install Codex CLI via npm.',
  },
  gemini: {
    args: ['install', '-g', '@google/gemini-cli'],
    command: 'npm',
    description: 'Install Gemini CLI via npm.',
  },
  opencode: {
    args: ['install', '-g', 'opencode-ai'],
    command: 'npm',
    description: 'Install OpenCode CLI via npm.',
  },
}

const defaultCommandResolver = (
  command: string,
  options: Pick<AgentCliDetectionOptions, 'cwd' | 'env' | 'platform'>
) => {
  try {
    return resolveCommandPath(
      command,
      options.cwd ?? process.cwd(),
      options.env ?? process.env,
      options.platform ?? process.platform
    )
  } catch {
    return null
  }
}

const defaultVersionReader = (command: string) => {
  try {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      shell: false,
      timeout: 3000,
    })
    if (result.error || result.status !== 0) return null
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    return output ?? null
  } catch {
    return null
  }
}

const resolvePresetCommand = (presetId: string) =>
  getBuiltinCommandPreset(presetId)?.command ?? presetId

export const detectAgentCli = (
  presetId: string,
  options: AgentCliDetectionOptions = {}
): Omit<AgentCliInstallPlan, 'install'> => {
  const command = options.commandOverride?.trim() || resolvePresetCommand(presetId)
  const resolvedPath =
    options.commandResolver?.(command) ??
    (options.commandExists
      ? options.commandExists(command)
        ? command
        : null
      : defaultCommandResolver(command, options))
  const versionReader = options.versionReader ?? defaultVersionReader
  return {
    command,
    installed: resolvedPath !== null,
    path: resolvedPath,
    presetId,
    version: resolvedPath ? versionReader(resolvedPath) : null,
  }
}

export const buildAgentCliInstallPlan = (
  presetId: string,
  options: AgentCliDetectionOptions = {}
): AgentCliInstallPlan => {
  const detection = detectAgentCli(presetId, options)
  return {
    ...detection,
    install: detection.installed ? null : (DEFAULT_INSTALLERS[presetId] ?? null),
  }
}
