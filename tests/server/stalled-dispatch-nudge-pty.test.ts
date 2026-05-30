import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createDispatchLedgerStore } from '../../src/server/dispatch-ledger-store.js'
import { openRuntimeDatabase } from '../../src/server/runtime-database.js'
import { createStalledDispatchNudge } from '../../src/server/stalled-dispatch-nudge.js'

const waitFor = async (assertion: () => void, timeoutMs = 5000, intervalMs = 25) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw lastError
}

describe('stalled dispatch nudge with a real worker PTY', () => {
  const tempDirs: string[] = []
  const runs: Array<{ manager: ReturnType<typeof createAgentManager>; runId: string }> = []
  const databases: Array<ReturnType<typeof openRuntimeDatabase>> = []

  afterEach(() => {
    for (const { manager, runId } of runs.splice(0)) {
      try {
        manager.stopRun(runId)
      } catch {
        // Individual tests stop their known run ids; this best-effort fallback
        // intentionally does not mask assertion failures.
      }
    }
    for (const db of databases.splice(0)) db.close()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  test('injects a team-report reminder into worker stdin only after a new idle prompt appears', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hive-stalled-nudge-pty-'))
    tempDirs.push(dir)
    const transcriptPath = join(dir, 'stdin.log')
    const workerScript = join(dir, 'worker.js')
    writeFileSync(
      workerScript,
      [
        "import { appendFileSync } from 'node:fs'",
        `const transcriptPath = ${JSON.stringify(transcriptPath)}`,
        "process.stdin.setEncoding('utf8')",
        "process.stdout.write('ready before dispatch\\n❯ ')",
        "process.stdin.on('data', (chunk) => {",
        '  appendFileSync(transcriptPath, chunk)',
        "  if (chunk.includes('finish-now')) process.stdout.write('\\nfinished real work\\n❯ ')",
        '})',
      ].join('\n')
    )

    const manager = createAgentManager()
    const db = openRuntimeDatabase()
    databases.push(db)
    const ledger = createDispatchLedgerStore(db)
    const run = await manager.startAgent({
      agentId: 'worker-1',
      args: [workerScript],
      command: process.execPath,
      cwd: dir,
    })
    runs.push({ manager, runId: run.runId })

    await waitFor(() => {
      expect(manager.getRun(run.runId).output).toContain('ready before dispatch')
      expect(manager.getRun(run.runId).output).toContain('❯')
    })

    const dispatch = ledger.createDispatch({
      text: 'finish the task and report',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    ledger.markSubmitted(dispatch.id)

    let clock = 0
    const orchestratorNudges: string[] = []
    const nudge = createStalledDispatchNudge({
      getActiveRunByAgentId: () => manager.getRun(run.runId),
      injectNudge: (_workspaceId, message) => orchestratorNudges.push(message),
      idleGraceMs: 20,
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: 'ws-1', name: 'ws-1', path: dir }],
      now: () => clock,
      staleMs: 1,
      writeRunInput: (runId, input) => manager.writeInput(runId, `${input}\n`),
    })

    nudge.tick()
    expect(existsSync(transcriptPath) ? readFileSync(transcriptPath, 'utf8') : '').not.toContain(
      'team report'
    )

    manager.writeInput(run.runId, 'finish-now\n')
    await waitFor(() => {
      expect(manager.getRun(run.runId).output).toContain('finished real work')
    })

    nudge.tick()
    clock += 20
    nudge.tick()

    await waitFor(() => {
      const transcript = readFileSync(transcriptPath, 'utf8')
      expect(transcript).toContain(`dispatch ${dispatch.id}`)
      expect(transcript).toContain('team report')
      expect(transcript).toContain('写文字总结不算汇报')
    })
    expect(orchestratorNudges).toHaveLength(0)
  })
})
