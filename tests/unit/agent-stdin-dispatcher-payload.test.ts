import { describe, expect, test } from 'vitest'

import {
  buildOrchestratorQuestionAnsweredPayload,
  buildOrchestratorReportPayload,
  buildOrchestratorStatusPayload,
  buildOrchestratorUserInputPayload,
  buildWorkerCancelPayload,
  buildWorkerCockpitSnapshot,
  buildWorkerDispatchPayload,
} from '../../src/server/agent-stdin-dispatcher.js'
import type { ParsedCockpit } from '../../src/server/cockpit-doc.js'
import {
  buildWorkerReminderTail,
  ORCHESTRATOR_REMINDER_TAIL,
  PM_DISPATCH_REMINDER,
} from '../../src/server/hive-team-guidance.js'

const lineIndexOf = (payload: string, needle: string): number =>
  payload.split('\n').findIndex((line) => line === needle || line.includes(needle))

describe('buildOrchestratorReportPayload', () => {
  test('starts with the report header and includes the body verbatim', () => {
    const payload = buildOrchestratorReportPayload('coder-1', 'fix shipped', [])
    expect(payload.split('\n')[0]).toBe('[Hive 系统消息：来自 @coder-1 的汇报]')
    expect(payload).toContain('fix shipped')
  })

  test('renders every artifact path on its own `artifact: <path>` line', () => {
    const payload = buildOrchestratorReportPayload('coder-1', 'done', ['a.md', 'b.png'])
    const lines = payload.split('\n')
    expect(lines).toContain('artifact: a.md')
    expect(lines).toContain('artifact: b.png')
  })

  test('places the orchestrator reminder AFTER the body, not before — recency anchoring depends on tail position', () => {
    const payload = buildOrchestratorReportPayload('coder-1', 'fix shipped', ['a.md'])
    const bodyIdx = lineIndexOf(payload, 'fix shipped')
    const artifactIdx = lineIndexOf(payload, 'artifact: a.md')
    const reminderIdx = lineIndexOf(payload, '<hive-system-reminder>')
    expect(bodyIdx).toBeGreaterThanOrEqual(0)
    expect(reminderIdx).toBeGreaterThan(bodyIdx)
    expect(reminderIdx).toBeGreaterThan(artifactIdx)
  })

  test('contains the full ORCHESTRATOR_REMINDER_TAIL block verbatim', () => {
    const payload = buildOrchestratorReportPayload('coder-1', 'done', [])
    expect(payload).toContain(ORCHESTRATOR_REMINDER_TAIL)
  })

  test('ends with a trailing newline so xterm/bracketed-paste submits the message', () => {
    const payload = buildOrchestratorReportPayload('coder-1', 'done', [])
    expect(payload.endsWith('\n')).toBe(true)
  })
})

describe('buildOrchestratorStatusPayload', () => {
  test('starts with the status header (distinct from the report header) and trails with the same reminder', () => {
    const payload = buildOrchestratorStatusPayload('coder-1', 'waiting on tests', [])
    expect(payload.split('\n')[0]).toBe('[Hive 系统消息：来自 @coder-1 的状态更新]')
    expect(payload).toContain(ORCHESTRATOR_REMINDER_TAIL)
    // Reminder is at tail, not at head.
    const reminderIdx = lineIndexOf(payload, '<hive-system-reminder>')
    const bodyIdx = lineIndexOf(payload, 'waiting on tests')
    expect(reminderIdx).toBeGreaterThan(bodyIdx)
  })
})

describe('buildOrchestratorUserInputPayload', () => {
  test('puts the user text first, the reminder last', () => {
    const payload = buildOrchestratorUserInputPayload('please draft the migration')
    const lines = payload.split('\n')
    expect(lines[0]).toBe('please draft the migration')
    const reminderIdx = lineIndexOf(payload, '<hive-system-reminder>')
    expect(reminderIdx).toBeGreaterThan(0)
  })

  test('preserves multi-line user input as-is before the reminder', () => {
    const payload = buildOrchestratorUserInputPayload('line one\nline two')
    expect(payload.startsWith('line one\nline two\n')).toBe(true)
    expect(payload).toContain(ORCHESTRATOR_REMINDER_TAIL)
  })
})

describe('buildOrchestratorQuestionAnsweredPayload', () => {
  test('tells the orchestrator a Cockpit question was answered and points it back to open-questions.md', () => {
    const payload = buildOrchestratorQuestionAnsweredPayload(
      'Q-E2E',
      'Run the browser smoke before closing M17'
    )
    expect(payload.split('\n')[0]).toBe('[Hive 系统消息：PM question 已被 user 答复]')
    expect(payload).toContain('question_id: Q-E2E')
    expect(payload).toContain('answer_summary: Run the browser smoke before closing M17')
    expect(payload).toContain('请重读 .hive/open-questions.md')
    expect(payload).toContain('这不是新 dispatch')
    expect(payload).toContain(ORCHESTRATOR_REMINDER_TAIL)
  })
})

