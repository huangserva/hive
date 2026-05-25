#!/usr/bin/env node

import { once } from 'node:events'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
import { createRuntimeStore, type RuntimeStore } from '../server/runtime-store.js'
import { createVersionService, type VersionService } from '../server/version-service.js'

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
  const feishuTransport = feishuCredentials
    ? new FeishuTransport({
        credentials: feishuCredentials,
        logger,
        store,
      })
    : null
  const app = createApp({
    feishuTransport,
    store,
    logger,
    runtimeInfo: { dataDir, port },
    versionService,
  })

  try {
    app.server.listen(port, '127.0.0.1')
    await Promise.race([
      once(app.server, 'listening'),
      once(app.server, 'error').then(([error]) => {
        throw error
      }),
    ])
  } catch (error) {
    await feishuTransport?.stop()
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
