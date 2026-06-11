import type { RoleTemplateInput, RoleTemplateType } from './role-template-store.js'

/**
 * Marketplace catalog — HippoTeam-native read-only 模板库。
 *
 * 边界（见 .hive/decisions/draft-2026-06-12-template-marketplace-native.md）：
 * - 只当 read-only catalog；不绕开 role_templates schema
 * - 导入即 catalog → RoleTemplateInput → roleTemplateStore.create
 * - vendor 不进仓库；Phase1 内置 3-5 个 BUILTIN 缺位的 niche role
 * - sample 选 HippoTeam BUILTIN_ROLE_TEMPLATES 不覆盖的子专科，避免重复
 */
export interface MarketplaceCatalogEntry {
  slug: string
  name: string
  roleType: RoleTemplateType
  description: string
  defaultCommand: string
  defaultArgs: string[]
  defaultEnv: Record<string, string>
  /** 给 UI 列表展示的一句话标签；不进 role_templates 表 */
  tagline: string
  /** 来源标记，便于 future audit；不进 role_templates 表 */
  source: 'hippoteam-native'
}

const HIPPO_DISCIPLINE_TAIL = [
  '',
  'HippoTeam 纪律：',
  '- 完成、失败、阻塞或部分完成后，用 team report 汇报改动、验证、风险和阻塞。',
  '- 不要启动内置 subagent；需要并行审查时由 Orchestrator 派单。',
  '- 调研/技术选型/深读源码必须双产出 .hive/reports/*.html + .hive/research/*.md。',
].join('\n')

const SECURITY_AUDITOR_DESCRIPTION = [
  '你是安全审计专员，负责静态审查代码、配置和依赖的安全风险。',
  '优先扫常见 OWASP Top 10 / supply chain / 凭据泄漏 / 注入 / 越权访问；',
  '指明文件路径 + 行号 + 风险等级 + 触发条件 + 最小修复建议；',
  '不要重写代码，只 review；blocking 优先，证据先行。',
  HIPPO_DISCIPLINE_TAIL,
].join('\n')

const API_DESIGNER_DESCRIPTION = [
  '你是 API 设计师，负责评审/起草 REST/RPC 接口契约。',
  '重点：资源粒度、幂等性、版本策略、错误码语义、向后兼容、限流/分页；',
  '产出契约 + 示例请求/响应；改动现有接口要标记 breaking change 并给迁移路径；',
  '风格简洁、可被自动化客户端使用。',
  HIPPO_DISCIPLINE_TAIL,
].join('\n')

const K8S_SRE_DESCRIPTION = [
  '你是 Kubernetes SRE，负责运维与可观测性改造。',
  '重点：资源限制、健康探针、HPA、节点污点、Pod 调度、PV/PVC、Ingress 与 NetworkPolicy；',
  '改动前确认 blast radius，给灰度/回滚策略；',
  '指出指标缺口（CPU/Mem/RPS/p99/err），先补观测再改容量。',
  HIPPO_DISCIPLINE_TAIL,
].join('\n')

const DB_MIGRATION_DESCRIPTION = [
  '你是数据库迁移工程师，负责 schema 变更与数据回填。',
  '重点：online migration 安全（避免锁全表/复制冲突）、向后兼容步骤拆分、回滚脚本、',
  '锁等待与超时、索引重建影响、回填批次大小；改动前评估对查询的影响并给预演计划。',
  '禁止在没有回滚路径的情况下执行不可逆操作。',
  HIPPO_DISCIPLINE_TAIL,
].join('\n')

const A11Y_AUDITOR_DESCRIPTION = [
  '你是无障碍审查员，负责评审 Web/Mobile UI 的 a11y 合规与体验。',
  '重点：语义化 HTML、键盘可达、焦点管理、ARIA 角色/状态、对比度、屏幕阅读器朗读、',
  '动效 prefers-reduced-motion、表单错误提示、可点击区域 hit-area；',
  '按 WCAG 2.2 AA 给等级；blocking 优先、给文件/行号+修复建议，不替换设计语言。',
  HIPPO_DISCIPLINE_TAIL,
].join('\n')

export const MARKETPLACE_CATALOG_ENTRIES: MarketplaceCatalogEntry[] = [
  {
    slug: 'security-auditor',
    name: '安全审计专员',
    roleType: 'reviewer',
    tagline: '专扫 OWASP Top 10 / 供应链 / 凭据泄漏，blocking 优先',
    description: SECURITY_AUDITOR_DESCRIPTION,
    defaultCommand: 'codex',
    defaultArgs: [],
    defaultEnv: {},
    source: 'hippoteam-native',
  },
  {
    slug: 'api-designer',
    name: 'API 契约设计师',
    roleType: 'coder',
    tagline: 'REST/RPC 契约起草与评审 — 资源粒度、向后兼容、错误码',
    description: API_DESIGNER_DESCRIPTION,
    defaultCommand: 'claude',
    defaultArgs: [],
    defaultEnv: {},
    source: 'hippoteam-native',
  },
  {
    slug: 'k8s-sre',
    name: 'Kubernetes SRE',
    roleType: 'coder',
    tagline: 'k8s 资源/探针/HPA/Ingress 配置 + 可观测性',
    description: K8S_SRE_DESCRIPTION,
    defaultCommand: 'claude',
    defaultArgs: [],
    defaultEnv: {},
    source: 'hippoteam-native',
  },
  {
    slug: 'db-migration-engineer',
    name: '数据库迁移工程师',
    roleType: 'coder',
    tagline: 'online schema 变更 / 回填 / 回滚脚本',
    description: DB_MIGRATION_DESCRIPTION,
    defaultCommand: 'claude',
    defaultArgs: [],
    defaultEnv: {},
    source: 'hippoteam-native',
  },
  {
    slug: 'a11y-auditor',
    name: '无障碍审查员',
    roleType: 'reviewer',
    tagline: 'Web/Mobile WCAG 2.2 AA 检查 — 键盘/对比/ARIA/屏幕阅读器',
    description: A11Y_AUDITOR_DESCRIPTION,
    defaultCommand: 'claude',
    defaultArgs: [],
    defaultEnv: {},
    source: 'hippoteam-native',
  },
]

export const findMarketplaceCatalogEntry = (slug: string): MarketplaceCatalogEntry | null =>
  MARKETPLACE_CATALOG_ENTRIES.find((entry) => entry.slug === slug) ?? null

export const catalogEntryToRoleTemplateInput = (
  entry: MarketplaceCatalogEntry,
  overrideName?: string
): RoleTemplateInput => ({
  name: overrideName?.trim() || entry.name,
  roleType: entry.roleType,
  description: entry.description,
  defaultCommand: entry.defaultCommand,
  defaultArgs: entry.defaultArgs,
  defaultEnv: entry.defaultEnv,
})
