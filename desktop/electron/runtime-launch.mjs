export const prepareElectronRuntimeEnv = ({
  env = process.env,
  repairDesktopPathEnv,
  rootEnvFile,
  staticDir,
}) => {
  repairDesktopPathEnv(env)
  env.HIVE_ELECTRON = '1'
  env.HIVE_ROOT_ENV_FILE ??= rootEnvFile
  env.HIVE_STATIC_DIR ??= staticDir
}

const isPortInUseError = (error) => {
  if (!(error instanceof Error)) return false
  return error.code === 'EADDRINUSE' || /port \d+ is already in use/i.test(error.message)
}

export const startHiveRuntimeWithPortRetry = async ({
  logger = console,
  maxAttempts = 20,
  runHiveCommand,
  startPort,
}) => {
  let port = startPort
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await runHiveCommand(['--port', String(port)], { logger })
    } catch (error) {
      if (!isPortInUseError(error) || attempt === maxAttempts - 1) {
        throw error
      }
      port += 1
    }
  }
  throw new Error('unreachable')
}
