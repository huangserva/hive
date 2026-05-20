import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

type LogLevel = 'error' | 'info' | 'warn'

interface HiveLogger {
  close: () => Promise<void>
  error: (message: string, error?: unknown) => void
  info: (message: string) => void
  warn: (message: string, error?: unknown) => void
}

interface CreateHiveLoggerOptions {
  dataDir: string
  env?: NodeJS.ProcessEnv
  port: number
}

const noopLogger: HiveLogger = {
  async close() {},
  error() {},
  info() {},
  warn() {},
}

const formatError = (error: unknown) => {
  if (error === undefined) return ''
  if (error instanceof Error) return error.stack ?? error.message
  return format(error)
}

const writeLine = (stream: WriteStream, level: LogLevel, message: string, error?: unknown) => {
  const suffix = formatError(error)
  const body = suffix ? `${message}\n${suffix}` : message
  stream.write(`[${new Date().toISOString()}] [${level}] ${body}\n`)
}

export const createHiveLogger = ({
  dataDir,
  env = process.env,
  port,
}: CreateHiveLoggerOptions): HiveLogger => {
  if (env.HIVE_LOG === '0') return noopLogger

  const logDir = join(dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const stream = createWriteStream(join(logDir, `runtime-${port}.log`), { flags: 'a' })

  return {
    close() {
      return new Promise<void>((resolve) => {
        stream.end(resolve)
      })
    },
    error(message, error) {
      writeLine(stream, 'error', message, error)
    },
    info(message) {
      writeLine(stream, 'info', message)
    },
    warn(message, error) {
      writeLine(stream, 'warn', message, error)
    },
  }
}

export type { HiveLogger }
