import type { Database } from 'better-sqlite3'

export const applySchemaVersion36 = (db: Database) => {
  db.transaction(() => {
    const table = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'feishu_approvals'")
      .get() as { sql: string } | undefined
    if (!table) return
    if (table.sql.includes("'resolving'")) return

    db.exec(`
      DROP INDEX IF EXISTS idx_feishu_approvals_status_created_at;
      DROP INDEX IF EXISTS idx_feishu_approvals_workspace_status;

      ALTER TABLE feishu_approvals RENAME TO feishu_approvals_v35;

      CREATE TABLE feishu_approvals (
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

      INSERT INTO feishu_approvals (
        approval_id,
        workspace_id,
        orch_agent_id,
        chat_id,
        message_id,
        action,
        risk,
        target,
        status,
        decision,
        operator,
        created_at,
        resolved_at
      )
      SELECT
        approval_id,
        workspace_id,
        orch_agent_id,
        chat_id,
        message_id,
        action,
        risk,
        target,
        status,
        decision,
        operator,
        created_at,
        resolved_at
      FROM feishu_approvals_v35;

      DROP TABLE feishu_approvals_v35;

      CREATE INDEX IF NOT EXISTS idx_feishu_approvals_status_created_at
        ON feishu_approvals (status, created_at);

      CREATE INDEX IF NOT EXISTS idx_feishu_approvals_workspace_status
        ON feishu_approvals (workspace_id, status);
    `)
  })()
}
