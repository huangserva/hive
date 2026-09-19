// 固定工作流(Opus 编排,andy 在 claude-workflow 黑盒里用 Workflow 工具执行)。
// 目的:对【用一段时间后整页白屏】做【修复后复查】——不是重跑修复前的旧调查,而是核实
//   "白屏相关修复已落库"之后,这个问题是否还有活路径、残留风险在哪、怎么坐实。
// 范式:Map(摸清现在仓库里真实存在的修复) → Re-investigate(4 面并行对抗式找残留活路径)
//   → Synthesize(硬结论 + 残留风险排序 + 可复现/埋点方案)。
// 关键前置事实(写进每个 surface,省得 andy 重走弯路):
//   - 这是【复查】不是首查。近期已 ship 的相关修复(需各 agent 亲自读真代码核实是否真在 HEAD):
//     ① 回显卡真根治:extractLastPtyLine 改有界 16KB 尾窗 + 80 列可见行状态机(worker-output-tracker.ts,
//        41f5e1c/40930f1/169056c),治"全量扫 1MB×10worker×每500ms 独占事件循环"。
//     ② 白屏前端加固:顶层 + cockpit/terminal 局部 ErrorBoundary、WS payload 运行时 normalize、
//        terminal pendingOutput 缓冲上限(马超那批,需核实是否真提交进 HEAD、还是仍在工作树/未落库)。
//   - user 实测体感:跑【一段时间】后才白屏(不是一上来就白)→ 怀疑方向=随时间累积的东西
//     (累积输出、内存增长、重连风暴、长期运行才触发的脏 state)。
//   - 现挂约 10 个 worker 子进程(claude/codex/opencode)并发多路 PTY 输出。
//   - 后端 better-sqlite3 是同步的;前端 React 19 + xterm + WebGL。
// 运行:派 andy → "跑工作流, file=workflows/whitescreen-reverify-2026-06-30.mjs"
export const meta = {
  name: 'whitescreen-reverify-2026-06-30',
  description: '用一段时间后整页白屏 的修复后复查(先摸清已落库修复 → 4 面并行找残留活路径 → 硬结论 + 可复现/埋点方案)',
  phases: [
    { title: 'Map', detail: '摸清 HEAD 里真实存在的白屏相关修复(别信 commit 声称,亲读)' },
    { title: 'Reinvestigate', detail: '4 面并行:事件循环冻结残留 / React 崩残留 / 无界增长泄漏 / 重连恢复风暴' },
    { title: 'Synthesize', detail: '硬结论 + 残留风险排序 + 可复现/埋点方案' },
  ],
}

const COMMON = `只读不改,必须真 ls/grep/read 仓库真文件再下结论,别凭文件名猜,别信注释/commit 里"已修复/已根治"的声称,对抗式亲自读代码验。逐条输出:文件:行 + 问题/结论 + 触发条件 + 这条是不是"用一段时间后白屏"的活路径(是/可能/否) + 证据强度(高=读到真代码确信/中=需复核/低=推测) + 最小治本或验证建议。找不到就如实说"这块没发现活路径"。中文。`

// Map 阶段先产出"现在 HEAD 真实存在哪些修复"的事实底座,后续 4 面都吃这个,避免各自重复摸底/各说各话。
const MAP_PROMPT = `【Map·摸清现状底座】这是【白屏修复后复查】的第一步。先 git log --oneline -15 + git status 看清当前 HEAD 和工作树,然后亲自读真代码,产出一份"现在仓库里到底落了哪些白屏相关修复"的事实清单(不是声称、是你读到的真代码)。必须覆盖并逐项给 文件:行 + 在/不在 + 形态:
1. 回显卡修复:src/server/worker-output-tracker.ts 的 extractLastPtyLine 是否真是有界尾窗(16KB)+ 可见行状态机?还有没有别处对累积 rawOutput 做 O(N) 全量扫?MAX_RUN_OUTPUT_LENGTH 是多少、rawOutput 怎么累积/截断?
2. 顶层 ErrorBoundary:web 入口(web/src/main.tsx 或等价)最外层有没有 ErrorBoundary?cockpit、terminal 各自有没有局部 ErrorBoundary?fallback 是整页空白还是可恢复面板?有没有 reset/重连?——逐个文件:行坐实,别假设马超那批已提交,核实它到底在 HEAD 还是仍躺工作树/根本没落库。
3. WS payload normalize:cockpit-normalize 之类对 WS 消息的运行时校验/兜底缺字段,是只兜顶层还是深层硬访问都兜了?
4. terminal 缓冲上限:pending-output-buffer 有没有字节/条数上限、restore 超时降级、ack 流控?
输出这份底座清单即可,先不下"还会不会白屏"的结论(那是后面 4 面的事)。${COMMON}`

