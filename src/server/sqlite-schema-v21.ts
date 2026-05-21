import type { Database } from 'better-sqlite3'

export const applySchemaVersion21 = (db: Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feishu_bindings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      chat_id TEXT NOT NULL UNIQUE,
      chat_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_feishu_bindings_workspace
      ON feishu_bindings (workspace_id);
  `)
}
