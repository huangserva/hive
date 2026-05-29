import type { Database } from 'better-sqlite3'

export const applySchemaVersion25 = (db: Database) => {
  const mobileDeviceColumns = new Set(
    (db.prepare('PRAGMA table_info(mobile_devices)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )

  if (!mobileDeviceColumns.has('capabilities')) {
    db.exec('ALTER TABLE mobile_devices ADD COLUMN capabilities TEXT')
  }
  if (!mobileDeviceColumns.has('revoked_at')) {
    db.exec('ALTER TABLE mobile_devices ADD COLUMN revoked_at INTEGER')
  }
  if (!mobileDeviceColumns.has('device_type')) {
    db.exec('ALTER TABLE mobile_devices ADD COLUMN device_type TEXT')
  }

  db.exec(`
    UPDATE mobile_devices
    SET
      capabilities = COALESCE(capabilities, '["read_dashboard","read_terminal","send_prompt","approve_risk","admin_runtime"]'),
      device_type = COALESCE(device_type, 'legacy_m19a')
    WHERE capabilities IS NULL OR device_type IS NULL;

  `)
}
