import { describe, expect, test } from 'vitest'

import { createPtyOutputBus } from '../../src/server/pty-output-bus.js'
import { TerminalStateMirror } from '../../src/server/terminal-state-mirror.js'
import {
  createLazyTerminalOutputMirror,
  createWorkerOutputTracker,
} from '../../src/server/worker-output-tracker.js'

const getXtermLastPtyLine = async (input: string) => {
  const mirror = new TerminalStateMirror()
  try {
    mirror.write(input)
    await mirror.getSnapshot()
    return mirror.lastPtyLine()
  } finally {
    mirror.dispose()
  }
}

describe('createLazyTerminalOutputMirror', () => {
  test('appends chunks without materializing terminal state until read', () => {
    const mirror = createLazyTerminalOutputMirror({ maxLength: 100 })

    mirror.append('first line\n')
    mirror.append('second line\n')

    expect(mirror.readStats().materializeCount).toBe(0)
    expect(mirror.lastPtyLine()).toBe('second line')
    expect(mirror.readStats().materializeCount).toBe(1)
    expect(mirror.lastPtyLine()).toBe('second line')
    expect(mirror.readStats().materializeCount).toBe(1)

    mirror.append('third line')

    expect(mirror.lastPtyLine()).toBe('third line')
    expect(mirror.readStats().materializeCount).toBe(2)
  })

  test('treats CRLF as newline while preserving carriage-return overwrites', () => {
    const mirror = createLazyTerminalOutputMirror({ maxLength: 100 })

    mirror.append('first line\r\n')
    mirror.append('progress 1%\rprogress 100%\r\n')

    expect(mirror.lastPtyLine()).toBe('progress 100%')
  })

  test('matches xterm for short carriage-return overwrites that leave old tail text', async () => {
    const input = 'download 100%\rOK\n'
    const mirror = createLazyTerminalOutputMirror({ maxLength: 100 })

    mirror.append(input)

    expect(mirror.lastPtyLine()).toBe(await getXtermLastPtyLine(input))
  })

  test('matches xterm when clear-line CSI removes stale carriage-return tail text', async () => {
    const cases = ['download 100%\r\u001b[KOK\n', 'stale line\r\u001b[2Kfresh\n']

    for (const input of cases) {
      const mirror = createLazyTerminalOutputMirror({ maxLength: 100 })
      mirror.append(input)

      expect(mirror.lastPtyLine()).toBe(await getXtermLastPtyLine(input))
    }
  })

  test('keeps output bounded even if no consumer reads it while chunks arrive', () => {
    const mirror = createLazyTerminalOutputMirror({ maxLength: 20 })

    for (let index = 0; index < 200; index += 1) {
      mirror.append(String(index % 10))
    }

    const stats = mirror.readStats()
    expect(stats.buffer.retainedChunks).toBeLessThanOrEqual(40)
    expect(stats.bufferedLength).toBeLessThanOrEqual(20)
    expect(stats.materializeCount).toBe(0)
    expect(mirror.lastPtyLine()).toBe('01234567890123456789')
  })

  test('materializes snapshots lazily from the buffered terminal output', async () => {
    const mirror = createLazyTerminalOutputMirror({ maxLength: 100 })

    mirror.append('alpha\n')
    mirror.append('\u001b[32mbeta\u001b[0m\n')

    expect(mirror.readStats().materializeCount).toBe(0)
    const snapshot = await mirror.getSnapshot()

    expect(snapshot).toContain('beta')
    expect(mirror.readStats().materializeCount).toBe(1)
  })
})

describe('createWorkerOutputTracker', () => {
  test('records last PTY line from output bus chunks without eager terminal parsing', () => {
    const outputBus = createPtyOutputBus()
    const tracker = createWorkerOutputTracker(outputBus)

    tracker.attach('workspace-1', 'agent-1', 'run-1', '')
    outputBus.publish('run-1', 'first\n')
    outputBus.publish('run-1', 'progress 1%\rprogress 100%\n')

    expect(tracker.getLastPtyLine('workspace-1', 'agent-1')).toBe('progress 100%')
  })
})
