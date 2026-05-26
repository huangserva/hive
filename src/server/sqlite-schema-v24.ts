import type { Database } from 'better-sqlite3'

export const applySchemaVersion24 = (db: Database) => {
  const workerColumns = new Set(
    (db.prepare('PRAGMA table_info(workers)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )

  if (!workerColumns.has('config_json')) {
    db.exec('ALTER TABLE workers ADD COLUMN config_json TEXT')
  }
}
