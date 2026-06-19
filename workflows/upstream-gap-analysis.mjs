// 固定工作流脚本（Opus 编排者设计，andy 在 GLM 上执行）。
// 目的：客观分析上游原版 tt-a1i/hive 与当前 HippoTeam 的差距全貌。
// 范式：fan-out（4 角度并行：可借鉴/backport · 我们的护城河 · 共享核心 drift · 上游方向）→ synthesize。
// 两个代码树（叶子 agent 用 ls/grep/git/diff 真读对比）：
//   - 我们 HippoTeam: /Users/huangzongning/development/hive-serva
//   - 上游原版(最新 main): /Users/huangzongning/development/hive-upstream-compare
// 控制流写死在此脚本，模型只在每个 agent() 叶子被调用。
export const meta = {
  name: 'upstream-gap-analysis',
  description: '客观对比上游 tt-a1i/hive 原版与当前 HippoTeam 的差距：可借鉴项/护城河/共享核心 drift/上游方向 4 角度并行 → 综合成差距报告 + backport 建议',
  phases: [
    { title: 'Analyze', detail: '4 角度并行对比两个代码树' },
    { title: 'Synthesize', detail: '综合差距报告 + 建议' },
  ],
}

const OURS = '/Users/huangzongning/development/hive-serva'
const UP = '/Users/huangzongning/development/hive-upstream-compare'

const ANGLES = [
  {
    key: 'borrow',
    prompt: `你是"可借鉴/backport 猎手"。客观对比上游原版与我们:上游=${UP}(tt-a1i/hive 最新 main),我们=${OURS}。
★方法纪律(重要):先【客观】看上游有哪些值得学的实现/做法/健壮性处理,别一上来用"我们已经更多了"当滤镜否掉。然后再评估借鉴价值。
具体:重点扫上游 src/server、src/cli、web 里【我们没有 或 比我们做得好】的代码点——bugfix、健壮性、边界处理、测试手法、架构小技巧。用 ls/grep 对比同名文件、或上游独有文件。逐条输出:上游文件:行/它做了什么/我们现状(有没有/差在哪)/是否值得 backport + 为什么。
背景:我们 2026-06-11 做过一轮 triage 拿了 4 个 backport;上游自那以后基本只动文档。所以重点找【那次可能漏的】或【仍值得拿的】,如果确实没什么新可拿的,如实说"上游无重大新增、已被 triage 覆盖"。基于真读到的代码,别猜。`,
  },
  {
    key: 'moat',
    prompt: `你是"护城河测绘员"。客观盘点我们 HippoTeam(${OURS})有、而上游原版(${UP})【没有】的东西——这是我们的独有价值。
方法:对比两边 src/server、src/cli、web、packages 的模块/文件,列出我们独有的大块能力(用 ls 对比目录、grep 关键模块)。例如(自己核实,别照抄):PM 文档体系(.hive)、飞书桥、语音/STT/TTS、WebRTC 通话、移动端 app、worker 状态 reconcile/M45 看门狗、accept-gate、relay 等。
逐块输出:能力名/对应文件或目录/上游有无/这块解决什么。目标是给 user 一张"我们比原版多了什么"的清晰地图。基于真读到的目录/代码。`,
  },
  {
    key: 'drift',
    prompt: `你是"共享核心 drift 审计员"。两边都有的【核心同名文件】(上游=${UP},我们=${OURS}),对比它们怎么分叉了。
方法:挑两边都存在的核心文件(如 src/server 里 agent-manager*、dispatch*、runtime*、workspace-store*、sqlite-schema*、relay* 等),用 diff 或逐文件读对比。重点找:① 上游在共享文件里有【我们没有的 bugfix/健壮性改进】(值得合回来)② 我们改动后是否【偏离了上游某个仍合理的设计】。
逐条输出:文件/分叉点/上游做法 vs 我们做法/谁更优 + 是否需要动作。基于真读到的代码,别猜。`,
  },
  {
    key: 'direction',
    prompt: `你是"上游方向分析员"。读上游(${UP})的 README、docs、最近提交历史(git log)、package.json、CHANGELOG/release notes,判断 tt-a1i/hive 的【发展方向和策略】。
线索:最近提交多是 "Remove public implementation docs"、"Clean public repository guidance"、"Clarify public source baseline"、release notes——疑似在把公开仓库收成"只留发布说明、剥实现细节"的壳。核实这个判断:上游是不是在走闭源/商业化、公开版变成 thin shell?
输出:上游近期到底在干什么、版本节奏、公开仓库完整度变化、这对我们意味着什么(上游未来可借鉴价值是否在下降、我们该更独立维护吗)。客观读真材料(git log/docs),别臆测。`,
  },
]

log('upstream-gap-analysis 启动:4 角度并行对比 tt-a1i/hive 原版 vs HippoTeam')

phase('Analyze')
const analyses = await parallel(
  ANGLES.map((a) => () => agent(a.prompt, { label: `analyze:${a.key}` })),
)

phase('Synthesize')
const sections = analyses
  .map((r, i) => (r ? `### 角度：${ANGLES[i].key}\n${r}` : null))
  .filter(Boolean)
  .join('\n\n')

const synthesis = await agent(
  `下面是 4 个角度对"上游 tt-a1i/hive 原版 vs 当前 HippoTeam"的对比分析。综合成一份给 user 的差距报告:
① 【可借鉴/backport 建议】:上游有哪些值得拿的(按价值排序);若基本没有,明确说"已被 6/11 triage 覆盖、上游无重大新增"。
② 【我们的护城河】:HippoTeam 比原版多出来的独有能力清单(给 user 一张清晰地图)。
③ 【共享核心 drift】:两边都改过的核心文件分叉点,有没有上游 bugfix 该合回来、或我们偏离了上游合理设计。
④ 【上游方向 + 战略含义】:上游在走什么路(是否收成闭源/thin shell),对我们维护策略的含义。
⑤ 【一句话结论 + 建议动作】:这次差距分析的净结论,以及要不要/做什么后续动作。
只综合这些输入 + 真读到的代码,别新编、别把猜测当事实。`,
  { label: 'synthesize' },
)

return { angles: ANGLES.map((a) => a.key), synthesis }
