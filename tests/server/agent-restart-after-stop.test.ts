import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const tempDirs: string[] = []

const waitFor = async (assertion: () => void, timeoutMs = 4000, intervalMs = 25) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw lastError
}

const prepareWorkspace = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-restart-after-stop-'))
  const workspacePath = join(dataDir, 'workspace')
  mkdirSync(workspacePath, { recursive: true })
  tempDirs.push(dataDir)
  return { dataDir, workspacePath }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('agent restart immediately after stop — real PTY (bug #7)', () => {
  // bug #7：stop 后到 PTY 真正退出之间 run.status 仍是 running，
  // 紧接着的 start 命中去重直接返回正在被 kill 的旧 run，重启变空操作。
  // 修复后 stop 已标记 stopRequested，start 必须 spawn 出全新的 run（新 runId / 新 PTY）。
  test('starting right after stop spawns a brand new run instead of returning the dying one', async () => {
    const { dataDir, workspacePath } = prepareWorkspace()
    // 脚本忽略 SIGTERM/SIGHUP，保证 stop 后到 force-kill 之间 PTY 仍存活、run.status 仍为 running，
    // 这样才能稳定复现「stop 后 PTY 退出前 start」的窗口。
    const script = join(workspacePath, 'ignore-stop.js')
    writeFileSync(
      script,
      [
        "process.on('SIGHUP', () => {})",
        "process.on('SIGTERM', () => {})",
        'process.stdin.resume()',
        'setInterval(() => {}, 1000)',
        "console.log('stubborn-started')",
      ].join('\n')
    )

    const store = createRuntimeStore({ agentManager: createAgentManager(), dataDir })
    const workspace = store.createWorkspace(workspacePath, 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    store.configureAgentLaunch(workspace.id, worker.id, {
      command: process.execPath,
      args: [script],
    })

    try {
      const firstRun = await store.startAgent(workspace.id, worker.id, { hivePort: '4010' })
      await waitFor(() => {
        expect(store.getLiveRun(firstRun.runId).status).toBe('running')
      })

      // stop 后立即（PTY 还没退出，旧 run.status 仍是 running）再次 start。
      store.stopAgentRun(firstRun.runId)
      expect(store.getLiveRun(firstRun.runId).status).toBe('running')

      const secondRun = await store.startAgent(workspace.id, worker.id, { hivePort: '4010' })

      // 关键断言：必须 spawn 出新 run，而不是返回旧的垂死 run。
      expect(secondRun.runId).not.toBe(firstRun.runId)
      await waitFor(() => {
        expect(store.getLiveRun(secondRun.runId).status).toBe('running')
      })
      expect(store.getLiveRun(secondRun.runId).pid).not.toBe(store.getLiveRun(firstRun.runId).pid)
    } finally {
      await store.close()
    }
  })
})
