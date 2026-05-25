import type { Database } from 'better-sqlite3'

export const applySchemaVersion23 = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_devices (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER
    );
  `)
}
