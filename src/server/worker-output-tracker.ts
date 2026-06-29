import { createRunOutputBuffer, MAX_RUN_OUTPUT_LENGTH } from './agent-manager-support.js'
import type { PtyOutputBus } from './pty-output-bus.js'
import { TerminalStateMirror } from './terminal-state-mirror.js'

interface TrackedRun {
  mirror: LazyTerminalOutputMirror
  runId: string
  unsubscribe: () => void
}

export interface WorkerOutputTracker {
  attach: (workspaceId: string, agentId: string, runId: string, initialOutput: string) => void
  closeAll: () => void
  detach: (workspaceId: string, agentId: string) => void
  getLastPtyLine: (workspaceId: string, agentId: string) => string | null
  getSnapshot: (workspaceId: string, agentId: string) => Promise<string | null>
}

const trackerKey = (workspaceId: string, agentId: string) => `${workspaceId}:${agentId}`

export interface LazyTerminalOutputMirror {
  append: (chunk: string) => void
  dispose: () => void
  getSnapshot: () => Promise<string>
  lastPtyLine: (maxLen?: number) => string | null
  readStats: () => {
    buffer: ReturnType<ReturnType<typeof createRunOutputBuffer>['readStats']>
    bufferedLength: number
    materializeCount: number
  }
}

const extractLastPtyLine = (rawOutput: string, maxLen: number) => {
  const lines: string[] = []
  let current: string[] = []
  let cursor = 0
  const pushLine = () => {
    lines.push(current.join(''))
    current = []
    cursor = 0
  }
  const clearToEndOfLine = () => {
    current = current.slice(0, cursor)
  }
  const clearLine = () => {
    current = []
    cursor = 0
  }
  for (let index = 0; index < rawOutput.length; index += 1) {
    const char = rawOutput[index]
    if (char === '\u001b' && rawOutput[index + 1] === '[') {
      const end = rawOutput.slice(index + 2).search(/[a-zA-Z]/)
      if (end < 0) break
      const finalIndex = index + 2 + end
      const final = rawOutput[finalIndex]
      if (final === 'K') {
        const parameter = rawOutput.slice(index + 2, finalIndex)
        if (parameter === '2') clearLine()
        else clearToEndOfLine()
      }
      index = finalIndex
      continue
    }
    if (char === '\r') {
      if (rawOutput[index + 1] === '\n') {
        pushLine()
        index += 1
        continue
      }
      cursor = 0
      continue
    }
    if (char === '\n') {
      pushLine()
      continue
    }
    current[cursor] = char ?? ''
    cursor += 1
  }
  lines.push(current.join(''))
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const cleaned = (lines[index] ?? '').trim()
    if (cleaned.length === 0) continue
    return cleaned.slice(0, maxLen)
  }
  return null
}

export const createLazyTerminalOutputMirror = ({
  maxLength = MAX_RUN_OUTPUT_LENGTH,
}: {
  maxLength?: number
} = {}): LazyTerminalOutputMirror => {
  const outputBuffer = createRunOutputBuffer(maxLength)
  let cachedLastLine: string | null = null
  let lastLineDirty = true
  let cachedSnapshot = ''
  let snapshotDirty = true
  let materializeCount = 0

  const readRawOutput = () => outputBuffer.read()

  return {
    append(chunk) {
      outputBuffer.append(chunk)
      lastLineDirty = true
      snapshotDirty = true
    },
    dispose() {
      cachedLastLine = null
      cachedSnapshot = ''
    },
    async getSnapshot() {
      if (!snapshotDirty) return cachedSnapshot
      const mirror = new TerminalStateMirror()
      try {
        mirror.write(readRawOutput())
        cachedSnapshot = await mirror.getSnapshot()
      } finally {
        mirror.dispose()
      }
      snapshotDirty = false
      materializeCount += 1
      return cachedSnapshot
    },
    lastPtyLine(maxLen = 60) {
      if (lastLineDirty) {
        cachedLastLine = extractLastPtyLine(readRawOutput(), maxLen)
        lastLineDirty = false
        materializeCount += 1
      }
      return cachedLastLine
    },
    readStats() {
      const raw = readRawOutput()
      return {
        buffer: outputBuffer.readStats(),
        bufferedLength: raw.length,
        materializeCount,
      }
    },
  }
}

/**
 * Maintains bounded raw terminal output per active agent run so the team-list
 * endpoint can report each worker's last output line without parsing every PTY
 * chunk through a headless xterm. Snapshot consumers still get xterm
 * serialization, but only when they ask for it.
 */
export const createWorkerOutputTracker = (outputBus: PtyOutputBus): WorkerOutputTracker => {
  const tracked = new Map<string, TrackedRun>()

  const disposeEntry = (entry: TrackedRun) => {
    entry.unsubscribe()
    entry.mirror.dispose()
  }

  return {
    attach(workspaceId, agentId, runId, initialOutput) {
      const key = trackerKey(workspaceId, agentId)
      const existing = tracked.get(key)
      if (existing) {
        if (existing.runId === runId) return
        disposeEntry(existing)
      }
      const mirror = createLazyTerminalOutputMirror()
      if (initialOutput.length > 0) mirror.append(initialOutput)
      const unsubscribe = outputBus.subscribe(runId, (chunk) => {
        mirror.append(chunk)
      })
      tracked.set(key, { mirror, runId, unsubscribe })
    },
    closeAll() {
      for (const entry of tracked.values()) disposeEntry(entry)
      tracked.clear()
    },
    detach(workspaceId, agentId) {
      const key = trackerKey(workspaceId, agentId)
      const entry = tracked.get(key)
      if (!entry) return
      disposeEntry(entry)
      tracked.delete(key)
    },
    getLastPtyLine(workspaceId, agentId) {
      const entry = tracked.get(trackerKey(workspaceId, agentId))
      return entry ? entry.mirror.lastPtyLine() : null
    },
    async getSnapshot(workspaceId, agentId) {
      const entry = tracked.get(trackerKey(workspaceId, agentId))
      return entry ? entry.mirror.getSnapshot() : null
    },
  }
}
