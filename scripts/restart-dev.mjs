// Rebuild + restart the local dev stack (runtime :4010 + web :5180).
// Usage:
//   pnpm restart:4010              build, confirm, stop old stack, start `pnpm dev`, verify
//   pnpm restart:4010 --no-build   skip the build, just restart (fast)
//   pnpm restart:4010 --yes        skip the confirmation prompt (-y)
//
// ⚠️ DESTRUCTIVE: restarting :4010 tears down the runtime and KILLS ALL RUNNING WORKERS
// (see CLAUDE.md §14). The script confirms before killing unless --yes is passed.
//
// Safe by design: the build runs FIRST, so a compile failure aborts before the
// running server is touched — you never end up with everything killed and nothing up.

import { execFileSync, spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

const PORTS = { runtime: 4010, web: 5180 }
const LOG_FILE = 'runtime-4010.log'
const isWin = process.platform === 'win32'
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm'
const flags = process.argv.slice(2)
const skipBuild = flags.includes('--no-build')
const assumeYes = flags.includes('--yes') || flags.includes('-y')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const log = (msg) => console.log(`[restart] ${msg}`)

// PIDs currently LISTENing on a TCP port (empty array when none / on error).
const listenersOnPort = (port) => {
  try {
    if (isWin) {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
      const re = new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'g')
      return [...new Set([...out.matchAll(re)].map((m) => m[1]))]
    }
    const out = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    })
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    // lsof/netstat exit non-zero when nothing matches — treat as "no listeners".
    return []
  }
}

const killPid = (pid, force) => {
  try {
    if (isWin) {
      execFileSync('taskkill', force ? ['/PID', pid, '/T', '/F'] : ['/PID', pid, '/T'])
    } else {
      process.kill(Number(pid), force ? 'SIGKILL' : 'SIGTERM')
    }
  } catch {
    // already gone — fine
  }
}

const freePort = async (port) => {
  let pids = listenersOnPort(port)
  if (pids.length === 0) return
  log(`freeing :${port} (pid ${pids.join(', ')})`)
  for (const pid of pids) killPid(pid, false)
  // give it up to 3s to exit gracefully
  for (let i = 0; i < 12 && listenersOnPort(port).length > 0; i++) await sleep(250)
  // force-kill any stragglers (this is the step that was silently missed before)
  pids = listenersOnPort(port)
  for (const pid of pids) {
    log(`force-killing ${pid} on :${port}`)
    killPid(pid, true)
  }
  if (pids.length > 0) await sleep(300)
}

const httpStatus = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`)
    return res.status
  } catch {
    return null
  }
}

// 1. Compile (acts as a typecheck gate; aborts on failure before touching the server).
if (skipBuild) {
  log('skipping build (--no-build)')
} else {
  log('building…')
  execFileSync(pnpm, ['build'], { stdio: 'inherit' })
}

// 2. Confirm — restarting kills the runtime AND every running worker (CLAUDE.md §14).
const running = listenersOnPort(PORTS.runtime).length > 0
if (running && !assumeYes) {
  if (!process.stdin.isTTY) {
    log(
      '❌ runtime is live and this will kill ALL workers; re-run with --yes in non-interactive use.'
    )
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    '[restart] ⚠️  This kills the :4010 runtime AND every running worker. Continue? [y/N] '
  )
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) {
    log('aborted — nothing was killed.')
    process.exit(0)
  }
}

// 3. Stop the old stack and confirm both ports are free.
log('stopping old stack…')
for (const port of Object.values(PORTS)) await freePort(port)

// 4. Start `pnpm dev` detached so it survives this script exiting.
log(`starting pnpm dev → ${LOG_FILE}`)
const logFd = openSync(resolve(LOG_FILE), 'w')
const child = spawn(pnpm, ['dev'], { detached: true, stdio: ['ignore', logFd, logFd] })
child.unref()

// 5. Wait for the runtime to listen + answer, then report.
log(`waiting for runtime on :${PORTS.runtime}…`)
let status = null
for (let i = 0; i < 40; i++) {
  await sleep(500)
  if (listenersOnPort(PORTS.runtime).length > 0) {
    status = await httpStatus(PORTS.runtime)
    if (status) break
  }
}

if (status) {
  const pid = listenersOnPort(PORTS.runtime)[0] ?? '?'
  log(`✅ runtime up — http://127.0.0.1:${PORTS.runtime}/ (HTTP ${status}, pid ${pid})`)
  log(`   web    — http://127.0.0.1:${PORTS.web}/`)
  log(`   logs   — ${LOG_FILE}`)
} else {
  log(`❌ runtime did not come up on :${PORTS.runtime}. Check ${LOG_FILE}.`)
  process.exitCode = 1
}
