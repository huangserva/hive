// Bounded buffer for terminal output that arrives on the IO socket BEFORE the
// control socket delivers the restore snapshot. Pre-fix this was an unbounded
// array: if restore was slow (server stall) while output kept flowing, it grew
// without limit → memory pressure / tab kill. This caps it by entry count AND
// byte total; when over a cap the oldest entry is dropped — but its bytes are
// acknowledged so the server's output backpressure window still advances (we
// discard stale pre-restore content; the restore snapshot is the source of truth
// for the final screen). The most recent entry is always kept.

export interface PendingOutputEntry {
  acknowledge: (bytes: number) => void
  bytes: number
  chunk: string
}

export interface PendingOutputBuffer {
  bytes: () => number
  clear: () => void
  drain: () => PendingOutputEntry[]
  drainBatch: (limit: number) => PendingOutputEntry[]
  droppedBytes: () => number
  droppedCount: () => number
  push: (entry: PendingOutputEntry) => void
  size: () => number
}

export interface PendingOutputBufferOptions {
  maxBytes: number
  maxEntries: number
}

export const DEFAULT_PENDING_OUTPUT_LIMITS: PendingOutputBufferOptions = {
  maxBytes: 4 * 1024 * 1024,
  maxEntries: 5000,
}

export const createPendingOutputBuffer = (
  options: PendingOutputBufferOptions = DEFAULT_PENDING_OUTPUT_LIMITS
): PendingOutputBuffer => {
  const entries: PendingOutputEntry[] = []
  let totalBytes = 0
  let droppedCount = 0
  let droppedBytes = 0

  const dropOldest = () => {
    const oldest = entries.shift()
    if (!oldest) return
    totalBytes -= oldest.bytes
    droppedCount += 1
    droppedBytes += oldest.bytes
    // Ack the discarded bytes so the server keeps flowing rather than stalling
    // its backpressure window waiting on output we will never render.
    try {
      oldest.acknowledge(oldest.bytes)
    } catch {
      // ignore: socket may already be closed
    }
  }

  return {
    bytes: () => totalBytes,
    clear: () => {
      entries.splice(0)
      totalBytes = 0
    },
    drain: () => {
      const drained = entries.splice(0)
      totalBytes = 0
      return drained
    },
    drainBatch: (limit) => {
      if (limit <= 0) return []
      const drained = entries.splice(0, limit)
      totalBytes -= drained.reduce((total, entry) => total + entry.bytes, 0)
      return drained
    },
    droppedBytes: () => droppedBytes,
    droppedCount: () => droppedCount,
    push: (entry) => {
      entries.push(entry)
      totalBytes += entry.bytes
      // Always keep at least the newest entry, even if it alone exceeds maxBytes.
      while (
        entries.length > 1 &&
        (entries.length > options.maxEntries || totalBytes > options.maxBytes)
      ) {
        dropOldest()
      }
    },
    size: () => entries.length,
  }
}
