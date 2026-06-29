import type { Database } from 'better-sqlite3'

export const applySchemaVersion39 = (db: Database) => {
  const columns = new Set(
    (
      db.prepare('PRAGMA table_info(dispatches)').all() as Array<{
        name: string
      }>
    ).map((column) => column.name)
  )
  if (!columns.has('late_report_forwarded_at')) {
    db.exec('ALTER TABLE dispatches ADD COLUMN late_report_forwarded_at INTEGER')
  }
}
