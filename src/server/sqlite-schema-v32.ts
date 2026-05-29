import type { Database } from 'better-sqlite3'

export const applySchemaVersion32 = (db: Database) => {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_run_timeline_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT,
        seq INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_run_timeline_run_seq
        ON agent_run_timeline_events (run_id, seq);

      CREATE INDEX IF NOT EXISTS idx_agent_run_timeline_run_epoch_seq
        ON agent_run_timeline_events (run_id, epoch, seq);

      CREATE INDEX IF NOT EXISTS idx_agent_run_timeline_workspace_time
        ON agent_run_timeline_events (workspace_id, created_at);
    `)
  })()
}
