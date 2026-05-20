import type { Database } from 'better-sqlite3'

export const applySchemaVersion19 = (db: Database) => {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  if (!columns.has('error_tail')) {
    db.exec('ALTER TABLE agent_runs ADD COLUMN error_tail TEXT')
  }
}
