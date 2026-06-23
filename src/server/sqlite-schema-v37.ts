import type { Database } from 'better-sqlite3'

export const applySchemaVersion37 = (db: Database) => {
  db.transaction(() => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(dispatches)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    if (!columns.has('evidence_json')) {
      db.exec('ALTER TABLE dispatches ADD COLUMN evidence_json TEXT')
    }
  })()
}
