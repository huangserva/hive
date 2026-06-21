import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createRuntimeStoreServices } from '../../src/server/runtime-store-helpers.js'
import { HIVE_DIR_NAME } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-recover-data-'))
  tempDirs.push(dataDir)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-recover-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, HIVE_DIR_NAME), { recursive: true })
  writeFileSync(
    join(workspacePath, HIVE_DIR_NAME, 'tasks.md'),
    '## In progress\n\n## Open\n\n## Done\n',
    'utf8'
  )

  const agentManager = createAgentManager()
  const services = createRuntimeStoreServices({ agentManager, dataDir })
  const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Recover Test')
  const worker = services.workspaceStore.addWorker(workspace.id, { name: '关羽', role: 'coder' })
  services.agentRuntime.configureAgentLaunch(workspace.id, worker.id, {
    args: [
      '-lc',
      `${process.execPath} -e "process.stdin.on('data', d => process.stdout.write(d))"`,
    ],
    command: '/bin/bash',
  })

  return { agentManager, services, worker, workspace }
}

const waitFor = async (check: () => boolean, message: string) => {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(message)
}

describe('team recover / abandon', () => {
  test('recover replays the original dispatch to the live worker without changing dispatch id', async () => {
    const { agentManager, services, worker, workspace } = setup()
    try {
      const run = await services.agentRuntime.startAgent(workspace, worker.id, { hivePort: '4010' })
      const orchestrator = services.workspaceStore.getAgent(
        workspace.id,
        `${workspace.id}:orchestrator`
      )
      const dispatch = await services.teamOps.dispatchTask(
        workspace.id,
        worker.id,
        '继续修复 compact 卡死恢复',
        { fromAgentId: orchestrator.id, hivePort: '4010' }
      )
      services.dispatchLedgerStore.markReportOverdue(dispatch.id)

      const result = services.teamOps.recoverTask(workspace.id, dispatch.id, {
        fromAgentId: orchestrator.id,
      })

      expect(result.dispatch.id).toBe(dispatch.id)
      expect(result.forwarded).toBe(true)
      expect(
        services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)?.status
      ).toBe('report_overdue')
      await waitFor(() => {
        const output = agentManager.getRun(run.runId).output
        return (
          output.includes('[Hive 系统消息：compact recovery replay]') &&
          output.includes(dispatch.id) &&
          output.includes('继续修复 compact 卡死恢复')
        )
      }, 'expected recover replay prompt to reach worker PTY')
    } finally {
      await services.agentRuntime.close()
      services.db.close()
    }
  })

  test('recover surfaces replay injection failures to mobile system events', async () => {
    const { services, worker, workspace } = setup()
    try {
      const run = await services.agentRuntime.startAgent(workspace, worker.id, { hivePort: '4010' })
      const orchestrator = services.workspaceStore.getAgent(
        workspace.id,
        `${workspace.id}:orchestrator`
      )
      const dispatch = await services.teamOps.dispatchTask(
        workspace.id,
        worker.id,
        '需要恢复但 PTY 写入失败的派单',
        { fromAgentId: orchestrator.id, hivePort: '4010' }
      )
      services.dispatchLedgerStore.markReportOverdue(dispatch.id)
      vi.spyOn(services.agentRuntime, 'getActiveRunByAgentId').mockReturnValue(run)
      vi.spyOn(services.agentRuntime, 'writeRecoveryReplayPrompt').mockImplementation(() => {
        throw new Error('pty closed')
      })

      const result = services.teamOps.recoverTask(workspace.id, dispatch.id, {
        fromAgentId: orchestrator.id,
      })

      expect(result.forwarded).toBe(false)
      expect(result.forwardError).toContain('pty closed')
      const events = services.mobileChatStore
        .listChatMessages(workspace.id)
        .filter((message) => message.message_type === 'system_event')
        .map((message) => JSON.parse(message.content_json) as { operation?: string; type?: string })
      expect(events).toContainEqual(
        expect.objectContaining({
          operation: 'recover',
          type: 'orchestrator_forward_failed',
        })
      )
    } finally {
      await services.agentRuntime.close()
      services.db.close()
    }
  })

  test('abandon rejects live workers, then releases the dispatch lock after the worker run is terminal', async () => {
    const { services, worker, workspace } = setup()
    try {
      const run = await services.agentRuntime.startAgent(workspace, worker.id, { hivePort: '4010' })
      const orchestrator = services.workspaceStore.getAgent(
        workspace.id,
        `${workspace.id}:orchestrator`
      )
      const dispatch = await services.teamOps.dispatchTask(
        workspace.id,
        worker.id,
        '卡住的旧派单',
        {
          fromAgentId: orchestrator.id,
          hivePort: '4010',
        }
      )
      services.dispatchLedgerStore.markReportOverdue(dispatch.id)

      expect(() =>
        services.teamOps.abandonTask(workspace.id, dispatch.id, {
          confirmWorkerStopped: true,
          fromAgentId: orchestrator.id,
        })
      ).toThrow(/worker still has an active run/)

      services.agentRuntime.stopAgentRun(run.runId)
      await waitFor(() => {
        const latest = services.agentRuntime.listAgentRuns(worker.id)[0]
        return (
          latest?.runId === run.runId && (latest.status === 'exited' || latest.status === 'error')
        )
      }, 'expected worker run to become terminal')

      const abandoned = services.teamOps.abandonTask(workspace.id, dispatch.id, {
        confirmWorkerStopped: true,
        fromAgentId: orchestrator.id,
      })

      expect(abandoned.dispatch.status).toBe('cancelled')
      expect(services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)).toBe(
        undefined
      )

      await expect(
        services.teamOps.dispatchTask(workspace.id, worker.id, '新派单可以进入', {
          fromAgentId: orchestrator.id,
          hivePort: '4010',
        })
      ).resolves.toEqual(expect.objectContaining({ text: '新派单可以进入' }))
    } finally {
      await services.agentRuntime.close()
      services.db.close()
    }
  })
})
