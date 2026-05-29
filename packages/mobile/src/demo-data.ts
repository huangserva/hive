import type { ChatMessage, MobileDashboard } from './api/client'

export const DEMO_DASHBOARD: MobileDashboard = {
  cockpit: {
    ai_actions_count: 4,
    baseline_stale: true,
    high_ai_actions: 2,
    open_questions: 3,
  },
  generated_at: new Date().toISOString(),
  plan: {
    active_milestone: 'M24 Mobile App Productization',
    current_phase: 'Implementation',
  },
  runs: [
    {
      agent_name: '关羽',
      id: 'demo-run-1',
      started_at: new Date().toISOString(),
      status: 'working',
    },
    { agent_name: '赵云', id: 'demo-run-2', started_at: new Date().toISOString(), status: 'idle' },
  ],
  tasks: { total_done: 23, total_open: 8 },
  workers: [
    { id: 'w1', name: '关羽', preset: 'codex', role: 'coder', status: 'working' },
    { id: 'w2', name: '赵云', preset: 'codex', role: 'coder', status: 'idle' },
    { id: 'w3', name: '马超', preset: 'claude', role: 'coder', status: 'working' },
    { id: 'w4', name: '典韦', preset: 'opencode', role: 'tester', status: 'stopped' },
    { id: 'w5', name: '吕布', preset: 'opencode', role: 'coder', status: 'idle' },
  ],
  workspace: { id: 'demo-ws', name: 'hive-serva', path: '/dev/hive-serva' },
}

const now = Date.now()

export const DEMO_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'demo-1',
    direction: 'outbound',
    message_type: 'user_text',
    content_json: JSON.stringify({ text: '开始做 M24 Phase 1 Chat 后端' }),
    created_at: now - 3600000,
  },
  {
    id: 'demo-2',
    direction: 'inbound',
    message_type: 'orch_reply',
    content_json: JSON.stringify({
      text: '收到，我来分析一下需求然后派关羽去实现 mobile_chat_messages 表和 REST endpoint。',
    }),
    created_at: now - 3500000,
  },
  {
    id: 'demo-3',
    direction: 'inbound',
    message_type: 'system_event',
    content_json: JSON.stringify({ text: 'Dispatched 关羽 → Phase 1 Chat Backend' }),
    created_at: now - 3400000,
  },
  {
    id: 'demo-4',
    direction: 'inbound',
    message_type: 'worker_report',
    content_json: JSON.stringify({
      text: 'Phase 1 完成：mobile_chat_messages 表 + REST + WS push，18 tests 全过。',
      worker: '关羽',
    }),
    created_at: now - 1800000,
  },
  {
    id: 'demo-5',
    direction: 'inbound',
    message_type: 'approval_request',
    content_json: JSON.stringify({
      text: 'Database migration: add indexes for mobile_chat_messages',
      approval_id: 'demo-approval-1',
    }),
    created_at: now - 900000,
  },
  {
    id: 'demo-6',
    direction: 'outbound',
    message_type: 'user_text',
    content_json: JSON.stringify({ text: '看起来不错，继续做 Phase 2' }),
    created_at: now - 600000,
  },
  {
    id: 'demo-7',
    direction: 'inbound',
    message_type: 'orch_reply',
    content_json: JSON.stringify({ text: '好的，Phase 2 UI 对齐已经派给赵云和马超并行处理。' }),
    created_at: now - 300000,
  },
]
