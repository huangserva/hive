# Cockpit Full Audit — 2026-05-24

## Problem
User discovered QuestionsTab answer button had empty handler. Need systematic audit of all 8 Cockpit tabs + ActionBar for similar dead handlers, missing APIs, and test gaps.

## Method
- Static grep of all `onClick` / event handlers in `web/src/cockpit/**/*.tsx`
- Backend route audit of `src/server/routes-cockpit.ts`
- aiActions algorithm review in `src/server/cockpit-doc.ts`
- i18n completeness check (all components use `t()`)
- Test file coverage audit via glob `tests/**/cockpit*.test.*`

## Key Findings (12 total)

### Dead Handlers (3 HIGH)
1. `ActionBar.tsx:75` — all action buttons (回答/查看/确认) have empty onClick
2. `IdeasTab.tsx:18` — "Promote" button empty onClick
3. `DecisionsTab.tsx:18` — "Confirm archive" button empty onClick

Note: QuestionsTab was already fixed by 关羽 — has real Dialog + POST.

### Missing Backend Endpoints (3)
- POST `/cockpit/ideas/:id/promote`
- POST `/cockpit/decisions/:id/confirm`
- POST `/cockpit/actions/:id/execute`

### Test Gaps (4 MEDIUM)
- No tests for: IdeasTab, DecisionsTab, BaselineTab, ArchiveTab
- No test for POST `/cockpit/questions/:id/answer` route
- No tab-switch rendering test in CockpitDrawer

### i18n Issue (1 MEDIUM)
- `BaselineTab.staleHint` is server-generated Chinese string, not passed through `t()`

### aiActions Missing Triggers (2 LOW)
- No time-based urgency for old unanswered questions
- No stale task detection

## Conclusion
Cockpit is display-complete and mostly i18n-complete. The 3 dead handlers are Phase C-2.5 TODOs, not regressions. QuestionsTab answer is now properly wired. Next step: create POST endpoints for promote/confirm/action and wire handlers.

## References
- Full report: `.hive/reports/cockpit-full-audit-2026-05-24.html`
- Source: `web/src/cockpit/` (8 tabs + ActionBar + Drawer)
- Backend: `src/server/routes-cockpit.ts`, `src/server/cockpit-doc.ts`
