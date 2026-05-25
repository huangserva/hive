# Full App E2E Smoke Runbook — 2026-05-25

Source report: [.hive/reports/full-app-e2e-sweep-2026-05-25.html](../reports/full-app-e2e-sweep-2026-05-25.html)

## Purpose

Reusable regression smoke checklist for the whole HippoTeam web app. Re-run with Playwright MCP against the local UI before shipping broad UI changes.

## Environment

- Start or reuse Web UI at `http://127.0.0.1:4010`.
- Use isolated Playwright MCP browser.
- Keep sweep read-only: open dialogs, inspect controls, cancel/close; do not confirm destructive actions or submit write forms.
- Capture console messages before and after the sweep.

## Failure Conditions

- Any uncaught console error.
- Any button opens a blank/broken dialog, no-ops when it should open a view, or traps the user without close/cancel.
- Any destructive action proceeds without explicit confirmation.
- Cockpit tabs render stale/empty content when source files contain data.
- Terminal xterm canvas is missing, zero-sized, or overlays app controls.

## Smoke Inventory

### Topbar

- Cockpit button: click. Expected: right drawer opens; badge/count remains; close button closes it.
- Feishu status lamp: inspect. Expected: indicator renders with no error. If made clickable later, expect status details popover.
- Language switch: click zh -> en -> zh. Expected: labels switch and layout does not overflow.
- Notification settings: click bell. Expected: settings popover/dialog shows sound choices, message mode, browser notification checkbox, Test and Close. Click Test only; close.

### Workspace Sidebar

- Workspace switcher: click another workspace, then return. Expected: active workspace changes without console error.
- Workspace settings: click gear for active workspace. Expected: Feishu integration dialog renders connection state, bound chats, chat_id/chat_name inputs, disabled Bind until chat_id is present; close. Do not unbind/bind.
- New Workspace: open dialog. Expected: path/name/CLI controls render. Cancel only.
- Delete Workspace: verify button exists and requires confirmation. Do not confirm.
- GitHub link: verify link presence. Do not navigate unless running a separate external-link check.

### Workers Sidebar

- Worker card: click one running and one idle worker if available. Expected: worker detail modal opens; xterm/empty terminal area renders; close works.
- Card hover actions: verify rename/delete/start buttons are visible. Open rename only if you can cancel; never confirm delete or start/stop during read-only sweep.
- Per-worker thinking_level: expected inventory item from 2026-05-25 dispatch. Current behavior: only Add Worker has thinking level; existing worker cards/modal do not expose a picker.
- Add Worker: open dialog. Expected: name field, random button, role cards, role details, CLI preset cards, thinking level select, startup command details. Change role/preset/thinking locally; cancel. Do not submit.
- Workspace terminal button: open only if read-only shell start is acceptable for the run. In strict read-only mode, verify button presence and skip.

### Cockpit

Open Cockpit and click all tabs:

- Plan: summary, progress, milestones, risks, current phase render.
- Tasks: counts and task groups render.
- Questions: open/answered sections render; do not submit answers.
- Ideas: inbox/promoted render. Promote buttons may open a dialog; cancel only.
- Decisions: draft/adopted sections render. Confirm buttons, if present, must be cancelled.
- Research: research notes list renders with timestamps and line counts.
- Baseline: baseline files and stale warning render.
- Archive: archive empty or month list renders.
- ActionBar: click at least one non-destructive action. Expected: switches to target tab and/or opens safe dialog. Cancel any write dialog.

### Todo Mini

- Toggle button: open and close drawer. Expected: progress/count and task list render.
- Add Task: click. Expected: inline input appears and no file write happens until submit. Do not submit. Current UX note: no obvious Cancel/Save buttons in viewport.
- Task row controls: verify copy/edit/subtask/delete controls are visible. Do not delete or save edits.
- Completed collapse: toggle completed section if visible. Expected: list expands/collapses without changing task state.

### Terminal Area

- Orchestrator terminal: verify `.xterm` and canvas are mounted with nonzero dimensions.
- Terminal input: verify textarea exists. Do not type commands unless the smoke run explicitly includes terminal IO.
- Worker terminal modal: open worker detail and verify terminal slot/xterm area.

## Console Checklist

After completing the sweep, collect console messages. Expected target is 0 errors. Known warnings from 2026-05-25 sweep:

```
Total messages: 2 (Errors: 0, Warnings: 2)

[WARNING] <link rel=preload> uses an unsupported `as` value @ http://127.0.0.1:4010/:12
[WARNING] Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}. @ http://127.0.0.1:4010/assets/index-Bk-KdMk0.js:52
```

Treat new warnings as regressions unless intentionally introduced and documented.

## 2026-05-25 Baseline Result

- Console: 0 errors, 2 warnings.
- Severity distribution: 0 blockers, 0 high, 2 medium, 2 low.
- Blocker: none.
- PM docs updated: this runbook and the self-contained HTML report only. No plan/ADR/open-question update was needed because this was a verification task and did not complete a milestone or require a product decision.
