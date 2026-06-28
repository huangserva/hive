import { describe, expect, it } from 'vitest'

import {
  createOutputTailBuffer,
  createRunOutputBuffer,
  installRunOutputBuffer,
} from '../../src/server/agent-manager-support.js'

describe('createRunOutputBuffer', () => {
  it('keeps the last max length characters when appended chunks overflow the cap', () => {
    const buffer = createRunOutputBuffer(10)

    buffer.append('abc')
    buffer.append('defgh')
    buffer.append('ijklmnop')

    expect(buffer.read()).toBe('ghijklmnop')
  })

  it('does not rebuild the cached string when read repeatedly without new output', () => {
    const buffer = createRunOutputBuffer(20)

    buffer.append('hello')
    expect(buffer.read()).toBe('hello')
    const first = buffer.readStats().rebuilds
    buffer.read()
    buffer.read()

    expect(buffer.read()).toBe('hello')
    expect(buffer.readStats().rebuilds).toBe(first)
  })

  it('marks the cache dirty only after append and rebuilds once on the next read', () => {
    const buffer = createRunOutputBuffer(20)

    buffer.append('hello')
    expect(buffer.read()).toBe('hello')
    const beforeAppend = buffer.readStats().rebuilds

    buffer.append(' world')
    expect(buffer.read()).toBe('hello world')
    expect(buffer.readStats().rebuilds).toBe(beforeAppend + 1)
    buffer.read()
    expect(buffer.readStats().rebuilds).toBe(beforeAppend + 1)
  })

  it('drops old chunks without copying the full buffered output on append', () => {
    const buffer = createRunOutputBuffer(6)

    buffer.append('abc')
    buffer.append('def')
    buffer.append('gh')

    expect(buffer.read()).toBe('cdefgh')
  })

  it('physically compacts discarded chunks even when output is never read', () => {
    const buffer = createRunOutputBuffer(20)

    for (let index = 0; index < 200; index += 1) {
      buffer.append('x')
    }

    const stats = buffer.readStats()
    expect(stats.headIndex).toBeLessThanOrEqual(stats.retainedChunks / 2)
    expect(stats.retainedChunks).toBeLessThanOrEqual(40)
    expect(buffer.read()).toBe('x'.repeat(20))
  })

  it('keeps only the tail when a single chunk is larger than the cap', () => {
    const buffer = createRunOutputBuffer(5)

    buffer.append('abcdefghijkl')

    expect(buffer.read()).toBe('hijkl')
    expect(buffer.readStats().retainedChunks).toBe(1)
  })

  it('keeps run.output setter wired to the bounded buffer', () => {
    const run = {
      runId: 'run-1',
      agentId: 'agent-1',
      pid: null,
      status: 'running',
      output: 'initial',
      exitCode: null,
      errorTail: null,
      errorTailBuffer: createOutputTailBuffer(),
      process: {
        isStopped: () => false,
        pause() {},
        pid: null,
        resize() {},
        resume() {},
        stop() {},
        write() {},
      },
    }
    installRunOutputBuffer(run)

    run.output = 'abcdefghijklmnopqrstuvwxyz'

    expect(run.output).toBe('abcdefghijklmnopqrstuvwxyz')
    expect(run.outputBuffer?.read()).toBe('abcdefghijklmnopqrstuvwxyz')
  })
})
