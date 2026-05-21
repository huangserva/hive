import { describe, expect, test } from 'vitest'

import {
  buildApprovalCard,
  buildResolvedApprovalCard,
  getCardActionOperator,
  parseApprovalCardAction,
} from '../../src/server/feishu-transport-utils.js'

const findFieldContent = (card: ReturnType<typeof buildApprovalCard>, label: string) => {
  const fieldsElement = card.elements.find(
    (el): el is { fields: Array<{ text: { content: string } }>; tag: string } =>
      'fields' in el && el.tag === 'div'
  )
  if (!fieldsElement) return null
  const field = fieldsElement.fields.find((f) => f.text.content.startsWith(`**${label}**`))
  return field?.text.content ?? null
}

describe('buildApprovalCard', () => {
  test('high risk uses red template and 高风险动作 in title', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'uuid-1',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    expect(card.header.template).toBe('red')
    expect(card.header.title.content).toContain('高风险动作')
  })

  test('medium risk uses orange template and 中风险动作 in title', () => {
    const card = buildApprovalCard({
      action: 'restart',
      approvalId: 'uuid-2',
      risk: 'medium',
      target: null,
      workspaceName: 'WS',
    })
    expect(card.header.template).toBe('orange')
    expect(card.header.title.content).toContain('中风险动作')
  })

  test('config sets wide_screen_mode to true', () => {
    const card = buildApprovalCard({
      action: 'x',
      approvalId: 'id',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    expect(card.config.wide_screen_mode).toBe(true)
  })

  test('action text is embedded in 动作 field', () => {
    const card = buildApprovalCard({
      action: 'delete "old" files\nrecursive',
      approvalId: 'id',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const content = findFieldContent(card, '动作')
    expect(content).toContain('delete "old" files\nrecursive')
  })

  test('target null shows orchestrator 自己 fallback', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'id',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const content = findFieldContent(card, '派给')
    expect(content).toContain('orchestrator 自己')
  })

  test('target name is embedded in 派给 field', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'id',
      risk: 'high',
      target: '关羽',
      workspaceName: 'WS',
    })
    const content = findFieldContent(card, '派给')
    expect(content).toContain('关羽')
    expect(content).not.toContain('orchestrator 自己')
  })

  test('workspaceName is embedded in Workspace field', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'id',
      risk: 'high',
      target: null,
      workspaceName: 'Production',
    })
    const content = findFieldContent(card, 'Workspace')
    expect(content).toContain('Production')
  })

  test('has exactly 2 buttons: Allow and Deny', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'id',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const actionElement = card.elements.find(
      (el): el is { actions: unknown[]; tag: string } => el.tag === 'action'
    )
    expect(actionElement).toBeDefined()
    expect(actionElement?.actions).toHaveLength(2)
  })

  test('Allow button has correct text, type, and value', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'uuid-allow-test',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const actionElement = card.elements.find(
      (el): el is { actions: Array<Record<string, unknown>>; tag: string } => el.tag === 'action'
    )
    const allowBtn = actionElement?.actions[0] as Record<string, unknown>
    expect(allowBtn.text).toEqual({ content: '✅ 允许', tag: 'plain_text' })
    expect(allowBtn.type).toBe('primary')
    expect(allowBtn.value).toEqual({ approval_id: 'uuid-allow-test', decision: 'allow' })
  })

  test('Deny button has correct text, type, and value', () => {
    const card = buildApprovalCard({
      action: 'deploy',
      approvalId: 'uuid-deny-test',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const actionElement = card.elements.find(
      (el): el is { actions: Array<Record<string, unknown>>; tag: string } => el.tag === 'action'
    )
    const denyBtn = actionElement?.actions[1] as Record<string, unknown>
    expect(denyBtn.text).toEqual({ content: '❌ 拒绝', tag: 'plain_text' })
    expect(denyBtn.type).toBe('danger')
    expect(denyBtn.value).toEqual({ approval_id: 'uuid-deny-test', decision: 'deny' })
  })

  test('different approvalId reflects in button values', () => {
    const cardA = buildApprovalCard({
      action: 'x',
      approvalId: 'id-A',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const cardB = buildApprovalCard({
      action: 'x',
      approvalId: 'id-B',
      risk: 'high',
      target: null,
      workspaceName: 'WS',
    })
    const getFirstBtnValue = (card: ReturnType<typeof buildApprovalCard>) => {
      const actionEl = card.elements.find(
        (el): el is { actions: Array<Record<string, unknown>>; tag: string } => el.tag === 'action'
      )
      return (actionEl?.actions[0] as Record<string, unknown>).value as Record<string, unknown>
    }
    expect(getFirstBtnValue(cardA).approval_id).toBe('id-A')
    expect(getFirstBtnValue(cardB).approval_id).toBe('id-B')
  })
})

describe('buildResolvedApprovalCard', () => {
  test('allow decision uses green template and ✅ 已允许 title', () => {
    const card = buildResolvedApprovalCard({
      action: 'deploy',
      decision: 'allow',
      operator: 'ou_x',
      resolvedAt: Date.now(),
    })
    expect(card.header.template).toBe('green')
    expect(card.header.title.content).toContain('✅ 已允许')
  })

  test('deny decision uses grey template and ❌ 已拒绝 title', () => {
    const card = buildResolvedApprovalCard({
      action: 'deploy',
      decision: 'deny',
      operator: 'ou_x',
      resolvedAt: Date.now(),
    })
    expect(card.header.template).toBe('grey')
    expect(card.header.title.content).toContain('❌ 已拒绝')
  })

  test('has no action buttons (read-only card)', () => {
    const card = buildResolvedApprovalCard({
      action: 'deploy',
      decision: 'allow',
      operator: 'ou_x',
      resolvedAt: Date.now(),
    })
    const hasAction = card.elements.some(
      (el) => typeof el === 'object' && 'tag' in el && el.tag === 'action'
    )
    expect(hasAction).toBe(false)
  })

  test('includes operator name with @ prefix', () => {
    const card = buildResolvedApprovalCard({
      action: 'deploy',
      decision: 'allow',
      operator: 'ou_abc123',
      resolvedAt: Date.now(),
    })
    const fieldsElement = card.elements.find(
      (el): el is { fields: Array<{ text: { content: string } }>; tag: string } =>
        'fields' in el && el.tag === 'div'
    )
    const resultField = fieldsElement?.fields.find((f) => f.text.content.startsWith('**处理结果**'))
    expect(resultField?.text.content).toContain('@ou_abc123')
  })

  test('resolvedAt is formatted as HH:MM', () => {
    const timestamp = new Date(2026, 0, 15, 14, 35, 0).getTime()
    const card = buildResolvedApprovalCard({
      action: 'deploy',
      decision: 'allow',
      operator: 'ou_x',
      resolvedAt: timestamp,
    })
    const fieldsElement = card.elements.find(
      (el): el is { fields: Array<{ text: { content: string } }>; tag: string } =>
        'fields' in el && el.tag === 'div'
    )
    const resultField = fieldsElement?.fields.find((f) => f.text.content.startsWith('**处理结果**'))
    expect(resultField?.text.content).toContain('14:35')
  })

  test('action text is embedded', () => {
    const card = buildResolvedApprovalCard({
      action: 'delete /tmp/old',
      decision: 'deny',
      operator: 'ou_x',
      resolvedAt: Date.now(),
    })
    const fieldsElement = card.elements.find(
      (el): el is { fields: Array<{ text: { content: string } }>; tag: string } =>
        'fields' in el && el.tag === 'div'
    )
    const actionField = fieldsElement?.fields.find((f) => f.text.content.startsWith('**动作**'))
    expect(actionField?.text.content).toContain('delete /tmp/old')
  })
})

describe('parseApprovalCardAction', () => {
  test('valid allow returns parsed result', () => {
    const result = parseApprovalCardAction({ approval_id: 'uuid-1', decision: 'allow' })
    expect(result).toEqual({ approvalId: 'uuid-1', decision: 'allow' })
  })

  test('valid deny returns parsed result', () => {
    const result = parseApprovalCardAction({ approval_id: 'uuid-2', decision: 'deny' })
    expect(result).toEqual({ approvalId: 'uuid-2', decision: 'deny' })
  })

  test('missing approval_id returns null', () => {
    expect(parseApprovalCardAction({ decision: 'allow' })).toBeNull()
  })

  test('missing decision returns null', () => {
    expect(parseApprovalCardAction({ approval_id: 'uuid' })).toBeNull()
  })

  test('invalid decision value returns null', () => {
    expect(parseApprovalCardAction({ approval_id: 'uuid', decision: 'maybe' })).toBeNull()
  })

  test('null value returns null', () => {
    expect(parseApprovalCardAction(null)).toBeNull()
  })

  test('undefined value returns null', () => {
    expect(parseApprovalCardAction(undefined)).toBeNull()
  })

  test('string value returns null', () => {
    expect(parseApprovalCardAction('not an object')).toBeNull()
  })

  test('non-string approval_id returns null', () => {
    expect(parseApprovalCardAction({ approval_id: 123, decision: 'allow' })).toBeNull()
  })

  test('non-string decision returns null', () => {
    expect(parseApprovalCardAction({ approval_id: 'uuid', decision: true })).toBeNull()
  })
})

describe('getCardActionOperator', () => {
  test('returns user_id when present', () => {
    const event = { operator: { user_id: 'uid_123', open_id: 'ou_456' } }
    expect(getCardActionOperator(event as never)).toBe('uid_123')
  })

  test('falls back to open_id when user_id is missing', () => {
    const event = { operator: { open_id: 'ou_789' } }
    expect(getCardActionOperator(event as never)).toBe('ou_789')
  })

  test('falls back to union_id when user_id and open_id are missing', () => {
    const event = { operator: { union_id: 'on_111' } }
    expect(getCardActionOperator(event as never)).toBe('on_111')
  })

  test('returns null when operator is null', () => {
    expect(getCardActionOperator({ operator: null } as never)).toBeNull()
  })

  test('returns null when all id fields are missing', () => {
    expect(getCardActionOperator({ operator: {} } as never)).toBeNull()
  })
})
