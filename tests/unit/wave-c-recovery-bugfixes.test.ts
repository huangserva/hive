import { describe, expect, test } from 'vitest'
import type { RecoveryMessage } from '../../src/server/message-log-store.js'
import { buildRecoverySummary } from '../../src/server/recovery-summary.js'
import { writeSystemMessage } from '../../src/server/restart-policy-support.js'
import type { AgentSummary, WorkspaceSummary } from '../../src/shared/types.js'

const extractOpenTasksSection = (summary: string) => {
  const start = summary.indexOf('## 当前未完成任务')
  const rest = summary.slice(start)
  const next = rest.indexOf('\n## ', 1)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('C2: recovery open-task reconstruction drops cancelled dispatches', () => {
  const workspace: WorkspaceSummary = { id: 'ws-1', name: 'WS', path: '/tmp/ws' }
  const orchestrator: AgentSummary = {
    description: '',
    id: 'orch',
    name: 'Boss',
    pendingTaskCount: 0,
    role: 'orchestrator',
    status: 'idle',
    workspaceId: 'ws-1',
  }
  const worker: AgentSummary = {
    description: '',
    id: 'w1',
    name: 'Guan',
    pendingTaskCount: 1,
    role: 'coder',
    status: 'idle',
    workspaceId: 'ws-1',
  }

  test('a cancelled dispatch is not listed as an open task after restart', () => {
    const messages: RecoveryMessage[] = [
      { createdAt: 1, from: 'orch', text: 'open task A', to: 'w1', type: 'send' },
      { createdAt: 2, from: 'orch', text: 'cancelled task B', to: 'w1', type: 'send' },
    ]

    const summary = buildRecoverySummary({
      agent: orchestrator,
      allTaskMessages: messages,
      cancelledDispatches: [{ text: 'cancelled task B', toAgentId: 'w1' }],
      messages,
      tasksContent: '',
      workers: [worker],
      workspace,
    })

    const section = extractOpenTasksSection(summary)
    expect(section).toContain('open task A')
    expect(section).not.toContain('cancelled task B')
  })
})

describe('C3: writeSystemMessage persists the recovery record only after a successful write', () => {
  // 写入 PTY 同步抛错（如 PTY 已失活）时，绝不能留下"已成功恢复"的 DB 记录。
  test('does not persist the recovery record when the PTY write throws', () => {
    const inserted: Array<{ text: string }> = []
    const insertMessage = (record: { text: string }) => {
      inserted.push(record)
      return { sequence: inserted.length }
    }

    expect(() =>
      writeSystemMessage({
        insertMessage: insertMessage as never,
        record: {
          createdAt: 1,
          text: 'recovery summary',
          type: 'system_recovery_summary',
          workerId: 'w1',
          workspaceId: 'ws-1',
        },
        runId: 'run-1',
        text: 'recovery summary',
        writeToRun: () => {
          throw new Error('PTY is not active for run: run-1')
        },
      })
    ).toThrow(/PTY is not active/)

    expect(inserted).toEqual([])
  })

  test('persists the recovery record after the write succeeds', () => {
    const inserted: Array<{ text: string }> = []
    const insertMessage = (record: { text: string }) => {
      inserted.push(record)
      return { sequence: inserted.length }
    }
    let written = ''

    writeSystemMessage({
      insertMessage: insertMessage as never,
      record: {
        createdAt: 1,
        text: 'recovery summary',
        type: 'system_recovery_summary',
        workerId: 'w1',
        workspaceId: 'ws-1',
      },
      runId: 'run-1',
      text: 'recovery summary',
      writeToRun: (_runId, text) => {
        written = text
      },
    })

    expect(written).toBe('recovery summary')
    expect(inserted).toHaveLength(1)
  })
})
