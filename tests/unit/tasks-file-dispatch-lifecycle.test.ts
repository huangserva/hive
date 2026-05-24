import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createTasksFileService, HIVE_DIR_NAME } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspace = (tasksContent?: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-dispatch-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, HIVE_DIR_NAME), { recursive: true })
  if (tasksContent !== undefined) {
    writeFileSync(join(dir, HIVE_DIR_NAME, 'tasks.md'), tasksContent, 'utf8')
  }
  return dir
}

const readTasks = (dir: string) => {
  const path = join(dir, HIVE_DIR_NAME, 'tasks.md')
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

const logger = { warn: vi.fn() }

describe('recordDispatchSent', () => {
  test('appends dispatch line to empty ## In progress section', () => {
    const dir = setupWorkspace('## In progress\n\n## Open\n\n## Done\n')
    const svc = createTasksFileService({ logger })
    svc.recordDispatchSent(dir, {
      dispatchId: '12345678-aaaa-bbbb-cccc-dddddddddddd',
      taskFirstLine: 'Implement auth middleware',
      workerName: '关羽',
    })
    const content = readTasks(dir)
    expect(content).toContain('**关羽** dispatch `12345678` — Implement auth middleware')
    expect(content).toContain('- [ ] **关羽**')
  })

  test('appends to existing In progress section with content', () => {
    const dir = setupWorkspace('## In progress\n\n- [x] Old task\n\n## Open\n')
    const svc = createTasksFileService({ logger })
    svc.recordDispatchSent(dir, {
      dispatchId: 'aabbccdd-1111',
      taskFirstLine: 'New task',
      workerName: '赵云',
    })
    const content = readTasks(dir)
    const lines = content?.split('\n').filter((l) => l.includes('dispatch'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('**赵云** dispatch `aabbccdd` — New task')
  })

  test('no-op when no ## In progress section exists', () => {
    const original = '## Open\n\n- [ ] Task\n'
    const dir = setupWorkspace(original)
    const svc = createTasksFileService({ logger })
    svc.recordDispatchSent(dir, {
      dispatchId: '12345678',
      taskFirstLine: 'No section',
      workerName: '测试',
    })
    expect(readTasks(dir)).toBe(original)
    expect(logger.warn).toHaveBeenCalled()
  })

  test('no-op when tasks.md does not exist', () => {
    const dir = setupWorkspace()
    rmSync(join(dir, HIVE_DIR_NAME, 'tasks.md'), { force: true })
    const svc = createTasksFileService({ logger })
    svc.recordDispatchSent(dir, {
      dispatchId: '12345678',
      taskFirstLine: 'Missing file',
      workerName: '测试',
    })
    expect(readTasks(dir)).toBeNull()
  })

  test('truncates taskFirstLine over 120 characters', () => {
    const longTask = 'A'.repeat(150)
    const dir = setupWorkspace('## In progress\n\n## Done\n')
    const svc = createTasksFileService({ logger })
    svc.recordDispatchSent(dir, {
      dispatchId: '12345678',
      taskFirstLine: longTask,
      workerName: '关羽',
    })
    const content = readTasks(dir)
    const dispatchLine = content?.split('\n').find((l) => l.includes('dispatch'))
    const afterDash = dispatchLine?.split(' — ')[1]
    expect(afterDash?.length).toBeLessThanOrEqual(120)
    expect(afterDash).toContain('…')
  })

  test('deduplicates same dispatch id — second call is no-op', () => {
    const dir = setupWorkspace('## In progress\n\n## Done\n')
    const svc = createTasksFileService({ logger })
    const input = {
      dispatchId: '12345678',
      taskFirstLine: 'Task A',
      workerName: '关羽',
    }
    svc.recordDispatchSent(dir, input)
    svc.recordDispatchSent(dir, input)
    const content = readTasks(dir)
    const dispatchLines = content?.split('\n').filter((l) => l.includes('dispatch'))
    expect(dispatchLines).toHaveLength(1)
  })
})

describe('recordDispatchDone', () => {
  test('marks matching dispatch line as done with [x]', () => {
    const dir = setupWorkspace(
      '## In progress\n\n- [ ] **关羽** dispatch `12345678` — Task desc\n\n## Done\n'
    )
    const svc = createTasksFileService({ logger })
    svc.recordDispatchDone(dir, { dispatchId: '12345678' })
    const content = readTasks(dir)
    expect(content).toContain('- [x] **关羽** dispatch `12345678` — Task desc')
    expect(content).not.toContain('- [ ] **关羽** dispatch `12345678`')
  })

  test('uses short id (first 8 chars) for matching', () => {
    const dir = setupWorkspace(
      '## In progress\n\n- [ ] **赵云** dispatch `aabbccdd` — Task\n\n## Done\n'
    )
    const svc = createTasksFileService({ logger })
    svc.recordDispatchDone(dir, { dispatchId: 'aabbccdd-1111-2222-3333-444444444444' })
    const content = readTasks(dir)
    expect(content).toContain('- [x] **赵云** dispatch `aabbccdd`')
  })

  test('no-op when dispatch id not found', () => {
    const original = '## In progress\n\n- [ ] **关羽** dispatch `12345678` — Task\n\n## Done\n'
    const dir = setupWorkspace(original)
    const svc = createTasksFileService({ logger })
    logger.warn.mockClear()
    svc.recordDispatchDone(dir, { dispatchId: 'ffffffff' })
    expect(readTasks(dir)).toBe(original)
    expect(logger.warn).toHaveBeenCalled()
  })

  test('idempotent when already marked [x]', () => {
    const dir = setupWorkspace(
      '## In progress\n\n- [x] **关羽** dispatch `12345678` — Task\n\n## Done\n'
    )
    const svc = createTasksFileService({ logger })
    svc.recordDispatchDone(dir, { dispatchId: '12345678' })
    const content = readTasks(dir)
    expect(content).toContain('- [x] **关羽** dispatch `12345678` — Task')
  })
})

describe('recordDispatchCancelled', () => {
  test('marks line as cancelled with [~] and reason', () => {
    const dir = setupWorkspace(
      '## In progress\n\n- [ ] **关羽** dispatch `12345678` — Task desc\n\n## Done\n'
    )
    const svc = createTasksFileService({ logger })
    svc.recordDispatchCancelled(dir, { dispatchId: '12345678', reason: 'duplicate' })
    const content = readTasks(dir)
    expect(content).toContain('- [~] **关羽** dispatch `12345678` — Task desc ⊘ duplicate')
  })

  test('truncates reason over 80 characters', () => {
    const longReason = 'R'.repeat(100)
    const dir = setupWorkspace(
      '## In progress\n\n- [ ] **关羽** dispatch `12345678` — Task\n\n## Done\n'
    )
    const svc = createTasksFileService({ logger })
    svc.recordDispatchCancelled(dir, { dispatchId: '12345678', reason: longReason })
    const content = readTasks(dir)
    const cancelledLine = content?.split('\n').find((l) => l.includes('⊘'))
    const reasonPart = cancelledLine?.split('⊘ ')[1]
    expect(reasonPart?.length).toBeLessThanOrEqual(80)
  })

  test('no-op when dispatch id not found', () => {
    const original = '## In progress\n\n- [ ] **关羽** dispatch `12345678` — Task\n\n## Done\n'
    const dir = setupWorkspace(original)
    const svc = createTasksFileService({ logger })
    logger.warn.mockClear()
    svc.recordDispatchCancelled(dir, { dispatchId: 'ffffffff', reason: 'not found' })
    expect(readTasks(dir)).toBe(original)
    expect(logger.warn).toHaveBeenCalled()
  })
})
