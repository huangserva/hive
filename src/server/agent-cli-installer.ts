import { spawnSync } from 'node:child_process'

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
  presetId: string
}

export interface AgentCliDetectionOptions {
  commandExists?: (command: string) => boolean
}

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

const defaultCommandExists = (command: string) => {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    stdio: 'ignore',
  })
  return result.status === 0
}

const resolvePresetCommand = (presetId: string) =>
  getBuiltinCommandPreset(presetId)?.command ?? presetId

export const detectAgentCli = (
  presetId: string,
  options: AgentCliDetectionOptions = {}
): Omit<AgentCliInstallPlan, 'install'> => {
  const command = resolvePresetCommand(presetId)
  const commandExists = options.commandExists ?? defaultCommandExists
  return {
    command,
    installed: commandExists(command),
    presetId,
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
