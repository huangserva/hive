import { describe, expect, test } from 'vitest'

import {
  buildProtocolDoc,
  buildWorkerReminderTail,
  getHiveTeamRules,
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

  test('requires explicit mobile replies for Mobile App-originated user messages', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('[来自手机 Mobile App]')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('team mobile-reply "<text>"')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('phone user will not see your response')
  })

  test('does not describe plain text as reaching remote mobile or Feishu users', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('plain text to the local desktop user only')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Plain text will NOT reach Mobile App or Feishu')
  })

  test('requires phone approval for high-risk Mobile App requests and replies on denial', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('PHONE APPROVAL')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('Mobile App (`[来自手机 Mobile App]`)')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('If DENIED')
    expect(ORCHESTRATOR_REMINDER_TAIL).toContain('team mobile-reply')
  })

  test('length stays under 2000 characters for token cost control', () => {
    expect(ORCHESTRATOR_REMINDER_TAIL.length).toBeLessThan(2600)
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

  test('makes explicit that a text recap is not a report and workers must self-check before the turn ends', () => {
    const tail = buildWorkerReminderTail('disp-abc')
    expect(tail).toContain('writing a text recap is not a report')
    expect(tail).toContain('Before ending every turn')
    expect(tail).toContain('actually run')
    expect(tail).toContain('team report')
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

  test('allows nested agents for claude-workflow workers while preserving report discipline', () => {
    const tail = buildWorkerReminderTail('disp-workflow', { workflowAllowed: true })
    expect(tail).toContain('Hive Workflow Worker')
    expect(tail).toContain('You ARE expected to run your internal workflow')
    expect(tail).toContain('team report "<result>" --dispatch disp-workflow')
    expect(tail).not.toContain('Do not launch nested CLI subagents')
  })

  test('reminds workers that PM documents are a shared responsibility', () => {
    const tail = buildWorkerReminderTail('disp-pm')
    expect(tail).toContain('PM 文档共维护职责')
    expect(tail).toContain('.hive/reports/')
    expect(tail).toContain('.hive/research/')
    expect(tail).toContain('不要等 orchestrator')
  })
})

describe('getHiveTeamRules', () => {
  test('keeps ordinary workers on the no-subagent rule', () => {
    const rules = getHiveTeamRules({
      description: '普通 coder，但文本里误写 claude-workflow 字样',
      role: 'coder',
      workflowAllowed: false,
    })
    expect(rules.join('\n')).toContain('不要调用 team send')
    expect(rules.join('\n')).toContain('内置 subagent')
    expect(rules.join('\n')).not.toContain('黑盒 workflow worker')
  })

  test('switches workflow workers by hard flag even when description is edited', () => {
    const rules = getHiveTeamRules({
      description: '用户改写后的普通描述',
      role: 'custom',
      workflowAllowed: true,
    })
    const text = rules.join('\n')
    expect(text).toContain('claude-workflow')
    expect(text).toContain('被期望使用')
    expect(text).toContain('内置 subagent')
    expect(text).toContain('team report')
    expect(text).not.toContain('不要调用 team send，也不要再启动')
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

  test('renders the Chinese Mobile App reply rule in the orchestrator section', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('[来自手机 Mobile App]')
    expect(doc).toContain('回复必须用 `team mobile-reply "<text>"`')
    expect(doc).toContain('否则手机 user 看不到你的回应')
  })

  test('renders the Chinese high-risk denial path for Mobile App requests', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('手机 App 来源用 `team mobile-reply`')
    expect(doc).toContain('已撤销，请提供替代方案')
  })

  test('renders the worker rule that plain text summaries do not count as dispatch reports', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('写一段文字总结不算汇报')
    expect(doc).toContain('每个 turn 结束前自检')
    expect(doc).toContain('是否真的运行了 `team report`')
  })
})
