import type { Database } from 'better-sqlite3'

import { BUILTIN_ROLE_TEMPLATES } from './role-templates.js'

export const applySchemaVersion27 = (db: Database) => {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'role_templates'")
    .get() as { name: string } | undefined
  if (!table) return

  const now = Date.now()
  const upsertTemplate = db.prepare(
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role_type = excluded.role_type,
       description = excluded.description,
       default_command = excluded.default_command,
       default_args = excluded.default_args,
       default_env = excluded.default_env,
       is_builtin = 1,
       updated_at = excluded.updated_at`
  )

  for (const template of BUILTIN_ROLE_TEMPLATES) {
    upsertTemplate.run(
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
