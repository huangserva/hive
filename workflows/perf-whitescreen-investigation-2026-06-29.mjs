// 固定工作流(Opus 编排,andy 在 claude-workflow 黑盒里用 Workflow 工具执行)。
// 目的:对 HippoTeam 自身两个反复治不好的体验 bug 做【对抗式/证据式】深度调查——只调查不改代码,给硬结论。
//   事项1:终端打字回显卡(有时 5 秒)。事项2:运行到一半整页白屏。
// 范式:fan-out(4 面并行,各读对应真文件,对抗式不信"已修复"声称) → synthesize(净结论 + 真瓶颈 + 最小治本方向)。
// 关键前置事实(写进每个 surface,省得 andy 重走弯路):
//   - 跑着的后台已是最新代码 a4765e7,echo 惰性解析修复 ee65916 已生效,但 user 实测【只稍好,仍卡】→ per-chunk 双重解析不是根因,根在别处。
//   - user 关键线索:【脱离 hive、在别的软件/裸终端打字很快】→ 瓶颈在 hive 自己的 输入→回显 管线,不在底层 CLI / 机器。
//   - 现挂 ~10 个 worker 子进程(claude/codex/opencode)并发多路 PTY 输出。
// 运行:派 andy → "跑工作流 perf-whitescreen-investigation-2026-06-29"
export const meta = {
  name: 'perf-whitescreen-investigation-2026-06-29',
  description: 'HippoTeam 回显卡顿 + 运行期白屏 两件事的对抗式证据调查(4 面并行深读真代码 → 真瓶颈定位 + 最小治本方向)',
  phases: [
    { title: 'Investigate', detail: '4 面并行:输入路径 / 输出背压 / 前端渲染 / 白屏崩源' },
    { title: 'Synthesize', detail: '净结论 + 真瓶颈排序 + 最小治本方向' },
  ],
}

const FACTS = `【前置事实·别重走】跑着的后台=最新代码 a4765e7,echo 惰性解析修复 ee65916 已生效但 user 实测只稍好仍卡(5秒级)→ per-chunk 双重解析不是根因。user 关键线索:脱离 hive 在裸终端打字很快 → 瓶颈在 hive 自身 输入→回显 管线(keystroke → WebSocket → pty stdin → pty data → server 中转 → WebSocket → xterm 渲染),不在 CLI/机器。现挂约 10 个 worker 并发多路 PTY 输出。`

const COMMON = `只读不改,必须真 ls/grep/read 仓库真文件再下结论,别凭文件名猜,别信注释/commit 里"已修复/已根治"的声称,对抗式亲自读代码验。逐条输出:文件:行 + 问题 + 触发条件 + 这条是不是真瓶颈(是/可能/否) + 证据强度(高=读到真代码确信/中=需复核/低=推测) + 最小治本建议。找不到就如实说"这块没发现问题"。中文。`

