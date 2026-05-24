import { describe, expect, test } from 'vitest'

import {
  ADR_TEMPLATE,
  BASELINE_INDEX_TEMPLATE,
  BASELINE_MODULE_MAP_TEMPLATE,
  BASELINE_PLACEHOLDER_TEMPLATE,
  BASELINE_RUNTIME_FLOWS_TEMPLATE,
  HANDOFF_TEMPLATE,
  IDEAS_INBOX_TEMPLATE,
  MILESTONE_REVIEW_TEMPLATE,
  OPEN_QUESTIONS_TEMPLATE,
  PLAN_TEMPLATE,
  RESEARCH_TEMPLATE,
} from '../../src/server/pm-templates.js'

describe('PLAN_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof PLAN_TEMPLATE).toBe('string')
    expect(PLAN_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains required placeholders', () => {
    expect(PLAN_TEMPLATE).toContain('{{PROJECT_NAME}}')
    expect(PLAN_TEMPLATE).toContain('{{YYYY-MM-DD}}')
  })

  test('contains required sections', () => {
    expect(PLAN_TEMPLATE).toContain('## 目标')
    expect(PLAN_TEMPLATE).toContain('## 里程碑')
    expect(PLAN_TEMPLATE).toContain('## Scope')
  })
})

describe('ADR_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof ADR_TEMPLATE).toBe('string')
    expect(ADR_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains required placeholders', () => {
    expect(ADR_TEMPLATE).toContain('{{DECISION_TITLE}}')
    expect(ADR_TEMPLATE).toContain('{{YYYY-MM-DD}}')
  })

  test('contains required sections', () => {
    expect(ADR_TEMPLATE).toContain('## 背景')
    expect(ADR_TEMPLATE).toContain('## 决策')
    expect(ADR_TEMPLATE).toContain('## 理由')
    expect(ADR_TEMPLATE).toContain('## 已知代价')
  })
})

describe('HANDOFF_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof HANDOFF_TEMPLATE).toBe('string')
    expect(HANDOFF_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains required placeholders', () => {
    expect(HANDOFF_TEMPLATE).toContain('{{PROJECT_NAME}}')
    expect(HANDOFF_TEMPLATE).toContain('{{YYYY-MM-DD}}')
  })

  test('contains required sections', () => {
    expect(HANDOFF_TEMPLATE).toContain('<h2>这次做了什么</h2>')
    expect(HANDOFF_TEMPLATE).toContain('<h2>当前状态</h2>')
    expect(HANDOFF_TEMPLATE).toContain('<h2>下一次 session 接手要做的</h2>')
  })
})

describe('RESEARCH_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof RESEARCH_TEMPLATE).toBe('string')
    expect(RESEARCH_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains required placeholders', () => {
    expect(RESEARCH_TEMPLATE).toContain('{{TOPIC}}')
    expect(RESEARCH_TEMPLATE).toContain('{{YYYY-MM-DD}}')
  })

  test('contains required sections', () => {
    expect(RESEARCH_TEMPLATE).toContain('## 问题')
    expect(RESEARCH_TEMPLATE).toContain('## 探索过程')
    expect(RESEARCH_TEMPLATE).toContain('## 结论')
    expect(RESEARCH_TEMPLATE).toContain('## 影响')
  })
})

describe('MILESTONE_REVIEW_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof MILESTONE_REVIEW_TEMPLATE).toBe('string')
    expect(MILESTONE_REVIEW_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains required placeholders', () => {
    expect(MILESTONE_REVIEW_TEMPLATE).toContain('{{MILESTONE_NAME}}')
    expect(MILESTONE_REVIEW_TEMPLATE).toContain('{{YYYY-MM-DD}}')
  })

  test('contains required sections', () => {
    expect(MILESTONE_REVIEW_TEMPLATE).toContain('## 计划 vs 实际')
    expect(MILESTONE_REVIEW_TEMPLATE).toContain('## 跑偏点')
    expect(MILESTONE_REVIEW_TEMPLATE).toContain('## 调整建议')
    expect(MILESTONE_REVIEW_TEMPLATE).toContain('## Next')
  })
})

describe('OPEN_QUESTIONS_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof OPEN_QUESTIONS_TEMPLATE).toBe('string')
    expect(OPEN_QUESTIONS_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains priority markers and archive section', () => {
    expect(OPEN_QUESTIONS_TEMPLATE).toContain('🔴 high')
    expect(OPEN_QUESTIONS_TEMPLATE).toContain('🟠 medium')
    expect(OPEN_QUESTIONS_TEMPLATE).toContain('🟢 low')
    expect(OPEN_QUESTIONS_TEMPLATE).toContain('已答')
  })
})

describe('IDEAS_INBOX_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof IDEAS_INBOX_TEMPLATE).toBe('string')
    expect(IDEAS_INBOX_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains inbox and promoted sections', () => {
    expect(IDEAS_INBOX_TEMPLATE).toContain('inbox')
    expect(IDEAS_INBOX_TEMPLATE).toContain('promoted')
  })
})

describe('BASELINE_INDEX_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof BASELINE_INDEX_TEMPLATE).toBe('string')
    expect(BASELINE_INDEX_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains project name placeholder and links to 5 sub-files', () => {
    expect(BASELINE_INDEX_TEMPLATE).toContain('{{PROJECT_NAME}}')
    expect(BASELINE_INDEX_TEMPLATE).toContain('module-map.md')
    expect(BASELINE_INDEX_TEMPLATE).toContain('runtime-flows.md')
    expect(BASELINE_INDEX_TEMPLATE).toContain('state-storage.md')
    expect(BASELINE_INDEX_TEMPLATE).toContain('test-gates.md')
    expect(BASELINE_INDEX_TEMPLATE).toContain('risk-hotspots.md')
  })
})

describe('BASELINE_MODULE_MAP_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof BASELINE_MODULE_MAP_TEMPLATE).toBe('string')
    expect(BASELINE_MODULE_MAP_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains Chinese and English section headings for code modules', () => {
    expect(BASELINE_MODULE_MAP_TEMPLATE).toContain('src/server/')
    expect(BASELINE_MODULE_MAP_TEMPLATE).toContain('web/src/')
    expect(BASELINE_MODULE_MAP_TEMPLATE).toContain('src/cli/')
  })
})

describe('BASELINE_RUNTIME_FLOWS_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof BASELINE_RUNTIME_FLOWS_TEMPLATE).toBe('string')
    expect(BASELINE_RUNTIME_FLOWS_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains numbered flow sections', () => {
    expect(BASELINE_RUNTIME_FLOWS_TEMPLATE).toContain('Flow 1')
    expect(BASELINE_RUNTIME_FLOWS_TEMPLATE).toContain('Flow 2')
    expect(BASELINE_RUNTIME_FLOWS_TEMPLATE).toContain('Flow 3')
  })
})

describe('BASELINE_PLACEHOLDER_TEMPLATE', () => {
  test('is non-empty string', () => {
    expect(typeof BASELINE_PLACEHOLDER_TEMPLATE).toBe('string')
    expect(BASELINE_PLACEHOLDER_TEMPLATE.length).toBeGreaterThan(0)
  })

  test('contains title placeholder', () => {
    expect(BASELINE_PLACEHOLDER_TEMPLATE).toContain('{{TITLE}}')
  })
})
