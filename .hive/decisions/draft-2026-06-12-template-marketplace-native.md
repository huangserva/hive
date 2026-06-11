# 决策：上游 marketplace 改 HippoTeam-native catalog 重做

**日期**: 2026-06-12
**状态**: 提案中（draft，等 user 拍）
**关联**: plan.md → 上游 tt-a1i/hive 1.4.0 模板市场 backport；ideas/inbox.md → 角色复用与跨 workspace 模板（PM 推荐已定方向）

## 背景

上游 tt-a1i/hive 1.4.0 (commit 99d3821 起 11 commit) 引入"template marketplace"：
- vendor 两个 community library 进仓库：`msitarzewski/agency-agents` (184 EN agent) + `jnMetaCode/agency-agents-zh` (216 ZH agent)，共 ~400 agent prompt 文件、99d3821 单 commit `114,235 insertions`
- 新增 `vendor/marketplace/{en,zh}/` 目录 + `pnpm sync:marketplace` 脚本拉新版
- 新增 routes / `web/src/marketplace/MarketplaceDrawer.tsx` / `useMarketplace.ts` / `MarketplaceAgentCard.tsx` 等 5 个组件
- 入口挂在 AddWorkerDialog（点"模板库"打开 drawer，浏览预览导入）
- 导入后落进现有 `role_templates` 表，`role_type='custom'`

HippoTeam 现状对照（已读源码核实）：
- 数据层：`role_templates` 表 (sqlite-schema-v7) + `role-template-store.ts` 提供 list/create/update/remove，schema 含 `default_command / default_args / default_env / is_builtin`；BUILTIN_ROLE_TEMPLATES 在 `role-templates.ts:143` 内置 6+ 个角色（全栈/前端/后端/审查/测试/DevOps/通用 助手等）
- API：`/api/settings/role-templates` 4 个 REST 路径完整（routes-settings.ts:158-200）
- Web：`useWorkerComposer.ts` 调 `listRoleTemplates()` 喂 AddWorker；**没有 Settings 管理 UI**（无 `web/src/settings/`）
- 治理特殊：HippoTeam 是 PM-driven 多 agent 协作工作台，角色含 orchestrator / coder / reviewer / tester / sentinel 6 大类，名字阵容用三国/中国名将体系（关羽/赵云/钟馗/周瑜/马超 等），跟上游 EN/ZH historical figures 池完全分叉

直接 cherry-pick 上游 marketplace 的 3 个问题：
1. **仓库膨胀 11.4 万行**：99d3821 单 commit insertion 数等同我们整个 src/ 体量；后续 sync 还要持续吃 community library 增量
2. **绕开 schema**：上游 catalog 与 role_templates 短暂并存（catalog 在 vendor 文件，import 时才落库）；HippoTeam L1 体系要求 "DB 是单一真源"，并存两套真源跟治理冲突
3. **EN/ZH 池不沾我们三国阵容**：上游 catalog 偏国际化通用 agent；HippoTeam 已有自己 hardcoded 三国阵容 + 6 大角色类，社区 EN agent 大量重复或不适用（"Salesforce Architect" / "Zk Steward" 等跟 HippoTeam 战场无关）

## 决策

**上游 marketplace 改 HippoTeam-native catalog 重做，分 Phase 渐进上**：

**Native 边界（user 已拍）**：
1. ✅ **marketplace 只当 read-only catalog 不绕开现有 schema** — catalog 在内存/TS 文件，导入即落 `role_templates` 表（is_builtin=0）；catalog 本身不持久化、不能从 UI 编辑
2. ✅ **导入转 RoleTemplateInput 不并存两套真源** — catalog 条目→`RoleTemplateInput`→`roleTemplateStore.create`；导入完，catalog 不再是 source of truth
3. ✅ **vendor 不一次进 10 万行** — Phase1 内置 3-5 个精选 sample（HippoTeam 缺位的 niche role），Phase2 起按需引远程索引或继续扩 sample
4. ✅ **Web 入口最小** — Phase1 只服务端 + curl 验证；Phase2 入口放 AddWorkerDialog 旁"📚 模板库"按钮触发简单 modal（不照搬 upstream MarketplaceDrawer）

**分期**：
- **Phase1（本单）**：catalog 数据模型 + 2 个 REST 路由 + 3-5 sample + TDD 集成测试。**无 UI**
- **Phase2（user 拍 Phase1 后）**：AddWorkerDialog 内"📚 模板库"按钮 + 极简 modal（列 sample + 一键导入）；i18n 中英
- **Phase3（远期，user 拍）**：远程索引（GitHub raw / 自托管 catalog.json）+ search / filter / 分类树

## 理由

1. **避 11.4 万行 vendor 污染** — Phase1 先 3-5 sample，到 Phase3 才考虑远程索引，仓库历史保持干净
2. **HippoTeam 治理一致** — `role_templates` 表保持单一真源；user 改 catalog 入库后跟手动 POST 完全一致，可走 update/delete
3. **跟 BUILTIN 互补不重复** — sample 选 HippoTeam builtin **缺位** 的 niche role（security audit / API designer / k8s sre / db migration / tech writer 等），展示 catalog 的真实价值而非自我重复
4. **Web UI Phase 渐进** — Phase1 无 UI 节省 web 工时，等 user 真有需求拉 Phase2；不照搬 upstream Drawer，避免引入 5 个组件 + 1 个 hook 的范围扩张
5. **可逆** — Phase1 全部代码集中在 1-2 文件，回滚成本极低；catalog 数据即使作废也只影响 sample，不影响已入库的 role_templates

## 已知代价

- **Phase1 user 不能直接用 UI 导入** — 只能 curl `/api/settings/marketplace/import` 或 Phase2 再加 UI；接受，因为派单显式要求"先做最小"
- **3-5 sample 覆盖窄** — community library 的长尾 niche role 这版触不到；user 真的要 400 agent 再上 Phase3 远程索引
- **catalog 静态 TS 数组** — 加新 sample 要改代码 PR + 发版；如果用户量大、需 hot-reload 要等 Phase3 远程
- **没有 search / filter / 分类树** — Phase1 直接列表展示就够 3-5 sample；Phase2 / Phase3 看需求加

## Phase2 注意事项（钟馗 2026-06-12 复审非 blocking 提点）

- `catalogEntryToRoleTemplateInput` 返回的 `defaultArgs`/`defaultEnv` 是 catalog entry 字段的引用。Phase1 catalog 是静态常量，没人 mutate，目前不会有 bug；但 **Phase2 上 UI 后**如果允许用户在 modal 里编辑 args/env 再 import（即对 import payload mutate），必须在映射器里改成拷贝：
  ```ts
  defaultArgs: [...entry.defaultArgs],
  defaultEnv: { ...entry.defaultEnv },
  ```
  否则用户改一次会污染所有后续 import 的同 slug 默认值。

## 结果（后写）
（实施后回填实际效果：Phase1 走通后回写本节，再决定 Phase2/3 何时拉）
