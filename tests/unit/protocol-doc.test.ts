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
})
