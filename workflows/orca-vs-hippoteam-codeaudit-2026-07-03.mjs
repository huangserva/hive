// 固定工作流(Opus 编排,andy 在 claude-workflow 黑盒里用 Workflow 工具执行)。
// 目的:对 Orca(stablyai/orca) vs HippoTeam(hive-serva) 做【代码级审计对比】——不是读 README,
//   是 grep/read 两边真源码,拿 file:证据说话。user 明确判"只读 README 的比较是片面的",要求认真审代码。
// 范式:6 面并行(每面一个维度,同一 agent 读【两边真代码】做代码级对比) → Synthesize(诚实硬结论 +
//   代码级借鉴候选 + 我们护城河 + 【代码审计比 README 版多看出/纠正了什么】)。
// 两个代码库(都在本地,子 agent 直接 Read/Grep,别用 WebFetch 逐文件):
//   - Orca:   /Users/huangzongning/development/orca-compare      (浅克隆,src ~16 万行 TS/TSX,Electron)
//   - HippoTeam: /Users/huangzongning/development/hive-serva     (本仓库)
// 运行:派 andy → "跑工作流, file=workflows/orca-vs-hippoteam-codeaudit-2026-07-03.mjs"
export const meta = {
  name: 'orca-vs-hippoteam-codeaudit-2026-07-03',
  description: 'Orca vs HippoTeam 代码级审计对比(6 面并行读两边真源码拿 file 证据 → 硬结论 + 代码级借鉴候选 + 护城河 + 纠正 README 版片面处)',
  phases: [
    { title: 'Audit', detail: '6 面并行:编排模型/终端/移动端远控/配额账号/代码平台集成/治理与状态模型' },
    { title: 'Synthesize', detail: '代码级硬结论 + 借鉴候选(带证据) + 护城河 + README 版的片面/错误纠正' },
  ],
}

const ORCA = '/Users/huangzongning/development/orca-compare'
const HIPPO = '/Users/huangzongning/development/hive-serva'

const ORCA_MAP = `Orca 代码地图(省你摸底,但要亲自 Read 验):Electron app(electron.vite.config.ts)。src/main(后端 ~1500 文件):runtime/orchestration(多agent编排)、git、worktree 相关、codex-accounts/claude-accounts + codex-usage/claude-usage/opencode-usage(配额账号)、github/gitlab/gitea、browser、agent-hooks。src/renderer(前端 ~3582 文件):components/terminal-pane、browser-pane、diff-comments、worktree-creation、agent、mobile、feature-wall/agents-orchestration。src/cli(Orca CLI 105 文件)、src/relay(101 文件)、src/shared(537)。mobile/(Expo RN app)。技术栈:electron42 + react19 + node-pty + ws + zod4。`

const HIPPO_MAP = `HippoTeam 代码地图:Web app(浏览器 + 本地 Node,绑 127.0.0.1),非 Electron。src/server(后端脊柱):team-operations.ts(派单/汇报/cancel/accept)、dispatch-ledger-store.ts(dispatch 账本)、hive-team-guidance.ts(ORCHESTRATOR_RULES/WORKER_RULES 提示词)、agent-manager.ts + role-templates.ts(worker spawn/preset)、terminal-stream-hub.ts + worker-output-tracker.ts(PTY 输出)、relay-connector.ts + relay-rpc-handler.ts(外网 relay 隧道)、routes-mobile.ts、webrtc-*.ts + fast-voice-reply.ts + local-stt/local-tts(语音)、sentinel-heartbeat.ts + stalled-dispatch-*(卡死探测)、pm-*.ts + cockpit-doc.ts(.hive 文档解析)、sqlite-schema*.ts(better-sqlite3)。web/src(前端):terminal/*、cockpit/*。packages/mobile(Expo RN app)。packages/relay(DMIT 中继服务器)。.hive/(治理文档:plan/tasks/decisions/baseline/open-questions/ideas)。preset=claude/codex/opencode/gemini 4 种。`

