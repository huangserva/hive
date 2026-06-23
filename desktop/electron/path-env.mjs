import { execSync as defaultExecSync } from 'node:child_process'
import { readdirSync as defaultReaddirSync } from 'node:fs'
import { delimiter } from 'node:path'

const DEFAULT_POSIX_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const PATH_MARKER_START = '__HIVE_DESKTOP_PATH_START__'
const PATH_MARKER_END = '__HIVE_DESKTOP_PATH_END__'

const getPathValue = (env) => env.PATH ?? env.Path ?? env.path ?? ''

const expandHome = (path, home) => (home ? path.replace(/^~(?=\/|$)/, home) : path)

const readLoginShellPath = ({ env, execSync, platform }) => {
  if (platform === 'win32') return ''
  const shell = env.SHELL || '/bin/zsh'
  const command = `${JSON.stringify(shell)} -l -i -c 'printf "${PATH_MARKER_START}%s${PATH_MARKER_END}" "$PATH"'`
  try {
    const output = String(
      execSync(command, {
        encoding: 'utf8',
        env,
        shell: '/bin/sh',
        timeout: 2000,
      })
    ).trim()
    const start = output.indexOf(PATH_MARKER_START)
    const end = output.indexOf(PATH_MARKER_END, start + PATH_MARKER_START.length)
    if (start >= 0 && end > start) {
      return output.slice(start + PATH_MARKER_START.length, end).trim()
    }
    return output
  } catch {
    return ''
  }
}

const listNvmVersionBins = (env, readdirSync) => {
  const home = env.HOME ?? ''
  if (!home) return []
  const versionsRoot = `${home}/.nvm/versions/node`
  try {
    return readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${versionsRoot}/${entry.name}/bin`)
  } catch {
    return []
  }
}

const buildFallbackPathParts = (env, platform, readdirSync) => {
  if (platform === 'win32') return []
  const home = env.HOME ?? ''
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '~/.local/bin',
    '~/.bun/bin',
    '~/.npm-global/bin',
    env.NVM_BIN,
    ...listNvmVersionBins(env, readdirSync),
  ]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .map((part) => expandHome(part, home))
}

export const resolveDesktopPathEnv = ({
  env = process.env,
  execSync = defaultExecSync,
  platform = process.platform,
  readdirSync = defaultReaddirSync,
} = {}) => {
  const currentPath = getPathValue(env)
  if (platform === 'win32') return currentPath

  const shellPath = readLoginShellPath({ env, execSync, platform })
  const parts = [
    ...buildFallbackPathParts(env, platform, readdirSync),
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
