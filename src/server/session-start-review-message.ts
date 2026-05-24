export const SESSION_START_REVIEW_MESSAGE = [
  '[Hive 系统消息：会话开始]',
  '',
  '按 ORCHESTRATOR_RULES PM 段要求，开始干活前请先：',
  '',
  '1. 读 .hive/baseline/README.md 跟你需要的子文档（module-map / runtime-flows / state-storage / test-gates / risk-hotspots），重建项目上下文',
  '2. 读 .hive/plan.md 看 current_phase + 最近的 milestones 状态',
  '3. 扫 .hive/ideas/inbox.md，看有没有跟当前 plan 关联的成熟想法（每 session 最多挂 2 条 promote Q 到 open-questions.md）',
  '4. 扫 .hive/open-questions.md，识别 user 还在等你处理什么',
  '',
  '跑完用一段简短文字告诉 user "我看了 baseline，当前在 phase X，N 条 open question 待答，M 条 idea 候选 promote"。然后再听 user 这次想做什么。',
  '',
  '不要重复 review，本会话只跑一次。',
].join('\n')

export const appendSessionStartReviewMessage = (text: string) =>
  [text, '', SESSION_START_REVIEW_MESSAGE].join('\n')
