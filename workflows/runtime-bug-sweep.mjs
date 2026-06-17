// 固定工作流脚本（Opus 编排者设计，andy 在 GLM 上执行）。
// 目的：在 HippoTeam runtime/dispatch/agent-lifecycle 脊柱上做一次 bug 普查，
//      专挖本会话已证实存在的几类病：真相源漂移 / 静默吞错 / 并发竞态 / 资源泄漏。
// 范式：fan-out（4 个猎手并行，各扫一类反模式，真读 src/server 代码）→ synthesize（去重 + 按严重度 + 真假可利用性排序）。
// 控制流写死，模型只在 agent() 叶子被调用。运行：Workflow({ scriptPath: '<abs>/workflows/runtime-bug-sweep.mjs' })
export const meta = {
  name: 'runtime-bug-sweep',
  description: '在 runtime/dispatch/agent-lifecycle 脊柱上做 bug 普查：4 类反模式（真相源漂移/静默吞错/并发竞态/资源泄漏）并行挖 → 综合成按严重度排序的优先级清单',
  phases: [
    { title: 'Hunt', detail: '4 类反模式并行挖' },
    { title: 'Synthesize', detail: '去重 + 按严重度/可利用性排序' },
  ],
}

const HUNTERS = [
  {
    key: 'truth-drift',
    prompt: `你是"真相源漂移"猎手。本仓库刚根因过一个大 bug：worker 状态曾是内存可变字段、与 ledger/进程态等多个真相源运行期无对账（已修）。现在去 src/server 里找【其它同类】：某个状态/计数/缓存有【多个真相源】或【存了又派生】、运行期不对账、靠单点事件维护、漏一处就漂移。重点扫：dispatch ledger 与内存、relay/feishu/mobile 连接态、approval/审批态、session/run 计数、各种 Map 缓存与 DB 的一致性。逐条输出：文件:行 + 哪几个源 + 怎么漂移 + 后果。只读不改，基于真读到的代码，别猜，别复述已修的 worker-status。`,
  },
  {
    key: 'silent-swallow',
    prompt: `你是"静默吞错"猎手。本仓库刚发现 onAgentExit 被 try/catch 静默吞错导致状态不收敛。去 src/server 里找【其它危险的吞错】：try/catch 吞掉异常后不 log 不上报不补救、catch 空块、Promise 没 .catch、await 失败被忽略、降级 fallback 掩盖真失败让上层以为成功。重点：发消息/派单/审批/连接/持久化这些命门路径上的吞错（吞了会让 user 以为成功其实没成）。逐条输出：文件:行 + 吞了什么 + 什么场景会害人。只读不改，基于真代码。`,
  },
  {
    key: 'concurrency-race',
    prompt: `你是"并发竞态"猎手。本仓库刚发现两类竞态：① DB 写与内存写非原子（ledger 先 commit、内存后改，中间崩就漂移）② 启动中窗口（run 还没注册进 registry 时被其它逻辑误判）。去 src/server 里找【其它竞态】：DB+内存双写非原子、事件乱序到达（onError/onExit、dispatch/report 交叉）、await 之间的状态窗口、检查-然后-使用（TOCTOU）、多 worker 并发改同一状态。重点 dispatch 生命周期、PTY 启停、relay 重连、approval。逐条输出：文件:行 + 触发时序 + 后果。只读不改，基于真代码。`,
  },
  {
    key: 'resource-leak',
    prompt: `你是"资源泄漏"猎手。本仓库踩过 ENFILE（递归 watch 帧海耗尽 fd）+ removeRun/stopRun 不配对留僵尸 PTY。去 src/server 里找【其它泄漏】：PTY/子进程没在所有退出路径 kill、setInterval/setTimeout 没 clear、chokidar/EventEmitter listener 没 remove、文件句柄/流没关、Map/Set/registry 只增不删（run/dispatch/session/connection 累积）、WebSocket 没清理。重点 agent-manager / sentinel / relay / watcher。逐条输出：文件:行 + 泄漏什么 + 什么情况累积。只读不改，基于真代码。`,
  },
]

log('runtime-bug-sweep 启动：4 类反模式并行挖 runtime 脊柱')

phase('Hunt')
const hunts = await parallel(
  HUNTERS.map((h) => () => agent(h.prompt, { label: `hunt:${h.key}` })),
)

phase('Synthesize')
const sections = hunts
  .map((r, i) => (r ? `### 猎手：${HUNTERS[i].key}\n${r}` : null))
  .filter(Boolean)
  .join('\n\n')

const synthesis = await agent(
  `下面是 4 个猎手在 runtime 脊柱上挖的 bug（真相源漂移 / 静默吞错 / 并发竞态 / 资源泄漏）。综合成一份给 PM 的优先级清单：
① 去重（同一处被多猎手命中的合并）。
② 每条标：文件:行 / 问题 / 类别 / 严重度(高/中/低) / 是【真实可利用】还是【理论/纵深】/ 最小修复建议。
③ 按"该立刻修"排序，并明确标出你对每条的【置信度】(高=确信读到真代码、中=需复核、低=可能假阳性)——因为后续会有独立 codex reviewer 逐条核，你诚实标注能帮他聚焦。
④ 若发现与刚修的 worker-status reconcile 同源/同类的问题，单独点出。
只综合这些输入 + 真读到的代码，不要新编、不要把猜测当事实。

${sections}`,
  { label: 'synthesize' },
)

return { hunters: HUNTERS.map((h) => h.key), synthesis }
