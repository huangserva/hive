# M19a protocol audit

**Date**: 2026-05-25
**Milestone**: M19a protocol audit + Expo/RN skeleton + LAN read-only dashboard
**Paired report**: `.hive/reports/m19a-protocol-audit-2026-05-25.html`

## Scope

This note indexes the current HippoTeam runtime HTTP and WebSocket surface for the native app epic. It is an audit only: no product code was changed.

M19a needs the Expo/RN app to connect over LAN and render a read-only dashboard:

- runtime identity
- workspace list / selected workspace
- Cockpit summary, including plan, tasks, questions, AI actions, baseline status, reports/research
- worker status
- run / terminal status, transcript-first

## Source files scanned

- `src/server/app.ts`
- `src/server/local-request-guard.ts`
- `src/server/ui-auth-helpers.ts`
- `src/server/routes.ts`
- `src/server/routes-workspaces.ts`
- `src/server/routes-runtime.ts`
- `src/server/routes-cockpit.ts`
- `src/server/routes-plan.ts`
- `src/server/routes-tasks.ts`
- `src/server/routes-dispatches.ts`
- `src/server/routes-settings.ts`
- `src/server/routes-feishu.ts`
- `src/server/routes-fs.ts`
- `src/server/routes-team.ts`
- `src/server/routes-ui.ts`
- `src/server/routes-version.ts`
- `src/server/cockpit-websocket-server.ts`
- `src/server/plan-websocket-server.ts`
- `src/server/tasks-websocket-server.ts`
- `src/server/terminal-ws-server.ts`
- `src/server/terminal-stream-hub.ts`
- `src/server/terminal-protocol.ts`
- `web/src/api.ts`

## Key findings

1. The existing web runtime already exposes most read-only dashboard data:
   - Cockpit aggregate: `GET /api/workspaces/:workspaceId/cockpit`
   - Cockpit realtime: `WS /ws/cockpit/:workspaceId`
   - Workers: `GET /api/ui/workspaces/:workspaceId/team`
   - Runs: `GET /api/ui/workspaces/:workspaceId/runs`
   - Runtime identity: `GET /api/runtime/status`
   - Workspace list: `GET /api/workspaces`

2. Native LAN access is currently blocked:
   - HTTP calls pass through `assertLocalRequest(request)` in `src/server/app.ts`.
   - WS upgrade handlers call `getLocalRequestRejection(request)`.
   - `src/server/local-request-guard.ts` only allows localhost / loopback host and remote address.

3. Browser UI auth is not reusable as a stable mobile auth scheme:
   - UI auth is an HttpOnly cookie named `hive_ui_token`.
   - `requireUiTokenFromRequest` reads cookies only.
   - WS validators read the same cookie.
   - No `Authorization: Bearer` or paired-device credential exists.

4. The current route namespace is web-UI-shaped, not native-app-stable:
   - Worker list and runs live under `/api/ui/...`.
   - Task file endpoint returns raw markdown; parsed task data is available only through Cockpit.
   - Terminal WS is bidirectional and browser-terminal-shaped.

5. For M19a, terminal should be transcript/status-first:
   - `WS /ws/terminal/:runId/io` can write PTY input.
   - `WS /ws/terminal/:runId/control` supports restore, resize, stop, ack.
   - A read-only app should not need the raw terminal stream/input channel in the first phase.

## Recommended M19a API shape

Minimum stable native API layer:

```text
GET /api/mobile/runtime/status
GET /api/mobile/workspaces
GET /api/mobile/workspaces/:workspaceId/dashboard
WS  /ws/mobile/workspaces/:workspaceId/dashboard
GET /api/mobile/runs/:runId/transcript
```

The dashboard endpoint should aggregate existing parsers/store calls rather than duplicate logic:

```json
{
  "runtime": { "port": 4010, "pid": 12345, "version": "..." },
  "workspace": { "id": "...", "name": "...", "path": "..." },
  "plan": { "current_phase": "...", "active_milestone": "..." },
  "tasks": { "total_open": 0, "total_done": 0, "sections": [] },
  "workers": [],
  "runs": [],
  "cockpit": {
    "open_questions": 0,
    "high_ai_actions": 0,
    "baseline_stale": true,
    "ai_actions": []
  },
  "generated_at": "2026-05-25T00:00:00.000Z"
}
```

## Endpoint status summary

Legend:

- ✅ Reusable data and shape for M19a, once LAN/mobile auth exists.
- ⚠️ Useful but needs a mobile wrapper, compact schema, or auth/transport changes.
- ❌ Missing for native app.

### Directly useful after auth/LAN work

- ✅ `GET /api/workspaces`
- ✅ `GET /api/runtime/status`
- ✅ `GET /api/workspaces/:workspaceId/cockpit`
- ✅ `WS /ws/cockpit/:workspaceId`
- ✅ `GET /api/ui/workspaces/:workspaceId/team`
- ✅ `GET /api/ui/workspaces/:workspaceId/runs`

### Useful but not ideal as native contract

- ⚠️ `GET /api/workspaces/:workspaceId/plan` and `WS /ws/plan/:workspaceId`: redundant with Cockpit for dashboard, but good for narrower plan-only clients.
- ⚠️ `GET /api/workspaces/:workspaceId/tasks` and `WS /ws/tasks/:workspaceId`: raw markdown only; Cockpit has parsed tasks.
- ⚠️ `GET /api/ui/workspaces/:workspaceId/dispatches`: useful for history, not required for first dashboard.
- ⚠️ `GET /api/runtime/runs/:runId`: single-run detail, no aggregate realtime stream.
- ⚠️ `GET /api/workspaces/:workspaceId/cockpit/report-file` and `doc-file`: later detail views.

### Not suitable for M19a read-only app

- ❌ Browser session bootstrap `GET /api/ui/session`: cookie-only and same-origin oriented.
- ❌ CLI agent endpoints `/api/team/*`: worker/orchestrator protocol, not mobile client protocol.
- ❌ Terminal WS as-is for read-only dashboard: powerful, bidirectional, and cookie-bound.

## Implementation notes for next workers

- Do not expose the existing local UI token over LAN as the mobile auth solution.
- Introduce a paired-device credential or bearer token before allowing non-loopback hosts.
- Keep M19a read-only: dashboard snapshot/realtime first, control and terminal input later.
- Reuse `parseCockpit(workspacePath)`, `store.listWorkspaces()`, `store.listTerminalRuns(workspaceId)`, and `enrichTeamList(...).map(serializeTeamListItem)`.
- Prefer one compact dashboard endpoint over forcing the mobile app to coordinate five web UI endpoints.

