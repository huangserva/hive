import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database, { type Database as DatabaseInstance } from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import { createRuntimeStore } from '../../src/server/runtime-store.js'
import { initializeRuntimeDatabase } from '../../src/server/sqlite-schema.js'
import { applySchemaVersion34 } from '../../src/server/sqlite-schema-v34.js'

const tempDirs: string[] = []
const stores: Array<ReturnType<typeof createRuntimeStore>> = []
const CODEX_YOLO_WITH_PLAYWRIGHT_MCP = [
  '--dangerously-bypass-approvals-and-sandbox',
  '-c',
  'mcp_servers.playwright.command="npx"',
  '-c',
  'mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]',
  '-c',
  'mcp_servers.playwright.startup_timeout_sec=30',
  '-c',
  'mcp_servers.playwright.tool_timeout_sec=60',
]

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 })
  }
})

const expectDispatchSchema = (db: DatabaseInstance) => {
  const dispatchTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dispatches'")
    .get() as { name: string } | undefined
  const dispatchIndexes = new Set(
    (db.prepare('PRAGMA index_list(dispatches)').all() as Array<{ name: string }>).map(
      (index) => index.name
    )
  )

  expect(dispatchTable).toEqual({ name: 'dispatches' })
  expect(dispatchIndexes.has('idx_dispatches_workspace_created_at')).toBe(true)
  expect(dispatchIndexes.has('idx_dispatches_open_by_worker')).toBe(true)
}

const indexColumns = (db: DatabaseInstance, indexName: string) =>
  (db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string }>).map(
    (column) => column.name
  )

