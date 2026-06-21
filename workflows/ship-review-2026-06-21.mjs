// 固定工作流脚本（Opus 编排者设计，andy 在 GLM 上执行）。
// 目的：对本轮 sprint（worker 状态对账 / dispatch-recover / env 安全护栏 / 飞书审批持久化 /
//      compact 看门狗 / codex 出图）新 ship 的代码做一次聚焦审查——这些是真正的回归风险区。
// 范式：fan-out（5 个审查员各深读一个受影响面的真文件，挖 bug/回归/安全）→ synthesize（去重+按严重度+置信度排序）。
// 控制流写死，模型只在 agent() 叶子被调用。
// 运行：Workflow({ scriptPath: '<abs>/workflows/ship-review-2026-06-21.mjs' })
export const meta = {
  name: 'ship-review-2026-06-21',
  description: '对本轮 sprint 新 ship 的 6 块代码做聚焦审查：5 个面并行深读真文件挖回归/bug/安全 → 综合成按严重度+置信度排序的优先级清单',
  phases: [
    { title: 'Review', detail: '5 个受影响面并行审查' },
    { title: 'Synthesize', detail: '去重 + 按严重度/置信度排序' },
  ],
}

const COMMON = `只读不改，必须真 ls/grep/read 仓库里的真文件再下结论，别凭文件名猜。逐条输出：文件:行 + 问题 + 触发条件/为什么 + 严重度(高/中/低) + 置信度(高=读到真代码确信/中=需复核/低=可能假阳性) + 最小修复建议。基于真读到的代码，不要把猜测当事实，找不到问题就如实说"这块没发现问题"。`

const SURFACES = [
  {
    key: 'worker-status-reconcile',
    prompt: `你审查【worker 状态对账与生命周期】面。本轮把 worker 状态从"内存可变字段+多真相源"改成"单一权威派生+运行期对账"。读这些真文件：src/server/agent-status-reconciler.ts、agent-runtime.ts、agent-runtime-contract.ts、workspace-store-hydration.ts、runtime-store-helpers.ts。重点找：① 派生函数 deriveAgentStatus 的输入是否在所有路径都准（activeRun/isStarting/openDispatchCount）；② 已知"水合→首次 reconcile tick 之间 count=0 的窗口"是否真堵上了；③ 启动窗口误判（run 未注册进 registry 被判 stopped/idle）；④ 对账与事件维护之间还有没有漂移残口。${COMMON}`,
  },
  {
    key: 'dispatch-recover-cli',
    prompt: `你审查【dispatch / report / recover / abandon 与 team CLI】面。本轮加了 team recover/abandon 治"死结"(report_overdue dispatch 卡活 worker 既挡新派又取消不掉)，并收敛了注入路径。读真文件：src/server/team-operations.ts、agent-stdin-dispatcher.ts、src/cli/team.ts。重点找：① recover/abandon 的状态流转是否原子、会不会把活 dispatch 误清；② 注入失败时 dispatch 状态是否仍标成功(静默吞错)；③ 取消/恢复与 report 事件交叉到达的竞态；④ CLI 参数校验缺口/危险默认值。${COMMON}`,
  },
  {
    key: 'env-security-guard',
    prompt: `你审查【spawn env 作用域 + 能力面护栏 + 鉴权】面。本轮做了 provider 维度 env 白名单(防密钥串台)、补回 PROXY_PARENT_ENV_KEYS(修代理回归)、workflow worker 无条件剥 ANTHROPIC_API_KEY。读真文件：src/server/agent-manager.ts、agent-manager-support.ts、team-authz.ts，以及 command-preset 相关。重点找：① 白名单有没有漏掉该传的(致功能回归)或放过了不该传的(致密钥泄漏到错 provider)；② GLM key 是否真的只 spawn 注入、绝不落库/泄给其它 provider；③ 鉴权/能力判定可被绕过处；④ 代理变量作用域是否正确。这是安全命门，宁可多疑。${COMMON}`,
  },
  {
    key: 'feishu-approval-persist',
    prompt: `你审查【飞书/移动审批持久化 + schema 迁移】面。本轮加了 feishu_approvals 表 + 原子 resolve(UPDATE WHERE status='pending'→'resolving' 防相反决策翻转)，markResolved 仅在注入成功后。读真文件：src/server/feishu-approval-ledger.ts、sqlite-schema-v35.ts、sqlite-schema-v36.ts、routes-mobile.ts、relay-rpc-handler.ts。重点找：① 原子 resolve 是否真防住并发双决策/重放；② 高风险动作(rm/push/drop)审批闸门有没有可绕过路径；② schema 迁移(v34→v36)是否幂等、对存量库安全、有无丢数据；④ 审批超时/孤儿态处理。${COMMON}`,
  },
  {
    key: 'compact-watchdog-codex-image',
    prompt: `你审查【compact 自愈看门狗 + codex 出图导出 + session capture】面。读真文件：src/server/compact-recovery-watchdog.ts、codex-image-export.ts、session-capture-codex.ts、command-preset-defaults.ts(codex capture 路径)。重点找：① 看门狗默认 fail-closed(只升级不自动重启)是否真的安全、自动重启路径(HIVE_COMPACT_AUTORECOVER)有没有误杀活 worker 风险、run 退出确认是否可靠；② codex-image-export 选图逻辑(按事件 timestamp 非文件 mtime)边界、PNG 校验、路径处理、命令注入面；③ CODEX_SESSION_ROOT 改造后 session resume/capture 有没有回归、对存量库 preset 的兼容。${COMMON}`,
  },
]

log('ship-review-2026-06-21 启动：5 个受影响面并行审查本轮 sprint 新代码')

phase('Review')
const reviews = await parallel(
  SURFACES.map((s) => () => agent(s.prompt, { label: `review:${s.key}` })),
)

phase('Synthesize')
const sections = reviews
  .map((r, i) => (r ? `### 面：${SURFACES[i].key}\n${r}` : `### 面：${SURFACES[i].key}\n(该审查员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 5 个审查员对本轮 sprint 新代码各受影响面的审查结果。综合成一份给 PM 的优先级清单：
① 去重（同一处被多面命中的合并）。
② 每条标：文件:行 / 问题 / 面 / 严重度(高/中/低) / 置信度(高/中/低，因为后续有独立 codex reviewer 钟馗逐条核，你诚实标注帮他聚焦) / 是【真实可利用】还是【理论/纵深】/ 最小修复建议。
③ 按"该立刻修"排序。
④ 顶部给一句净结论：本轮代码是【可放行】还是【有阻塞项必须先修】，以及阻塞项编号。
只综合这些输入 + 真读到的代码，不要新编、不要把猜测当事实。

${sections}`,
  { label: 'synthesize' },
)

return { surfaces: SURFACES.map((s) => s.key), synthesis }
