import { describe, expect, test } from 'vitest'

import {
  BUILTIN_ROLE_TEMPLATES,
  CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL,
  CLAUDE_WORKFLOW_ROLE_DESCRIPTION,
} from '../../src/server/role-templates.js'

describe('builtin role templates', () => {
  test('includes claude-workflow as a workflow runner with GLM Anthropic routing defaults', () => {
    const template = BUILTIN_ROLE_TEMPLATES.find((item) => item.id === 'claude-workflow')

    expect(template).toBeDefined()
    expect(template?.defaultCommand).toBe('claude')
    expect(template?.defaultArgs).toEqual([])
    expect(template?.roleType).toBe('custom')
    expect(template?.description).toBe(CLAUDE_WORKFLOW_ROLE_DESCRIPTION)
    expect(template?.description).toContain('claude-workflow')
    expect(template?.description).toContain('被期望使用内置 subagent')
    expect(template?.description).not.toContain('不要启动内置 subagent')
    expect(template?.description).not.toContain('不要再启动')
    expect(template?.defaultEnv).toMatchObject({
      ANTHROPIC_BASE_URL: CLAUDE_WORKFLOW_ANTHROPIC_BASE_URL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2',
    })
    expect(template?.defaultEnv).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
  })
})
