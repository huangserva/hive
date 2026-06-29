import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { WEB_TERMINAL_UPLOAD_MAX_BYTES } from '../../src/server/upload-limits.js'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

const createWorkspacePath = () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-web-upload-workspace-'))
  tempDirs.push(workspacePath)
  return workspacePath
}

const jsonHeaders = (cookie?: string) => ({
  'content-type': 'application/json',
  ...(cookie ? { cookie } : {}),
})

describe('workspace upload route', () => {
  test('rejects upload without a valid UI token', async () => {
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Auth')
      const response = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.from('private bytes').toString('base64'),
          filename: 'image.png',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(),
        method: 'POST',
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: 'UI endpoint requires valid UI token',
      })
    } finally {
      await server.close()
    }
  })

  test('rejects upload to an unknown workspace with 404', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const response = await fetch(`${server.baseUrl}/api/workspaces/missing-workspace/upload`, {
        body: JSON.stringify({
          data: Buffer.from('private bytes').toString('base64'),
          filename: 'image.png',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: 'Workspace not found: missing-workspace',
      })
    } finally {
      await server.close()
    }
  })

  test('writes uploaded image bytes under the runtime uploads directory', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-web-upload-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Write')
      const cookie = await getUiCookie(server.baseUrl)
      const payload = Buffer.from('image bytes from browser')

      const response = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: payload.toString('base64'),
          filename: 'screen.png',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })
      const body = (await response.json()) as {
        filename: string
        mime_type: string
        ok: boolean
        path: string
        size: number
      }

      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        filename: 'screen.png',
        mime_type: 'image/png',
        ok: true,
        size: payload.length,
      })
      expect(body.path).toMatch(
        new RegExp(
          `^${join(dataDir, 'uploads').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[0-9a-f-]+\\.png$`
        )
      )
      expect(body).not.toHaveProperty('url')
      expect(readFileSync(body.path)).toEqual(payload)
    } finally {
      await server.close()
    }
  })

  test('rejects files over the web terminal upload limit', async () => {
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Oversized')
      const cookie = await getUiCookie(server.baseUrl)
      const response = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.alloc(WEB_TERMINAL_UPLOAD_MAX_BYTES + 1, 1).toString('base64'),
          filename: 'too-big.png',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: 'File too large (max 20MB)',
      })
    } finally {
      await server.close()
    }
  })

  test('sanitizes filename input before deriving the stored extension', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-web-upload-safe-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Safe Name')
      const cookie = await getUiCookie(server.baseUrl)
      const response = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.from('safe bytes').toString('base64'),
          filename: '../nested/../../escape.PNG',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })
      const body = (await response.json()) as { filename: string; path: string }

      expect(response.status).toBe(200)
      expect(body.filename).toBe('escape.PNG')
      expect(basename(body.path)).toMatch(/^[0-9a-f-]+\.png$/)
      expect(dirname(body.path)).toBe(join(dataDir, 'uploads'))
      expect(existsSync(body.path)).toBe(true)
    } finally {
      await server.close()
    }
  })

  test('rejects upload bodies whose data field is not a base64 string', async () => {
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Bad Data')
      const cookie = await getUiCookie(server.baseUrl)
      const response = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: 42,
          filename: 'screen.png',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: 'data (base64) is required',
      })
    } finally {
      await server.close()
    }
  })

  test('rejects invalid base64 payloads before writing a file', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-web-upload-invalid-base64-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Invalid Base64')
      const cookie = await getUiCookie(server.baseUrl)
      const response = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: 'not-valid-@@@',
          filename: 'screen.png',
          mime_type: 'image/png',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: 'data must be valid base64',
      })
      expect(existsSync(join(dataDir, 'uploads'))).toBe(false)
    } finally {
      await server.close()
    }
  })

  test('rejects non-image mime types and unsafe raster extensions', async () => {
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(createWorkspacePath(), 'Upload Bad Type')
      const cookie = await getUiCookie(server.baseUrl)
      const badMime = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.from('<svg></svg>').toString('base64'),
          filename: 'screen.png',
          mime_type: 'text/html',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })
      const badExt = await fetch(`${server.baseUrl}/api/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.from('<svg></svg>').toString('base64'),
          filename: 'screen.svg',
          mime_type: 'image/svg+xml',
        }),
        headers: jsonHeaders(cookie),
        method: 'POST',
      })

      expect(badMime.status).toBe(400)
      await expect(badMime.json()).resolves.toMatchObject({
        error: 'mime_type must be image/*',
      })
      expect(badExt.status).toBe(400)
      await expect(badExt.json()).resolves.toMatchObject({
        error: 'Unsupported image extension',
      })
    } finally {
      await server.close()
    }
  })
})
