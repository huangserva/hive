import type { Database } from 'better-sqlite3'

export const applySchemaVersion31 = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_media_uploads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      device_id TEXT,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_media_workspace
      ON mobile_media_uploads(workspace_id, created_at);
  `)
}
