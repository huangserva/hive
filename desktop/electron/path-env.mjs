import { execSync as defaultExecSync } from 'node:child_process'
import { readdirSync as defaultReaddirSync } from 'node:fs'
import { delimiter, win32 as win32Path } from 'node:path'

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
const LOGIN_SHELL_TIMEOUT_MS = 7000

const getPathValue = (env) => env.PATH ?? env.Path ?? env.path ?? ''

const expandHome = (path, home) => (home ? path.replace(/^~(?=\/|$)/, home) : path)
const getPathDelimiter = (platform) => (platform === 'win32' ? win32Path.delimiter : delimiter)

const getEnvValue = (env, key, platform) => {
  if (platform !== 'win32') return env[key]
  const matchedKey = Object.keys(env).find((item) => item.toLowerCase() === key.toLowerCase())
  return matchedKey ? env[matchedKey] : undefined
}

const expandWindowsEnvRefs = (value, env) =>
  value.replace(/%([^%]+)%/g, (match, key) => getEnvValue(env, key, 'win32') ?? match)

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
  if (platform === 'win32') return readWindowsRegistryPathEnv({ env, execSync })
  const shell = env.SHELL || '/bin/zsh'
  const proxyKeys = PROXY_ENV_KEYS.join(' ')
  const command = `${JSON.stringify(shell)} -l -i -c 'printf "${SHELL_ENV_MARKER_START}\\n"; printf "PATH=%s\\n" "$PATH"; for key in ${proxyKeys}; do value=$(printenv "$key" 2>/dev/null || true); if [ -n "$value" ]; then printf "%s=%s\\n" "$key" "$value"; fi; done; printf "${SHELL_ENV_MARKER_END}\\n"'`
  try {
    const output = String(
      execSync(command, {
        encoding: 'utf8',
        env,
        shell: '/bin/sh',
        timeout: LOGIN_SHELL_TIMEOUT_MS,
      })
    ).trim()
    return parseShellEnvOutput(output)
  } catch {
    return {}
  }
}

const parseWindowsRegistryPathOutput = (output, env) => {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i.exec(line)
    if (!match) continue
    return expandWindowsEnvRefs(match[1].trim(), env)
  }
  return ''
}

const readWindowsRegistryPathEnv = ({ env, execSync }) => {
  const commands = [
    'reg query HKCU\\Environment /v PATH',
    'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v PATH',
  ]
  const paths = []
  for (const command of commands) {
    try {
      const output = String(
        execSync(command, {
          encoding: 'utf8',
          env,
          shell: true,
          timeout: 2000,
        })
      )
      const path = parseWindowsRegistryPathOutput(output, env)
      if (path) paths.push(path)
    } catch {
      // Missing registry values are common on fresh machines; fallbacks below cover them.
    }
  }
  return paths.length > 0 ? { PATH: paths.join(win32Path.delimiter) } : {}
}

const parseScutilProxyOutput = (output) => {
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    values[match[1]] = match[2]
  }
  const proxyEnv = {}
  if (values.HTTPEnable === '1' && values.HTTPProxy && values.HTTPPort) {
    proxyEnv.HTTP_PROXY = `http://${values.HTTPProxy}:${values.HTTPPort}`
    proxyEnv.http_proxy = proxyEnv.HTTP_PROXY
  }
  if (values.HTTPSEnable === '1' && values.HTTPSProxy && values.HTTPSPort) {
    proxyEnv.HTTPS_PROXY = `http://${values.HTTPSProxy}:${values.HTTPSPort}`
    proxyEnv.https_proxy = proxyEnv.HTTPS_PROXY
  }
  if (values.SOCKSEnable === '1' && values.SOCKSProxy && values.SOCKSPort) {
    proxyEnv.ALL_PROXY = `socks5://${values.SOCKSProxy}:${values.SOCKSPort}`
    proxyEnv.all_proxy = proxyEnv.ALL_PROXY
  }
  return proxyEnv
}

const readMacSystemProxyEnv = ({ execSync, platform }) => {
  if (platform !== 'darwin') return {}
  try {
    return parseScutilProxyOutput(
      String(
        execSync('scutil --proxy', {
          encoding: 'utf8',
          shell: '/bin/sh',
          timeout: 2000,
        })
      )
    )
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
  if (platform === 'win32') {
    return [
      getEnvValue(env, 'APPDATA', platform)
        ? `${getEnvValue(env, 'APPDATA', platform)}\\npm`
        : undefined,
      getEnvValue(env, 'LOCALAPPDATA', platform)
        ? `${getEnvValue(env, 'LOCALAPPDATA', platform)}\\Microsoft\\WinGet\\Links`
        : undefined,
      getEnvValue(env, 'APPDATA', platform)
        ? `${getEnvValue(env, 'APPDATA', platform)}\\nvm`
        : undefined,
      getEnvValue(env, 'ProgramFiles', platform)
        ? `${getEnvValue(env, 'ProgramFiles', platform)}\\nodejs`
        : undefined,
      getEnvValue(env, 'ProgramFiles(x86)', platform)
        ? `${getEnvValue(env, 'ProgramFiles(x86)', platform)}\\nodejs`
        : undefined,
    ].filter((part) => typeof part === 'string' && part.length > 0)
  }
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

  const resolvedShellEnv = shellEnv ?? readLoginShellEnv({ env, execSync, platform })
  const shellPath = resolvedShellEnv.PATH ?? ''
  const pathDelimiter = getPathDelimiter(platform)
  const parts =
    platform === 'win32'
      ? [
          ...(shellPath || '').split(pathDelimiter),
          ...buildFallbackPathParts(env, platform, readdirSync),
          ...currentPath.split(pathDelimiter),
        ]
      : [
          ...buildFallbackPathParts(env, platform, readdirSync),
          ...(shellPath || DEFAULT_POSIX_PATH).split(pathDelimiter),
          ...currentPath.split(pathDelimiter),
        ]
  const seen = new Set()
  const merged = []
  for (const part of parts) {
    const normalized = part.trim()
    const key = platform === 'win32' ? normalized.toLowerCase() : normalized
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    merged.push(normalized)
  }
  return merged.join(pathDelimiter)
}

const repairDesktopProxyEnv = (env, ...sources) => {
  for (const key of PROXY_ENV_KEYS) {
    if (env[key]) continue
    for (const source of sources) {
      if (source[key]) {
        env[key] = source[key]
        break
      }
    }
  }
}

export const repairDesktopPathEnv = (env = process.env, options = {}) => {
  const platform = options.platform ?? process.platform
  const shellEnv = readLoginShellEnv({
    env,
    execSync: options.execSync ?? defaultExecSync,
    platform,
  })
  const systemProxyEnv =
    platform === 'win32'
      ? {}
      : readMacSystemProxyEnv({
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
  repairDesktopProxyEnv(env, shellEnv, systemProxyEnv)
  return env.PATH
}
