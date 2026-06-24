#!/usr/bin/env node

import { once } from 'node:events'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAgentManager } from '../server/agent-manager.js'
import { createApp } from '../server/app.js'
import {
  type FeishuCredentials,
  FeishuCredentialsError,
  loadFeishuCredentials,
} from '../server/feishu-credentials.js'
import { FeishuTransport } from '../server/feishu-transport.js'
import { createHiveLogger, type HiveLogger } from '../server/logger.js'
import { readPackageVersion } from '../server/package-version.js'
import { loadRelayConfig } from '../server/relay-config.js'
import { createRelayConnector, type RelayConnectorHandle } from '../server/relay-connector.js'
import { createRelayRpcHandler, resolveWebRtcIceServers } from '../server/relay-rpc-handler.js'
import { createVoiceStreamTtsHandler } from '../server/relay-voice-stream-tts.js'
import { createRuntimeStore, type RuntimeStore } from '../server/runtime-store.js'
import { injectSecretsIntoEnv } from '../server/secret-store.js'
import { createVersionService, type VersionService } from '../server/version-service.js'
import { createWebRtcCallee } from '../server/webrtc-callee.js'
import { createWebRtcDownlinkAudio } from '../server/webrtc-downlink-audio.js'
import {
  createWebRtcFileDownlinkAudio,
  resolveWebRtcDownlinkMode,
} from '../server/webrtc-file-downlink-audio.js'
import { createWebRtcUpstreamAudioSink } from '../server/webrtc-upstream-audio.js'

interface RunHiveCommandResult {
  port: number
  close: () => Promise<void>
  store: RuntimeStore
}

type RunHiveCommandOptions = {
  versionService?: VersionService
}

type ListenError = Error & {
  address?: string
  code?: string
  port?: number
}

export const loadRootEnvFile = ({
  cwd = process.cwd(),
  env = process.env,
}: {
  cwd?: string
  env?: NodeJS.ProcessEnv
} = {}) => {
  const configuredEnvPath = env.HIVE_ROOT_ENV_FILE
  const envPath = configuredEnvPath
    ? isAbsolute(configuredEnvPath)
      ? configuredEnvPath
      : join(cwd, configuredEnvPath)
    : join(cwd, '.env')
  if (!existsSync(envPath)) return false
  try {
    let loaded = false
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
      if (!match) continue
      const key = match[1]
      const rawValue = match[2]
      if (!key || rawValue === undefined) continue
      if (env[key] !== undefined) continue
      const value = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2')
      env[key] = value
      loaded = true
    }
    return loaded
  } catch {
    return false
  }
}

loadRootEnvFile()

export const HIVE_USAGE = [
  'Usage:',
  '  hive [--port <port>]',
  '',
  'Options:',
  '  --port <port>   Bind the local runtime to a specific port (default: 3000).',
  '  -h, --help      Print this help.',
  '  -v, --version   Print the installed Hive version.',
].join('\n')

export const handleHiveInfoCommand = (argv: string[]) => {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HIVE_USAGE)
    return true
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(readPackageVersion())
    return true
  }
  return false
}

const parsePort = (argv: string[]) => {
  let parsedPort: number | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--port') {
      if (arg?.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
      if (arg) throw new Error(`Unknown argument: ${arg}`)
      continue
    }

    const value = argv[index + 1]
    if (!value) {
      throw new Error('Usage: hive [--port <port>]')
    }

    const port = Number.parseInt(value, 10)
    if (Number.isNaN(port) || port < 0) {
      throw new Error(`Invalid port: ${value}`)
    }

    parsedPort = port
    index += 1
  }

  return parsedPort ?? 3000
}

const resolveDataDir = () => process.env.HIVE_DATA_DIR || join(homedir(), '.config', 'hive')

const registerFatalProcessLoggers = (logger: HiveLogger) => {
  const handleFatal = (label: string, error: unknown) => {
    logger.error(label, error)
    console.error(error)
    void logger.close().finally(() => {
      process.exit(1)
    })
  }
  const uncaughtException = (error: Error) => {
    handleFatal('uncaughtException', error)
  }
  const unhandledRejection = (reason: unknown) => {
    handleFatal('unhandledRejection', reason)
  }
  process.on('uncaughtException', uncaughtException)
  process.on('unhandledRejection', unhandledRejection)
  return () => {
    process.off('uncaughtException', uncaughtException)
    process.off('unhandledRejection', unhandledRejection)
  }
}

const maybePrintUpdateHint = async (versionService: VersionService) => {
  const info = await versionService.getVersionInfo()
  if (!info.update_available) return
  console.log(
    `Hive update available: ${info.current_version} -> ${info.latest_version}. Run: ${info.install_hint}`
  )
}

const isListenError = (error: unknown): error is ListenError =>
  error instanceof Error && typeof (error as ListenError).code === 'string'

const formatPortInUseMessage = (port: number) =>
  [
    `Hive could not start because port ${port} is already in use.`,
    '',
    'Another Hive instance may already be running:',
    `  http://127.0.0.1:${port}`,
    '',
    'Options:',
    '  - Open the existing Hive window.',
    '  - Stop the process using that port:',
    `      lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill`,
    '  - Start Hive on another port:',
    `      hive --port ${port + 1}`,
  ].join('\n')

const formatListenError = (error: unknown, requestedPort: number) => {
  if (isListenError(error) && error.code === 'EADDRINUSE') {
    return new Error(formatPortInUseMessage(error.port ?? requestedPort))
  }
  return error
}

