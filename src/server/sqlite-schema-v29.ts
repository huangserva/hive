import type { Database } from 'better-sqlite3'

export const applySchemaVersion29 = (db: Database) => {
  const mobileDeviceColumns = new Set(
    (db.prepare('PRAGMA table_info(mobile_devices)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )

  if (!mobileDeviceColumns.has('source')) {
    db.exec("ALTER TABLE mobile_devices ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
  }
}
