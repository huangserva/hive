import type { Database } from 'better-sqlite3'

/**
 * M43 Phase 1 — dispatch accept-gate 三字段（旁挂方案 B，不动 8 态 status）。
 *
 * 设计见 `.hive/decisions/draft-2026-06-13-accept-gate.md` + `.hive/reports/2026-06-13-accept-gate-reviewer-verdict-design.html`。
 *
 * 关键不变量：
 * - 三个字段都 NULL 默认；存量 open dispatch 全部 NULL → 走旧路径，零数据迁移
 * - `isOpenDispatchStatus / isCompletedDispatchStatus` 不变 → M34 兜底 / stalled-dispatch / sentinel / mobile dashboard 全部零波及
 * - 字段写入由 env flag `HIVE_ACCEPT_GATE=1` gated；flag=0 时读端忽略 → 行为完全等价回退前
 */
export const applySchemaVersion33 = (db: Database) => {
  db.transaction(() => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(dispatches)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    )
    if (!columns.has('review_status')) {
      db.exec('ALTER TABLE dispatches ADD COLUMN review_status TEXT')
    }
    if (!columns.has('reviews_dispatch_id')) {
      db.exec('ALTER TABLE dispatches ADD COLUMN reviews_dispatch_id TEXT')
    }
    if (!columns.has('accept_verdict')) {
      db.exec('ALTER TABLE dispatches ADD COLUMN accept_verdict TEXT')
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dispatches_workspace_review_status
        ON dispatches (workspace_id, review_status);
      CREATE INDEX IF NOT EXISTS idx_dispatches_reviews_dispatch_id
        ON dispatches (reviews_dispatch_id);
    `)
  })()
}
