import type { Database } from 'better-sqlite3'

export const applySchemaVersion30 = (db: Database) => {
  db.exec('DROP TABLE IF EXISTS mobile_pairing_codes')
}
