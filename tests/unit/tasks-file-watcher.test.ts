import { describe, expect, it } from 'vitest'

import { buildWatchedPaths } from '../../src/server/tasks-file-watcher.js'

// 回归锁：2026-06 事故 —— reports/** 递归把视频逐帧 jpg 海 watch 进去 → fd 耗尽
// ENFILE → node-pty 启 worker 分不到 TTY → worker 启动即崩。本测试钉死"只 watch
// 文本文档、绝不递归吞二进制资产"这个不变量，防止有人改回 reports/**。
describe('tasks-file-watcher 监听路径白名单 (防 ENFILE)', () => {
  const paths = buildWatchedPaths('/ws/.hive/tasks.md', '/ws/.hive/plan.md', '/ws/.hive')

  it('绝不递归 watch reports（防视频帧海塞爆 fd）', () => {
    expect(paths).not.toContain('/ws/.hive/reports')
    expect(paths).not.toContain('/ws/.hive/reports/**')
    // reports 只认文本交付，不碰 assets/ 二进制
    const reportsGlobs = paths.filter((p) => p.includes('/reports/'))
    expect(reportsGlobs).toEqual(['/ws/.hive/reports/*.html', '/ws/.hive/reports/*.md'])
    expect(paths.some((p) => p.includes('/reports/assets'))).toBe(false)
  })

  it('任何递归目录 glob 都必须收口到扩展名，不许裸 /** 吞二进制资产', () => {
    for (const p of paths) {
      expect(p.endsWith('/**')).toBe(false)
      if (p.includes('/**')) {
        expect(p.endsWith('.md') || p.endsWith('.html')).toBe(true)
      }
    }
  })

  it('仍覆盖 PM 文档实时刷新所需的文本路径', () => {
    expect(paths).toContain('/ws/.hive/tasks.md')
    expect(paths).toContain('/ws/.hive/plan.md')
    expect(paths).toContain('/ws/.hive/open-questions.md')
    expect(paths).toContain('/ws/.hive/ideas/**/*.md')
    expect(paths).toContain('/ws/.hive/research/**/*.md')
    expect(paths).toContain('/ws/.hive/baseline/**/*.md')
    expect(paths).toContain('/ws/.hive/decisions/**/*.md')
    expect(paths).toContain('/ws/.hive/archive/**/*.md')
  })
})
