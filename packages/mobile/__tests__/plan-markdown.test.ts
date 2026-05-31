import { describe, expect, test } from 'vitest'

import { extractPlanMilestoneDetails, parsePlanMarkdownBlocks } from '../src/cockpit/plan-markdown'

describe('plan markdown parser', () => {
  test('marks bold text without keeping markdown delimiters', () => {
    expect(parsePlanMarkdownBlocks('Ship **mobile cockpit** next')).toEqual([
      {
        kind: 'paragraph',
        segments: [
          { kind: 'text', text: 'Ship ' },
          { kind: 'bold', text: 'mobile cockpit' },
          { kind: 'text', text: ' next' },
        ],
      },
    ])
  })

  test('marks inline code as code segments', () => {
    expect(parsePlanMarkdownBlocks('Run `pnpm test` before build')).toEqual([
      {
        kind: 'paragraph',
        segments: [
          { kind: 'text', text: 'Run ' },
          { kind: 'code', text: 'pnpm test' },
          { kind: 'text', text: ' before build' },
        ],
      },
    ])
  })

  test('keeps mixed inline styles in source order', () => {
    expect(parsePlanMarkdownBlocks('Fix **PlanView** and `detailsBody`')).toEqual([
      {
        kind: 'paragraph',
        segments: [
          { kind: 'text', text: 'Fix ' },
          { kind: 'bold', text: 'PlanView' },
          { kind: 'text', text: ' and ' },
          { kind: 'code', text: 'detailsBody' },
        ],
      },
    ])
  })

  test('keeps pure text unchanged except wiki-link brackets', () => {
    expect(parsePlanMarkdownBlocks('See [[mobile-vs-web UI audit]]')).toEqual([
      {
        kind: 'paragraph',
        segments: [{ kind: 'text', text: 'See mobile-vs-web UI audit' }],
      },
    ])
  })

  test('parses quote and list line prefixes as block styles', () => {
    expect(parsePlanMarkdownBlocks('> Decision\n- first item')).toEqual([
      { kind: 'quote', segments: [{ kind: 'text', text: 'Decision' }] },
      { kind: 'listItem', segments: [{ kind: 'text', text: 'first item' }] },
    ])
  })

  test('keeps expanded milestone details as markdown lines while collapsing subtitle text', () => {
    const details = extractPlanMilestoneDetails(`# M28\n> Decision\n- first item\n- second item`)

    expect(details.subtitle).toBe('> Decision - first item')
    expect(parsePlanMarkdownBlocks(details.markdown)).toEqual([
      { kind: 'quote', segments: [{ kind: 'text', text: 'Decision' }] },
      { kind: 'listItem', segments: [{ kind: 'text', text: 'first item' }] },
      { kind: 'listItem', segments: [{ kind: 'text', text: 'second item' }] },
    ])
  })
})