const COMMON = `【铁律】这是代码级审计,不是读 README。必须真 ls/grep/read 【两个仓库】的真源码(路径见下)再下结论,每个论断带 file:行 证据。禁止复述 README 声称、禁止凭目录名猜实现。逐项输出:① Orca 这块【怎么实现的】(file:行 + 关键机制,读到真代码)② HippoTeam 这块【怎么实现的】(file:行)③ 代码级差异 + 谁更强 + 为什么(拿实现依据,不是感觉)④ 值得我们借鉴的【具体代码级点】(不是"抄配额功能"这种空话,要说清它代码里怎么做、我们接在哪)⑤ 证据强度(高=读到真实现/中=部分/低=推测)。找不到就如实说"这块没读到"。中文。Orca=${ORCA}  HippoTeam=${HIPPO}`

const DIMENSIONS = [
  {
    key: 'orchestration-model',
    prompt: `【维度1·多 agent 编排模型】代码级审计两边【怎么组织多个 agent】。Orca:读 ${ORCA}/src/main/runtime/orchestration/**、${ORCA}/src/renderer/src/components/feature-wall/agents-orchestration/**、agent 相关 main 代码——它的"一个 prompt 撒多 agent、各 worktree、对比择优"在代码里到底怎么实现的?有没有调度器/状态机/任务分发?agent 之间隔离与结果合并的真实机制?HippoTeam:读 ${HIPPO}/src/server/team-operations.ts、dispatch-ledger-store.ts、hive-team-guidance.ts、agent-manager.ts、role-templates.ts——我们的派单账本 + 角色路由 + 实现→审→修环怎么实现。核心对比:Orca 的 best-of-N 并行 vs 我们的角色分工串行审查,两种编排哲学在代码结构上的根本差异 + 各自适合什么。${ORCA_MAP} ${HIPPO_MAP} ${COMMON}`,
  },
  {
    key: 'worktree-terminal',
    prompt: `【维度2·worktree 隔离 + 终端渲染】代码级审计。worktree:Orca 读 ${ORCA}/src/renderer/src/components/worktree-creation/**、${ORCA}/src/main/git/** 及 worktree 相关 main——它把 worktree 做成一等公民的真实实现(创建/切换/清理/与 agent 绑定)。HippoTeam:grep ${HIPPO}/src/server 里 worktree/HIVE_WORKER_WORKTREES 相关(M32)——我们的 worktree 是隔离层还是中心模型,代码上差多少。终端:Orca 读 ${ORCA}/src/renderer/src/components/terminal-pane/** + terminal 相关 main;HippoTeam 读 ${HIPPO}/src/server/terminal-stream-hub.ts、worker-output-tracker.ts、${HIPPO}/web/src/terminal/**——两边 node-pty + xterm + WebGL 的真实差异(分屏/滚动持久化/背压/多路输出),谁的终端工程更扎实,代码依据。${ORCA_MAP} ${HIPPO_MAP} ${COMMON}`,
  },
  {
    key: 'mobile-remote-voice',
    prompt: `【维度3·移动端 + 远控 + 语音】代码级审计。Orca:读 ${ORCA}/mobile/**、${ORCA}/src/relay/**——它的移动 companion 怎么连、relay 怎么做、有没有语音/审批/媒体收发。HippoTeam:读 ${HIPPO}/packages/mobile/**(关键部分)、${HIPPO}/src/server/relay-connector.ts、relay-rpc-handler.ts、routes-mobile.ts、webrtc-*.ts、fast-voice-reply.ts、local-stt*、local-tts*——我们的 WebRTC 语音通话(barge-in)+ GLM 前台 + 飞书审批卡 + 媒体走 relay。核心:两边远控架构(Orca relay vs 我们 daemon 出站隧道 + E2EE)代码级对比;确认 Orca 语音/审批到底有没有(读代码证伪,别信 README 说"有通知"就当"有语音")。谁的远控更深,代码依据。${ORCA_MAP} ${HIPPO_MAP} ${COMMON}`,
  },
  {
    key: 'quota-account',
    prompt: `【维度4·配额/账号管理·user 痛点重点】代码级审计——这是 user 明确关心的(付最贵一档还为 Codex 额度精打细算)。Orca:精读 ${ORCA}/src/main/codex-usage/**、claude-usage/**、opencode-usage/**、codex-accounts/**、claude-accounts/**——它【代码里到底怎么读各家用量/配额】(调什么 API/读什么本地文件/session 记录?)、怎么做账号热切换(多账号存哪、切换时改什么 env/token)、用量怎么展示。这是能不能借鉴的关键:把它的真实数据来源和机制挖出来。HippoTeam:确认我们【完全没有】这块(grep 证实无 usage/quota/account 管理),评估借鉴它到我们(接在哪:agent-manager spawn env? 新面板? per-provider)。要能落地的代码级方案雏形,不是"我们该做配额管理"空话。${ORCA_MAP} ${HIPPO_MAP} ${COMMON}`,
  },
  {
    key: 'codeplatform-diff',
    prompt: `【维度5·代码平台集成 + diff 标注反馈】代码级审计。Orca:读 ${ORCA}/src/main/github/**、gitlab/**、gitea/**、${ORCA}/src/renderer/src/components/diff-comments/**、github-project/**——它怎么在应用内浏览 PR/issue、怎么把 diff 行级评论送回 agent 迭代(diff-comments 的真实数据流:评论→prompt→agent)。HippoTeam:我们这块薄——grep 确认有没有 github/PR 集成、我们的 reviewer 反馈(钟馗审)现在怎么回给 coder(team report → orch → team send 再派,是不是整段而非行级)。核心借鉴评估:diff 行级标注反馈的代码机制,能不能接进我们"实现→钟馗审→修"环把反馈粒度降到行级。${ORCA_MAP} ${HIPPO_MAP} ${COMMON}`,
  },
  {
    key: 'governance-state',
    prompt: `【维度6·治理/协作机制 + 数据状态模型·我们的护城河,代码级证伪】代码级审计。HippoTeam 护城河:读 ${HIPPO}/src/server/pm-*.ts、cockpit-doc.ts、team-operations.ts 里 accept-gate(HIVE_ACCEPT_GATE)、dispatch-ledger-store.ts、sentinel-heartbeat.ts、stalled-dispatch-*、${HIPPO}/.hive/(plan/tasks/decisions/baseline)——我们的 PM 文档治理 + 审查闸门 + 卡死探测 + dispatch 账本的真实实现。Orca:在 ${ORCA} 里【grep 证伪】它有没有任何对标的治理/协作/审查闸门/PM 层/dispatch 账本(读 src/main、src/shared、看它数据怎么存——有没有类似 sqlite dispatch ledger?还是纯 IDE 无协作治理)。核心:代码级坐实"Orca 是单人 IDE、无团队治理" vs "HippoTeam 有 PM 治理内核"这个判断到底成不成立,还是 Orca 其实也有我漏看的协作机制。数据存储对比:Orca 用什么持久化 vs 我们 better-sqlite3(${HIPPO}/src/server/sqlite-schema*.ts)。${ORCA_MAP} ${HIPPO_MAP} ${COMMON}`,
  },
]

