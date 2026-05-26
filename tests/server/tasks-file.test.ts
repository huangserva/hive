import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createTasksFileService } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('tasks file service', () => {
  test('creates .hive/tasks.md on first read and persists writes there', () => {
    const workspacePath = join(tmpdir(), `hive-tasks-${Date.now()}`)
    mkdirSync(workspacePath, { recursive: true })
    tempDirs.push(workspacePath)
    const tasksPath = join(workspacePath, '.hive', 'tasks.md')

    const service = createTasksFileService()

    const initial = service.readTasks(workspacePath)
    expect(initial).toContain('## In progress')
    expect(initial).toContain('## Done')
    expect(existsSync(tasksPath)).toBe(true)
    expect(existsSync(join(workspacePath, 'tasks.md'))).toBe(false)

    service.writeTasks(workspacePath, '- [ ] implement login\n')

    expect(service.readTasks(workspacePath)).toBe('- [ ] implement login\n')
    expect(readFileSync(tasksPath, 'utf8')).toBe('- [ ] implement login\n')
  })

  test('copies legacy root tasks.md into .hive/tasks.md without rewriting the root file', () => {
    const workspacePath = join(tmpdir(), `hive-tasks-legacy-${Date.now()}`)
    mkdirSync(workspacePath, { recursive: true })
    tempDirs.push(workspacePath)
    const legacyPath = join(workspacePath, 'tasks.md')
    const hiveTasksPath = join(workspacePath, '.hive', 'tasks.md')
    writeFileSync(legacyPath, '## In progress\n\n- [ ] legacy task\n', 'utf8')

    const service = createTasksFileService()

    const content = service.readTasks(workspacePath)
    expect(content).toContain('- [ ] legacy task')
    expect(content).toContain('## In progress')
    expect(readFileSync(hiveTasksPath, 'utf8')).toContain('- [ ] legacy task')

    service.writeTasks(workspacePath, '- [x] new hive task\n')

    expect(readFileSync(hiveTasksPath, 'utf8')).toBe('- [x] new hive task\n')
    expect(readFileSync(legacyPath, 'utf8')).toBe('## In progress\n\n- [ ] legacy task\n')
  })
})
