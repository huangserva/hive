export const meta = {
  name: 'report-delivery-investigation',
  description: 'worker team report 已执行但 orchestrator 收不到回报 — 多角度对抗式查根因（只查不改）',
  whenToUse: 'worker 汇报石沉大海类 bug 的根因定位',
  phases: [
    { title: 'Map', detail: '测绘 report→orch 完整投递链路 + 对照 dispatch→worker 方向（77fbe78 已修）' },
    { title: 'Probe', detail: '6 条失败假设各自深读真码取证' },
    { title: 'Verify', detail: '每条候选根因对抗式验证（默认尝试证伪）' },
    { title: 'Synthesize', detail: 'opus 收敛根因 + 证据 + 推荐修复方向（不实现）' },
    { title: 'Report', detail: '写中文 HTML 报告 + research 索引笔记' },
  ],
}

// ---- 模型策略：claude 全程（user 明确要 claude workflow）。广度用 sonnet，关键推理用 opus ----
const FINDER_MODEL = 'claude-sonnet-4-6'
const JUDGE_MODEL = 'claude-opus-4-8'

const REPO_HINT = `代码仓库就是当前工作目录（HippoTeam / hive-serva）。用 Read/Grep/Bash 读真码。
关键文件锚点（行号可能漂移，按符号搜）：
- src/cli/team.ts: team report CLI 处理（约 929-950 行 POST /api/team/report）+ assertForwardedToOrchestrator（约 130 行）
- src/server/routes-team.ts: /api/team/report 路由
- src/server/team-operations.ts: report 业务逻辑（dispatch 状态机 reported + 注入 orchestrator stdin）
- src/server/agent-stdin-dispatcher.ts: 把系统消息注入目标 agent PTY stdin
- src/server/post-start-input-writer.ts: bracketed-paste 投递 + 就绪态检测（77fbe78 改的核心文件）
- src/server/runtime-store-helpers.ts: writeRunInput（77fbe78 改过 allowExistingPrompt）
- src/server/dispatch-ledger-store.ts: dispatches 表状态机（reported / input_acknowledged_at / input_delivery_failed_at）
- src/server/stalled-dispatch-nudge.ts / stale-dispatch-status.ts: 卡死/未投递 surface 机制
对照基准：git show 77fbe78（派单 dispatch→worker 方向的盲投修复）。本次怀疑同类 bug 在 worker→orchestrator 反方向未修。`

const MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reportPath', 'injectionMechanism', 'sharedWithDispatch', 'files'],
  properties: {
    reportPath: { type: 'string', description: '从 worker 敲 team report 到 orchestrator 收到的完整调用链（按文件:函数串起来）' },
    injectionMechanism: { type: 'string', description: '注入 orchestrator stdin 用什么机制（bracketed-paste? 经过 post-start-input-writer? 有无就绪态 gate?）' },
    sharedWithDispatch: { type: 'string', description: 'report→orch 注入与 dispatch→worker 注入是否共用同一套投递代码；若共用，77fbe78 的修复是否覆盖了 report 方向' },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'role'], properties: { file: { type: 'string' }, role: { type: 'string' } } } },
    forwardedFlagSemantics: { type: 'string', description: 'assertForwardedToOrchestrator 检查 payload 哪个字段；该字段在服务端何时被置 true/false；是否在 stdin 真正落地前就置 true' },
  },
}

const HYP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hypothesis', 'supported', 'confidence', 'failureMode', 'evidence'],
  properties: {
    hypothesis: { type: 'string' },
    supported: { type: 'boolean', description: '真码是否支持该假设' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    failureMode: { type: 'string', description: '具体在什么条件下 orch 收不到（orch 忙/compact/非空闲 prompt/竞态…），一步步说清触发路径' },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'detail'], properties: { file: { type: 'string', description: 'file:line' }, detail: { type: 'string', description: '这段码为什么支持或反驳假设' } } } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hypothesis', 'verdict', 'reasoning'],
  properties: {
    hypothesis: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
    reasoning: { type: 'string', description: '对抗式复核：默认尝试证伪。说清为何 confirm 或 refute，引用具体码点' },
    residualUnknown: { type: 'string', description: '仍需真机/运行期日志才能坐实的部分（若有）' },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'rootCauses'],
  properties: {
    summary: { type: 'string', description: '一段话给 user 的人话结论：orch 为什么收不到 report' },
    rootCauses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'confidence', 'mechanism', 'evidence', 'fixDirection'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          mechanism: { type: 'string', description: '机制级解释，含触发条件' },
          evidence: { type: 'array', items: { type: 'string', description: 'file:line + 一句为什么' } },
          fixDirection: { type: 'string', description: '推荐修复方向（只给方向不写实现）' },
        },
      },
    },
    reproPath: { type: 'string', description: '如何稳定复现（含需要的运行期条件，如 orch 处于 compact 时让 worker report）' },
    instrumentation: { type: 'string', description: '若根因要运行期日志坐实，建议在哪埋点抓现行' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}

