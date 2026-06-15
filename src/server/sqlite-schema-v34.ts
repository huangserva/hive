import type { Database } from 'better-sqlite3'

const ensureColumn = (
  db: Database,
  tableName: string,
  columnName: string,
  columnDefinition: string
) => {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`)
  }
}

export const applySchemaVersion34 = (db: Database) => {
  db.transaction(() => {
    ensureColumn(db, 'workers', 'workflow_allowed', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn(db, 'agent_launch_configs', 'env_json', 'TEXT')
    ensureColumn(db, 'agent_launch_configs', 'workflow_allowed', 'INTEGER NOT NULL DEFAULT 0')
  })()
}
