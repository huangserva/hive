# Test Gates

> Commands and testing discipline for HippoTeam changes.

## Standard gates

- Typecheck: `pnpm exec tsc -p tsconfig.build.json --noEmit`
- Lint/format check: `pnpm exec biome check <changed files>` or `pnpm check`
- Unit/integration/web tests: `pnpm exec vitest run` or `pnpm test`
- Production build: `pnpm build`
- Package smoke when release-related: `pnpm pack:check && pnpm pack:smoke`
- Windows subset when path/shell changes: `pnpm test:windows`

## Package scripts

- `pnpm dev` starts runtime + Vite via concurrently.
- `pnpm dev:runtime` runs `tsx src/cli/hive.ts --port 4010`.
- `pnpm build` runs clean, TS build, artifact prep, and Vite build.
- `pnpm check` is `biome check .`.
- `pnpm test` is `vitest run`.
- `pnpm release:dry` is check + build + test + pack checks.

## TDD discipline from CLAUDE/AGENTS

- Integration tests in `tests/server/*` and `tests/cli/*` must not mock PTY/node-pty.
- Real integration means real HTTP server + real store/SQLite + real PTY when involved.
- Do not add production fallback branches only to make tests pass.
- Do not assert mock call loops as product behavior.
- Do not use empty assertions, source-string assertions, or `not.toThrow()` alone.
- Error paths matter: missing worker, DB failure, PTY failure, concurrent stop, exited agent.
- If an assertion would pass with product code written backwards, it is a fake test.
- Schema changes require migration, not ad hoc runtime ALTER in stores.

## Before claiming done

- Report exact commands and pass/fail tail.
- If a required gate cannot run, state why and what was run instead.
- Confirm no unrelated dirty files were reverted or modified.
- Confirm tests were not changed when the dispatch forbids it.
- For UI work, build must pass and text must fit in target containers.

## Known noisy but accepted test output

- PTY teardown can print `Unhandled pty write error EIO/EBADF` while tests still pass.
- Vite build prints Radix/lucide `"use client" was ignored` warnings.
- Web tests may log swallowed fetch/socket errors during intentional server shutdown.
