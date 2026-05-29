import { describe, expect, test } from 'vitest'

import { TerminalStateMirror } from '../../src/server/terminal-state-mirror.js'

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, reject, resolve }
}

describe('terminal state mirror', () => {
  test('queues snapshot serialization with terminal operations', async () => {
    const mirror = new TerminalStateMirror()
    const gate = deferred<void>()
    const internals = mirror as unknown as {
      operationQueue: Promise<void>
      serializeAddon: { serialize: () => string }
    }
    internals.operationQueue = gate.promise
    internals.serializeAddon.serialize = () => 'stable snapshot'
    const previousQueue = internals.operationQueue

    const snapshot = mirror.getSnapshot()

    expect(internals.operationQueue).not.toBe(previousQueue)

    mirror.write('later output')
    gate.resolve()

    await expect(snapshot).resolves.toBe('stable snapshot')
    await internals.operationQueue
    mirror.dispose()
  })
})
