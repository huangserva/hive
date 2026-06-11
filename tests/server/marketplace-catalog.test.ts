import { afterEach, describe, expect, test } from 'vitest'

import {
  catalogEntryToRoleTemplateInput,
  findMarketplaceCatalogEntry,
  MARKETPLACE_CATALOG_ENTRIES,
} from '../../src/server/marketplace-catalog.js'
import { BUILTIN_ROLE_TEMPLATES } from '../../src/server/role-templates.js'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const servers: Array<Awaited<ReturnType<typeof startTestServer>>> = []

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close()
  }
})

describe('marketplace catalog (unit)', () => {
  test('catalog 至少包含 3 个 sample 且 slug 全局唯一', () => {
    expect(MARKETPLACE_CATALOG_ENTRIES.length).toBeGreaterThanOrEqual(3)
    const slugs = MARKETPLACE_CATALOG_ENTRIES.map((entry) => entry.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test('catalog 不跟 BUILTIN_ROLE_TEMPLATES 的 id/name 撞 (避免重复价值)', () => {
    const builtinIds = new Set(BUILTIN_ROLE_TEMPLATES.map((t) => t.id))
    const builtinNames = new Set(BUILTIN_ROLE_TEMPLATES.map((t) => t.name))
    for (const entry of MARKETPLACE_CATALOG_ENTRIES) {
      expect(builtinIds.has(entry.slug)).toBe(false)
      expect(builtinNames.has(entry.name)).toBe(false)
    }
  })

  test('每条 sample description 都尾追 HippoTeam 纪律段', () => {
    for (const entry of MARKETPLACE_CATALOG_ENTRIES) {
      expect(entry.description).toContain('HippoTeam 纪律：')
      expect(entry.description).toContain('team report 汇报')
    }
  })

  test('findMarketplaceCatalogEntry 命中已知 slug，未知返 null', () => {
    expect(findMarketplaceCatalogEntry('security-auditor')?.name).toBe('安全审计专员')
    expect(findMarketplaceCatalogEntry('does-not-exist')).toBeNull()
  })

  test('catalogEntryToRoleTemplateInput 映射所有字段 + 默认 name 来自 catalog', () => {
    const entry = findMarketplaceCatalogEntry('security-auditor')
    if (!entry) throw new Error('security-auditor missing from catalog')
    const input = catalogEntryToRoleTemplateInput(entry)
    expect(input.name).toBe(entry.name)
    expect(input.roleType).toBe(entry.roleType)
    expect(input.description).toBe(entry.description)
    expect(input.defaultCommand).toBe(entry.defaultCommand)
    expect(input.defaultArgs).toEqual(entry.defaultArgs)
    expect(input.defaultEnv).toEqual(entry.defaultEnv)
  })

  test('catalogEntryToRoleTemplateInput override_name 生效 (trim 空白)', () => {
    const entry = findMarketplaceCatalogEntry('security-auditor')
    if (!entry) throw new Error('security-auditor missing from catalog')
    expect(catalogEntryToRoleTemplateInput(entry, '我的审计员').name).toBe('我的审计员')
    expect(catalogEntryToRoleTemplateInput(entry, '  ').name).toBe(entry.name)
  })
})

describe('marketplace catalog (HTTP)', () => {
  test('GET /api/settings/marketplace/catalog 返回完整 sample 列表带 tagline', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    const response = await fetch(`${server.baseUrl}/api/settings/marketplace/catalog`, {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Array<{
      slug: string
      name: string
      role_type: string
      tagline: string
      description: string
      source: string
    }>
    expect(body.length).toBe(MARKETPLACE_CATALOG_ENTRIES.length)
    const security = body.find((entry) => entry.slug === 'security-auditor')
    expect(security?.name).toBe('安全审计专员')
    expect(security?.tagline).toContain('OWASP')
    expect(security?.role_type).toBe('reviewer')
    expect(security?.source).toBe('hippoteam-native')
    expect(security?.description).toContain('HippoTeam 纪律：')
  })

  test('GET catalog 没 UI 凭证拒绝 (4xx)', async () => {
    const server = await startTestServer()
    servers.push(server)
    const response = await fetch(`${server.baseUrl}/api/settings/marketplace/catalog`)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
  })

  test('POST import 没 UI 凭证拒绝写入 role_templates (4xx + 表无该 sample 落入)', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const importResponse = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'security-auditor' }),
    })
    expect(importResponse.status).toBeGreaterThanOrEqual(400)
    expect(importResponse.status).toBeLessThan(500)

    // 真验未落库 — 拿合法 cookie 读 role_templates 列表，"安全审计专员" 这个 sample
    // 名字不该出现（builtin 没这个 + 上面 POST 应被鉴权拦下）。
    // 删掉 routes-settings.ts:226 的 requireUiTokenFromRequest 这条会立刻挂红。
    const listResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      headers: { cookie },
    })
    expect(listResponse.status).toBe(200)
    const templates = (await listResponse.json()) as Array<{ name: string }>
    expect(templates.find((t) => t.name === '安全审计专员')).toBeUndefined()
  })

  test('POST /api/settings/marketplace/import 真落 role_templates 表且 list 能读到', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const importResponse = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'security-auditor' }),
    })
    expect(importResponse.status).toBe(201)
    const imported = (await importResponse.json()) as {
      slug: string
      template: { id: string; name: string; role_type: string; default_command: string }
    }
    expect(imported.slug).toBe('security-auditor')
    expect(imported.template.name).toBe('安全审计专员')
    expect(imported.template.role_type).toBe('reviewer')
    expect(imported.template.default_command).toBe('codex')
    expect(imported.template.id).toBeTruthy()

    const listResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      headers: { cookie },
    })
    expect(listResponse.status).toBe(200)
    const templates = (await listResponse.json()) as Array<{ id: string; name: string }>
    const persisted = templates.find((t) => t.id === imported.template.id)
    if (!persisted) {
      throw new Error('imported role template not persisted to role_templates table')
    }
    expect(persisted.name).toBe('安全审计专员')
  })

  test('POST import 支持 override_name 替换默认名 (例如个人化命名)', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const importResponse = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'api-designer', override_name: '团队 API 评审员' }),
    })
    expect(importResponse.status).toBe(201)
    const imported = (await importResponse.json()) as {
      template: { id: string; name: string }
    }
    expect(imported.template.name).toBe('团队 API 评审员')

    const listResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      headers: { cookie },
    })
    const templates = (await listResponse.json()) as Array<{ id: string; name: string }>
    expect(templates.find((t) => t.id === imported.template.id)?.name).toBe('团队 API 评审员')
  })

  test('POST import 未知 slug 返 400', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const response = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'does-not-exist' }),
    })
    expect(response.status).toBe(400)
  })

  test('POST import 缺 slug 返 400', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const response = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
  })

  test('同一 slug 多次 import 落多条 role_templates 记录 (允许同源多实例)', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const first = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'k8s-sre' }),
    })
    const firstBody = (await first.json()) as { template: { id: string } }

    const second = await fetch(`${server.baseUrl}/api/settings/marketplace/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'k8s-sre', override_name: 'k8s-sre #2' }),
    })
    const secondBody = (await second.json()) as { template: { id: string; name: string } }

    expect(secondBody.template.id).not.toBe(firstBody.template.id)
    expect(secondBody.template.name).toBe('k8s-sre #2')

    const listResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      headers: { cookie },
    })
    const templates = (await listResponse.json()) as Array<{ id: string }>
    const ids = new Set(templates.map((t) => t.id))
    expect(ids.has(firstBody.template.id)).toBe(true)
    expect(ids.has(secondBody.template.id)).toBe(true)
  })
})
