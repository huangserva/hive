import { describe, expect, test } from 'vitest'

import {
  buildProtocolDoc,
  buildWorkerReminderTail,
  ORCHESTRATOR_REMINDER_TAIL,
  PM_DISPATCH_REMINDER,
} from '../../src/server/hive-team-guidance.js'

describe('ORCHESTRATOR_REMINDER_TAIL', () => {
  test('wraps the reminder in a hive-system-reminder XML envelope', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL.startsWith('<hive-system-reminder>')).toBe(true)
    expect(ORCHESTRATOR_REMINDER_TAIL.endsWith('</hive-system-reminder>')).toBe(true)
  })

  test('names the role and the exact dispatch verb so a post-/compact agent can re-anchor', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Hive Orchestrator')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('team send "<worker-name>" "<task>"')
  })

  test('forbids the CLI built-in subagent escape hatch', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Never call')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Task')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Explore')
  })

  test('contains session start / baseline / ideas/inbox / open-questions keywords', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('session start')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('baseline')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('ideas/inbox')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('open-questions')
  })

  test('length stays under 2000 characters for token cost control', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL.length).toBeLessThan(2000)
  })
})

describe('buildWorkerReminderTail', () => {
  test('wraps the reminder in a hive-system-reminder XML envelope', () => {
    const tail = buildWorkerReminderTail('disp-1234')
    expect(tail.startsWith('<hive-system-reminder>')).toBe(true)
    expect(tail.endsWith('</hive-system-reminder>')).toBe(true)
  })

  test('interpolates the dispatch_id into the team-report syntax line', () => {
    const tail = buildWorkerReminderTail('disp-abc')
    expect(tail).toContain('team report "<result>" --dispatch disp-abc')
    expect(tail).toContain('team report --stdin --dispatch disp-abc')
  })

  test('different dispatch_ids produce different reminder bodies', () => {
    const left = buildWorkerReminderTail('disp-1')
    const right = buildWorkerReminderTail('disp-2')
    expect(left).not.toEqual(right)
    expect(left).toContain('disp-1')
    expect(left).not.toContain('disp-2')
    expect(right).toContain('disp-2')
    expect(right).not.toContain('disp-1')
  })

  test('names the role and forbids nested subagents', () => {
    const tail = buildWorkerReminderTail('disp-x')
    expect(tail).toContain('Hive Worker')
    expect(tail).toContain('Do not launch nested CLI subagents')
  })

  test('reminds workers that PM documents are a shared responsibility', () => {
    const tail = buildWorkerReminderTail('disp-pm')
    expect(tail).toContain('PM 文档共维护职责')
    expect(tail).toContain('.hive/reports/')
    expect(tail).toContain('.hive/research/')
    expect(tail).toContain('不要等 orchestrator')
  })
})

describe('PM_DISPATCH_REMINDER', () => {
  test('requires research-class work to produce both report and research note', () => {
    expect(PM_DISPATCH_REMINDER).toContain('PM 文档共维护')
    expect(PM_DISPATCH_REMINDER).toContain('.hive/reports/*.html')
    expect(PM_DISPATCH_REMINDER).toContain('.hive/research/*.md')
    expect(PM_DISPATCH_REMINDER).toContain('plan.md')
    expect(PM_DISPATCH_REMINDER).toContain('decisions/')
  })
})

describe('buildProtocolDoc', () => {
  test('renders both orchestrator and worker rule sections', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('## Orchestrator rules')
    expect(doc).toContain('## Worker rules')
    expect(doc).toContain('## `team` CLI — orchestrator')
    expect(doc).toContain('## `team` CLI — worker')
  })

  test('mentions the .hive/PROTOCOL.md cat-recover path explicitly', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('`cat .hive/PROTOCOL.md`')
  })

  test('starts with an H1 heading so a tail of the file is still self-identifying', () => {
    const doc = buildProtocolDoc()
    expect(doc.split('\n')[0]).toBe('# Hive Team Protocol')
  })

  test('renders rule entries as a bulleted list (one bullet per rule, not a single paragraph)', () => {
    const doc = buildProtocolDoc()
    // Both sections should yield at least 3 bullets each (current rule counts
    // are 7 / 6; locking in "at least 3" tolerates future rule edits while
    // still catching the regression where renderRules collapsed bullets).
    const orchSection = doc.split('## Orchestrator rules')[1]?.split('## Worker rules')[0] ?? ''
    const workerSection = doc.split('## Worker rules')[1] ?? ''
    expect(
      orchSection.split('\n').filter((line) => line.startsWith('- ')).length
    ).toBeGreaterThanOrEqual(3)
    expect(
      workerSection.split('\n').filter((line) => line.startsWith('- ')).length
    ).toBeGreaterThanOrEqual(3)
  })
})
