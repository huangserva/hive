import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { exportLatestCodexImageFromSessionRoot } from '../../src/server/codex-image-export.js'

const tempDirs: string[] = []

const makeTempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lGlNtwAAAABJRU5ErkJggg=='

describe('codex image export', () => {
  test('decodes the latest image_generation_end result from CODEX_SESSION_ROOT to a PNG file', () => {
    const root = makeTempDir('hive-codex-image-root-')
    const sessionRoot = join(root, 'sessions')
    const olderDir = join(sessionRoot, '2026', '06', '18')
    const latestDir = join(sessionRoot, '2026', '06', '19')
    mkdirSync(olderDir, { recursive: true })
    mkdirSync(latestDir, { recursive: true })
    writeFileSync(
      join(olderDir, 'rollout-old.jsonl'),
      `${JSON.stringify({
        payload: { result: tinyPngBase64, type: 'image_generation_end' },
        timestamp: '2026-06-18T00:00:00.000Z',
        type: 'event_msg',
      })}\n`,
      'utf8'
    )
    const latestRollout = join(latestDir, 'rollout-new.jsonl')
    writeFileSync(
      latestRollout,
      [
        JSON.stringify({ payload: { cwd: '/workspace', id: 'session-new' }, type: 'session_meta' }),
        JSON.stringify({
          payload: {
            result: tinyPngBase64,
            revised_prompt: 'new generated image',
            status: 'generating',
            type: 'image_generation_end',
          },
          timestamp: '2026-06-19T00:00:00.000Z',
          type: 'event_msg',
        }),
      ].join('\n'),
      'utf8'
    )
    const outPath = join(root, 'assets', 'codex.png')

    const result = exportLatestCodexImageFromSessionRoot({ outPath, sessionRoot })

    expect(result).toMatchObject({
      bytes: 70,
      imageEventLine: 2,
      outPath,
      sourcePath: latestRollout,
    })
    expect(readFileSync(outPath).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })

  test('chooses the newest image event even when an older rollout file was touched later', () => {
    const root = makeTempDir('hive-codex-image-event-order-')
    const sessionRoot = join(root, 'sessions')
    const dir = join(sessionRoot, '2026', '06', '19')
    mkdirSync(dir, { recursive: true })
    const olderImageNewerFile = join(dir, 'rollout-current-worker.jsonl')
    const newerImageOlderFile = join(dir, 'rollout-codex-exec.jsonl')
    writeFileSync(
      olderImageNewerFile,
      `${JSON.stringify({
        payload: {
          result: tinyPngBase64,
          revised_prompt: 'older image event',
          type: 'image_generation_end',
        },
        timestamp: '2026-06-19T10:00:00.000Z',
        type: 'event_msg',
      })}\n`,
      'utf8'
    )
    writeFileSync(
      newerImageOlderFile,
      `${JSON.stringify({
        payload: {
          result: tinyPngBase64,
          revised_prompt: 'newer E2E image event',
          type: 'image_generation_end',
        },
        timestamp: '2026-06-19T11:00:00.000Z',
        type: 'event_msg',
      })}\n`,
      'utf8'
    )
    utimesSync(
      newerImageOlderFile,
      new Date('2026-06-19T11:00:01.000Z'),
      new Date('2026-06-19T11:00:01.000Z')
    )
    utimesSync(
      olderImageNewerFile,
      new Date('2026-06-19T11:01:00.000Z'),
      new Date('2026-06-19T11:01:00.000Z')
    )

    const result = exportLatestCodexImageFromSessionRoot({
      outPath: join(root, 'assets', 'fresh.png'),
      sessionRoot,
    })

    expect(result.sourcePath).toBe(newerImageOlderFile)
  })

  test('rejects image_generation_end payloads that are not PNG data', () => {
    const root = makeTempDir('hive-codex-image-invalid-')
    const sessionRoot = join(root, 'sessions')
    mkdirSync(join(sessionRoot, '2026', '06', '19'), { recursive: true })
    writeFileSync(
      join(sessionRoot, '2026', '06', '19', 'rollout-invalid.jsonl'),
      `${JSON.stringify({
        payload: {
          result: Buffer.from('not a png').toString('base64'),
          type: 'image_generation_end',
        },
        type: 'event_msg',
      })}\n`,
      'utf8'
    )

    expect(() =>
      exportLatestCodexImageFromSessionRoot({
        outPath: join(root, 'assets', 'bad.png'),
        sessionRoot,
      })
    ).toThrow('No PNG image_generation_end result found')
  })
})
