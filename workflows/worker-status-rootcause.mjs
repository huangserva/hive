// 固定工作流脚本（Opus 编排者设计，andy 在 GLM 上执行）。
// 目的：彻底根因 "worker 状态显示与真实状态脱节"（假忙 / 假idle 反复复发）问题。
// 范式：fan-out（4 角度并行深挖真相源 + 所有脱节路径 + 历史返工）→ synthesize（综合出根因 + 架构级彻底修复）。
// 控制流写死在此脚本，模型只在每个 agent() 叶子被调用。运行：Workflow({ scriptPath: '<abs>/workflows/worker-status-rootcause.mjs' })
export const meta = {
  name: 'worker-status-rootcause',
  description: '彻底根因 worker 状态显示与真实状态脱节（假忙/假idle 反复复发）：4 角度并行深挖真相源/计数生命周期/脱节路径/历史返工 → 综合出根因 + 架构级彻底修复方案',
  phases: [
    { title: 'Investigate', detail: '4 角度并行深挖' },
    { title: 'Synthesize', detail: '综合根因 + 彻底修复方案' },
  ],
}

const ANGLES = [
  {
    key: 'status-truth',
    prompt: `你是状态机考古员。彻底查清 HippoTeam 里 worker 的"运行中/空闲/停止"状态【真相源在哪】——是存下来的还是算出来的？谁说了算？读真文件：src/server/agent-runtime.ts、src/server/agent-runtime-stop-run.ts、src/server/runtime-store.ts、src/server/runtime-store-helpers.ts、src/server/agent-manager-support.ts、以及 worker snapshot / summary / AgentSummary 的构造处。逐条列出【每一处读取/写入/派生 worker status 的代码点】：文件:行 + 它依据什么置状态（PTY 事件？agent_runs 表？内存字段？）。重点回答：有没有【多个互不一致的真相源】？只读不改，基于真读到的代码，别猜。`,
  },
  {
    key: 'pendingcount',
    prompt: `你是计数器追踪员。追踪 worker 的 pendingTaskCount / pending_task_count 的【完整生命周期】：每一处 ++ / -- / 置零在哪（文件:行），各自被什么事件触发（dispatch 注入 / report / cancel / crash / restart / markAgentStarted）。重点找出【会让计数与"ledger 里真实 open dispatch 数"脱节】的所有路径——尤其：① 直接改 DB dispatch 状态（绕过内存计数）② worker crash 时没递减 ③ compact ④ cancel 路径 ⑤ markAgentStarted 重置。读真文件：src/server/runtime-store-helpers.ts、src/server/agent-runtime.ts、src/server/dispatch-ledger-store.ts、src/server/team-operations.ts、src/server/agent-stdin-dispatcher.ts。只读不改，基于真代码，别猜。`,
  },
  {
    key: 'desync-paths',
    prompt: `你是脱节路径侦探。穷举【显示状态 ≠ 真实状态】的所有具体路径。定义真实状态 = (PTY/子进程是否真活 + dispatch ledger 里是否有该 worker 的 open dispatch + agent_run 是否 active)。对每一条脱节路径给：触发条件 + 为什么显示会错（显示偏哪边）+ 文件:行。已知至少存在这几类，请验证并补全：① 直接 SQL 改 dispatch 状态绕过内存计数 → worker 显示 working/pending>0 但其实无真任务（"假忙"）② compact 后 worker 仍显 working ③ "假idle"（reconcile 前缓存 stale，见 git commit e924dd6）④ worker crash/error 退出但状态没收敛。读真文件：src/server/agent-runtime.ts、src/server/agent-manager-support.ts、src/server/agent-stdin-dispatcher.ts、以及前端 reconcileWorkerRuntimeStatuses 相关。只读不改，基于真代码。`,
  },
  {
    key: 'past-fixes',
    prompt: `你是返工审计员。HippoTeam 为 worker 状态问题已经修过多次。用 git log / git show 读这些历史修复（至少：commit e924dd6 "假idle 前端 reconcile"、5527a8a 与 cc52a87 "markAgentStarted 归 idle / 不丢排队 dispatch"，可再 git log --oneline 搜 worker status / idle / reconcile 找更多）。逐个评估：每个修的是【症状还是根因】？为什么 worker 状态问题【反复复发】？明确指出【架构级的根本缺陷】——例如状态存在多个不统一的真相源（内存字段 vs agent_runs 表 vs 真实进程 vs dispatch ledger），缺一个从真实信号统一 reconcile 的单一权威。基于真读到的代码 + git 历史，别猜。`,
  },
]

log('worker-status-rootcause 启动：4 角度并行深挖 worker 状态脱节根因')

phase('Investigate')
const investigations = await parallel(
  ANGLES.map((angle) => () => agent(angle.prompt, { label: `investigate:${angle.key}` })),
)

phase('Synthesize')
const sections = investigations
  .map((r, i) => (r ? `### 角度：${ANGLES[i].key}\n${r}` : null))
  .filter(Boolean)
  .join('\n\n')

const synthesis = await agent(
  `下面是 4 个角度对"worker 状态显示与真实脱节（假忙/假idle 反复复发）"的独立深挖。请综合成一份给 PM 看的【根因 + 彻底修复】报告：
① 【根本原因】：为什么这个问题反复复发、架构缺陷到底是什么——是不是缺一个从真实信号（子进程是否存活 + ledger 是否有 open dispatch + run 是否 active）统一 reconcile 的【单一权威真相源】，而现在内存字段/agent_runs/真实进程/ledger 各说各话？
② 【所有脱节路径清单】（去重，每条带 文件:行 + 触发条件）。
③ 【彻底修复方案】：不是再打一个症状补丁。给出单一真相源 + 周期性/事件驱动 reconcile 的设计，必须覆盖 SQL绕过/crash/compact/cancel/markAgentStarted 全部已发现路径；说明每条脱节路径在新方案下如何被收敛。
④ 和在途 M45 compact-recovery 看门狗如何协同（别重复造、明确边界）。
⑤ 实施优先级（哪条是必须先堵的命门）。
只综合下面这些输入 + 真读到的代码，不要新编。

${sections}`,
  { label: 'synthesize' },
)

return { angles: ANGLES.map((a) => a.key), synthesis }
