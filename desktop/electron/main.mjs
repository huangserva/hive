import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, shell } from 'electron'

import { repairDesktopPathEnv } from './path-env.mjs'
import { prepareElectronRuntimeEnv, startHiveRuntimeWithPortRetry } from './runtime-launch.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '../..')

let mainWindow = null
let runtime = null
let quitting = false

const resolvePort = () => process.env.HIVE_ELECTRON_PORT ?? '4010'
const resolveInitialPort = () => Number.parseInt(resolvePort(), 10) || 4010

const focusMainWindow = () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

const createMainWindow = async (port) => {
  mainWindow = new BrowserWindow({
    height: 900,
    minHeight: 720,
    minWidth: 1120,
    show: false,
    title: 'HippoTeam',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 1280,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`)
}

const startRuntime = async () => {
  prepareElectronRuntimeEnv({
    repairDesktopPathEnv,
    rootEnvFile: resolve(appRoot, '.env'),
    staticDir: resolve(appRoot, 'web/dist'),
  })
  const { runHiveCommand } = await import('../../dist/src/cli/hive.js')

  runtime = await startHiveRuntimeWithPortRetry({
    logger: console,
    runHiveCommand,
    startPort: resolveInitialPort(),
  })
  return runtime.port
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusMainWindow()
  })

  app.whenReady().then(async () => {
    try {
      const port = await startRuntime()
      await createMainWindow(port)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await dialog.showMessageBox({
        buttons: ['Quit'],
        message: 'HippoTeam failed to start.',
        detail: message,
        type: 'error',
      })
      app.quit()
    }
  })
}

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0 && runtime) {
    await createMainWindow(runtime.port)
    return
  }
  focusMainWindow()
})

app.on('before-quit', async (event) => {
  if (quitting) {
    return
  }
  event.preventDefault()
  quitting = true
  try {
    await runtime?.close()
  } finally {
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
