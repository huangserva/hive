# Runtime Flows

> 主要运行时数据流。只记录稳定路径；细节以代码和测试为准。

## Flow 1: User 在 web UI 派单

```
User
  -> web/src/worker/useWorkerActions.ts
  -> web/src/api.ts POST /api/team/send or workspace worker action
  -> routes-team.ts / team-operations.ts
  -> team-authz.ts validates orchestrator token
  -> workspace-store-mutations.ts pending_task_count += 1, status=working
  -> dispatch-ledger-store.ts creates submitted dispatch
  -> agent-stdin-dispatcher.ts writes task prompt into worker PTY
  -> message-log-store.ts records send message
  -> web refresh/WS shows worker working
```

Notes:
- Protocol state is event-driven: send -> working, report -> idle when pending is zero.
- Worker identity is by worker name at CLI boundary; internal IDs stay server-side.

## Flow 2: Worker `team report` 回 orch

```
Worker PTY
  -> bin/team -> src/cli/team.ts report/status
  -> POST /api/team/report or /api/team/status
  -> routes-team.ts
  -> team-authz.ts validates worker token
  -> dispatch-ledger-store.ts finds open dispatch or status path
  -> message-log-store.ts records report/status
  -> workspace-store-mutations.ts pending_task_count -= 1
  -> agent-stdin-dispatcher.ts injects system message into orchestrator PTY
  -> worker status becomes idle when no pending tasks remain
```

Notes:
- `team cancel` is explicit dispatch cancellation; it must not be confused with report.
- PTY exit path goes through agent-manager-support/exit handler and marks agent stopped.

## Flow 3: 飞书 inbound -> orch

```
Feishu chat
  -> lark.WSClient in feishu-transport.ts
  -> parseTextContent / stripLeadingMentions
  -> feishu-route-resolver.ts maps chat_id to workspace + orchestrator
  -> feishu-inbound-handler.ts formats "[来自飞书 chat=...]"
  -> agentRuntime.getActiveRunByAgentId checks orch online
  -> store.recordUserInput(workspaceId, orchAgentId, formattedText)
  -> team-operations/message-log-store persist user_input
  -> agent-stdin-dispatcher writes into orchestrator PTY
```

Notes:
- Group chats require @bot; p2p messages do not.
- Phase 2 outbound uses `team feishu reply`; approval cards use in-memory ledger.

## Flow 4: PM 文件 -> Cockpit dashboard

```
.hive/{plan.md,tasks.md,open-questions.md}
.hive/{ideas/**,baseline/**,decisions/**,archive/**}
  -> tasks-file-watcher.ts chokidar debounce
  -> RuntimeStore registerCockpitListener callbacks
  -> cockpit-websocket-server.ts publishes /ws/cockpit/:workspaceId
  -> cockpit-doc.ts parseCockpit(workspacePath)
  -> plan/PM parsers produce ParsedCockpit
  -> web/src/cockpit/useCockpit.ts receives snapshot/update
  -> CockpitDrawer renders tabs + action bar
```

Notes:
- Legacy `/ws/plan/:workspaceId` remains for PlanDrawer backward compatibility.
- `aiActions` currently derive from high/medium questions, recent ideas, draft decisions, and baseline stale hint.