export const runHiveCommand = async (
  argv: string[],
  options: RunHiveCommandOptions = {}
): Promise<RunHiveCommandResult> => {
  const port = parsePort(argv)
  const dataDir = resolveDataDir()
  injectSecretsIntoEnv({ dataDir })
  const logger = createHiveLogger({ dataDir, port })
  const unregisterFatalLoggers = registerFatalProcessLoggers(logger)
  let feishuCredentials: FeishuCredentials | null = null
  try {
    feishuCredentials = loadFeishuCredentials({ dataDir })
    if (feishuCredentials) {
      logger.info(`feishu credentials loaded app_id=${feishuCredentials.appId}`)
    } else {
      logger.info('feishu credentials not configured, transport disabled')
    }
  } catch (error) {
    if (error instanceof FeishuCredentialsError) {
      logger.error('feishu credentials invalid, transport disabled', error)
    } else {
      throw error
    }
  }
  const versionService = options.versionService ?? createVersionService()
  const version = readPackageVersion()
  const store = createRuntimeStore({
    agentManager: createAgentManager(),
    dataDir,
    logger,
  })
  let relayConnector: RelayConnectorHandle | null = null
  let webRtcRuntime:
    | {
        getActiveWorkspaceCallIds?: (workspaceId: string) => string[]
        hasActiveWorkspaceCall: (workspaceId: string) => boolean
      }
    | undefined
  try {
    const relayConfig = await loadRelayConfig({ dataDir })
    if (relayConfig.enabled) {
      const webRtcDownlinkMode = resolveWebRtcDownlinkMode()
      const webRtcCallee = createWebRtcCallee({
        audioSink: createWebRtcUpstreamAudioSink({ logger, store }),
        ...(webRtcDownlinkMode === 'file_segments'
          ? { fileDownlinkAudio: createWebRtcFileDownlinkAudio({ logger, store }) }
          : { downlinkAudio: createWebRtcDownlinkAudio({ logger, store }) }),
        getIceServers: async () => resolveWebRtcIceServers(),
      })
      webRtcRuntime = webRtcCallee
      relayConnector = createRelayConnector(
        relayConfig,
        createRelayRpcHandler({ runtimeInfo: { dataDir, port }, store }),
        {
          authenticateDevice: (token) => store.authenticateMobileDevice(token),
          voiceStreamHandler: createVoiceStreamTtsHandler({
            hasActiveWebRtcCall: (deviceId) => webRtcCallee.hasActiveCall(deviceId),
          }),
          webrtcSignalHandler: webRtcCallee.handleSignal,
        }
      )
      logger.info(
        `relay connector enabled relay_url=${relayConfig.relay_url} room_id=${relayConfig.room_id} webrtc_downlink_mode=${webRtcDownlinkMode}`
      )
    } else {
      logger.info('relay connector disabled')
    }
  } catch (error) {
    logger.error('relay connector config invalid, relay disabled', error)
  }
  const feishuTransport = feishuCredentials
    ? new FeishuTransport({
        credentials: feishuCredentials,
        logger,
        store,
      })
    : null
  const app = createApp({
    feishuTransport,
    relayConnector,
    store,
    logger,
    runtimeInfo: { dataDir, port },
    versionService,
    ...(webRtcRuntime ? { webRtcRuntime } : {}),
  })

  try {
    app.server.listen(port, '0.0.0.0')
    await Promise.race([
      once(app.server, 'listening'),
      once(app.server, 'error').then(([error]) => {
        throw error
      }),
    ])
  } catch (error) {
    await feishuTransport?.stop()
    relayConnector?.close()
    await app.store.close()
    await logger.close()
    unregisterFatalLoggers()
    throw formatListenError(error, port)
  }

  const address = app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Server did not bind to an inet port')
  }

  if (feishuCredentials) {
    try {
      await feishuTransport?.start()
    } catch (error) {
      logger.error('feishu transport failed to start, inbound disabled', error)
    }
  }

  let closePromise: Promise<void> | null = null
  const close = async () => {
    if (closePromise) {
      return closePromise
    }

    closePromise = (async () => {
      process.off('SIGTERM', gracefulShutdown)
      process.off('SIGINT', gracefulShutdown)
      unregisterFatalLoggers()
      await feishuTransport?.stop()
      relayConnector?.close()
      await new Promise<void>((resolve, reject) => {
        app.server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
      await app.store.close()
      await logger.close()
    })()

    return closePromise
  }

  const gracefulShutdown = () => {
    void close()
      .then(() => {
        process.exit(0)
      })
      .catch((error) => {
        console.error(error)
        process.exit(1)
      })
  }

  process.once('SIGTERM', gracefulShutdown)
  process.once('SIGINT', gracefulShutdown)

  console.log(`Hive running at http://127.0.0.1:${address.port}`)
  logger.info(
    `runtime started port=${address.port} pid=${process.pid} cwd=${process.cwd()} version=${version}`
  )
  void maybePrintUpdateHint(versionService).catch(() => {})

  return {
    port: address.port,
    close,
    store: app.store,
  }
}

export type { RunHiveCommandResult }

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
  : false

if (isMainModule) {
  const argv = process.argv.slice(2)
  if (handleHiveInfoCommand(argv)) process.exit(0)
  runHiveCommand(argv).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
