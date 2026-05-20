import type { Database } from 'better-sqlite3'

export const applySchemaVersion20 = (db: Database) => {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(agent_launch_configs)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  if (!columns.has('thinking_level')) {
    db.exec('ALTER TABLE agent_launch_configs ADD COLUMN thinking_level TEXT')
  }
}