const SURFACES = [
  {
    key: 'eventloop-freeze-residual',
    prompt: `【复查·事件循环冻结残留】回显卡的 16KB 尾窗已修了 extractLastPtyLine,但"用一段时间后白屏"很可能是主线程被周期性同步重活冻死的表象(冻结期间 WS 不收不发、看着像白/卡死)。对抗式查:HEAD 里【还有没有别的】同步重活在热路径上随时间/规模放大?重点:① 别处对累积 PTY 输出/大字符串的同步全量处理(不只 extractLastPtyLine);② better-sqlite3 同步写是否落在每条 PTY data / 每次派单 / 每次轮询的热路径上,累积久了变慢;③ chokidar 监听回调里的同步重活、.hive 下文件数增长(reports/research 已 139/134)导致的监听/读放大;④ team-list 轮询(每500ms)在 ~10 worker 下还有没有别的 O(N) 同步代价。读真文件:worker-output-tracker.ts、terminal-stream-hub.ts、agent-manager*.ts、tasks-file-watcher.ts、team-list 富化路径、任何 pty data 回调里的同步 sqlite write。必须回答:跑一段时间后主线程会不会被周期性冻几秒、最可疑那段是谁、能否 instrument 计时坐实。${COMMON}`,
  },
  {
    key: 'react-crash-residual',
    prompt: `【复查·React 运行期崩残留】顶层/局部 ErrorBoundary 据称已加。对抗式查:① 这些 ErrorBoundary 是否真覆盖了会崩的子树(还是有盲区——event handler 抛错、async/Promise 回调抛错、WS onmessage 回调里抛错,这些 ErrorBoundary 根本兜不住);② fallback 是不是整页空白(那跟白屏没区别),有没有可恢复/重连;③ 跑一段时间后什么"长期才出现"的脏 payload / 增长 state / 重连后 stale snapshot 会触发渲染期硬访问(读 undefined 属性、map 非数组、normalize 没兜的深层字段)把树打崩。读真文件:web 入口 main.tsx、ErrorBoundary 实现、cockpit-normalize、terminal-client/control-frame 的 WS 帧消费、cockpit 与 terminal 渲染顶层、useTasksFile 等 WS 消费 hook。必须回答:用一段时间后最可能的崩源(按概率排序+触发条件)、ErrorBoundary 的真实盲区(尤其 async/event-handler 抛错)、是不是"崩了但 fallback 也是空白"=用户看到的白屏。${COMMON}`,
  },
  {
    key: 'unbounded-growth-leak',
    prompt: `【复查·无界增长/内存泄漏】"用一段时间后"才白屏的经典原因=某东西随时间无界增长,最终 OOM/卡死/渲染崩。对抗式查 HEAD:① 前端有没有无界累积的 buffer/数组/Map(terminal pendingOutput 上限真的生效吗、xterm scrollback、cockpit 历史、WS 消息缓存、未清理的定时器/监听器);② 后端 rawOutput 累积到 MAX_RUN_OUTPUT_LENGTH 的行为(到顶是截断还是持续增长、~10 worker 各一份多大);③ WebSocket bufferedAmount 无界、ws.send 无背压;④ React 组件未清理的 effect/订阅在长时间 + 多次重连后泄漏。读真文件:web/src/terminal/*(pending-output-buffer、xterm 初始化 scrollback、ack 流控)、terminal-stream-hub.ts、worker-output-tracker.ts(累积/截断)、WS 客户端、cockpit 数据 hook。必须回答:有没有"跑越久越大"的东西、上限是否真生效、最可能拖垮页面的那个增长点、能否用内存/计数 instrument 坐实。${COMMON}`,
  },
  {
    key: 'reconnect-restore-storm',
    prompt: `【复查·重连/恢复风暴】长时间运行必然经历 WS 断线重连、后台切回、terminal restore。对抗式查:① 重连后 snapshot/restore 是否一次性灌入巨量积压输出把主线程/xterm 打死(尤其多 worker 同时 restore);② ack 流控在 socket 未 open 时丢 ack 导致服务端背压永久 pause(pending-output-buffer 超 cap 丢弃时 ack 会不会丢);③ 重连风暴(指数退避缺失/无上限重试)把 CPU/WS 打满;④ stale snapshot 覆盖/不覆盖导致的脏 state 渲染崩。读真文件:web/src/terminal/terminal-client.ts(restore/ack/重连)、pending-output-buffer.ts、api.ts 的 WS 重连(connectCockpitStream/connectPlanStream)、useTasksFile、terminal-stream-hub.ts 服务端 restore/背压。必须回答:跑一段时间触发重连/恢复后,会不会一次性洪流冻死或 ack 丢失导致永久背压、最薄弱那条、最小治本方向。${COMMON}`,
  },
]

