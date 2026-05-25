---
title: M17 paseo skills playbook design
date: 2026-05-25
source_report: ../reports/m17-skills-playbook-design-2026-05-25.html
status: design
---

# M17 paseo skills playbook design

## Question

How should HippoTeam translate paseo's five collaboration playbooks into the Cockpit / PM document system without copying paseo's runtime wholesale?

## Source Index

- `~/development/paseo/skills/paseo-handoff/SKILL.md`
  - Solves agent-to-agent task transfer. The handoff brief is self-contained: task, context, files, current state, tried attempts, decisions, acceptance criteria, constraints.
  - Key constraint: preserve task semantics. "Investigate" must not become "fix".
- `~/development/paseo/skills/paseo-advisor/SKILL.md`
  - Solves "second opinion" without delegation. The advisor is read-only, gets a sharp question, relevant files, considered/rejected options, and returns a recommendation with reasoning.
  - Key constraint: use provider contrast when possible and synthesize rather than blindly adopt.
- `~/development/paseo/skills/paseo-committee/SKILL.md`
  - Solves hard/stuck problems with two contrasting high-reasoning advisors. Plan first, implement separately, then review the diff against the plan.
  - Key constraint: committee members do not edit code; the orchestrator owns synthesis and implementation routing.
- `~/development/paseo/skills/paseo-epic/SKILL.md`
  - Solves large multi-phase work. It creates a durable plan file, captures immutable requirements, uses adversarial planning/review, then implements and delivers phase by phase.
  - Key constraint: requirements are captured before planning and are not changed by planner/reviewer agents.
- `~/development/paseo/skills/paseo-loop/SKILL.md`
  - Solves repeated worker/verifier cycles such as "keep trying until tests pass" or "babysit this external check".
  - Key constraint: every loop needs a concrete verifier and bounded stop conditions.
- `~/development/paseo/skills/paseo-orchestrate/SKILL.md`
  - Deprecated redirect to `paseo-epic`; useful mainly as evidence that the epic flow replaced older orchestration wording.
- `~/development/paseo/skills/paseo/SKILL.md`
  - Shared paseo substrate: provider preferences, worktree creation, agent launching, waiting discipline, schedules, and CLI parity.

## Existing HippoTeam Context

- Current PM state lives in `.hive/plan.md`, `.hive/tasks.md`, `.hive/open-questions.md`, `.hive/ideas/inbox.md`, `.hive/decisions/`, `.hive/research/`, `.hive/reports/`, `.hive/baseline/`, and `.hive/archive/`.
- Current templates are flat under `.hive/templates/`: `adr`, `baseline`, `handoff`, `ideas-inbox`, `milestone-review`, `open-questions`, `plan`, `research`.
- Current Cockpit `aiActions` already covers high/medium open questions, research/report orphan audit, recent ideas, decision drafts, and baseline stale hints.
- Current gap: PM documents describe project state, but they do not yet encode reusable operating playbooks for handoff, advisor, committee, epic, and loop workflows.

## Design Decisions

1. Translate paseo playbooks into HippoTeam PM artifacts first, not a new runtime first.
   - Reason: HippoTeam already has `.hive` documents, Cockpit, `team send`, and runtime prompts. Templates + rules + aiActions fit the existing control plane and avoid a second orchestration system.
2. Add playbook templates before adding automation.
   - Reason: the immediate failure mode is missing or inconsistent briefs. Templates raise the floor without risky scheduling/runtime changes.
3. Use Cockpit ActionBar as suggestion surface, not automatic execution.
   - Reason: advisor/committee/loop can consume agents or run commands. They should remain explicit PM choices until the triggers have proven precise.
4. Prioritize handoff first.
   - Reason: it directly improves worker rescue, cross-session continuity, and dispatch quality, while overlapping least with existing plan/tasks behavior.
5. Keep `epic` as an extension of plan.md, not a replacement.
   - Reason: HippoTeam already has a global plan and milestones. Epic should add immutable requirements and phase gates for large M-items, not fork the project plan model.

## Recommended Implementation Order

1. Handoff
2. Loop
3. Advisor
4. Committee
5. Epic

## Notes for Future Implementation

- Suggested template path: `.hive/templates/playbook-*.template.md`. A subdirectory is cleaner long term, but the existing template convention is flat; the first implementation can stay flat to reduce seeding and protocol changes.
- Suggested Cockpit extension: add `AIActionType = 'playbook'` and a `playbook` discriminator such as `handoff | loop | advisor | committee | epic`.
- Suggested ActionBar behavior: do not auto-run playbooks. Render a concrete "prepare X brief" action that opens or generates a draft in `.hive/`.
- No ADR was written in this design-only pass because no implementation choice has been adopted yet. If M17 implementation starts with handoff, that should create the ADR or update a dedicated M17 ADR.
