#!/usr/bin/env node
// Pull the two upstream agent prompt repos and materialize them into
// vendor/marketplace/<lang>/ as a snapshot the hive runtime serves locally.
// Run before each release: pnpm sync:marketplace
//
// Strategy: download the entire repo as a tarball in one gh-authenticated
// request, extract to a temp dir, filter the markdown files, parse YAML
// frontmatter, atomically swap the result into vendor/marketplace/<lang>/.
// One request per source instead of ~400 per-file content fetches.

import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import matter from 'gray-matter'

const SOURCES = {
  en: { owner: 'msitarzewski', repo: 'agency-agents' },
  zh: { owner: 'jnMetaCode', repo: 'agency-agents-zh' },
}

const EXCLUDED_TOPLEVEL = new Set([
  'README.md',
  'README.en.md',
  'README.zh-CN.md',
  'README.zh-TW.md',
  'CONTRIBUTING.md',
  'CONTRIBUTING_zh-CN.md',
  'SECURITY.md',
  'AGENT-LIST.md',
  'CATALOG.md',
  'UPSTREAM.md',
])

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const vendorRoot = join(repoRoot, 'vendor', 'marketplace')

const parseArgs = () => {
  const args = process.argv.slice(2)
  const out = { source: 'both', dryRun: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--source') {
      const next = args[i + 1]
      if (next !== 'en' && next !== 'zh' && next !== 'both') {
        throw new Error(`Invalid --source value: ${next}`)
      }
      out.source = next
      i += 1
    } else if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length)
      if (value !== 'en' && value !== 'zh' && value !== 'both') {
        throw new Error(`Invalid --source value: ${value}`)
      }
      out.source = value
    } else if (arg === '--dry-run') {
      out.dryRun = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return out
}

const ghJson = (path) => {
  const result = execFileSync('gh', ['api', path], { encoding: 'utf8' })
  return JSON.parse(result)
}

const downloadTarball = (owner, repo, sha, targetPath) => {
  // gh api with -H Accept reads octet-stream and dumps to stdout. We need to
  // write bytes to disk, so use --output. spawnSync to avoid maxBuffer limits.
  const result = spawnSync(
    'gh',
    [
      'api',
      '--header',
      'Accept: application/vnd.github.v3.raw',
      `repos/${owner}/${repo}/tarball/${sha}`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 200 * 1024 * 1024 }
  )
  if (result.status !== 0) {
    throw new Error(`gh tarball fetch failed for ${owner}/${repo} @ ${sha}`)
  }
  writeFileSync(targetPath, result.stdout)
}

const extractTarball = (tarballPath, destDir) => {
  const result = spawnSync('tar', ['-xz', '-f', tarballPath, '-C', destDir], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`tar extract failed for ${tarballPath}`)
  }
  const entries = readdirSync(destDir).filter((entry) => {
    const stat = statSync(join(destDir, entry))
    return stat.isDirectory()
  })
  if (entries.length !== 1) {
    throw new Error(
      `Expected 1 top-level dir in tarball, found ${entries.length}: ${entries.join(', ')}`
    )
  }
  return join(destDir, entries[0])
}

const walkMarkdownFiles = (extractedRoot) => {
  const results = []
  const walk = (currentDir, relativeDir) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const absolutePath = join(currentDir, entry.name)
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Skip top-level meta files (READMEs, CATALOG, etc.)
        if (!relativeDir && EXCLUDED_TOPLEVEL.has(entry.name)) continue
        results.push({ absolutePath, relativePath })
      }
    }
  }
  walk(extractedRoot, '')
  return results
}

const buildManifest = (lang, sourceInfo, agents) => ({
  source: {
    repo: `${sourceInfo.owner}/${sourceInfo.repo}`,
    commit: sourceInfo.sha,
    fetched_at: new Date().toISOString(),
  },
  language: lang,
  categories: [...new Set(agents.map((agent) => agent.category))].sort(),
  agents: agents.sort((a, b) => a.path.localeCompare(b.path)),
})

const buildSourcesMarkdown = (lang, sourceInfo, agentCount) => `# Source attribution

This directory mirrors [${sourceInfo.owner}/${sourceInfo.repo}](https://github.com/${sourceInfo.owner}/${sourceInfo.repo}) at commit \`${sourceInfo.sha}\`.

- Language: ${lang}
- Agents: ${agentCount}
- Synced: ${new Date().toISOString()}
- License: MIT (see LICENSE in this directory)

All markdown content is unmodified from upstream. Hive only filters out top-level
meta files (READMEs, CATALOG, etc.) and parses YAML frontmatter to build the
manifest. To refresh, run \`pnpm sync:marketplace\` at the hive repo root.
`