log('orca-vs-hippoteam-codeaudit-0703 启动:6 面并行代码级审计(读两边真源码拿 file 证据) → 综合')

phase('Audit')
const audits = await parallel(
  DIMENSIONS.map((d) => () => agent(d.prompt, { label: `audit:${d.key}`, phase: 'Audit' })),
)

phase('Synthesize')
const sections = audits
  .map((r, i) => (r ? `### 维度:${DIMENSIONS[i].key}\n${r}` : `### 维度:${DIMENSIONS[i].key}\n(该审计员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 6 个审计员对 Orca vs HippoTeam 的【代码级】审计(都读了两边真源码)。综合成一份给 PM 的硬结论,要求:
① 顶部净结论:两者到底是不是同类、各自内核是什么——用【代码级证据】说,不是 README 叙事。
② 【代码审计比只读 README 的版本多看出/纠正了什么】——这是 user 的核心诉求(他判 README 版片面)。明确列:哪些 README 说得含糊/夸大、哪些是读代码才发现的真实机制或真实差距、哪些 README 版的结论被代码推翻或深化。
③ 借鉴候选排序:每条带【代码级证据 + 具体落地点】(Orca 代码里怎么做的 file:行 + 我们接在哪),不要空话。配额/账号那条是 user 痛点,重点给能落地的方案雏形。
④ 我们的护城河:代码级坐实哪些 Orca 真没有(治理/审查闸门/语音/审批),哪些其实它也有我们该警惕。
⑤ 诚实标注证据强度,读到真代码的和推测的分开;哪些维度审得深、哪些没读透。
只综合这些代码级输入,不要新编、不要退回 README 叙事。中文。

${sections}`,
  { label: 'synthesize', phase: 'Synthesize' },
)

return { dimensions: DIMENSIONS.map((d) => d.key), synthesis }
