import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import { resetSessionCaptureCoordinatorForTests } from '../../src/server/claude-session-coordinator.js'
import { captureOpenCodeSessionId } from '../../src/server/session-capture-opencode.js'

const tempDirs: string[] = []

const makeTempDir = (prefix: string) => {
  const dir = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  resetSessionCaptureCoordinatorForTests()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('opencode session capture identity discriminator (bug B3)', () => {
  // 回归测试：同 workspace 同 cwd 下两个 opencode agent，各自 session 的 part 内容含自己的 binding marker，
  // 必须各自只捕获含自己 marker 的 session，不能抓串。
  test('two concurrent opencode captures bind ids to the matching agent marker', async () => {
    const dataDir = makeTempDir('hive-opencode-discriminator')
    const cwd = join(dataDir, 'workspace')
    mkdirSync(cwd, { recursive: true })
    const dbPath = join(dataDir, 'opencode.db')

    // 让 bob 的 session 先插入（rowid 更小 → listSessionIds 排序在前），但 alice 的 capture 先注册——
    // 若没有内容判别（旧 bug），alice 会抢到排在最前的 bob session，从而抓串。
    const aliceSessionId = 'ses_aliceaaaaaaaaaaaaaaaaaaaaaa'
    const bobSessionId = 'ses_bobbbbbbbbbbbbbbbbbbbbbbbbb'
    const aliceMarker = 'Hive session binding: workspace_id=ws-1; agent_id=alice'
    const bobMarker = 'Hive session binding: workspace_id=ws-1; agent_id=bob'

    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        time_archived INTEGER
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `)
    db.prepare('INSERT INTO session (id, directory, time_archived) VALUES (?, ?, NULL)').run(
      bobSessionId,
      cwd
    )
    db.prepare('INSERT INTO session (id, directory, time_archived) VALUES (?, ?, NULL)').run(
      aliceSessionId,
      cwd
    )
    db.prepare('INSERT INTO part (id, session_id, data) VALUES (?, ?, ?)').run(
      'part-bob',
      bobSessionId,
      JSON.stringify({ text: `[Hive 系统消息：启动说明]\n${bobMarker}`, type: 'text' })
    )
    db.prepare('INSERT INTO part (id, session_id, data) VALUES (?, ?, ?)').run(
      'part-alice',
      aliceSessionId,
      JSON.stringify({ text: `[Hive 系统消息：启动说明]\n${aliceMarker}`, type: 'text' })
    )
    db.close()

    const alice: string[] = []
    const bob: string[] = []

    const aliceCapture = captureOpenCodeSessionId(
      cwd,
      new Set(),
      (sessionId) => alice.push(sessionId),
      200,
      2,
      dbPath,
      { contentIncludes: aliceMarker }
    )
    const bobCapture = captureOpenCodeSessionId(
      cwd,
      new Set(),
      (sessionId) => bob.push(sessionId),
      200,
      2,
      dbPath,
      { contentIncludes: bobMarker }
    )

    await Promise.all([aliceCapture, bobCapture])

    expect(alice).toEqual([aliceSessionId])
    expect(bob).toEqual([bobSessionId])
  })
})
