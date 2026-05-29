import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { resetSessionCaptureCoordinatorForTests } from '../../src/server/claude-session-coordinator.js'
import { captureCodexSessionId } from '../../src/server/session-capture-codex.js'
import { captureGeminiSessionId } from '../../src/server/session-capture-gemini.js'

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

describe('codex/gemini session capture identity discriminator', () => {
  // 回归测试：同 workspace 同 cwd 下两个 codex agent 几乎同时启动时，
  // 必须各自只抓到内容含自己 binding marker 的 session，不能抓串。
  test('two concurrent codex captures bind ids to the matching agent marker', async () => {
    const codexHome = makeTempDir('hive-codex-discriminator')
    const cwd = join(codexHome, 'workspace')
    mkdirSync(cwd, { recursive: true })
    const sessionDir = join(codexHome, 'sessions', '2026', '04', '30')
    mkdirSync(sessionDir, { recursive: true })

    // 让 bob 的 session id 排序在前，但 alice 的 capture 先注册——
    // 若没有内容判别（旧 bug），alice 会抢到排在最前的 bob session，从而抓串。
    const aliceSessionId = '019dc277-0e8e-75c1-9794-bbbbbbbbbbbb'
    const bobSessionId = '019dc277-0e8e-75c1-9794-aaaaaaaaaaaa'
    const aliceMarker = '你是 Demo 的 Alice（coder）。'
    const bobMarker = '你是 Demo 的 Bob（coder）。'

    const writeRollout = (sessionId: string, marker: string) => {
      const meta = JSON.stringify({ payload: { cwd, id: sessionId }, type: 'session_meta' })
      const userLine = JSON.stringify({ payload: { content: marker }, type: 'user_message' })
      writeFileSync(
        join(sessionDir, `rollout-2026-04-30T00-00-00-${sessionId}.jsonl`),
        `${meta}\n${userLine}\n`
      )
    }

    const alice: string[] = []
    const bob: string[] = []

    const aliceCapture = captureCodexSessionId(
      cwd,
      new Set(),
      (sessionId) => alice.push(sessionId),
      200,
      2,
      codexHome,
      { contentIncludes: aliceMarker }
    )
    const bobCapture = captureCodexSessionId(
      cwd,
      new Set(),
      (sessionId) => bob.push(sessionId),
      200,
      2,
      codexHome,
      { contentIncludes: bobMarker }
    )

    writeRollout(bobSessionId, bobMarker)
    writeRollout(aliceSessionId, aliceMarker)

    await Promise.all([aliceCapture, bobCapture])

    expect(alice).toEqual([aliceSessionId])
    expect(bob).toEqual([bobSessionId])
  })

  // 回归测试：gemini 同样要按内容里的 binding marker 区分身份，不能抓串。
  test('two concurrent gemini captures bind ids to the matching agent marker', async () => {
    const geminiHome = makeTempDir('hive-gemini-discriminator')
    const cwd = join(geminiHome, 'workspace')
    mkdirSync(cwd, { recursive: true })
    const projectDir = join(geminiHome, 'tmp', 'project-hash')
    const chatsDir = join(projectDir, 'chats')
    mkdirSync(chatsDir, { recursive: true })
    writeFileSync(join(projectDir, '.project_root'), `${cwd}\n`)

    // 让 bob 的 session id 排序在前，但 alice 的 capture 先注册——
    // 若没有内容判别（旧 bug），alice 会抢到排在最前的 bob session，从而抓串。
    const aliceSessionId = '29405746-aa9b-40bf-961b-bbbbbbbbbbbb'
    const bobSessionId = '29405746-aa9b-40bf-961b-aaaaaaaaaaaa'
    const aliceMarker = '你是 Demo 的 Alice（coder）。'
    const bobMarker = '你是 Demo 的 Bob（coder）。'

    const writeChat = (sessionId: string, marker: string) => {
      writeFileSync(
        join(chatsDir, `session-${sessionId}.json`),
        JSON.stringify({ messages: [{ content: marker }], sessionId })
      )
    }

    const alice: string[] = []
    const bob: string[] = []

    const aliceCapture = captureGeminiSessionId(
      cwd,
      new Set(),
      (sessionId) => alice.push(sessionId),
      200,
      2,
      geminiHome,
      { contentIncludes: aliceMarker }
    )
    const bobCapture = captureGeminiSessionId(
      cwd,
      new Set(),
      (sessionId) => bob.push(sessionId),
      200,
      2,
      geminiHome,
      { contentIncludes: bobMarker }
    )

    writeChat(bobSessionId, bobMarker)
    writeChat(aliceSessionId, aliceMarker)

    await Promise.all([aliceCapture, bobCapture])

    expect(alice).toEqual([aliceSessionId])
    expect(bob).toEqual([bobSessionId])
  })
})
