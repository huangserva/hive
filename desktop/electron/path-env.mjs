import { execSync as defaultExecSync } from 'node:child_process'
import { delimiter } from 'node:path'

const DEFAULT_POSIX_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

const getPathValue = (env) => env.PATH ?? env.Path ?? env.path ?? ''

const expandHome = (path, home) => (home ? path.replace(/^~(?=\/|$)/, home) : path)

const readLoginShellPath = ({ env, execSync, platform }) => {
  if (platform === 'win32') return ''
  const shell = env.SHELL || '/bin/zsh'
  try {
    return String(
      execSync('printf %s "$PATH"', {
        encoding: 'utf8',
        env,
        shell,
      })
    ).trim()
  } catch {
    return ''
  }
}

const buildFallbackPathParts = (env, platform) => {
  if (platform === 'win32') return []
  const home = env.HOME ?? ''
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '~/.local/bin',
    '~/.bun/bin',
    '~/.npm-global/bin',
    env.NVM_BIN,
    '~/.nvm/current/bin',
  ]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .map((part) => expandHome(part, home))
}

export const resolveDesktopPathEnv = ({
  env = process.env,
  execSync = defaultExecSync,
  platform = process.platform,
} = {}) => {
  const currentPath = getPathValue(env)
  if (platform === 'win32') return currentPath

  const shellPath = readLoginShellPath({ env, execSync, platform })
  const parts = [
    ...buildFallbackPathParts(env, platform),
    ...(shellPath || DEFAULT_POSIX_PATH).split(delimiter),
    ...currentPath.split(delimiter),
  ]
  const seen = new Set()
  const merged = []
  for (const part of parts) {
    const normalized = part.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    merged.push(normalized)
  }
  return merged.join(delimiter)
}

export const repairDesktopPathEnv = (env = process.env) => {
  env.PATH = resolveDesktopPathEnv({ env })
  return env.PATH
}
