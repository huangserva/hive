import type { Database } from 'better-sqlite3'

export const applySchemaVersion38 = (db: Database) => {
  const dispatchColumns = new Set(
    (db.prepare('PRAGMA table_info(dispatches)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )

  if (!dispatchColumns.has('input_acknowledged_at')) {
    db.exec('ALTER TABLE dispatches ADD COLUMN input_acknowledged_at INTEGER')
  }
  if (!dispatchColumns.has('input_delivery_failed_at')) {
    db.exec('ALTER TABLE dispatches ADD COLUMN input_delivery_failed_at INTEGER')
  }
}
