import { describe, expect, test } from 'vitest'

import { buildProtocolDoc } from '../../src/server/hive-team-guidance.js'

describe('buildProtocolDoc', () => {
  test('contains PM keyword', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('PM')
  })

  test('contains all 6 PM duty keywords', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('plan.md')
    expect(doc).toContain('decisions/')
    expect(doc).toContain('research/')
    expect(doc).toContain('tasks.md')
    expect(doc).toContain('milestone')
    expect(doc).toContain('全局视角')
  })

  test('contains .hive/ directory conventions section', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('plan.md')
    expect(doc).toContain('tasks.md')
    expect(doc).toContain('decisions/')
    expect(doc).toContain('research/')
    expect(doc).toContain('reports/')
    expect(doc).toContain('templates/')
  })

  test('renderRules output has consistent indentation', () => {
    const doc = buildProtocolDoc()
    const lines = doc.split('\n')
    const ruleLines = lines.filter((line) => line.startsWith('- ') || line.startsWith('  '))
    for (const line of ruleLines) {
      if (line.startsWith('- ')) continue
      expect(line.startsWith('  ')).toBe(true)
      expect(line.startsWith('\t')).toBe(false)
    }
  })

  test('contains team cancel command in orchestrator section', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('team cancel')
  })

  test('contains Open Questions / Ideas Inbox / Baseline / Decisions / Archive / Cross-workspace section headings', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('Open Questions')
    expect(doc).toContain('Ideas Inbox')
    expect(doc).toContain('Baseline')
    expect(doc).toContain('Decisions')
    expect(doc).toContain('Archive')
    expect(doc).toContain('Cross-workspace')
  })

  test('contains "最多每 session 挂 2 条新 Q" constraint', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('最多每 session 挂 2 条新 Q')
  })

  test('contains "200 行内" baseline size constraint', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('200 行内')
  })

  test('contains ADR draft naming convention draft-YYYY-MM-DD-X.md', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('draft-YYYY-MM-DD-X.md')
  })

  test('contains archive directory format archive/YYYY-MM/', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('archive/YYYY-MM/')
  })

  test('directory conventions section lists open-questions / ideas/inbox / baseline / archive', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('open-questions.md')
    expect(doc).toContain('ideas/inbox.md')
    expect(doc).toContain('baseline/')
    expect(doc).toContain('archive/')
  })

  test('contains handoff playbook rules for worker rescue and semantic preservation', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('Handoff Playbook')
    expect(doc).toContain('worker stuck')
    expect(doc).toContain('reassign')
    expect(doc).toContain('跨 session 续接')
    expect(doc).toContain('保任务语义')
  })

  test('contains loop playbook rules for bounded verifier retry loops', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('Loop Playbook')
    expect(doc).toContain('verifier')
    expect(doc).toContain('max iterations')
    expect(doc).toContain('有界停止')
    expect(doc).toContain('保任务语义')
  })

  test('contains advisor playbook rules for read-only second opinions', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('Advisor Playbook')
    expect(doc).toContain('第二意见')
    expect(doc).toContain('只读')
    expect(doc).toContain('不改代码')
    expect(doc).toContain('orch 综合而不是盲从')
  })

  test('contains committee playbook rules for opposing high-reasoning advisors', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('Committee Playbook')
    expect(doc).toContain('两个对立')
    expect(doc).toContain('高推理 advisor')
    expect(doc).toContain('committee 成员不改代码')
    expect(doc).toContain('实现路由')
  })

  test('contains epic playbook rules for immutable requirements and phase gates', () => {
    const doc = buildProtocolDoc()
    expect(doc).toContain('Epic Playbook')
    expect(doc).toContain('不可变需求')
    expect(doc).toContain('阶段闸门')
    expect(doc).toContain('plan.md 的扩展')
    expect(doc).toContain('planner / reviewer agent 不能改需求')
  })
})