const dispatchColumns = (db: DatabaseInstance) =>
  new Set(
    (db.prepare('PRAGMA table_info(dispatches)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )

const tableColumns = (db: DatabaseInstance, tableName: string) =>
  new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )

const tableExists = (db: DatabaseInstance, tableName: string) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as
    | { name: string }
    | undefined

describe('schema version', () => {
  test('runtime sqlite initializes a schema_version table', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-version-'))
    tempDirs.push(dataDir)

    stores.push(createRuntimeStore({ dataDir }))

    const db = new Database(join(dataDir, 'runtime.sqlite'), { readonly: true })
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
      .get() as { name: string } | undefined

    expect(row).toEqual({ name: 'schema_version' })
    db.close()
  })

  test('latest schema includes last_session_id, pid, ended_at and drops messages.kind', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-columns-'))
    tempDirs.push(dataDir)

    stores.push(createRuntimeStore({ dataDir }))

    const db = new Database(join(dataDir, 'runtime.sqlite'), { readonly: true })
    const workerColumns = new Set(
      (db.prepare('PRAGMA table_info(workers)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const agentRunColumns = new Set(
      (db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const launchConfigColumns = new Set(
      (db.prepare('PRAGMA table_info(agent_launch_configs)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const commandPresetColumns = new Set(
      (db.prepare('PRAGMA table_info(command_presets)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const roleTemplateColumns = new Set(
      (db.prepare('PRAGMA table_info(role_templates)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const appStateColumns = new Set(
      (db.prepare('PRAGMA table_info(app_state)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const messageColumns = new Set(
      (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const dispatchColumns = new Set(
      (db.prepare('PRAGMA table_info(dispatches)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const mobileDeviceColumns = new Set(
      (db.prepare('PRAGMA table_info(mobile_devices)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const mobilePairingCodesTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mobile_pairing_codes'"
      )
      .get() as { name: string } | undefined

    expect(workerColumns.has('last_session_id')).toBe(true)
    expect(workerColumns.has('workflow_allowed')).toBe(true)
    expect(agentRunColumns.has('pid')).toBe(true)
    expect(agentRunColumns.has('ended_at')).toBe(true)
    expect(agentRunColumns.has('error_tail')).toBe(true)
    expect(launchConfigColumns.has('command_preset_id')).toBe(true)
    expect(launchConfigColumns.has('interactive_command')).toBe(true)
    expect(launchConfigColumns.has('preset_augmentation_disabled')).toBe(true)
    expect(launchConfigColumns.has('resume_args_template')).toBe(true)
    expect(launchConfigColumns.has('session_id_capture_json')).toBe(true)
    expect(launchConfigColumns.has('thinking_level')).toBe(true)
    expect(launchConfigColumns.has('env_json')).toBe(true)
    expect(launchConfigColumns.has('workflow_allowed')).toBe(true)
    expect(commandPresetColumns).toEqual(
      new Set([
        'id',
        'display_name',
        'command',
        'args',
        'env',
        'resume_args_template',
        'session_id_capture',
        'yolo_args_template',
        'is_builtin',
        'created_at',
        'updated_at',
      ])
    )
    expect(roleTemplateColumns).toEqual(
      new Set([
        'id',
        'name',
        'role_type',
        'description',
        'default_command',
        'default_args',
        'default_env',
        'is_builtin',
        'created_at',
        'updated_at',
      ])
    )
    expect(appStateColumns).toEqual(new Set(['key', 'value', 'updated_at']))
    expect(messageColumns.has('kind')).toBe(false)
    expect(dispatchColumns).toEqual(
      new Set([
        'sequence',
        'id',
        'workspace_id',
        'from_agent_id',
        'to_agent_id',
        'text',
        'status',
        'created_at',
        'delivered_at',
        'submitted_at',
        'reported_at',
        'report_text',
        'artifacts',
        // M43 schema v33: 三个旁挂字段，默认 NULL；不破 8 态 status 维度。
        'review_status',
        'reviews_dispatch_id',
        'accept_verdict',
      ])
    )
    expect(mobileDeviceColumns).toEqual(
      new Set([
        'id',
        'token',
        'name',
        'created_at',
        'last_seen_at',
        'capabilities',
        'revoked_at',
        'device_type',
        'push_token',
        'source',
      ])
    )
    expect(mobilePairingCodesTable).toBeUndefined()
    expectDispatchSchema(db)

    const presetCount = db
      .prepare('SELECT COUNT(*) AS count FROM command_presets WHERE is_builtin = 1')
      .get() as { count: number }
    const roleTemplateCount = db
      .prepare('SELECT COUNT(*) AS count FROM role_templates WHERE is_builtin = 1')
      .get() as { count: number }
    const appState = db
      .prepare('SELECT key, value FROM app_state WHERE key = ?')
      .get('active_workspace_id') as { key: string; value: string | null } | undefined
    const latestVersion = db
      .prepare('SELECT version FROM schema_version WHERE version = ?')
      .get(34) as { version: number } | undefined

    expect(presetCount.count).toBe(4)
    expect(roleTemplateCount.count).toBe(12)
    expect(appState).toEqual({ key: 'active_workspace_id', value: null })
    expect(latestVersion).toEqual({ version: 34 })

    db.close()
  })

  test('latest schema seeds eleven HippoTeam worker role templates', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-hippoteam-role-templates-'))
    tempDirs.push(dataDir)

    stores.push(createRuntimeStore({ dataDir }))

    const db = new Database(join(dataDir, 'runtime.sqlite'), { readonly: true })
    const rows = db
      .prepare(
        `SELECT id, name, role_type, description, default_command, default_args, default_env
         FROM role_templates
         WHERE is_builtin = 1 AND role_type != 'orchestrator'
         ORDER BY id`
      )
      .all() as Array<{
      default_args: string
      default_command: string
      default_env: string
      description: string
      id: string
      name: string
      role_type: string
    }>

    expect(rows).toHaveLength(11)
    expect(rows.map((row) => row.name).sort()).toEqual(
      [
        'Claude Workflow 运行器',
        'DevOps 工程师',
        '代码审查员',
        '全栈工程师',
        '前端专家',
        '后端专家',
        '哨兵',
        '技术文档员',
        '测试工程师',
        '调研员',
        '通用助手',
      ].sort()
    )
    for (const row of rows) {
      expect(row.default_command).toBe('claude')
      expect(JSON.parse(row.default_args)).toEqual([])
      expect(row.description).toContain('team report')
      if (row.id === 'claude-workflow') {
        expect(JSON.parse(row.default_env)).toMatchObject({
          ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.5-air',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.2',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2',
        })
        expect(row.description).toContain('被期望使用内置 subagent')
        expect(row.description).not.toContain('不要启动内置 subagent')
      } else {
        expect(JSON.parse(row.default_env)).toEqual({})
        expect(row.description).toContain('不要启动内置 subagent')
      }
    }
    expect(rows.find((row) => row.name === '调研员')?.description).toContain('.hive/reports/')
    expect(rows.find((row) => row.name === '调研员')?.description).toContain('.hive/research/')
    expect(rows.find((row) => row.name === '哨兵')?.role_type).toBe('sentinel')

    db.close()
  })

  test('migration updates builtin Claude yolo args for existing databases', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-claude-yolo-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8);

      CREATE TABLE command_presets (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL,
        env TEXT NOT NULL,
        resume_args_template TEXT,
        session_id_capture TEXT,
        yolo_args_template TEXT,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    db.prepare(
      `INSERT INTO command_presets (
        id,
        display_name,
        command,
        args,
        env,
        resume_args_template,
        session_id_capture,
        yolo_args_template,
        is_builtin,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'claude',
      'Claude Code (CC)',
      'claude',
      '[]',
      '{}',
      '[]',
      null,
      JSON.stringify(['--dangerously-skip-permissions']),
      1,
      1,
      1
    )

    initializeRuntimeDatabase(db)

    const preset = db
      .prepare('SELECT yolo_args_template FROM command_presets WHERE id = ?')
      .get('claude') as { yolo_args_template: string } | undefined
    const version = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(9) as
      | { version: number }
      | undefined

    expect(JSON.parse(preset?.yolo_args_template ?? '[]')).toEqual([
      '--dangerously-skip-permissions',
      '--permission-mode=bypassPermissions',
      '--disallowedTools=Task',
    ])
    expect(version).toEqual({ version: 9 })

    db.close()
  })

  test('migration updates builtin resume support for all supported agent presets', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-agent-resume-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9);

      CREATE TABLE command_presets (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL,
        env TEXT NOT NULL,
        resume_args_template TEXT,
        session_id_capture TEXT,
        yolo_args_template TEXT,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const insert = db.prepare(
      `INSERT INTO command_presets (
        id,
        display_name,
        command,
        args,
        env,
        resume_args_template,
        session_id_capture,
        yolo_args_template,
        is_builtin,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [id, displayName, command] of [
      ['claude', 'Claude Code (CC)', 'claude'],
      ['codex', 'Codex', 'codex'],
      ['opencode', 'OpenCode', 'opencode'],
      ['gemini', 'Gemini', 'gemini'],
    ] as const) {
      insert.run(id, displayName, command, '[]', '{}', null, null, null, 1, 1, 1)
    }

    initializeRuntimeDatabase(db)

    const rows = db
      .prepare(
        'SELECT id, resume_args_template, session_id_capture, yolo_args_template FROM command_presets ORDER BY id'
      )
      .all() as Array<{
      id: string
      resume_args_template: string | null
      session_id_capture: string | null
      yolo_args_template: string | null
    }>
    const byId = Object.fromEntries(rows.map((row) => [row.id, row])) as Record<
      string,
      (typeof rows)[number] | undefined
    >
    const expectPreset = (id: string) => {
      const row = byId[id]
      expect(row).toBeDefined()
      return row as (typeof rows)[number]
    }

    const claude = expectPreset('claude')
    const codex = expectPreset('codex')
    const gemini = expectPreset('gemini')
    const opencode = expectPreset('opencode')

    expect(claude.resume_args_template).toBe('--resume {session_id}')
    expect(JSON.parse(claude.session_id_capture ?? '{}')).toMatchObject({
      source: 'claude_project_jsonl_dir',
    })
    expect(codex.resume_args_template).toBe('resume {session_id}')
    expect(JSON.parse(codex.session_id_capture ?? '{}')).toMatchObject({
      source: 'codex_session_jsonl_dir',
    })
    expect(JSON.parse(codex.yolo_args_template ?? '[]')).toEqual(CODEX_YOLO_WITH_PLAYWRIGHT_MCP)
    expect(gemini.resume_args_template).toBe('--resume {session_id}')
    expect(JSON.parse(gemini.session_id_capture ?? '{}')).toMatchObject({
      source: 'gemini_session_json_dir',
    })
    expect(JSON.parse(gemini.yolo_args_template ?? '[]')).toEqual(['--yolo'])
    expect(opencode.resume_args_template).toBe('--session {session_id}')
    expect(JSON.parse(opencode.session_id_capture ?? '{}')).toMatchObject({
      source: 'opencode_session_db',
    })
    expect(JSON.parse(opencode.yolo_args_template ?? '[]')).toEqual([])
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(10)).toEqual({
      version: 10,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(11)).toEqual({
      version: 11,
    })

    db.close()
  })

  test('migration updates builtin yolo args for existing v10 databases', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-agent-yolo-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10);

      CREATE TABLE command_presets (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL,
        env TEXT NOT NULL,
        resume_args_template TEXT,
        session_id_capture TEXT,
        yolo_args_template TEXT,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const insert = db.prepare(
      `INSERT INTO command_presets (
        id,
        display_name,
        command,
        args,
        env,
        resume_args_template,
        session_id_capture,
        yolo_args_template,
        is_builtin,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [id, displayName, command] of [
      ['claude', 'Claude Code (CC)', 'claude'],
      ['codex', 'Codex', 'codex'],
      ['opencode', 'OpenCode', 'opencode'],
      ['gemini', 'Gemini', 'gemini'],
    ] as const) {
      insert.run(id, displayName, command, '[]', '{}', null, null, null, 1, 1, 1)
    }

    initializeRuntimeDatabase(db)

    const rows = db
      .prepare('SELECT id, yolo_args_template FROM command_presets ORDER BY id')
      .all() as Array<{ id: string; yolo_args_template: string | null }>
    const byId = Object.fromEntries(
      rows.map((row) => [row.id, JSON.parse(row.yolo_args_template ?? '[]') as string[]])
    )

    expect(byId.claude).toEqual([
      '--dangerously-skip-permissions',
      '--permission-mode=bypassPermissions',
      '--disallowedTools=Task',
    ])
    expect(byId.codex).toEqual(CODEX_YOLO_WITH_PLAYWRIGHT_MCP)
    expect(byId.gemini).toEqual(['--yolo'])
    expect(byId.opencode).toEqual([])
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(11)).toEqual({
      version: 11,
    })

    db.close()
  })

  test('migration clears builtin OpenCode yolo args for existing v16 databases', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-opencode-yolo-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15), (16, 16);

      CREATE TABLE command_presets (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL,
        env TEXT NOT NULL,
        resume_args_template TEXT,
        session_id_capture TEXT,
        yolo_args_template TEXT,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const insert = db.prepare(
      `INSERT INTO command_presets (
        id,
        display_name,
        command,
        args,
        env,
        resume_args_template,
        session_id_capture,
        yolo_args_template,
        is_builtin,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [id, displayName, command, yoloArgs] of [
      [
        'claude',
        'Claude Code (CC)',
        'claude',
        [
          '--dangerously-skip-permissions',
          '--permission-mode=bypassPermissions',
          '--disallowedTools=Task',
        ],
      ],
      ['codex', 'Codex', 'codex', ['--dangerously-bypass-approvals-and-sandbox']],
      ['opencode', 'OpenCode', 'opencode', ['--dangerously-skip-permissions']],
      ['gemini', 'Gemini', 'gemini', ['--yolo']],
    ] as const) {
      insert.run(
        id,
        displayName,
        command,
        '[]',
        '{}',
        null,
        null,
        JSON.stringify(yoloArgs),
        1,
        1,
        1
      )
    }
    insert.run(
      'custom-opencode',
      'Custom OpenCode',
      'opencode',
      '[]',
      '{}',
      null,
      null,
      JSON.stringify(['--dangerously-skip-permissions']),
      0,
      1,
      1
    )

    initializeRuntimeDatabase(db)

    const rows = db
      .prepare('SELECT id, yolo_args_template FROM command_presets ORDER BY id')
      .all() as Array<{ id: string; yolo_args_template: string | null }>
    const byId = Object.fromEntries(
      rows.map((row) => [row.id, JSON.parse(row.yolo_args_template ?? '[]') as string[]])
    )

    expect(byId.claude).toEqual([
      '--dangerously-skip-permissions',
      '--permission-mode=bypassPermissions',
      '--disallowedTools=Task',
    ])
    expect(byId.codex).toEqual(CODEX_YOLO_WITH_PLAYWRIGHT_MCP)
    expect(byId.gemini).toEqual(['--yolo'])
    expect(byId.opencode).toEqual([])
    expect(byId['custom-opencode']).toEqual(['--dangerously-skip-permissions'])
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(18)).toEqual({
      version: 18,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(19)).toEqual({
      version: 19,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(20)).toEqual({
      version: 20,
    })

    db.close()
  })

  test('migration updates builtin role template descriptions for existing databases', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-role-template-descriptions-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11);

      CREATE TABLE role_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role_type TEXT NOT NULL,
        description TEXT NOT NULL,
        default_command TEXT NOT NULL,
        default_args TEXT NOT NULL,
        default_env TEXT NOT NULL,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const insert = db.prepare(
      `INSERT INTO role_templates (
        id,
        name,
        role_type,
        description,
        default_command,
        default_args,
        default_env,
        is_builtin,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const [id, name, roleType, description] of [
      ['orchestrator', 'Orchestrator', 'orchestrator', 'old orch'],
      ['coder', 'Coder', 'coder', 'old coder'],
      ['reviewer', 'Reviewer', 'reviewer', 'old reviewer'],
      ['tester', 'Tester', 'tester', 'old tester'],
    ] as const) {
      insert.run(id, name, roleType, description, 'claude', '[]', '{}', 1, 1, 1)
    }

    initializeRuntimeDatabase(db)

    const rows = db
      .prepare('SELECT id, description FROM role_templates ORDER BY id')
      .all() as Array<{ description: string; id: string }>
    const byId = Object.fromEntries(rows.map((row) => [row.id, row.description]))

    expect(byId.coder).toContain('实现型 Coder')
    expect(byId.coder).toContain('交付说明要包含')
    expect(byId.reviewer).toContain('监工型 Reviewer')
    expect(byId.reviewer).toContain('blocking 问题')
    expect(byId.tester).toContain('验证型 Tester')
    expect(byId.orchestrator).toContain('组织右侧真实成员协作')
    expect(byId.orchestrator).toContain('.hive/tasks.md')
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(12)).toEqual({
      version: 12,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(13)).toEqual({
      version: 13,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(14)).toEqual({
      version: 14,
    })
    expectDispatchSchema(db)

    db.close()
  })

  test('migration refreshes v12 builtin role prompts to .hive tasks path', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v13-role-template-descriptions-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11), (12, 12);

      CREATE TABLE role_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role_type TEXT NOT NULL,
        description TEXT NOT NULL,
        default_command TEXT NOT NULL,
        default_args TEXT NOT NULL,
        default_env TEXT NOT NULL,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO role_templates (
        id,
        name,
        role_type,
        description,
        default_command,
        default_args,
        default_env,
        is_builtin,
        created_at,
        updated_at
      )
      VALUES (
        'orchestrator',
        'Orchestrator',
        'orchestrator',
        '你是 Hive 的 Orchestrator。维护 tasks.md。',
        'claude',
        '[]',
        '{}',
        1,
        1,
        1
      );
    `)

    initializeRuntimeDatabase(db)

    const row = db
      .prepare('SELECT description FROM role_templates WHERE id = ?')
      .get('orchestrator') as { description: string }
    expect(row.description).toContain('.hive/tasks.md')
    expect(row.description).not.toContain('维护 tasks.md')
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(13)).toEqual({
      version: 13,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(14)).toEqual({
      version: 14,
    })
    expectDispatchSchema(db)

    db.close()
  })

  test('migration backfills dispatch ledger from legacy send and report messages', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v14-dispatch-backfill-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11), (12, 12), (13, 13);

      CREATE TABLE messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        type TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT,
        text TEXT,
        status TEXT,
        artifacts TEXT,
        created_at INTEGER NOT NULL
      );
    `)
    const insert = db.prepare(
      `INSERT INTO messages (
         workspace_id,
         worker_id,
         type,
         from_agent_id,
         to_agent_id,
         text,
         status,
         artifacts,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    insert.run('ws-1', 'worker-1', 'send', 'orch-1', 'worker-1', 'task 1', null, null, 100)
    insert.run('ws-1', 'worker-1', 'send', 'orch-1', 'worker-1', 'task 2', null, null, 200)
    insert.run(
      'ws-1',
      'worker-1',
      'report',
      'worker-1',
      'orch-1',
      'done 1',
      null,
      JSON.stringify(['src/a.ts']),
      300
    )

    initializeRuntimeDatabase(db)

    const dispatches = db
      .prepare(
        'SELECT workspace_id, to_agent_id, text, status, reported_at, report_text, artifacts FROM dispatches ORDER BY sequence'
      )
      .all() as Array<{
      artifacts: string
      reported_at: number | null
      report_text: string | null
      status: string
      text: string
      to_agent_id: string
      workspace_id: string
    }>

    expect(dispatches).toEqual([
      {
        artifacts: JSON.stringify(['src/a.ts']),
        reported_at: 300,
        report_text: 'done 1',
        status: 'reported',
        text: 'task 1',
        to_agent_id: 'worker-1',
        workspace_id: 'ws-1',
      },
      {
        artifacts: '[]',
        reported_at: null,
        report_text: null,
        status: 'queued',
        text: 'task 2',
        to_agent_id: 'worker-1',
        workspace_id: 'ws-1',
      },
    ])
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(14)).toEqual({
      version: 14,
    })
    expectDispatchSchema(db)

    db.close()
  })

  test('migration repairs v14 dispatch tables that were created without sequence', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v15-dispatch-sequence-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14);

      CREATE TABLE dispatches (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        submitted_at INTEGER,
        reported_at INTEGER,
        report_text TEXT,
        artifacts TEXT
      );

      CREATE INDEX idx_dispatches_workspace_created_at
        ON dispatches (workspace_id, created_at);

      CREATE INDEX idx_dispatches_open_by_worker
        ON dispatches (workspace_id, to_agent_id, status, created_at);
    `)
    db.prepare(
      `INSERT INTO dispatches (
         id,
         workspace_id,
         from_agent_id,
         to_agent_id,
         text,
         status,
         created_at,
         delivered_at,
         submitted_at,
         reported_at,
         report_text,
         artifacts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'dispatch-2',
      'ws-1',
      'orch-1',
      'worker-1',
      'second',
      'submitted',
      200,
      210,
      220,
      null,
      null,
      '[]'
    )
    db.prepare(
      `INSERT INTO dispatches (
         id,
         workspace_id,
         from_agent_id,
         to_agent_id,
         text,
         status,
         created_at,
         delivered_at,
         submitted_at,
         reported_at,
         report_text,
         artifacts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'dispatch-1',
      'ws-1',
      'orch-1',
      'worker-1',
      'first',
      'reported',
      100,
      110,
      120,
      130,
      'done',
      '["a.md"]'
    )

    initializeRuntimeDatabase(db)

    const dispatchColumns = new Set(
      (db.prepare('PRAGMA table_info(dispatches)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const rows = db
      .prepare('SELECT sequence, id, text FROM dispatches ORDER BY sequence ASC')
      .all() as Array<{ id: string; sequence: number; text: string }>

    expect(dispatchColumns.has('sequence')).toBe(true)
    expect(rows).toEqual([
      { id: 'dispatch-1', sequence: 1, text: 'first' },
      { id: 'dispatch-2', sequence: 2, text: 'second' },
    ])
    expect(indexColumns(db, 'idx_dispatches_workspace_created_at')).toEqual([
      'workspace_id',
      'sequence',
    ])
    expect(indexColumns(db, 'idx_dispatches_open_by_worker')).toEqual([
      'workspace_id',
      'to_agent_id',
      'status',
      'sequence',
    ])
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(15)).toEqual({
      version: 15,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(16)).toEqual({
      version: 16,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(17)).toEqual({
      version: 17,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(18)).toEqual({
      version: 18,
    })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(19)).toEqual({
      version: 19,
    })

    db.close()
  })

  test('v15 migration rebuilds legacy dispatches with sequence and preserves rows', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14);

      CREATE TABLE dispatches (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        submitted_at INTEGER,
        reported_at INTEGER,
        report_text TEXT,
        artifacts TEXT
      );

      INSERT INTO dispatches (
        id,
        workspace_id,
        from_agent_id,
        to_agent_id,
        text,
        status,
        created_at,
        delivered_at,
        submitted_at,
        reported_at,
        report_text,
        artifacts
      ) VALUES
        ('dispatch-later', 'ws-1', 'orch', 'worker', 'later', 'queued', 200, NULL, NULL, NULL, NULL, '[]'),
        ('dispatch-earlier', 'ws-1', 'orch', 'worker', 'earlier', 'reported', 100, 110, 120, 130, 'done', '["a.md"]');

      CREATE INDEX idx_dispatches_workspace_created_at
        ON dispatches (workspace_id, created_at);

      CREATE INDEX idx_dispatches_open_by_worker
        ON dispatches (workspace_id, to_agent_id, status, created_at);
    `)

    initializeRuntimeDatabase(db)

    const rows = db
      .prepare(
        `SELECT sequence, id, workspace_id, from_agent_id, to_agent_id, text, status, created_at, delivered_at, submitted_at, reported_at, report_text, artifacts
         FROM dispatches
         ORDER BY sequence ASC`
      )
      .all()

    expect(dispatchColumns(db).has('sequence')).toBe(true)
    expect(rows).toEqual([
      {
        artifacts: '["a.md"]',
        created_at: 100,
        delivered_at: 110,
        from_agent_id: 'orch',
        id: 'dispatch-earlier',
        reported_at: 130,
        report_text: 'done',
        sequence: 1,
        status: 'reported',
        submitted_at: 120,
        text: 'earlier',
        to_agent_id: 'worker',
        workspace_id: 'ws-1',
      },
      {
        artifacts: '[]',
        created_at: 200,
        delivered_at: null,
        from_agent_id: 'orch',
        id: 'dispatch-later',
        reported_at: null,
        report_text: null,
        sequence: 2,
        status: 'queued',
        submitted_at: null,
        text: 'later',
        to_agent_id: 'worker',
        workspace_id: 'ws-1',
      },
    ])
    expect(tableExists(db, 'dispatches_legacy_v15')).toBeUndefined()
    expect(indexColumns(db, 'idx_dispatches_workspace_created_at')).toEqual([
      'workspace_id',
      'sequence',
    ])
    expect(indexColumns(db, 'idx_dispatches_open_by_worker')).toEqual([
      'workspace_id',
      'to_agent_id',
      'status',
      'sequence',
    ])
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(15)).toEqual({
      version: 15,
    })

    db.close()
  })

  test('v15 migration rolls back dispatch rebuild and schema_version on copy failure', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at)
      VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8), (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14);

      CREATE TABLE dispatches (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        submitted_at INTEGER,
        reported_at INTEGER,
        report_text TEXT,
        artifacts TEXT
      );

      INSERT INTO dispatches (
        id,
        workspace_id,
        from_agent_id,
        to_agent_id,
        text,
        status,
        created_at,
        delivered_at,
        submitted_at,
        reported_at,
        report_text,
        artifacts
      ) VALUES
        ('duplicate-dispatch', 'ws-1', 'orch', 'worker', 'first copy candidate', 'queued', 100, NULL, NULL, NULL, NULL, '[]'),
        ('duplicate-dispatch', 'ws-1', 'orch', 'worker', 'second copy candidate', 'queued', 200, NULL, NULL, NULL, NULL, '[]');

      CREATE INDEX idx_dispatches_workspace_created_at
        ON dispatches (workspace_id, created_at);

      CREATE INDEX idx_dispatches_open_by_worker
        ON dispatches (workspace_id, to_agent_id, status, created_at);
    `)

    expect(() => initializeRuntimeDatabase(db)).toThrow()

    const rows = db
      .prepare('SELECT rowid, id, text, created_at FROM dispatches ORDER BY rowid ASC')
      .all()

    expect(dispatchColumns(db).has('sequence')).toBe(false)
    expect(rows).toEqual([
      {
        created_at: 100,
        id: 'duplicate-dispatch',
        rowid: 1,
        text: 'first copy candidate',
      },
      {
        created_at: 200,
        id: 'duplicate-dispatch',
        rowid: 2,
        text: 'second copy candidate',
      },
    ])
    expect(tableExists(db, 'dispatches')).toEqual({ name: 'dispatches' })
    expect(tableExists(db, 'dispatches_legacy_v15')).toBeUndefined()
    expect(
      db.prepare('SELECT version FROM schema_version WHERE version = ?').get(15)
    ).toBeUndefined()

    db.close()
  })

  test('migration upgrades legacy messages.kind data into messages.type', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-migrate-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at) VALUES (1, 1), (2, 2), (3, 3), (4, 4);

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        type TEXT NOT NULL,
        kind TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT,
        text TEXT,
        status TEXT,
        artifacts TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agent_launch_configs (
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, agent_id)
      );

      CREATE TABLE agent_runs (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        exit_code INTEGER,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    db.prepare(
      `INSERT INTO messages (
         workspace_id,
         worker_id,
         type,
         kind,
         from_agent_id,
         to_agent_id,
         text,
         status,
         artifacts,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('ws-1', 'worker-1', 'send', 'send', 'orch-1', 'worker-1', 'hello', null, null, 123)

    initializeRuntimeDatabase(db)

    const migratedColumns = new Set(
      (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const message = db
      .prepare('SELECT type, text FROM messages WHERE workspace_id = ?')
      .get('ws-1') as { text: string; type: string } | undefined

    expect(migratedColumns.has('kind')).toBe(false)
    expect(message).toEqual({ type: 'send', text: 'hello' })
    db.close()
  })

  test('schema v20 adds nullable thinking_level to existing launch configs', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v20-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at) VALUES
        (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8),
        (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15),
        (16, 16), (17, 17), (18, 18), (19, 19);

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        last_session_id TEXT,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agent_launch_configs (
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        command_preset_id TEXT,
        interactive_command TEXT,
        preset_augmentation_disabled INTEGER NOT NULL DEFAULT 0,
        resume_args_template TEXT,
        session_id_capture_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, agent_id)
      );

      INSERT INTO agent_launch_configs (
        workspace_id, agent_id, command, args_json, command_preset_id,
        interactive_command, preset_augmentation_disabled, resume_args_template,
        session_id_capture_json, created_at, updated_at
      ) VALUES (
        'ws-1', 'agent-1', 'claude', '[]', 'claude',
        NULL, 0, NULL, NULL, 1, 1
      );
    `)

    initializeRuntimeDatabase(db)

    const columns = new Set(
      (db.prepare('PRAGMA table_info(agent_launch_configs)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    const row = db
      .prepare('SELECT thinking_level FROM agent_launch_configs WHERE agent_id = ?')
      .get('agent-1') as { thinking_level: string | null } | undefined

    expect(columns.has('thinking_level')).toBe(true)
    expect(row).toEqual({ thinking_level: null })
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(20)).toEqual({
      version: 20,
    })
    db.close()
  })

  test('migration v21 creates feishu_bindings on top of v20 database', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v21-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at) VALUES
        (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8),
        (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15),
        (16, 16), (17, 17), (18, 18), (19, 19), (20, 20);

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        last_session_id TEXT,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agent_launch_configs (
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        command_preset_id TEXT,
        interactive_command TEXT,
        preset_augmentation_disabled INTEGER NOT NULL DEFAULT 0,
        resume_args_template TEXT,
        session_id_capture_json TEXT,
        thinking_level TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, agent_id)
      );
    `)

    initializeRuntimeDatabase(db)

    const columns = new Set(
      (db.prepare('PRAGMA table_info(feishu_bindings)').all() as Array<{ name: string }>).map(
        (col) => col.name
      )
    )
    const indexes = new Set(
      (db.prepare('PRAGMA index_list(feishu_bindings)').all() as Array<{ name: string }>).map(
        (idx) => idx.name
      )
    )

    expect(columns).toEqual(
      new Set(['id', 'workspace_id', 'chat_id', 'chat_name', 'enabled', 'created_at'])
    )
    expect(indexes.has('idx_feishu_bindings_workspace')).toBe(true)
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(21)).toEqual({
      version: 21,
    })
    db.close()
  })

  test('migration v22 updates builtin Codex preset with Playwright MCP args', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v22-codex-mcp-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      INSERT INTO schema_version (version, applied_at) VALUES
        (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8),
        (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15),
        (16, 16), (17, 17), (18, 18), (19, 19), (20, 20), (21, 21);

      CREATE TABLE command_presets (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL,
        env TEXT NOT NULL,
        resume_args_template TEXT,
        session_id_capture TEXT,
        yolo_args_template TEXT,
        is_builtin INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    db.prepare(
      `INSERT INTO command_presets (
        id,
        display_name,
        command,
        args,
        env,
        resume_args_template,
        session_id_capture,
        yolo_args_template,
        is_builtin,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'codex',
      'Codex',
      'codex',
      '[]',
      '{}',
      'resume {session_id}',
      JSON.stringify({
        pattern: '~/.codex/sessions/**/*.jsonl',
        source: 'codex_session_jsonl_dir',
      }),
      JSON.stringify(['--dangerously-bypass-approvals-and-sandbox']),
      1,
      1,
      1
    )

    initializeRuntimeDatabase(db)

    const row = db
      .prepare('SELECT yolo_args_template FROM command_presets WHERE id = ?')
      .get('codex') as { yolo_args_template: string }
    const args = JSON.parse(row.yolo_args_template) as string[]

    expect(args).toContain('mcp_servers.playwright.command="npx"')
    expect(args).toContain(
      'mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]'
    )
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(23)).toEqual({
      version: 23,
    })
    db.close()
  })

  test('M43 schema v33 adds review_status / reviews_dispatch_id / accept_verdict (all NULL by default) + idempotent', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v33-'))
    tempDirs.push(dataDir)
    // 1) 初始化 → schema_version 应含 33。
    const store = createRuntimeStore({ dataDir })
    stores.push(store)
    const db = new Database(join(dataDir, 'runtime.sqlite'))
    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(33)).toEqual({
      version: 33,
    })
    // 2) 三个新列存在、defaults NULL。
    const cols = dispatchColumns(db)
    expect(cols.has('review_status')).toBe(true)
    expect(cols.has('reviews_dispatch_id')).toBe(true)
    expect(cols.has('accept_verdict')).toBe(true)
    const fullColInfo = db.prepare('PRAGMA table_info(dispatches)').all() as Array<{
      name: string
      dflt_value: string | null
      notnull: number
    }>
    for (const colName of ['review_status', 'reviews_dispatch_id', 'accept_verdict']) {
      const info = fullColInfo.find((c) => c.name === colName)
      expect(info, `column ${colName} must exist`).toBeDefined()
      expect(info?.notnull, `${colName} must be nullable`).toBe(0)
      expect(info?.dflt_value, `${colName} default must be NULL`).toBeNull()
    }
    // 3) 索引存在。
    const dispatchIndexes = new Set(
      (db.prepare('PRAGMA index_list(dispatches)').all() as Array<{ name: string }>).map(
        (index) => index.name
      )
    )
    expect(dispatchIndexes.has('idx_dispatches_workspace_review_status')).toBe(true)
    expect(dispatchIndexes.has('idx_dispatches_reviews_dispatch_id')).toBe(true)

    // 4) 重复执行 applySchemaVersion33 不应重复 ALTER（PRAGMA table_info 守住）。
    const { applySchemaVersion33 } = await import('../../src/server/sqlite-schema-v33.js')
    expect(() => {
      applySchemaVersion33(db)
      applySchemaVersion33(db)
      applySchemaVersion33(db)
    }).not.toThrow()
    // 列数仍是 16（13 旧 + 3 新），不会出现 review_status_1 之类的重命名。
    const colsAfter = dispatchColumns(db)
    expect(colsAfter.size).toBe(cols.size)
    db.close()
  })

  test('M43 v32 → v33 migration on a legacy v32 database adds 3 columns + sets schema_version=33', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v32-to-v33-'))
    tempDirs.push(dataDir)
    const db = new Database(join(dataDir, 'runtime.sqlite'))
    // 造一个 v32 数据库：schema_version 含 1..32，dispatches 表是 v15+ 后的 13 列。
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_version (version, applied_at) VALUES
        (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8),
        (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15),
        (16, 16), (17, 17), (18, 18), (19, 19), (20, 20), (21, 21), (22, 22),
        (23, 23), (24, 24), (25, 25), (26, 26), (27, 27), (28, 28), (29, 29),
        (30, 30), (31, 31), (32, 32);

      CREATE TABLE dispatches (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        submitted_at INTEGER,
        reported_at INTEGER,
        report_text TEXT,
        artifacts TEXT
      );
      CREATE INDEX idx_dispatches_workspace_created_at ON dispatches (workspace_id, sequence);
      CREATE INDEX idx_dispatches_open_by_worker ON dispatches (workspace_id, to_agent_id, status, sequence);
    `)
    // 插一条遗留数据，迁移后应仍可读，且三个新字段为 NULL。
    db.prepare(
      `INSERT INTO dispatches (id, workspace_id, from_agent_id, to_agent_id, text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('legacy-1', 'ws-1', null, 'worker-1', 'legacy task', 'reported', 1)

    const before = dispatchColumns(db)
    expect(before.has('review_status')).toBe(false)
    expect(before.has('reviews_dispatch_id')).toBe(false)
    expect(before.has('accept_verdict')).toBe(false)

    // 触发 initialize → 应只跑 v33。
    initializeRuntimeDatabase(db)

    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(33)).toEqual({
      version: 33,
    })
    const after = dispatchColumns(db)
    expect(after.has('review_status')).toBe(true)
    expect(after.has('reviews_dispatch_id')).toBe(true)
    expect(after.has('accept_verdict')).toBe(true)
    // 遗留数据三字段确实 NULL。
    const legacyRow = db
      .prepare(
        'SELECT review_status, reviews_dispatch_id, accept_verdict FROM dispatches WHERE id = ?'
      )
      .get('legacy-1') as {
      review_status: unknown
      reviews_dispatch_id: unknown
      accept_verdict: unknown
    }
    expect(legacyRow.review_status).toBeNull()
    expect(legacyRow.reviews_dispatch_id).toBeNull()
    expect(legacyRow.accept_verdict).toBeNull()
    db.close()
  })

  test('v34 migration records workflow launch columns and is idempotent', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-schema-v34-'))
    tempDirs.push(dataDir)

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO schema_version (version, applied_at) VALUES
        (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8),
        (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15),
        (16, 16), (17, 17), (18, 18), (19, 19), (20, 20), (21, 21), (22, 22),
        (23, 23), (24, 24), (25, 25), (26, 26), (27, 27), (28, 28), (29, 29),
        (30, 30), (31, 31), (32, 32), (33, 33);

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        config_json TEXT,
        last_session_id TEXT,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE agent_launch_configs (
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        command_preset_id TEXT,
        interactive_command TEXT,
        preset_augmentation_disabled INTEGER NOT NULL DEFAULT 0,
        thinking_level TEXT,
        resume_args_template TEXT,
        session_id_capture_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, agent_id)
      );
    `)

    expect(tableColumns(db, 'workers').has('workflow_allowed')).toBe(false)
    expect(tableColumns(db, 'agent_launch_configs').has('env_json')).toBe(false)
    expect(tableColumns(db, 'agent_launch_configs').has('workflow_allowed')).toBe(false)

    initializeRuntimeDatabase(db)

    expect(db.prepare('SELECT version FROM schema_version WHERE version = ?').get(34)).toEqual({
      version: 34,
    })
    expect(tableColumns(db, 'workers').has('workflow_allowed')).toBe(true)
    expect(tableColumns(db, 'agent_launch_configs').has('env_json')).toBe(true)
    expect(tableColumns(db, 'agent_launch_configs').has('workflow_allowed')).toBe(true)

    const workerColumnCount = tableColumns(db, 'workers').size
    const launchColumnCount = tableColumns(db, 'agent_launch_configs').size
    expect(() => {
      applySchemaVersion34(db)
      applySchemaVersion34(db)
    }).not.toThrow()
    expect(tableColumns(db, 'workers').size).toBe(workerColumnCount)
    expect(tableColumns(db, 'agent_launch_configs').size).toBe(launchColumnCount)

    db.close()
  })
})
