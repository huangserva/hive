import type { Database } from 'better-sqlite3'

export const applySchemaVersion28 = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mobile_chat_messages (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mobile_chat_workspace_time
      ON mobile_chat_messages(workspace_id, created_at);
  `)
}
