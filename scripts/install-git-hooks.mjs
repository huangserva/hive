#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

if (!existsSync('.husky/pre-commit')) {
  process.exit(0)
}

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.husky'], { stdio: 'ignore' })
} catch {
  process.exit(0)
}
