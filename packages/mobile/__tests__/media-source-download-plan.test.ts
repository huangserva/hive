import { describe, expect, it } from 'vitest'

import { planMediaSourceDownload } from '../src/lib/media-source-download-plan'

const UPLOAD_URL = '/api/mobile/uploads/abcDEF123.png'

describe('planMediaSourceDownload（chat 媒体 JS 下载到 file:// 决策·LAN authed 图加载不出真修）', () => {
  it('非 uploads url（如 /api/something/other）→ skip', () => {
    expect(
      planMediaSourceDownload({
        authToken: 'tok',
        connectionMode: 'lan',
        mediaUrl: '/api/other/foo.png',
      })
    ).toEqual({ kind: 'skip' })
  })

  it('basename 不安全（含 .. 或路径分隔）→ skip', () => {
    expect(
      planMediaSourceDownload({
        authToken: 'tok',
        connectionMode: 'lan',
        mediaUrl: '/api/mobile/uploads/../etc/passwd',
      })
    ).toEqual({ kind: 'skip' })
  })

  it('钟馗 blocking 焊死: dot-segment basename `.` / `..` → skip（path-traversal 焊死，LAN+relay 两路径都收敛）', () => {
    // 这条测产品代码若把 buildRelayMediaCacheKey 里的 dot-segment guard 删掉必红，
    // 卡住"basename === '.'/'..'+ cache path 拼成父目录"这类污染 cache 外层的最坏情况。
    expect(
      planMediaSourceDownload({
        authToken: 'tok',
        connectionMode: 'lan',
        mediaUrl: '/api/mobile/uploads/.',
      })
    ).toEqual({ kind: 'skip' })
    expect(
      planMediaSourceDownload({
        authToken: 'tok',
        connectionMode: 'lan',
        mediaUrl: '/api/mobile/uploads/..',
      })
    ).toEqual({ kind: 'skip' })
    // relay 模式同款焊死（runRelayChunks 也复用 buildRelayMediaCacheKey）
    expect(
      planMediaSourceDownload({
        authToken: 'tok',
        connectionMode: 'relay',
        mediaUrl: '/api/mobile/uploads/..',
      })
    ).toEqual({ kind: 'skip' })
  })

  it('disconnected 模式 → skip（没有可用 transport / LAN）', () => {
    expect(
      planMediaSourceDownload({
        authToken: 'tok',
        connectionMode: 'disconnected',
        mediaUrl: UPLOAD_URL,
      })
    ).toEqual({ kind: 'skip' })
  })

  it('relay 模式 + uploads → relay-chunks（保留现有 media.get 路径）', () => {
    const plan = planMediaSourceDownload({
      authToken: 'tok',
      connectionMode: 'relay',
      mediaUrl: UPLOAD_URL,
    })
    expect(plan).toEqual({ cacheKey: 'abcDEF123.png', kind: 'relay-chunks' })
  })

  it('relay 模式 + 没 authToken 也走 relay-chunks（relay 不靠 user token）', () => {
    const plan = planMediaSourceDownload({
      authToken: '',
      connectionMode: 'relay',
      mediaUrl: UPLOAD_URL,
    })
    expect(plan).toEqual({ cacheKey: 'abcDEF123.png', kind: 'relay-chunks' })
  })

  it('LAN 模式 + uploads + 有 authToken → lan-download（真修核心）', () => {
    const plan = planMediaSourceDownload({
      authToken: 'tok-abc',
      connectionMode: 'lan',
      mediaUrl: UPLOAD_URL,
    })
    expect(plan).toEqual({ cacheKey: 'abcDEF123.png', kind: 'lan-download' })
  })

  it('LAN 模式 + uploads + authToken 为空字符串 → skip（降级，让上层走老路径）', () => {
    expect(
      planMediaSourceDownload({
        authToken: '',
        connectionMode: 'lan',
        mediaUrl: UPLOAD_URL,
      })
    ).toEqual({ kind: 'skip' })
  })

  it('LAN 模式 + uploads + authToken null → skip', () => {
    expect(
      planMediaSourceDownload({
        authToken: null,
        connectionMode: 'lan',
        mediaUrl: UPLOAD_URL,
      })
    ).toEqual({ kind: 'skip' })
  })

  it('LAN 模式 + uploads + authToken undefined → skip', () => {
    expect(
      planMediaSourceDownload({
        authToken: undefined,
        connectionMode: 'lan',
        mediaUrl: UPLOAD_URL,
      })
    ).toEqual({ kind: 'skip' })
  })

  it('cacheKey 在 lan-download 和 relay-chunks 之间保持一致（同 url 同 basename 复用同一份 cache 文件）', () => {
    const lan = planMediaSourceDownload({
      authToken: 'tok',
      connectionMode: 'lan',
      mediaUrl: UPLOAD_URL,
    })
    const relay = planMediaSourceDownload({
      authToken: 'tok',
      connectionMode: 'relay',
      mediaUrl: UPLOAD_URL,
    })
    // 不变量：两条路径 download 完后都写到同一个 cache 文件，避免 relay/LAN 切换重下。
    if (lan.kind !== 'lan-download' || relay.kind !== 'relay-chunks') {
      throw new Error('unexpected plan kinds')
    }
    expect(lan.cacheKey).toBe(relay.cacheKey)
  })
})
