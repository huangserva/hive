// 固定工作流脚本（由 Opus 编排者设计，andy 这类 workflow agent 在 GLM 上执行）。
// 范式：fan-out（3 个角度并行审查）→ synthesize（综合成优先级清单）。
// 控制流写死在此脚本，模型只在每个 agent() 叶子节点被调用。可复现：同脚本同目标 → 同流程。
// 运行：Workflow({ scriptPath: '<abs>/workflows/code-review-3x.mjs', args: { file: '<repo-relative path>' } })
export const meta = {
  name: 'code-review-3x',
  description: '对一个源码文件并行做 3 个角度审查（bug / 安全 / 简化），再综合成一份按严重度排序的优先级清单',
  phases: [
    { title: 'Review', detail: '3 个角度并行审查' },
    { title: 'Synthesize', detail: '去重 + 按严重度排序综合' },
  ],
}

// 关键：scriptPath 模式下 args 以 JSON【字符串】注入（非已解析对象，orch 用 diag 坐实），
// 故先 normalize——是字符串就 parse。这样带参数复用真正生效；默认值仅作无参时 fallback。
const wfArgs = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const file = wfArgs.file ?? 'src/server/dispatch-ledger-store.ts'

const ANGLES = [
  {
    key: 'bugs',
    prompt: `你是正确性审查员。读 ${file} 真文件，找：正确性 bug、边界条件错误、竞态、错误处理缺失。只读不改。逐条输出：文件:行 + 问题 + 为什么。基于真读到的代码，别猜。`,
  },
  {
    key: 'security',
    prompt: `你是安全审查员。读 ${file} 真文件，找：注入、路径穿越、鉴权缺失、密钥泄漏、不安全的反序列化/文件操作。只读不改。逐条输出：文件:行 + 风险 + 触发条件。基于真读到的代码。`,
  },
  {
    key: 'simplify',
    prompt: `你是简化审查员。读 ${file} 真文件，找：重复逻辑、可合并分支、低效、过度复杂、可抽函数处。只读不改。逐条输出：文件:行 + 现状 + 改进建议。基于真读到的代码。`,
  },
]

log(`code-review-3x 启动，目标文件：${file}`)

phase('Review')
const reviews = await parallel(
  ANGLES.map((angle) => () => agent(angle.prompt, { label: `review:${angle.key}` }))
)

phase('Synthesize')
const sections = reviews
  .map((review, index) => (review ? `### 角度：${ANGLES[index].key}\n${review}` : null))
  .filter(Boolean)
  .join('\n\n')

const synthesis = await agent(
  `下面是 3 个独立角度对 ${file} 的审查结果。请：① 去掉重复项；② 按严重度（高/中/低）排序；③ 合成一份给 PM 看的优先级问题清单，每条带【文件:行 / 问题 / 严重度 / 最小修复建议】。只综合这些输入，不要新编。\n\n${sections}`,
  { label: 'synthesize' }
)

return { file, angles: ANGLES.map((a) => a.key), synthesis }