log('whitescreen-reverify-0630 启动:先摸清已落库修复 → 4 面并行对抗式复查 用一段时间后白屏 是否还有活路径')

phase('Map')
const mapFacts = await agent(MAP_PROMPT, { label: 'map:current-fixes' })

phase('Reinvestigate')
const reviews = await parallel(
  SURFACES.map((s) => () =>
    agent(`${s.prompt}\n\n【现状底座·Map 阶段已读到的真实修复清单,以此为准别重复摸底,但要对抗式复核别全盘照收】\n${mapFacts}`, {
      label: `probe:${s.key}`,
      phase: 'Reinvestigate',
    }),
  ),
)

phase('Synthesize')
const sections = reviews
  .map((r, i) => (r ? `### 面:${SURFACES[i].key}\n${r}` : `### 面:${SURFACES[i].key}\n(该调查员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 1 份现状底座(Map) + 4 个调查员对【用一段时间后整页白屏 修复后是否还有活路径】的对抗式复查。综合成一份给 PM 的硬结论:
① 顶部净结论一句话:白屏相关修复落库后,"用一段时间后白屏"现在【还能不能复发】——彻底堵死 / 还有活路径(列几条) / 无法仅靠读码判定需埋点抓现行。诚实标注哪些"读到真代码确信"、哪些"推测待验",绝不和稀泥(user 被"治本"骗过、明确不许声称根治除非有硬证据)。
② 残留活路径排序:把 4 面找到的"是/可能"路径按"最可能导致白屏"排序,每条标 文件:行 + 触发条件(尤其"跑多久/什么规模才触发")+ 证据强度。
③ ErrorBoundary 真实有效性:顶层/局部到底兜不兜得住,async/event-handler/WS 回调抛错这类盲区还在不在,fallback 是不是也是空白(=对用户没区别)。
④ 可复现 + 埋点方案:给 PM 一份"下次 user 实测时怎么一次性区分 卡(事件循环冻结) vs 白(渲染崩) vs OOM"的具体埋点/观测清单 + 尽量给最小复现配方(如挂满 worker + 大输出 + 强制重连 跑 N 分钟)。
⑤ 如果发现"修复其实没真落库"(还在工作树/没提交),明确点名哪个、风险是什么。
只综合这些输入 + 真读到的代码,不要新编、不要把猜测当事实。中文。

${mapFacts ? `## 现状底座(Map)\n${mapFacts}\n\n` : ''}## 4 面复查\n${sections}`,
  { label: 'synthesize' },
)

return { surfaces: SURFACES.map((s) => s.key), mapFacts, synthesis }
