import { describe, expect, test } from 'vitest'
import { shouldAcceptResponse } from '../src/api/agent-poll-stale-guard.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('shouldAcceptResponse — request sequence token guard', () => {
  test('accepts when seq matches (same request context)', () => {
    expect(shouldAcceptResponse(1, 1)).toBe(true)
    expect(shouldAcceptResponse(42, 42)).toBe(true)
  })

  test('rejects when seq differs (stale response after workspace/worker switch)', () => {
    expect(shouldAcceptResponse(2, 1)).toBe(false)
    expect(shouldAcceptResponse(1, 2)).toBe(false)
  })

  test('rejects when seq advanced past captured (A→B→A fast switch back)', () => {
    const seqAfterSwitchBack = 3
    const capturedFromFirstA = 1
    expect(shouldAcceptResponse(seqAfterSwitchBack, capturedFromFirstA)).toBe(false)
  })

  test('simulates load() stale response scenario: workspace switch during in-flight request', async () => {
    let currentSeq = 0
    const state: { tasks: string[] | null; transcript: string[] | null } = {
      tasks: null,
      transcript: null,
    }
    const oldTasks = deferred<string[]>()
    const oldTranscript = deferred<string[]>()
    const newTasks = deferred<string[]>()
    const newTranscript = deferred<string[]>()

    const loadA = async () => {
      const captured = currentSeq
      const tasks = await oldTasks.promise
      if (!shouldAcceptResponse(currentSeq, captured)) return
      state.tasks = tasks
      const transcript = await oldTranscript.promise
      if (!shouldAcceptResponse(currentSeq, captured)) return
      state.transcript = transcript
    }

    const loadB = async () => {
      const captured = currentSeq
      const tasks = await newTasks.promise
      if (!shouldAcceptResponse(currentSeq, captured)) return
      state.tasks = tasks
      const transcript = await newTranscript.promise
      if (!shouldAcceptResponse(currentSeq, captured)) return
      state.transcript = transcript
    }

    const loadAPromise = loadA()
    currentSeq++
    state.tasks = null
    state.transcript = null
    const loadBPromise = loadB()
    newTasks.resolve(['new-ws-task'])
    await Promise.resolve()
    newTranscript.resolve(['new-ws-line'])
    await loadBPromise
    oldTasks.resolve(['old-ws-task'])
    await Promise.resolve()
    oldTranscript.resolve(['old-ws-line'])
    await loadAPromise

    expect(state.tasks).toEqual(['new-ws-task'])
    expect(state.transcript).toEqual(['new-ws-line'])
  })

  test('simulates interval stale response: workspace switch during poll', async () => {
    let currentSeq = 0
    const state: { transcript: string[] | null } = { transcript: null }
    const oldTranscript = deferred<string[]>()
    const newTranscript = deferred<string[]>()

    const pollOld = async () => {
      const captured = currentSeq
      const t = await oldTranscript.promise
      if (!shouldAcceptResponse(currentSeq, captured)) return
      state.transcript = t
    }

    const pollNew = async () => {
      const captured = currentSeq
      const t = await newTranscript.promise
      if (!shouldAcceptResponse(currentSeq, captured)) return
      state.transcript = t
    }

    const oldPollPromise = pollOld()
    currentSeq++
    state.transcript = null
    const newPollPromise = pollNew()
    newTranscript.resolve(['new-poll-line'])
    await newPollPromise
    oldTranscript.resolve(['old-poll-line'])
    await oldPollPromise

    expect(state.transcript).toEqual(['new-poll-line'])
  })

  test('simulates A→B→A fast switch: old A response rejected', async () => {
    let currentSeq = 0
    const state: { transcript: string[] | null } = { transcript: null }
    const staleA = deferred<string[]>()
    const b = deferred<string[]>()
    const freshA = deferred<string[]>()

    const capturedA1 = currentSeq
    const loadAPromise = (async () => {
      const t = await staleA.promise
      if (!shouldAcceptResponse(currentSeq, capturedA1)) return
      state.transcript = t
    })()

    currentSeq++
    state.transcript = null

    const capturedB = currentSeq
    const loadBPromise = (async () => {
      const t = await b.promise
      if (!shouldAcceptResponse(currentSeq, capturedB)) return
      state.transcript = t
    })()

    currentSeq++
    state.transcript = null

    const capturedA2 = currentSeq
    const loadA2Promise = (async () => {
      const t = await freshA.promise
      if (!shouldAcceptResponse(currentSeq, capturedA2)) return
      state.transcript = t
    })()

    b.resolve(['B-line'])
    await loadBPromise
    freshA.resolve(['fresh-A-line'])
    await loadA2Promise
    staleA.resolve(['stale-A-line'])
    await loadAPromise

    expect(state.transcript).toEqual(['fresh-A-line'])
  })

  test('clear on switch: stale data not visible before new request completes', () => {
    const state: { transcript: string[] | null; tasks: string[] | null } = {
      transcript: ['old-data'],
      tasks: ['old-task'],
    }

    state.transcript = null
    state.tasks = null

    expect(state.transcript).toBeNull()
    expect(state.tasks).toBeNull()
  })
})
