import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createPostStartInputWriter,
  hasBracketedPasteAcknowledgement,
  hasClaudeBusyOutput,
  hasInteractivePromptReady,
} from '../../src/server/post-start-input-writer.js'

describe('post-start input writer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('recognizes interactive TUI prompts', () => {
    expect(hasInteractivePromptReady('booting\n❯ ')).toBe(true)
    expect(hasInteractivePromptReady('booting\n› ')).toBe(true)
    expect(
      hasInteractivePromptReady('Gemini CLI\n* Type your message or @path/to/file', 'gemini')
    ).toBe(true)
    expect(hasInteractivePromptReady('OpenCode\nAsk anything...', 'opencode')).toBe(true)
    expect(hasInteractivePromptReady('booting only')).toBe(false)
  })

  test('recognizes Claude bracketed-paste acknowledgements after the baseline output', () => {
    const baseline = 'Welcome back\n❯ '
    expect(
      hasBracketedPasteAcknowledgement(`${baseline}[Pasted text #1 +25 lines]`, baseline.length)
    ).toBe(true)
    const oldOutput = `${baseline}old [Pasted text #1]`
    expect(hasBracketedPasteAcknowledgement(oldOutput, oldOutput.length)).toBe(false)
  })

  test('recognizes Claude compact/busy output without treating it as prompt readiness', () => {
    expect(hasClaudeBusyOutput('Compacting conversation…\nPress esc to interrupt')).toBe(true)
    expect(hasClaudeBusyOutput('Compacting conversation...\nesc to interrupt')).toBe(true)
    expect(hasClaudeBusyOutput('Working… press esc to interrupt')).toBe(true)
    expect(hasClaudeBusyOutput('The task text says: press esc to interrupt')).toBe(false)
    expect(hasClaudeBusyOutput('Welcome back\n❯ ')).toBe(false)
    expect(hasInteractivePromptReady('Compacting conversation…\nesc to interrupt', 'claude')).toBe(
      false
    )
  })

  test('defers Claude input until prompt and paste acknowledgement are ready, then submits Enter', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    const manager = {
      getRun: vi.fn(() => ({ output })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    expect(manager.writeInput).not.toHaveBeenCalled()
    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)

    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '\u001b[200~payload\u001b[201~')

    vi.advanceTimersByTime(600)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)

    output += '[Pasted text #1 +1 lines]\n'
    vi.advanceTimersByTime(149)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
    expect(manager.writeInput).toHaveBeenNthCalledWith(2, 'run-1', '\r')
  })

  test('reports Claude paste acknowledgement only after the bracketed paste ack lands', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }
    const onPasteAck = vi.fn()
    const onPasteGaveUp = vi.fn()

    const write = createPostStartInputWriter(manager as never, 'claude', {
      onPasteAck,
      onPasteGaveUp,
    })
    write('run-1', 'payload')

    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)
    expect(onPasteAck).not.toHaveBeenCalled()

    output += '[Pasted text #1 +1 lines]\n'
    vi.advanceTimersByTime(700)

    expect(onPasteAck).toHaveBeenCalledTimes(1)
    expect(onPasteGaveUp).not.toHaveBeenCalled()
  })

  test('reports Claude paste as acknowledged after timeout fallback submit', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }
    const onPasteAck = vi.fn()
    const onPasteGaveUp = vi.fn()

    const write = createPostStartInputWriter(manager as never, 'claude', {
      onPasteAck,
      onPasteGaveUp,
    })
    write('run-1', 'payload')

    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3000)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
    expect(manager.writeInput).toHaveBeenNthCalledWith(2, 'run-1', '\r')
    expect(onPasteAck).toHaveBeenCalledTimes(1)
    expect(onPasteGaveUp).not.toHaveBeenCalled()

    output += 'retry prompt\n❯ '
    vi.advanceTimersByTime(5000)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
  })

  test('reports non-Claude interactive input as acknowledged after writing it', () => {
    vi.useFakeTimers()
    let output = 'OpenCode\n'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }
    const onPasteAck = vi.fn()

    const write = createPostStartInputWriter(manager as never, 'opencode', { onPasteAck })
    write('run-1', 'payload')

    output = 'OpenCode\nAsk anything'
    vi.advanceTimersByTime(50)

    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(onPasteAck).toHaveBeenCalledTimes(1)
  })

  test('waits longer before submitting large pasted prompts after acknowledgement', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    const manager = {
      getRun: vi.fn(() => ({ output })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload\n'.repeat(600))

    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    output += '[Pasted text #1 +600 lines]\n'
    vi.advanceTimersByTime(200)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1300)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
    expect(manager.writeInput).toHaveBeenNthCalledWith(2, 'run-1', '\r')
  })

  test('submits Claude short pasted input when no bracketed paste acknowledgement appears', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }
    const onPasteAck = vi.fn()
    const onPasteGaveUp = vi.fn()

    const write = createPostStartInputWriter(manager as never, 'claude', {
      onPasteAck,
      onPasteGaveUp,
    })
    write('run-1', 'payload')

    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2999)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(onPasteAck).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
    expect(manager.writeInput).toHaveBeenNthCalledWith(2, 'run-1', '\r')
    expect(onPasteAck).toHaveBeenCalledTimes(1)
    expect(onPasteGaveUp).not.toHaveBeenCalled()

    output += 'Done\n❯ '
    vi.advanceTimersByTime(5000)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
  })

  test('does not repeatedly paste when Claude stays busy after a missing acknowledgement', () => {
    vi.useFakeTimers()
    let output = 'Welcome back after restart\n❯ '
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    vi.advanceTimersByTime(7999)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output += 'Compacting conversation…\nesc to interrupt\n'
    vi.advanceTimersByTime(1)
    expect(manager.writeInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(120_000)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '\u001b[200~payload\u001b[201~')

    vi.advanceTimersByTime(3_000)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
    expect(manager.writeInput).toHaveBeenNthCalledWith(2, 'run-1', '\r')

    vi.advanceTimersByTime(30_000)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
  })

  test('waits for Gemini prompt readiness and writes plain input without bracketed paste', () => {
    vi.useFakeTimers()
    let output = 'Gemini CLI v0.35.3\nAuthenticated with gemini-api-key'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'gemini')
    write('run-1', '[Hive 系统消息：启动说明]\n请基于此继续。')

    vi.advanceTimersByTime(5000)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output += '\n* Type your message or @path/to/file'
    vi.advanceTimersByTime(50)

    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(
      1,
      'run-1',
      '[Hive 系统消息：启动说明]\n请基于此继续。'
    )
    expect(manager.writeInput.mock.calls[0]?.[1]).not.toContain('\u001b[200~')
    expect(manager.writeInput.mock.calls[0]?.[1]).not.toContain('\u001b[201~')

    vi.advanceTimersByTime(600)
    expect(manager.writeInput).toHaveBeenCalledTimes(2)
    expect(manager.writeInput).toHaveBeenNthCalledWith(2, 'run-1', '\r')
  })

  test('stops polling Gemini when the prompt never becomes ready', () => {
    vi.useFakeTimers()
    const manager = {
      getRun: vi.fn(() => ({
        output: 'Gemini CLI v0.35.3\nAuthenticated with gemini-api-key',
        status: 'running',
      })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'gemini')
    write('run-1', 'payload')

    vi.advanceTimersByTime(9000)
    const callsAfterTimeout = manager.getRun.mock.calls.length
    expect(manager.writeInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(manager.getRun).toHaveBeenCalledTimes(callsAfterTimeout)
    expect(manager.writeInput).not.toHaveBeenCalled()
  })

  test('does not submit delayed Enter after the PTY exits', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    let status = 'running'
    const manager = {
      getRun: vi.fn(() => ({ output, status })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    status = 'exited'
    output += '[Pasted text #1 +1 lines]\n'
    vi.advanceTimersByTime(3000)

    expect(manager.writeInput).toHaveBeenCalledTimes(1)
  })

  test('does not write delayed interactive input after the PTY exits before prompt readiness', () => {
    vi.useFakeTimers()
    let output = 'Welcome back\n'
    let status = 'running'
    const manager = {
      getRun: vi.fn(() => ({ output, status })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    status = 'exited'
    output = 'Welcome back\n❯ '
    vi.advanceTimersByTime(50)

    expect(manager.writeInput).not.toHaveBeenCalled()
  })

  // 根因 A 回归：resume 后 run.output 仍含 restart 前的旧提示符，注入不能被它误触发。
  test('after resume, ignores the stale prompt already in output and waits for a fresh one', () => {
    vi.useFakeTimers()
    // 模拟 resume：注入开始时 output 里已经有 restart 前留下的旧 ❯。
    let output = 'Welcome back after restart\n❯ '
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    // 旧提示符不算就绪：CLI 还没真正接受输入，绝不能在这上面粘贴。
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(manager.writeInput).not.toHaveBeenCalled()

    // CLI 真正就绪后追加一个【新】提示符，这时才注入。
    output += 'thinking...\n❯ '
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '[200~payload[201~')
  })

  test('fresh start with no prior prompt still injects when the prompt first appears', () => {
    vi.useFakeTimers()
    let output = ''
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    vi.advanceTimersByTime(50)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output = 'booting\n❯ '
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '[200~payload[201~')
  })

  test('claude compact/busy output extends readiness wait instead of forcing 8s fallback', () => {
    vi.useFakeTimers()
    let output = 'Welcome back after restart\n❯ '
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'claude')
    write('run-1', 'payload')

    vi.advanceTimersByTime(7999)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output += 'Compacting conversation…\nesc to interrupt\n'
    vi.advanceTimersByTime(1)
    expect(manager.writeInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output += 'Compacted\n❯ '
    vi.advanceTimersByTime(100)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '[200~payload[201~')
  })

  test('codex keeps the existing 8s timeout fallback behavior', () => {
    vi.useFakeTimers()
    const manager = {
      getRun: vi.fn(() => ({ output: 'Codex starting without prompt', status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'codex')
    write('run-1', 'payload')

    vi.advanceTimersByTime(7999)
    expect(manager.writeInput).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '[200~payload[201~')
  })

  test('gemini recognizes its prompt marker only in output after the injection baseline', () => {
    vi.useFakeTimers()
    // resume：旧的 "Type your message" 已在 output 里；gemini 不做 timeout 兜底，绝不能误触发。
    let output = 'Gemini CLI v0.35.3\n* Type your message or @path/to/file'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'gemini')
    write('run-1', 'payload')

    // 仍在轮询窗口内（< 8s readiness timeout，gemini 超时后会停轮询）：
    // 旧 marker 在 baseline 之前，slice 后看不到，故不注入。
    vi.advanceTimersByTime(5000)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output += '\nrunning task\n* Type your message or @path/to/file'
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', 'payload')
    expect(manager.writeInput.mock.calls[0]?.[1]).not.toContain('[200~')
  })

  test('opencode recognizes its prompt marker only in output after the injection baseline', () => {
    vi.useFakeTimers()
    let output = 'OpenCode\nAsk anything...'
    const manager = {
      getRun: vi.fn(() => ({ output, status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, 'opencode')
    write('run-1', 'payload')

    vi.advanceTimersByTime(50)
    expect(manager.writeInput).not.toHaveBeenCalled()

    output += '\ndone\nAsk anything...'
    vi.advanceTimersByTime(50)
    expect(manager.writeInput).toHaveBeenCalledTimes(1)
    expect(manager.writeInput).toHaveBeenNthCalledWith(1, 'run-1', '[200~payload[201~')
  })

  test('writes non-interactive commands immediately', () => {
    const manager = {
      getRun: vi.fn(() => ({ output: '', status: 'running' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, process.execPath)
    write('run-1', 'payload')

    expect(manager.getRun).toHaveBeenCalledWith('run-1')
    expect(manager.writeInput).toHaveBeenCalledWith('run-1', 'payload\n')
  })

  test('skips non-interactive post-start input after the run exits', () => {
    const manager = {
      getRun: vi.fn(() => ({ output: '', status: 'exited' })),
      writeInput: vi.fn(),
    }

    const write = createPostStartInputWriter(manager as never, process.execPath)
    write('run-1', 'payload')

    expect(manager.writeInput).not.toHaveBeenCalled()
  })
})
