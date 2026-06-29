import { createRunOutputBuffer, MAX_RUN_OUTPUT_LENGTH } from './agent-manager-support.js'
import type { PtyOutputBus } from './pty-output-bus.js'
import { TerminalStateMirror } from './terminal-state-mirror.js'

const LAST_PTY_LINE_SCAN_WINDOW = 16_384
const LAST_PTY_LINE_WARN_MS = 16
const TERMINAL_LAST_LINE_COLUMNS = 80

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
  lastPtyLine: (maxLen?: number, context?: LastPtyLineContext) => string | null
  readStats: () => {
    buffer: ReturnType<ReturnType<typeof createRunOutputBuffer>['readStats']>
    bufferedLength: number
    lastLineScannedLength: number
    materializeCount: number
  }
}

interface LastPtyLineContext {
  agentId: string
  runId: string
  workspaceId: string
}

interface LastPtyLineScanWindow {
  initialPendingWrap: boolean
  initialCursor: number
  input: string
}

const selectLastPtyLineScanWindow = (rawOutput: string): LastPtyLineScanWindow => {
  if (rawOutput.length <= LAST_PTY_LINE_SCAN_WINDOW) {
    return { input: rawOutput, initialCursor: 0, initialPendingWrap: false }
  }
  const windowStart = rawOutput.length - LAST_PTY_LINE_SCAN_WINDOW
  let scanStart = windowStart
  let hiddenCsiBytes = 0
  const possibleCsiStart = rawOutput.lastIndexOf('\u001b[', windowStart)
  if (possibleCsiStart >= Math.max(0, windowStart - 32)) {
    const prefixFragment = rawOutput.slice(possibleCsiStart + 2, windowStart)
    if (!/[a-zA-Z]/.test(prefixFragment)) {
      const csiEnd = rawOutput.slice(windowStart).search(/[a-zA-Z]/)
      if (csiEnd >= 0 && csiEnd <= 32) {
        scanStart = windowStart + csiEnd + 1
        hiddenCsiBytes = scanStart - possibleCsiStart
      }
    }
  }
  const previousLineBoundary = rawOutput.lastIndexOf('\n', windowStart - 1)
  const omittedCurrentLineChars =
    previousLineBoundary >= 0 ? scanStart - previousLineBoundary - 1 : scanStart
  const visibleOmittedChars = Math.max(0, omittedCurrentLineChars - hiddenCsiBytes)
  return {
    input: rawOutput.slice(scanStart),
    initialCursor: visibleOmittedChars % TERMINAL_LAST_LINE_COLUMNS,
    initialPendingWrap:
      visibleOmittedChars > 0 && visibleOmittedChars % TERMINAL_LAST_LINE_COLUMNS === 0,
  }
}

const extractLastPtyLine = (rawOutput: string, maxLen: number) => {
  const {
    input: scanInput,
    initialCursor,
    initialPendingWrap,
  } = selectLastPtyLineScanWindow(rawOutput)
  let currentRow: string[] = []
  let lastNonEmptyRow: string | null = null
  let cursor = initialCursor
  let pendingWrap = initialPendingWrap
  const rememberCurrentRow = () => {
    const cleaned = currentRow.join('').trim()
    if (cleaned.length > 0) lastNonEmptyRow = cleaned
  }
  const startNewRow = () => {
    rememberCurrentRow()
    currentRow = []
    cursor = 0
    pendingWrap = false
  }
  const clearToEndOfLine = () => {
    currentRow = currentRow.slice(0, cursor)
    pendingWrap = false
  }
  const clearLine = () => {
    currentRow = []
    cursor = 0
    pendingWrap = false
  }
  for (let index = 0; index < scanInput.length; index += 1) {
    const char = scanInput[index]
    if (char === '\u001b' && scanInput[index + 1] === '[') {
      const end = scanInput.slice(index + 2).search(/[a-zA-Z]/)
      if (end < 0) break
      const finalIndex = index + 2 + end
      const final = scanInput[finalIndex]
      if (final === 'K') {
        const parameter = scanInput.slice(index + 2, finalIndex)
        if (parameter === '2') clearLine()
        else clearToEndOfLine()
      }
      index = finalIndex
      continue
    }
    if (char === '\r') {
      pendingWrap = false
      if (scanInput[index + 1] === '\n') {
        startNewRow()
        index += 1
        continue
      }
      cursor = 0
      continue
    }
    if (char === '\n') {
      pendingWrap = false
      startNewRow()
      continue
    }
    if (pendingWrap) startNewRow()
    currentRow[cursor] = char ?? ''
    if (cursor >= TERMINAL_LAST_LINE_COLUMNS - 1) {
      cursor = TERMINAL_LAST_LINE_COLUMNS
      pendingWrap = true
    } else {
      cursor += 1
    }
  }
  rememberCurrentRow()
  // lastNonEmptyRow is only assigned inside the rememberCurrentRow closure, so TS flow
  // analysis narrows it to its `null` initializer here (closure writes are ignored).
  // Re-assert the real type so the truthy branch narrows to string instead of never.
  const lastLine = lastNonEmptyRow as string | null
  return {
    line: lastLine ? lastLine.slice(0, maxLen) : null,
    scannedLength: scanInput.length,
  }
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
  let lastLineScannedLength = 0

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
    lastPtyLine(maxLen = 60, context) {
      if (lastLineDirty) {
        const rawOutput = readRawOutput()
        const startedAt = performance.now()
        const result = extractLastPtyLine(rawOutput, maxLen)
        const elapsedMs = performance.now() - startedAt
        cachedLastLine = result.line
        lastLineScannedLength = result.scannedLength
        if (elapsedMs >= LAST_PTY_LINE_WARN_MS) {
          const suffix = context
            ? ` workspace_id=${context.workspaceId} agent_id=${context.agentId} run_id=${context.runId}`
            : ''
          console.warn(
            `[hive] slow last_pty_line extraction${suffix} elapsed_ms=${elapsedMs.toFixed(1)} raw_chars=${rawOutput.length} scanned_chars=${result.scannedLength}`
          )
        }
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
        lastLineScannedLength,
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
      return entry
        ? entry.mirror.lastPtyLine(60, { agentId, runId: entry.runId, workspaceId })
        : null
    },
    async getSnapshot(workspaceId, agentId) {
      const entry = tracked.get(trackerKey(workspaceId, agentId))
      return entry ? entry.mirror.getSnapshot() : null
    },
  }
}