describe('buildWorkerDispatchPayload', () => {
  test('keeps the existing dispatch header, role, obligation prose, and task body intact', () => {
    const payload = buildWorkerDispatchPayload(
      'orchestrator-1',
      'Coder — implements features',
      'disp-42',
      'add error handling to login.ts'
    )
    expect(payload).toContain('[Hive 系统消息：来自 @orchestrator-1 的派单]')
    expect(payload).toContain('你的角色：Coder — implements features')
    expect(payload).toContain('dispatch_id: disp-42')
    expect(payload).toContain('add error handling to login.ts')
  })

  test('appends the worker reminder tail with the dispatch_id interpolated', () => {
    const payload = buildWorkerDispatchPayload('orchestrator-1', 'Coder', 'disp-77', 'task body')
    expect(payload).toContain(buildWorkerReminderTail('disp-77'))
    // No leaked placeholder.
    expect(payload).not.toContain('--dispatch <id>')
  })

  test('places the worker reminder AFTER the task body so it is the last thing the worker sees', () => {
    const payload = buildWorkerDispatchPayload('orchestrator-1', 'Coder', 'disp-99', 'do the thing')
    const taskBodyIdx = lineIndexOf(payload, 'do the thing')
    const reminderIdx = lineIndexOf(payload, '<hive-system-reminder>')
    expect(taskBodyIdx).toBeGreaterThanOrEqual(0)
    expect(reminderIdx).toBeGreaterThan(taskBodyIdx)
  })

  test('injects PM co-maintenance requirements into every worker dispatch', () => {
    const payload = buildWorkerDispatchPayload(
      'orchestrator-1',
      'Coder',
      'disp-pm',
      'research paseo and write the report'
    )
    const taskBodyIdx = lineIndexOf(payload, 'research paseo and write the report')
    const pmReminderIdx = lineIndexOf(payload, 'PM 文档共维护')
    const reportRequirementIdx = lineIndexOf(payload, '.hive/reports/*.html')
    const researchRequirementIdx = lineIndexOf(payload, '.hive/research/*.md')
    const workerTailIdx = lineIndexOf(payload, '<hive-system-reminder>')

    expect(payload).toContain(PM_DISPATCH_REMINDER)
    expect(pmReminderIdx).toBeGreaterThan(taskBodyIdx)
    expect(reportRequirementIdx).toBeGreaterThan(pmReminderIdx)
    expect(researchRequirementIdx).toBeGreaterThan(pmReminderIdx)
    expect(workerTailIdx).toBeGreaterThan(pmReminderIdx)
  })

  test('can include a compact Cockpit snapshot before the worker reminder tail', () => {
    const payload = buildWorkerDispatchPayload(
      'orchestrator-1',
      'Coder',
      'disp-snapshot',
      'fix the flaky test',
      'Cockpit snapshot: phase=build; open_questions=2'
    )

    const pmReminderIdx = lineIndexOf(payload, 'PM 文档共维护')
    const snapshotIdx = lineIndexOf(payload, 'Cockpit snapshot: phase=build')
    const workerTailIdx = lineIndexOf(payload, '<hive-system-reminder>')

    expect(snapshotIdx).toBeGreaterThan(pmReminderIdx)
    expect(workerTailIdx).toBeGreaterThan(snapshotIdx)
  })

  test('can include a compact worker capability summary in dispatch context', () => {
    const payload = buildWorkerDispatchPayload(
      'orchestrator-1',
      'Coder',
      'disp-cap',
      'run browser smoke',
      undefined,
      'Codex capabilities: provider=codex; risk=high; unattended=true; features=browser_e2e, mcp'
    )

    expect(payload).toContain('**Worker capability manifest（runtime 推导）**')
    expect(payload).toContain('provider=codex')
    expect(payload).toContain('browser_e2e')
    expect(lineIndexOf(payload, 'provider=codex')).toBeGreaterThan(
      lineIndexOf(payload, 'run browser smoke')
    )
  })
})

describe('buildWorkerCockpitSnapshot', () => {
  test('summarizes live PM state without dumping full Cockpit documents', () => {
    const snapshot = buildWorkerCockpitSnapshot({
      aiActions: [
        {
          action: '回答',
          id: 'Q1',
          priority: 'high',
          targetTab: 'questions',
          text: 'Need key',
          type: 'question',
        },
        {
          action: '查看',
          id: 'baseline-stale',
          priority: 'medium',
          targetTab: 'baseline',
          text: 'stale',
          type: 'audit',
        },
      ],
      baseline: { staleHint: 'baseline stale' },
      plan: {
        currentPhase: null,
        frontmatter: { current_phase: 'M13 Layer 4' },
        milestones: [
          {
            body: '',
            doneCount: 0,
            id: 'M13',
            items: [],
            progress: 0,
            status: 'in_progress',
            title: 'PM co-maintenance',
            totalCount: 0,
          },
        ],
      },
      questions: { high: [{}], medium: [{}], low: [] },
    } as unknown as ParsedCockpit)

    expect(snapshot).toContain('Cockpit snapshot')
    expect(snapshot).toContain('phase: M13 Layer 4')
    expect(snapshot).toContain('active: M13 PM co-maintenance')
    expect(snapshot).toContain('open_questions: 2')
    expect(snapshot).toContain('high_ai_actions: 1')
    expect(snapshot).toContain('baseline: stale')
    expect(snapshot).toContain('only stage your files')
    expect(snapshot.length).toBeLessThan(520)
  })
})

describe('buildWorkerCancelPayload', () => {
  test('includes dispatch id and reason', () => {
    const payload = buildWorkerCancelPayload('disp-42', 'wrong direction')
    expect(payload).toContain('disp-42')
    expect(payload).toContain('已取消')
    expect(payload).toContain('wrong direction')
  })

  test('instructs worker to stop and not report', () => {
    const payload = buildWorkerCancelPayload('disp-1', 'test')
    expect(payload).toContain('请停止执行这条派单')
    expect(payload).toContain('不要再为它调用 team report')
  })
})
