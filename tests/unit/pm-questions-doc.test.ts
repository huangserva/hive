import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  answerQuestionInFile,
  appendQuestionInFile,
  parseQuestionsDoc,
} from '../../src/server/pm-questions-doc.js'

const FULL_QUESTIONS = `# Open Questions

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- [ ] **Q1** 数据库 schema 变更影响线上数据
- [x] **Q2** 是否引入新的 ORM

### 🟠 medium — 影响下一步规划

- [ ] **Q3** API 版本策略选择
- [ ] **Q4** 第三方服务选型

### 🟢 low — 灰度区

- [ ] **Q5** 代码风格偏好

## 已答（archive 留追溯）

- [x] **Q6** 已决定使用 SQLite
- [x] **Q8** 是否继续用 SQLite → **answered 2026-05-24**：继续用，保持轻量
- [x] **Q7** 采用 monorepo 结构
`

describe('parseQuestionsDoc', () => {
  test('parses all priority buckets with correct counts', () => {
    const result = parseQuestionsDoc(FULL_QUESTIONS)
    expect(result.high).toHaveLength(2)
    expect(result.medium).toHaveLength(2)
    expect(result.low).toHaveLength(1)
    expect(result.answered).toHaveLength(3)
    expect(result.parseError).toBeNull()
  })

  test('parses question id and text', () => {
    const result = parseQuestionsDoc(FULL_QUESTIONS)
    expect(result.high[0]).toEqual({
      id: 'Q1',
      priority: 'high',
      raw: expect.stringContaining('Q1'),
      text: '数据库 schema 变更影响线上数据',
    })
    expect(result.medium[0]?.id).toBe('Q3')
    expect(result.answered[0]?.id).toBe('Q6')
  })

  test('empty content returns empty arrays', () => {
    const result = parseQuestionsDoc('')
    expect(result.high).toEqual([])
    expect(result.medium).toEqual([])
    expect(result.low).toEqual([])
    expect(result.answered).toEqual([])
    expect(result.raw).toBe('')
    expect(result.parseError).toBeNull()
  })

  test('missing sections default to empty', () => {
    const result = parseQuestionsDoc('# No questions here\n\nJust text.')
    expect(result.high).toEqual([])
    expect(result.answered).toEqual([])
  })

  test('raw preserves original content', () => {
    const result = parseQuestionsDoc(FULL_QUESTIONS)
    expect(result.raw).toBe(FULL_QUESTIONS)
  })

  test('answered items get low priority', () => {
    const result = parseQuestionsDoc(FULL_QUESTIONS)
    expect(result.answered[0]?.priority).toBe('low')
  })

  test('answered items expose answer text when present', () => {
    const result = parseQuestionsDoc(FULL_QUESTIONS)
    expect(result.answered[1]).toMatchObject({
      answer: '继续用，保持轻量',
      answered: true,
      id: 'Q8',
      text: '是否继续用 SQLite',
    })
  })

  test('parses non-numeric question IDs without accepting malformed IDs', () => {
    const result = parseQuestionsDoc(`# Open Questions

## 待 user 拍板（按优先级）

### 🟠 medium — 影响下一步规划

- [ ] **Q9** numeric question
- [ ] **Q-E2E** browser smoke question
- [ ] **Q-foo_2** hyphen and underscore question
- [ ] **R1** wrong prefix should be ignored
- [ ] **Q bad** whitespace in id should be ignored
`)

    expect(result.medium.map((question) => question.id)).toEqual(['Q9', 'Q-E2E', 'Q-foo_2'])
    expect(result.medium.map((question) => question.text)).toEqual([
      'numeric question',
      'browser smoke question',
      'hyphen and underscore question',
    ])
    expect(result.parseError).toBeNull()
  })

  test('answers non-numeric question IDs by moving them to answered', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-questions-'))
    const hiveDir = join(workspacePath, '.hive')
    mkdirSync(hiveDir)
    const questionsPath = join(hiveDir, 'open-questions.md')
    writeFileSync(
      questionsPath,
      `# Open Questions

## 待 user 拍板（按优先级）

### 🟠 medium — 影响下一步规划

- [ ] **Q-E2E** Validate browser answer flow

## 已答（archive 留追溯）

（暂无）
`,
      'utf8'
    )

    answerQuestionInFile(workspacePath, 'Q-E2E', 'Browser smoke OK')

    const updated = readFileSync(questionsPath, 'utf8')
    expect(updated).not.toContain('- [ ] **Q-E2E**')
    expect(updated).toContain('- [x] **Q-E2E** Validate browser answer flow → **answered ')
    expect(updated).toContain('**：Browser smoke OK')
    const parsed = parseQuestionsDoc(updated)
    expect(parsed.medium).toEqual([])
    expect(parsed.answered.find((question) => question.id === 'Q-E2E')).toMatchObject({
      answer: 'Browser smoke OK',
      text: 'Validate browser answer flow',
    })
  })

  test('next generated question id ignores non-numeric IDs', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-questions-'))
    const hiveDir = join(workspacePath, '.hive')
    mkdirSync(hiveDir)
    const questionsPath = join(hiveDir, 'open-questions.md')
    writeFileSync(
      questionsPath,
      `# Open Questions

## 待 user 拍板（按优先级）

### 🟠 medium — 影响下一步规划

- [ ] **Q7** Last numeric question
- [ ] **Q-E2E** Browser smoke question

## 已答（archive 留追溯）
`,
      'utf8'
    )

    const result = appendQuestionInFile(workspacePath, 'New generated question')

    expect(result.questionId).toBe('Q8')
    expect(readFileSync(questionsPath, 'utf8')).toContain('- [ ] **Q8** New generated question')
  })
})
