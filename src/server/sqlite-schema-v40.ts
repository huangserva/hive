import type { Database } from 'better-sqlite3'

export const applySchemaVersion40 = (db: Database) => {
  const columns = new Set(
    (
      db.prepare('PRAGMA table_info(dispatches)').all() as Array<{
        name: string
      }>
    ).map((column) => column.name)
  )
  if (!columns.has('report_acknowledged_at')) {
    db.exec('ALTER TABLE dispatches ADD COLUMN report_acknowledged_at INTEGER')
  }
  if (!columns.has('report_delivery_failed_at')) {
    db.exec('ALTER TABLE dispatches ADD COLUMN report_delivery_failed_at INTEGER')
  }
}
