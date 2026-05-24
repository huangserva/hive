import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import { BadRequestError, NotFoundError } from './http-errors.js'

const execFileP = promisify(execFile)

const isInside = (root: string, candidate: string) => {
  const relative = candidate.slice(root.length)
  return candidate === root || relative.startsWith(sep)
}

export const openWorkspaceFile = async (workspacePath: string, requestedPath: string) => {
  const trimmed = requestedPath.trim()
  if (!trimmed) throw new BadRequestError('path must not be empty')

  const root = resolve(workspacePath)
  const candidate = resolve(root, trimmed)
  if (!isInside(root, candidate)) throw new BadRequestError('path must be inside workspace')
  if (!existsSync(candidate)) throw new NotFoundError(`File not found: ${requestedPath}`)

  await execFileP('open', [candidate], { windowsHide: true })
}
