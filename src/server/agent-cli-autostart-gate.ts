import { resolveCommandPath } from './agent-command-resolver.js'
import type { AgentLaunchConfigInput } from './agent-run-store.js'
import { BadRequestError } from './http-errors.js'

export const assertAutostartCommandPresetAvailable = (
  launchConfig: AgentLaunchConfigInput | undefined
) => {
  if (!launchConfig?.commandPresetId) return
  try {
    resolveCommandPath(launchConfig.command, process.cwd(), {
      ...process.env,
      ...(launchConfig.env ?? {}),
    })
  } catch {
    throw new BadRequestError(
      `Command preset CLI is not installed or not on PATH: ${launchConfig.command}. Install it or set a manual CLI path first.`
    )
  }
}
