import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseIdeasDoc, promoteIdeaInFile } from '../../src/server/pm-ideas-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const FULL_IDEAS = `# Ideas Inbox

## inbox（按加入时间倒序）

### 2026-05-20

- 🤔 idea: 用 LLM 做自动 code review
- ~~已验证的方案~~

### 2026-05-18

- idea: 引入 GraphQL 替代 REST

## promoted

### 2026-05-15

- 🤔 idea: ~~迁移到 monorepo~~
`

describe('parseIdeasDoc', () => {
  test('parses inbox and promoted sections', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox).toHaveLength(3)
    expect(result.promoted).toHaveLength(1)
    expect(result.parseError).toBeNull()
  })

  test('extracts text without idea marker', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox[0]?.text).toBe('用 LLM 做自动 code review')
  })

  test('extracts addedAt date from heading', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox[0]?.addedAt).toBe('2026-05-20')
    expect(result.inbox[2]?.addedAt).toBe('2026-05-18')
  })

  test('strips strikethrough from text', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox[1]?.text).toBe('已验证的方案')
    expect(result.inbox[1]?.promoted).toBe(true)
  })

  test('promoted items have promoted=true', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.promoted[0]?.promoted).toBe(true)
  })

  test('empty content returns empty arrays', () => {
    const result = parseIdeasDoc('')
    expect(result.inbox).toEqual([])
    expect(result.promoted).toEqual([])
    expect(result.raw).toBe('')
    expect(result.parseError).toBeNull()
  })

  test('raw preserves original content', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.raw).toBe(FULL_IDEAS)
  })

  test('stable id generation does not depend on inbox position', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    const withoutFirst = parseIdeasDoc(
      FULL_IDEAS.replace('- 🤔 idea: 用 LLM 做自动 code review\n', '')
    )
    expect(result.inbox[1]?.id).toBe(withoutFirst.inbox[0]?.id)
    expect(result.inbox[2]?.id).toBe(withoutFirst.inbox[1]?.id)
  })

  test('ignores indented child bullets inside an idea', () => {
    const result = parseIdeasDoc(`# Ideas Inbox

## inbox

### 2026-05-24

- 🤔 idea: provider catalog
  - 详细能力声明
  - 价值：减少 preset 分支
- idea: voice control

## promoted
`)

    expect(result.inbox).toHaveLength(2)
    expect(result.inbox.map((idea) => idea.text)).toEqual(['provider catalog', 'voice control'])
  })

  test('promotes the originally selected ideas when multiple promotes shift inbox positions', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-ideas-stable-id-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive', 'ideas'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'ideas', 'inbox.md'),
      `# Ideas Inbox

## inbox

- idea: first idea
- idea: second idea
- idea: third idea

## promoted
`,
      'utf8'
    )

    const initial = parseIdeasDoc(
      readFileSync(join(workspacePath, '.hive', 'ideas', 'inbox.md'), 'utf8')
    )
    const firstId = initial.inbox[0]?.id
    const secondId = initial.inbox[1]?.id
    if (!firstId || !secondId) throw new Error('Expected first and second idea ids')

    promoteIdeaInFile(workspacePath, firstId, 'adr')
    promoteIdeaInFile(workspacePath, secondId, 'adr')

    const content = readFileSync(join(workspacePath, '.hive', 'ideas', 'inbox.md'), 'utf8')
    expect(content).toContain('- ~~first idea~~ → promoted to adr')
    expect(content).toContain('- ~~second idea~~ → promoted to adr')
    expect(content).toContain('- idea: third idea')
    expect(content).not.toContain('- ~~third idea~~ → promoted to adr')
  })
})
