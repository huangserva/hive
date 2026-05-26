# Hive Serva Architecture Diagram Research

Date: 2026-05-25
Report: `.hive/reports/2026-05-25-hive-serva-architecture.html`

## Question

Use `https://github.com/Cocoon-AI/architecture-diagram-generator` to draw this repository's project structure.

## Process

- Read project context from `CLAUDE.md` and the canonical spec at `docs/superpowers/specs/2026-04-18-hive-design.md`.
- Used the existing baseline docs as structure sources:
  - `.hive/baseline/module-map.md`
  - `.hive/baseline/runtime-flows.md`
  - `.hive/baseline/state-storage.md`
- Cloned Cocoon-AI's generator to `/tmp/architecture-diagram-generator` and followed `architecture-diagram/SKILL.md` plus `resources/template.html`.
- Kept the generated artifact as a self-contained HTML file with inline SVG and the generator's dark theme, semantic colors, summary cards, and export toolbar.

## Conclusion

The diagram should represent the project at the subsystem level rather than a file-by-file graph:

- `web/src` is the React/Vite UI layer.
- `src/server` is the local Node runtime, with route registry, RuntimeStore, WebSocket servers, agent lifecycle, team protocol, Feishu bridge, and PM document parsers.
- `src/cli` contains `hive` runtime startup and `team` agent-facing protocol client.
- SQLite persists runtime state; `.hive/*` persists user-visible PM documents.
- Real CLI agents run as PTY processes and communicate through the team protocol.

## Impact

This is a documentation artifact only. No production code or tests were changed.

## References

- Cocoon-AI architecture diagram generator: `https://github.com/Cocoon-AI/architecture-diagram-generator`
- Local generated report: `.hive/reports/2026-05-25-hive-serva-architecture.html`
