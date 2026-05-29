import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  captureSessionIdWithCoordinator,
  getSessionCaptureCoordinatorStateForTests,
  resetSessionCaptureCoordinatorForTests,
} from '../../src/server/claude-session-coordinator.js'
import {
  doesCapturedSessionExist,
  snapshotSessionIdsForCapture,
} from '../../src/server/session-capture.js'

const tempDirs: string[] = []
const originalCodexHome = process.env.CODEX_HOME

afterEach(() => {
  resetSessionCaptureCoordinatorForTests()
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = originalCodexHome
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('C1: codex session capture with a >64KB session_meta first line', () => {
  // 旧实现给首行读取定了 64KB 硬上限，首行超过即静默跳过 → 该 session 永远捕获不到。
  test('captures the session instead of silently skipping the oversized header', () => {
    const codexHome = join(tmpdir(), `hive-codex-largehdr-${crypto.randomUUID()}`)
    mkdirSync(codexHome, { recursive: true })
    tempDirs.push(codexHome)
    const cwd = join(codexHome, 'workspace')
    mkdirSync(cwd, { recursive: true })
    process.env.CODEX_HOME = codexHome

    const sessionId = '019dc277-0e8e-75c1-9794-94929426288e'
    const sessionDir = join(codexHome, 'sessions', '2026', '04', '30')
    mkdirSync(sessionDir, { recursive: true })

    // 构造一个 >64KB 的合法 session_meta 首行（payload 里塞一个大字段）。
    const firstLine = JSON.stringify({
      payload: { cwd, id: sessionId, pad: 'x'.repeat(70 * 1024) },
      type: 'session_meta',
    })
    expect(firstLine.length).toBeGreaterThan(64 * 1024)
    writeFileSync(
      join(sessionDir, `rollout-2026-04-30T00-00-00-${sessionId}.jsonl`),
      `${firstLine}\n${JSON.stringify({ type: 'event_msg' })}\n`
    )

    const capture = {
      pattern: '~/.codex/sessions/**/*.jsonl',
      source: 'codex_session_jsonl_dir' as const,
    }

    expect(snapshotSessionIdsForCapture(cwd, capture)?.knownSessionIds).toEqual(
      new Set([sessionId])
    )
    expect(doesCapturedSessionExist(cwd, capture, sessionId)).toBe(true)
  })
})

describe('C4: claude-session-coordinator does not leak waiter map entries', () => {
  // waitersByProjectKey 此前 resolve 后只 set 空数组、从不删除 key → 模块级内存泄漏。
  test('removes the projectKey from the waiters map after the waiter resolves', async () => {
    const projectKey = 'pk-leak-regression'
    const captured: string[] = []

    await captureSessionIdWithCoordinator({
      intervalMs: 2,
      knownSessionIds: new Set(),
      listSessionIds: () => ['sess-new'],
      onCapture: (sessionId) => captured.push(sessionId),
      projectKey,
      timeoutMs: 200,
    })

    expect(captured).toEqual(['sess-new'])
    const state = getSessionCaptureCoordinatorStateForTests()
    expect(state.waiterKeys).not.toContain(projectKey)
    expect(state.pollerKeys).not.toContain(projectKey)
    expect(state.claimedKeys).not.toContain(projectKey)
  })
})
