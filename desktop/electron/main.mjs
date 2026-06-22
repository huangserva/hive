import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, shell } from 'electron'

import { runHiveCommand } from '../../dist/src/cli/hive.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '../..')

let mainWindow = null
let runtime = null
let quitting = false

const resolvePort = () => process.env.HIVE_ELECTRON_PORT ?? '4010'

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
  process.env.HIVE_ELECTRON = '1'
  process.env.HIVE_STATIC_DIR ??= resolve(appRoot, 'web/dist')

  runtime = await runHiveCommand(['--port', resolvePort()], {
    logger: console,
  })
  return runtime.port
}

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

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0 && runtime) {
    await createMainWindow(runtime.port)
  }
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