// ============ Phase 1: Map ============
phase('Map')
const map = await agent(
  `${REPO_HINT}

任务：测绘 "worker 敲 team report → orchestrator 收到回报" 的完整投递链路，并和 "dispatch → worker" 方向做对照。

重点回答：
1. report 从 CLI（src/cli/team.ts）→ 路由 → 业务逻辑 → 注入 orchestrator PTY stdin，每一跳是哪个文件哪个函数。
2. 注入 orchestrator stdin 用的是不是和派单注入 worker 同一套 post-start-input-writer / agent-stdin-dispatcher 代码？
3. 77fbe78 的修复（投递 gate + 就绪态单一真相源 + onPasteGaveUp 不静默 return）到底加在哪条路径上——只加在 dispatch→worker，还是也覆盖了 report→orch？用 git show 77fbe78 核对改动文件和调用方。
4. assertForwardedToOrchestrator 检查 payload 的哪个字段；服务端在什么时机把它置 true——是在 stdin 真正落地后，还是只要 ledger 写成功就置 true（即"已记录"被当成"已送达"）？

只测绘事实，不下结论。`,
  { schema: MAP_SCHEMA, model: JUDGE_MODEL, effort: 'high', phase: 'Map', label: 'map:report-delivery-path' }
)

log(`链路测绘完成：注入机制=${map.injectionMechanism?.slice(0, 80)}…`)

// ============ Phase 2+3: Probe → Verify（pipeline，每条假设取证后立即对抗式复核）============
const HYPOTHESES = [
  {
    key: 'h1-orch-readiness-gate',
    prompt: `怀疑①（首要嫌疑）：report→orch 的 stdin 注入【缺少】77fbe78 给 dispatch→worker 加的就绪态 gate。当 orchestrator 自己正忙 / 正在 auto-compact / PTY 不在空闲提示符时，注入的 bracketed-paste 报文被静默丢弃，或被盲 timeout 当成已投递，orch 永远看不到这条 report。worker 那头 team report 照常返回成功、打印"已执行"。
请深读 report 注入路径，对比 77fbe78 在 dispatch 方向加的保护（allowExistingPrompt / 尾部 idle prompt 检测 / 禁止 Claude 8s 盲 timeout / onPasteGaveUp 标 input_delivery_failed_at），逐条核对 report→orch 方向有没有同样的保护。`,
  },
  {
    key: 'h2-forwarded-false-positive',
    prompt: `怀疑②：服务端把 report "已转发 orchestrator" 的标志（assertForwardedToOrchestrator 检查的字段）在 stdin 真正落地之前就置 true，或在注入失败时仍返回成功。导致 worker 侧 assert 通过、以为送达了，实际 orch PTY 没收到。
请定位该字段在服务端被赋值的每一处，判断它反映的是"已写 DB/ledger"还是"已确认注入 orch stdin 成功"。`,
  },
  {
    key: 'h3-recorded-not-delivered-gap',
    prompt: `怀疑③：dispatch 状态机把该派单标 reported、.hive/tasks.md 打勾，是【独立于】orch stdin 投递成功与否完成的。于是 Cockpit/tasks 显示"已完成"，但 orchestrator 的对话上下文从未收到这条 report → PM 永远不知道。
请核对 team-operations report 逻辑里："写 ledger reported / 勾 tasks.md" 与 "注入 orch stdin" 的先后与错误处理：注入失败时 ledger 会回滚吗？还是照样 reported？`,
  },
  {
    key: 'h4-worker-side-swallow',
    prompt: `怀疑④：即便投递失败、CLI 的 assertForwardedToOrchestrator 抛错，worker（claude/codex/opencode）也把 team report 当成功——打印"已执行 team report"后停手，不重试、不上报失败。
请核对：(a) assertForwardedToOrchestrator 抛错时 CLI 进程退出码是什么；(b) worker agent 看到非零退出/错误输出会不会当回事；(c) 有没有"report 投递失败"被 worker 静默吞掉的路径。结合 team list 里吕布的 last_pty_line "工作已完成但 report 未送达" 这条现成铁证分析。`,
  },
  {
    key: 'h5-orch-compact-race',
    prompt: `怀疑⑤（与 77fbe78 同根、反方向）：orchestrator 正处于 auto-compact 窗口时，worker 的 report 注入落空。77fbe78 证明 compact 期间 bracketed-paste 会被吞；该问题在 worker→orch 方向是否同样存在、是否被同一修复覆盖？
请确认 report 注入是否经过 post-start-input-writer 的 compact 检测分支；若经过，对 orchestrator 这个"目标"是否启用了同样的 compact 等待 + onPasteGaveUp 失败标记；若走的是另一条更老的未加固路径，指出来。`,
  },
  {
    key: 'h6-no-resurface-mechanism',
    prompt: `怀疑⑥：report 投递 orch 失败后，【没有任何】兜底机制把"worker 已 report 但 orch 没收到"重新捅给 PM。stalled-dispatch-nudge / sentinel / reconcile 只盯 dispatch 超期或孤儿，盯不到"已 reported 但投递失败"这个态。
请核对现有 surface 机制（stalled-dispatch-nudge.ts / stale-dispatch-status.ts / sentinel-heartbeat.ts / 任何 reconcile）覆盖的状态集合，确认"reported 成功但 orch 注入失败"是不是一个无人认领的黑洞态。`,
  },
]

