import type { Database } from 'better-sqlite3'

export const applySchemaVersion35 = (db: Database) => {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feishu_approvals (
        approval_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        orch_agent_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        risk TEXT NOT NULL CHECK (risk IN ('high', 'medium')),
        target TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolving', 'resolved')),
        decision TEXT CHECK (decision IN ('allow', 'deny') OR decision IS NULL),
        operator TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_feishu_approvals_status_created_at
        ON feishu_approvals (status, created_at);

      CREATE INDEX IF NOT EXISTS idx_feishu_approvals_workspace_status
        ON feishu_approvals (workspace_id, status);
    `)
  })()
}
