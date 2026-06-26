import type { Database } from 'better-sqlite3'
import { BUILTIN_ROLE_TEMPLATES } from './role-templates.js'
import { applySchemaVersion5 } from './sqlite-schema-v5.js'
import { applySchemaVersion7 } from './sqlite-schema-v7.js'
import { applySchemaVersion8 } from './sqlite-schema-v8.js'
import { applySchemaVersion9 } from './sqlite-schema-v9.js'
import { applySchemaVersion10 } from './sqlite-schema-v10.js'
import { applySchemaVersion11 } from './sqlite-schema-v11.js'
import { applySchemaVersion12 } from './sqlite-schema-v12.js'
import { applySchemaVersion13 } from './sqlite-schema-v13.js'
import { applySchemaVersion14 } from './sqlite-schema-v14.js'
import { applySchemaVersion15 } from './sqlite-schema-v15.js'
import { applySchemaVersion16 } from './sqlite-schema-v16.js'
import { applySchemaVersion17 } from './sqlite-schema-v17.js'
import { applySchemaVersion18 } from './sqlite-schema-v18.js'
import { applySchemaVersion19 } from './sqlite-schema-v19.js'
import { applySchemaVersion20 } from './sqlite-schema-v20.js'
import { applySchemaVersion21 } from './sqlite-schema-v21.js'
import { applySchemaVersion22 } from './sqlite-schema-v22.js'
import { applySchemaVersion23 } from './sqlite-schema-v23.js'
import { applySchemaVersion24 } from './sqlite-schema-v24.js'
import { applySchemaVersion25 } from './sqlite-schema-v25.js'
import { applySchemaVersion26 } from './sqlite-schema-v26.js'
import { applySchemaVersion27 } from './sqlite-schema-v27.js'
import { applySchemaVersion28 } from './sqlite-schema-v28.js'
import { applySchemaVersion29 } from './sqlite-schema-v29.js'
import { applySchemaVersion30 } from './sqlite-schema-v30.js'
import { applySchemaVersion31 } from './sqlite-schema-v31.js'
import { applySchemaVersion32 } from './sqlite-schema-v32.js'
import { applySchemaVersion33 } from './sqlite-schema-v33.js'
import { applySchemaVersion34 } from './sqlite-schema-v34.js'
import { applySchemaVersion35 } from './sqlite-schema-v35.js'
import { applySchemaVersion36 } from './sqlite-schema-v36.js'
import { applySchemaVersion37 } from './sqlite-schema-v37.js'
import { applySchemaVersion38 } from './sqlite-schema-v38.js'

export const CURRENT_SCHEMA_VERSION = 38

