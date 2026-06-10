import { describe, expect, test } from 'vitest'

import { buildAgentStartupInstructions } from '../../src/server/agent-startup-instructions.js'
import { SENTINEL_ROLE_DESCRIPTION } from '../../src/server/role-templates.js'
import {
  buildSentinelHeartbeatPayload,
  SENTINEL_RULES,
} from '../../src/server/sentinel-guidance.js'

const sentinelAgent = {
  description: 'Sentinel 巡检员',
  id: 'workspace-1:sentinel',
  name: 'Sentinel',
  pendingTaskCount: 0,
  role: 'sentinel',
  status: 'idle',
  workspaceId: 'workspace-1',
} as const

const workspace = {
  id: 'workspace-1',
  name: 'Alpha',
  path: '/tmp/alpha',
}

describe('sentinel guidance report contract', () => {
  test('startup instructions route sentinel inspection findings through team status, not dispatch report', () => {
    const instructions = buildAgentStartupInstructions({
      agent: sentinelAgent,
      workspace,
    })

    expect(instructions).toContain('team status "<巡检发现>"')
    expect(instructions).not.toContain('team report "<巡检发现>"')
    expect(instructions).not.toContain('用 team report 汇报')
  })

  test('sentinel rules do not instruct dispatch-less team report usage', () => {
    const rules = [SENTINEL_ROLE_DESCRIPTION, ...SENTINEL_RULES].join('\n')

    expect(rules).toContain('team status')
    expect(rules).toContain('巡检发现')
    expect(rules).not.toContain('with `team report`')
    expect(rules).not.toContain('用 team report 汇报')
    expect(rules).not.toContain('Use `team status` only')
  })

  test('heartbeat prompt tells sentinel to publish findings with team status', () => {
    const payload = buildSentinelHeartbeatPayload({
      cockpitSummary: 'open_questions=0\nhigh_ai_actions=0\nbaseline=fresh',
      gitSummary: 'status: clean',
      workspace,
    })

    expect(payload).toContain('用 team status 汇报给 Orchestrator')
    expect(payload).not.toContain('用 team report 汇报给 Orchestrator')
  })
})
