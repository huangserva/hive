import { execSync as defaultExecSync } from 'node:child_process'
import { readdirSync as defaultReaddirSync } from 'node:fs'
import { delimiter } from 'node:path'

const DEFAULT_POSIX_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const SHELL_ENV_MARKER_START = '__HIVE_DESKTOP_ENV_START__'
const SHELL_ENV_MARKER_END = '__HIVE_DESKTOP_ENV_END__'
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]

const getPathValue = (env) => env.PATH ?? env.Path ?? env.path ?? ''

const expandHome = (path, home) => (home ? path.replace(/^~(?=\/|$)/, home) : path)

const parseShellEnvOutput = (output) => {
  const start = output.indexOf(SHELL_ENV_MARKER_START)
  const end = output.indexOf(SHELL_ENV_MARKER_END, start + SHELL_ENV_MARKER_START.length)
  if (start < 0 || end <= start) return {}
  const body = output.slice(start + SHELL_ENV_MARKER_START.length, end)
  const values = {}
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return values
}

const readLoginShellEnv = ({ env, execSync, platform }) => {
  if (platform === 'win32') return {}
  const shell = env.SHELL || '/bin/zsh'
  const proxyKeys = PROXY_ENV_KEYS.join(' ')
  const command = `${JSON.stringify(shell)} -l -i -c 'printf "${SHELL_ENV_MARKER_START}\\n"; printf "PATH=%s\\n" "$PATH"; for key in ${proxyKeys}; do value=$(printenv "$key" 2>/dev/null || true); if [ -n "$value" ]; then printf "%s=%s\\n" "$key" "$value"; fi; done; printf "${SHELL_ENV_MARKER_END}\\n"'`
  try {
    const output = String(
      execSync(command, {
        encoding: 'utf8',
        env,
        shell: '/bin/sh',
        timeout: 2000,
      })
    ).trim()
    return parseShellEnvOutput(output)
  } catch {
    return {}
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
  shellEnv,
} = {}) => {
  const currentPath = getPathValue(env)
  if (platform === 'win32') return currentPath

  const resolvedShellEnv = shellEnv ?? readLoginShellEnv({ env, execSync, platform })
  const shellPath = resolvedShellEnv.PATH ?? ''
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

const repairDesktopProxyEnv = (env, shellEnv) => {
  for (const key of PROXY_ENV_KEYS) {
    if (env[key] === undefined && shellEnv[key]) {
      env[key] = shellEnv[key]
    }
  }
}

export const repairDesktopPathEnv = (env = process.env, options = {}) => {
  const platform = options.platform ?? process.platform
  const shellEnv =
    platform === 'win32'
      ? {}
      : readLoginShellEnv({
          env,
          execSync: options.execSync ?? defaultExecSync,
          platform,
        })
  env.PATH = resolveDesktopPathEnv({
    env,
    execSync: options.execSync ?? defaultExecSync,
    platform,
    readdirSync: options.readdirSync ?? defaultReaddirSync,
    shellEnv,
  })
  repairDesktopProxyEnv(env, shellEnv)
  return env.PATH
}