phase('Probe')
const verified = await pipeline(
  HYPOTHESES,
  (h) =>
    agent(`${REPO_HINT}

【链路测绘背景】
- 投递链路：${map.reportPath}
- 注入机制：${map.injectionMechanism}
- 与 dispatch 方向是否共用 / 77fbe78 覆盖情况：${map.sharedWithDispatch}
- forwarded 标志语义：${map.forwardedFlagSemantics || '（map 未明确，自己查）'}

${h.prompt}

读真码取证后用 schema 输出。证据必须带 file:line 和"这段码为什么支持/反驳"。别脑补，读不到就说读不到。`,
      { schema: HYP_SCHEMA, model: FINDER_MODEL, effort: 'high', phase: 'Probe', label: `probe:${h.key}` }
    ),
  (finding, h) =>
    agent(`${REPO_HINT}

下面是一条关于 "worker report 收不到" 的假设取证结果，请你【对抗式复核】——默认立场是尝试证伪它。只有真码确凿支持才 confirm；证据不足或可被反例推翻就 refuted/uncertain。亲自去读它引用的 file:line 验证，不要轻信。

假设：${finding.hypothesis}
取证方结论：supported=${finding.supported} confidence=${finding.confidence}
失败模式：${finding.failureMode}
证据：${JSON.stringify(finding.evidence)}

输出 verdict。`,
      { schema: VERDICT_SCHEMA, model: JUDGE_MODEL, effort: 'high', phase: 'Verify', label: `verify:${h.key}` }
    ).then((v) => ({ ...finding, key: h.key, verdict: v }))
)

const clean = verified.filter(Boolean)
const confirmed = clean.filter((f) => f.verdict?.verdict === 'confirmed')
log(`取证+对抗复核完成：${clean.length} 条假设，${confirmed.length} 条 confirmed`)

// ============ Phase 4: Synthesize ============
phase('Synthesize')
const synthesis = await agent(
  `${REPO_HINT}

你是终审 + 收敛者。下面是 6 条关于 "worker team report 已执行但 orchestrator 收不到" 的假设，各自带取证 + 对抗式复核 verdict。请收敛成最终根因报告。

${JSON.stringify(clean.map((f) => ({ hypothesis: f.hypothesis, supported: f.supported, confidence: f.confidence, failureMode: f.failureMode, evidence: f.evidence, verdict: f.verdict })), null, 2)}

要求：
1. 给出真正的根因（可能不止一条；区分"主根因"和"放大器"）。每条带 severity / confidence / 机制级解释 / file:line 证据 / 推荐修复方向（只给方向不写实现）。
2. 给出稳定复现路径（含需要的运行期条件，比如让 orchestrator 处于 compact 时 worker report）。
3. 若某根因必须靠运行期日志才能 100% 坐实，明说"待运行期日志坐实"并给出建议埋点位置——遵守 HippoTeam 纪律：证据没坐实前不声称"已根治"。
4. summary 用人话，给非技术 user 也能懂的一段话。`,
  { schema: SYNTH_SCHEMA, model: JUDGE_MODEL, effort: 'high', phase: 'Synthesize', label: 'synthesize:root-cause' }
)

// ============ Phase 5: Report（双产出，中文）============
phase('Report')
await agent(
  `${REPO_HINT}

把下面的根因调查收敛结果写成两份交付物（全中文）。直接用 Write 工具落盘，不要把内容回贴给我。

【收敛结果 JSON】
${JSON.stringify(synthesis, null, 2)}

【6 条假设的复核明细 JSON】
${JSON.stringify(clean.map((f) => ({ key: f.key, hypothesis: f.hypothesis, verdict: f.verdict?.verdict, reasoning: f.verdict?.reasoning, evidence: f.evidence })), null, 2)}

要写的文件：
1. .hive/reports/2026-06-30-report-delivery-bug-investigation.html
   - 自包含深色 HTML（给 user 看），中文。
   - 结构：① 一句话结论（orch 为什么收不到 report）② 根因表（severity/confidence/机制/证据 file:line/修复方向）③ 复现路径 ④ 6 条假设逐条 verdict+理由 ⑤ 建议埋点/下一步。
   - 不要 emoji 轰炸，干净专业。严守"证据没坐实不声称根治"。
2. .hive/research/2026-06-30-report-delivery-bug-investigation.md
   - research 索引笔记（给未来 PM/worker），中文。frontmatter 含背景/方法/关键文件锚点/净结论/与 77fbe78 的关联/待运行期坐实项。

两份都写完后，team report 里报告这两个路径 + 一句话主根因。`,
  { model: JUDGE_MODEL, effort: 'high', phase: 'Report', label: 'scribe:deliverables' }
)

return {
  summary: synthesis.summary,
  rootCauses: synthesis.rootCauses,
  reproPath: synthesis.reproPath,
  confirmedCount: confirmed.length,
  reportHtml: '.hive/reports/2026-06-30-report-delivery-bug-investigation.html',
  researchMd: '.hive/research/2026-06-30-report-delivery-bug-investigation.md',
}