const ensureBuiltinRoleTemplates = (db: Database) => {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_templates'")
    .get() as { name: string } | undefined
  if (!table) return

  const now = Date.now()
  const insertRoleTemplate = db.prepare(
    `INSERT OR IGNORE INTO role_templates (
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )

  for (const template of BUILTIN_ROLE_TEMPLATES) {
    insertRoleTemplate.run(
      template.id,
      template.name,
      template.roleType,
      template.description,
      template.defaultCommand,
      JSON.stringify(template.defaultArgs),
      JSON.stringify(template.defaultEnv),
      now,
      now
    )
  }
}

export const initializeRuntimeDatabase = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      config_json TEXT,
      last_session_id TEXT,
      workflow_allowed INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
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

    CREATE TABLE IF NOT EXISTS agent_launch_configs (
      workspace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      command_preset_id TEXT,
      env_json TEXT,
      interactive_command TEXT,
      preset_augmentation_disabled INTEGER NOT NULL DEFAULT 0,
      thinking_level TEXT,
      workflow_allowed INTEGER NOT NULL DEFAULT 0,
      resume_args_template TEXT,
      session_id_capture_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL,
      exit_code INTEGER,
      error_tail TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      last_session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS dispatches (
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
      artifacts TEXT,
      evidence_json TEXT,
      input_acknowledged_at INTEGER,
      input_delivery_failed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_dispatches_workspace_created_at
      ON dispatches (workspace_id, sequence);

    CREATE INDEX IF NOT EXISTS idx_dispatches_open_by_worker
      ON dispatches (workspace_id, to_agent_id, status, sequence);
  `)

  const versions = db
    .prepare('SELECT version FROM schema_version ORDER BY version ASC')
    .all() as Array<{ version: number }>
  const appliedVersions = new Set(versions.map((row) => row.version))

  if (!appliedVersions.has(1)) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(1, Date.now())
    appliedVersions.add(1)
  }

  if (!appliedVersions.has(2)) {
    const workerColumns = new Set(
      (db.prepare('PRAGMA table_info(workers)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )

    if (workerColumns.size > 0 && !workerColumns.has('description')) {
      db.exec('ALTER TABLE workers ADD COLUMN description TEXT')
    }
    if (workerColumns.size > 0 && !workerColumns.has('workflow_allowed')) {
      db.exec('ALTER TABLE workers ADD COLUMN workflow_allowed INTEGER NOT NULL DEFAULT 0')
    }

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(2, Date.now())
  }

  if (!appliedVersions.has(3)) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(3, Date.now())
    appliedVersions.add(3)
  }

  if (!appliedVersions.has(4)) {
    const messageColumns = new Set(
      (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )

    if (messageColumns.size > 0 && !messageColumns.has('artifacts')) {
      db.exec('ALTER TABLE messages ADD COLUMN artifacts TEXT')
    }

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(4, Date.now())
  }

  if (!appliedVersions.has(5)) {
    applySchemaVersion5(db)

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(5, Date.now())
  }

  if (!appliedVersions.has(6)) {
    const launchConfigColumns = new Set(
      (db.prepare('PRAGMA table_info(agent_launch_configs)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    if (!launchConfigColumns.has('resume_args_template')) {
      db.exec('ALTER TABLE agent_launch_configs ADD COLUMN resume_args_template TEXT')
    }
    if (!launchConfigColumns.has('session_id_capture_json')) {
      db.exec('ALTER TABLE agent_launch_configs ADD COLUMN session_id_capture_json TEXT')
    }
    if (!launchConfigColumns.has('env_json')) {
      db.exec('ALTER TABLE agent_launch_configs ADD COLUMN env_json TEXT')
    }
    if (!launchConfigColumns.has('workflow_allowed')) {
      db.exec(
        'ALTER TABLE agent_launch_configs ADD COLUMN workflow_allowed INTEGER NOT NULL DEFAULT 0'
      )
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        agent_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        last_session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, agent_id)
      );
    `)

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(6, Date.now())
  }

  if (!appliedVersions.has(7)) {
    applySchemaVersion7(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(7, Date.now())
  }

  if (!appliedVersions.has(8)) {
    applySchemaVersion8(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(8, Date.now())
  }

  if (!appliedVersions.has(9)) {
    applySchemaVersion9(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(9, Date.now())
  }

  if (!appliedVersions.has(10)) {
    applySchemaVersion10(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(10, Date.now())
  }

  if (!appliedVersions.has(11)) {
    applySchemaVersion11(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(11, Date.now())
  }

  if (!appliedVersions.has(12)) {
    applySchemaVersion12(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(12, Date.now())
  }

  if (!appliedVersions.has(13)) {
    applySchemaVersion13(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(13, Date.now())
  }

  if (!appliedVersions.has(14)) {
    applySchemaVersion14(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(14, Date.now())
  }

  if (!appliedVersions.has(15)) {
    db.transaction(() => {
      applySchemaVersion15(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        15,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(16)) {
    applySchemaVersion16(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(16, Date.now())
  }

  if (!appliedVersions.has(17)) {
    applySchemaVersion17(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(17, Date.now())
  }

  if (!appliedVersions.has(18)) {
    applySchemaVersion18(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(18, Date.now())
  }

  if (!appliedVersions.has(19)) {
    applySchemaVersion19(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(19, Date.now())
  }

  if (!appliedVersions.has(20)) {
    applySchemaVersion20(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(20, Date.now())
  }

  if (!appliedVersions.has(21)) {
    applySchemaVersion21(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(21, Date.now())
  }

  if (!appliedVersions.has(22)) {
    applySchemaVersion22(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(22, Date.now())
  }

  if (!appliedVersions.has(23)) {
    applySchemaVersion23(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(23, Date.now())
  }

  if (!appliedVersions.has(24)) {
    applySchemaVersion24(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(24, Date.now())
  }

  if (!appliedVersions.has(25)) {
    applySchemaVersion25(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(25, Date.now())
  }

  if (!appliedVersions.has(26)) {
    applySchemaVersion26(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(26, Date.now())
  }

  if (!appliedVersions.has(27)) {
    applySchemaVersion27(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(27, Date.now())
  }

  if (!appliedVersions.has(28)) {
    applySchemaVersion28(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(28, Date.now())
  }

  if (!appliedVersions.has(29)) {
    applySchemaVersion29(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(29, Date.now())
  }

  if (!appliedVersions.has(30)) {
    applySchemaVersion30(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(30, Date.now())
  }

  if (!appliedVersions.has(31)) {
    applySchemaVersion31(db)
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(31, Date.now())
  }

  if (!appliedVersions.has(32)) {
    db.transaction(() => {
      applySchemaVersion32(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        32,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(33)) {
    db.transaction(() => {
      applySchemaVersion33(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        33,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(34)) {
    db.transaction(() => {
      applySchemaVersion34(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        34,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(35)) {
    db.transaction(() => {
      applySchemaVersion35(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        35,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(36)) {
    db.transaction(() => {
      applySchemaVersion36(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        36,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(37)) {
    db.transaction(() => {
      applySchemaVersion37(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        37,
        Date.now()
      )
    })()
  }

  if (!appliedVersions.has(38)) {
    db.transaction(() => {
      applySchemaVersion38(db)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        38,
        Date.now()
      )
    })()
  }

  ensureBuiltinRoleTemplates(db)
}
