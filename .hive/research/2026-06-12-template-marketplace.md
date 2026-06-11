# 模板市场 HippoTeam-native 重做 — 调研索引

**日期**: 2026-06-12
**作者**: 马超 (claude coder) · dispatch 3ad6c3b1
**配套**: `.hive/reports/2026-06-12-template-marketplace.html`（设计 + Phase1 汇报）+ `.hive/decisions/draft-2026-06-12-template-marketplace-native.md`（ADR draft）

## 问题

上游 tt-a1i/hive 1.4.0（commit 99d3821 起 11 commit）引入"template marketplace"模板市场。PM 已挑出战略候选，user 拍按 PM 推荐 native 重做（不 cherry-pick）。本单交付：ADR + Phase1 最小实现 + 调研双产出。

## 探索过程

1. **核实 HippoTeam 现有边界**：
   - 数据层：`role_templates` 表 (sqlite-schema-v7) + `role-template-store.ts` 完整 CRUD；BUILTIN 内置 6+ 个角色（含 technical-writer / devops-engineer / researcher / general-assistant）
   - API：`/api/settings/role-templates` 4 REST 路径完整
   - Web：`useWorkerComposer.ts` 调 `listRoleTemplates()` 喂 AddWorker；**没有 Settings 管理 UI**（无 `web/src/settings/` 目录）
2. **核实上游污染规模**：99d3821 单 commit 114,235 insertions（5 大组件 + 1 hook + ~400 vendor md 文件）
3. **设计 native 边界**：catalog 只 read-only，导入即落 role_templates；vendor 不进；Web 入口 Phase2 再上
4. **避 sample 撞 BUILTIN**：技术文档/DevOps/通用助手已是 builtin → 改选 security-auditor / api-designer / k8s-sre / db-migration-engineer / a11y-auditor 5 个 BUILTIN 缺位 niche

## 结论

- **决策（ADR draft）**：HippoTeam-native 分 3 期重做，本单 Phase1 完成
- **Phase1 完成项**：
  - `src/server/marketplace-catalog.ts` 新增（catalog 数据 + slug 查询 + RoleTemplateInput 映射）
  - `src/server/routes-settings.ts` +44 行（GET catalog / POST import）
  - `tests/server/marketplace-catalog.test.ts` 新增（13 真集成测试，禁 mock，发到 startTestServer 真 server）
- **测试**：13 marketplace + 4 settings-api 共 17 全绿
- **未动**：sqlite schema / role-template-store / 任何 Web UI / package.json deps / vendor 目录（不存在不创建）

### 关键设计要点

- **slug 是 catalog 内唯一**，但允许同 slug 多次 import（落多条 role_templates 记录，id 不同）；UX 上 Phase2 可加 confirm
- **catalog 不是真源**：导入后 catalog 仍可读，但 role_templates 才是 source of truth；catalog 改动不影响已导入记录
- **HippoTeam 纪律段必须存在**：unit 测试自动锁住每条 description 都含"HippoTeam 纪律："+ "team report 汇报"
- **slug/name 不撞 BUILTIN**：unit 测试自动锁，避免未来加 sample 不小心覆盖 builtin

## 影响

- **下一步**：钟馗审 Phase1 → user 拍 Phase2 范围（UI 入口具体形态）→ 马超/关羽 implement Phase2
- **plan.md**：未触 milestone；属上游 backport 单
- **ideas/inbox.md**：未新增 idea；如果 Phase2 / Phase3 拍掉时间，可考虑创建 "marketplace 远程索引" idea 入仓
- **tasks.md**：runtime 自动维护 dispatch 行，本 worker 不动 narrative

## 验证命令

```
pnpm exec vitest run tests/server/marketplace-catalog.test.ts tests/server/settings-api.test.ts
# Test Files  2 passed (2)
#      Tests  17 passed (17)
```

curl 路径走通（user/PM 可在 4010 重启后实测）：
```
curl -b "hive_ui_token=<token>" http://127.0.0.1:4010/api/settings/marketplace/catalog
curl -b "hive_ui_token=<token>" -XPOST -H content-type:application/json \
     -d '{"slug":"k8s-sre"}' http://127.0.0.1:4010/api/settings/marketplace/import
```

## Pointers

- HTML 报告：`.hive/reports/2026-06-12-template-marketplace.html`
- ADR draft：`.hive/decisions/draft-2026-06-12-template-marketplace-native.md`
- 上游对照 commit：`99d3821` (起点) ~ `352dc52` (round 6) 共 11 commit；`9075611` test casing fix 也属此簇
- HippoTeam 现有契约：`src/server/role-template-store.ts:15-33`（RoleTemplateRecord / Input）+ `src/server/role-templates.ts:143`（BUILTIN_ROLE_TEMPLATES）
- API 入口：`src/server/routes-settings.ts:207-247`（新增 marketplace 两路由位置）