const SURFACES = [
  {
    key: 'input-path-eventloop-block',
    prompt: `【事项1·回显卡·输入侧+事件循环阻塞】对抗式查:从 keystroke 到写进 pty stdin 这条路上,主事件循环是否被某条【同步重活】阻塞,导致回显被拖几秒。重点怀疑:大块 PTY 输出的同步解析、sqlite 同步写(better-sqlite3 是同步的!热路径上有没有在每条 PTY data / 每次派单时同步写库)、chokidar 文件监听回调里的同步重活、帧海(.hive/reports 下 167 文件)。读真文件:src/server/worker-output-tracker.ts、agent-manager*.ts、terminal-stream-hub.ts、键入→pty.write 的 handler(WebSocket message → pty stdin)、tasks-file-watcher.ts 及 chokidar 监听范围、任何在 pty data 回调里同步 sqlite write 的地方。必须回答:主线程有没有被同步 IO/CPU 周期性阻塞、最可疑的那段是谁、能否 instrument 计时坐实。${FACTS} ${COMMON}`,
  },
  {
    key: 'output-backpressure-ws',
    prompt: `【事项1·回显卡·输出背压】对抗式查:~10 个 worker 海量 PTY 输出经同一条/同一批 WebSocket 灌给前端时,是否产生 backpressure 把"回显"这种小消息挤到队列后面延迟几秒;以及 terminal-stream-hub 每-chunk mirror.write 在有 viewer attached 时是否仍是放大器、ws.send 是否无界缓冲/无合批/无节流。读真文件:src/server/terminal-stream-hub.ts(mirror.write、每-chunk 路径、viewer attach 逻辑)、WebSocket 广播/单播实现、ws backpressure(bufferedAmount 有没有被看)、是否对高频 PTY 输出做了 coalesce/throttle/分帧。必须回答:回显延迟是不是输出洪流把 WS 写队列灌满导致、有没有优先级/分流、最小治本方向(如输出合批+背压感知+输入旁路)。${FACTS} ${COMMON}`,
  },
  {
    key: 'frontend-xterm-render',
    prompt: `【事项1·回显卡·前端渲染侧】对抗式查 web 端 xterm 渲染与流控:WebGL addon 是否真启用/降级到 canvas、pending-output-buffer 的批处理与 ack 流控是否反而引入延迟、control-frame 校验/解析在主线程是否阻塞、收到回显字节到真正 paint 之间有没有人为节流/requestAnimationFrame 积压。读真文件:web/src/terminal/*(xterm 初始化、WebGL/canvas addon、pending-output-buffer、terminal-control-frame、ack 流控、resize 处理)、终端 WebSocket 客户端接收路径。必须回答:前端从收字节到上屏哪一段最慢、是不是流控/批处理把回显压后、WebGL 没生效导致 canvas 慢的可能。${FACTS} ${COMMON}`,
  },
  {
    key: 'whitescreen-react-crash',
    prompt: `【事项2·运行到一半白屏】对抗式查:UI 跑着跑着整页变白=React 树在运行期抛未捕获异常崩了。找运行期什么坏 payload / 坏 control 帧 / 渲染期硬访问(读 undefined 的属性、map 一个非数组、normalize 没兜住的 WS 消息)把树打崩,以及 ErrorBoundary 为什么没兜住或兜住后整页空白。读真文件:web/src/ui/ErrorBoundary.tsx(覆盖范围、fallback 是否整页空、有没有 reset)、cockpit/cockpit-normalize.ts、terminal/terminal-control-frame.ts、terminal/pending-output-buffer.ts、WebSocket payload 进来后的 normalize/解析入口、cockpit 与 terminal 的渲染顶层。必须回答:最可能的崩源(按概率排序+触发条件)、ErrorBoundary 的覆盖盲区(是不是只包了一部分树/event handler 与 async 抛错它根本兜不住)、最小加固方向(顶层兜底 + payload 防御性 normalize + 坏帧丢弃)。${FACTS} ${COMMON}`,
  },
]

log('perf-whitescreen-investigation-0629 启动:4 面并行对抗式调查 回显卡 + 运行期白屏')

phase('Investigate')
const reviews = await parallel(
  SURFACES.map((s) => () => agent(s.prompt, { label: `probe:${s.key}` })),
)

phase('Synthesize')
const sections = reviews
  .map((r, i) => (r ? `### 面:${SURFACES[i].key}\n${r}` : `### 面:${SURFACES[i].key}\n(该调查员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 4 个调查员对 HippoTeam 两个体验 bug 的对抗式调查。综合成一份给 PM 的硬结论:
① 事项1(回显卡):明确指出【真正的瓶颈在哪一段】(输入侧事件循环阻塞 / 输出背压 / 前端渲染,三选一或组合),按"最可能是主因"排序,每条标证据强度。给最小治本方向——别又一个点修,要对准结构性根因(user 已被"治本"骗过一次,不许和稀泥)。
② 事项2(白屏):最可能的崩源排序 + ErrorBoundary 盲区 + 最小加固方向。
③ 顶部给净结论:这两个 bug 各自能不能现在就定位到根、还是需要先 instrument 抓现行才能坐实;诚实标注哪些是"读到真代码确信"哪些是"推测待验"。
只综合这些输入 + 真读到的代码,不要新编、不要把猜测当事实。

${sections}`,
  { label: 'synthesize' },
)

return { surfaces: SURFACES.map((s) => s.key), synthesis }