const syncOne = async (lang, options) => {
  const sourceInfo = SOURCES[lang]
  console.log(`\n[${lang}] syncing ${sourceInfo.owner}/${sourceInfo.repo}…`)

  // Get default branch sha so the snapshot is reproducible
  const repoMeta = ghJson(`repos/${sourceInfo.owner}/${sourceInfo.repo}`)
  const branch = repoMeta.default_branch
  const branchMeta = ghJson(`repos/${sourceInfo.owner}/${sourceInfo.repo}/branches/${branch}`)
  sourceInfo.sha = branchMeta.commit.sha
  console.log(`[${lang}] default branch ${branch} @ ${sourceInfo.sha.slice(0, 12)}`)

  const tempBase = mkdtempSync(join(tmpdir(), `hive-marketplace-${lang}-`))
  try {
    const tarballPath = join(tempBase, 'archive.tar.gz')
    const extractRoot = join(tempBase, 'extract')
    mkdirSync(extractRoot, { recursive: true })

    console.log(`[${lang}] downloading tarball…`)
    downloadTarball(sourceInfo.owner, sourceInfo.repo, sourceInfo.sha, tarballPath)
    const extractedRoot = extractTarball(tarballPath, extractRoot)

    const mdFiles = walkMarkdownFiles(extractedRoot)
    console.log(`[${lang}] found ${mdFiles.length} markdown files after filter`)

    const agents = []
    const stagingDir = join(vendorRoot, `.tmp-${lang}`)
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true })

    let parseFailures = 0
    for (const { absolutePath, relativePath } of mdFiles) {
      const raw = readFileSync(absolutePath, 'utf8')
      let parsed
      try {
        parsed = matter(raw)
      } catch (error) {
        console.warn(`[${lang}] frontmatter parse failed: ${relativePath} — skipping`)
        console.warn(`  reason: ${error?.message ?? error}`)
        parseFailures += 1
        continue
      }
      const fm = parsed.data ?? {}
      if (!fm.name || !fm.description) {
        console.warn(`[${lang}] missing name/description: ${relativePath} — skipping`)
        parseFailures += 1
        continue
      }
      const normalizedPath = relativePath.split(sep).join('/')
      const category = normalizedPath.includes('/') ? normalizedPath.split('/')[0] : 'misc'
      agents.push({
        path: normalizedPath,
        category,
        name: String(fm.name),
        description: String(fm.description),
        emoji: fm.emoji ? String(fm.emoji) : null,
        color: fm.color ? String(fm.color) : null,
      })

      const targetPath = join(stagingDir, normalizedPath)
      mkdirSync(dirname(targetPath), { recursive: true })
      writeFileSync(targetPath, raw)
    }

    // Copy upstream LICENSE if present
    const licenseSource = join(extractedRoot, 'LICENSE')
    if (existsSync(licenseSource)) {
      cpSync(licenseSource, join(stagingDir, 'LICENSE'))
    } else {
      console.warn(`[${lang}] no LICENSE file found in upstream — please verify manually`)
    }

    const manifest = buildManifest(lang, sourceInfo, agents)
    writeFileSync(join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(
      join(stagingDir, 'SOURCES.md'),
      buildSourcesMarkdown(lang, sourceInfo, agents.length)
    )

    if (options.dryRun) {
      console.log(`[${lang}] dry-run: would write ${agents.length} agents to ${vendorRoot}/${lang}`)
      console.log(`[${lang}] dry-run: ${parseFailures} files would be skipped`)
      rmSync(stagingDir, { recursive: true, force: true })
      return
    }

    // Atomic swap: remove old, rename staging
    const finalDir = join(vendorRoot, lang)
    if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true })
    renameSync(stagingDir, finalDir)

    console.log(
      `[${lang}] wrote ${agents.length} agents${parseFailures > 0 ? ` (${parseFailures} skipped)` : ''} → ${finalDir}`
    )
  } finally {
    rmSync(tempBase, { recursive: true, force: true })
  }
}

const main = async () => {
  const options = parseArgs()
  mkdirSync(vendorRoot, { recursive: true })

  const langs = options.source === 'both' ? ['en', 'zh'] : [options.source]
  for (const lang of langs) {
    await syncOne(lang, options)
  }

  console.log(`\n✓ sync complete${options.dryRun ? ' (dry-run)' : ''}`)
}

main().catch((error) => {
  console.error(`✗ sync failed: ${error?.message ?? error}`)
  process.exit(1)
})
