import { existsSync, readFileSync, statSync } from 'node:fs'

interface CachedTextFile {
  content: string
  mtimeMs: number
  size: number
}

const textFileCache = new Map<string, CachedTextFile>()
let hits = 0
let misses = 0

export const clearPmFileCache = () => {
  textFileCache.clear()
  hits = 0
  misses = 0
}

export const snapshotPmFileCacheStats = () => ({ hits, misses })

export const readCachedTextFile = (filePath: string): string => {
  const stat = statSync(filePath)
  const cached = textFileCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    hits += 1
    return cached.content
  }

  misses += 1
  const content = readFileSync(filePath, 'utf8')
  textFileCache.set(filePath, { content, mtimeMs: stat.mtimeMs, size: stat.size })
  return content
}

export const readOptionalCachedTextFile = (filePath: string): string =>
  existsSync(filePath) ? readCachedTextFile(filePath) : ''
