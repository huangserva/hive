# Test Gates

> Commands and testing discipline for HippoTeam changes.
> **DRAFT 2026-06-12（马超 refresh，待 user 校对）** — 同步基于 `package.json scripts` + 4 个 `vitest.config.ts` + `.husky/pre-commit` + `.github/workflows/release.yml` 实跑/读核：测试规模从 ~229 涨到 ~323、新增 relay media chunk / mobile-send-media / marketplace / agent-spawn-env / 神经 VAD shadow / image render decision 等 anchor、RN-safe 测试新范式。

## Standard gates

- Typecheck (root): `pnpm exec tsc -p tsconfig.build.json --noEmit`
- Typecheck (mobile): `pnpm --dir packages/mobile exec tsc --noEmit`
- Typecheck (relay / relay-crypto): `pnpm --filter @huangserva/hippoteam-relay-crypto check`、同 `--filter @huangserva/hippoteam-relay`
- Lint/format check: `pnpm exec biome check <changed files>` 或 `pnpm check`（= `biome check .`）
- Root tests (server + unit + cli + web): `pnpm test` (= `vitest run`)，`vitest.config.ts` 强制 `fileParallelism: false`（PTY/sqlite 测试不能并发）；setup `tests/setup/vitest.setup.ts`（jsdom localStorage polyfill）
- Mobile tests: `pnpm exec vitest run -c packages/mobile/vitest.config.ts`（include 同时匹配根 cwd 和 mobile cwd 两个路径，跑时不重复）
- Relay-crypto / relay tests: `pnpm --filter @huangserva/hippoteam-relay-crypto test`、`pnpm --filter @huangserva/hippoteam-relay test`
- Production build: `pnpm build`（clean → tsc → prepare-artifacts → `vite build`）
- Package smoke when release-related: `pnpm pack:check && pnpm pack:smoke`
- Windows subset when path/shell changes: `pnpm test:windows` — 11 个文件、`--no-file-parallelism --maxWorkers=1 --testTimeout=30000`
- Release dry-run: `pnpm release:dry` = check + build + test + pack:check + pack:smoke

## CI / Pre-commit

- CI（`.github/workflows/release.yml`）：matrix macos-latest / ubuntu-latest / windows-latest 跑 `pnpm install --frozen-lockfile → check → build →` 非 Win 跑 `pnpm vitest run --no-file-parallelism --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000`、Win 跑 `pnpm test:windows` → `pack:check + pack:smoke`。publish job 仅在 tag 时触发。
- Pre-commit hook（`.husky/pre-commit` → `scripts/pm-governance-precommit.mjs`）**只跑 PM 治理 gate**，不跑 biome/tsc/vitest：
  - `.hive/reports/<date>-*.html` 必须有同日 `.hive/research/<date>-*.md`（调研类双产出硬规则；`setup-guide / tutorial / handoff` 关键词命名的 report 豁免）
  - `.hive/plan.md` staged 时 warn：milestone 编辑要带 commit hash
  - 实现：staged 文件名扫描 + `git diff --cached`，不真跑测试

## 测试目录结构现状（2026-06-12 实点）

- `tests/server/*.test.ts` — 73 文件，真集成（startTestServer + 真 PTY + 真 sqlite + 真 HTTP）
- `tests/unit/*.test.ts` — 118 文件，纯函数 / store 契约 / 解析器 / RPC handler 单测
- `tests/cli/*.test.ts` — 5 文件，CLI 行为端到端（hive / team）
- `tests/web/*.test.{ts,tsx}` — 52 文件，jsdom + React Testing Library
- `packages/mobile/__tests__/*.test.ts` — 57 文件，RN 纯逻辑层（context-logic、relay-config-store、neural VAD、webrtc playback、relay-media-cache 等，不跑 RN runtime）
- `packages/relay-crypto/tests/unit/*.test.ts` — 1 文件（tweetnacl handshake / channel）
- `packages/relay/tests/unit/*.test.ts` — 2 文件（keygen、relay-server room 中转）
- 合计 ~323 测试文件

## TDD discipline from CLAUDE/AGENTS

- 集成测试（`tests/server/*` + `tests/cli/*`）**禁止 mock PTY/node-pty**；违反按假测试删
- 真集成 = 真 HTTP server + 真 store/SQLite + 真 PTY 在涉及时
- 不要为让测试过加 production fallback 分支
- 不要把 mock call 循环当 product behavior 断言
- 禁空断言 / 源字符串断言 / 单独 `not.toThrow()`
- 错误路径必须测：missing worker / DB failure / PTY failure / concurrent stop / exited agent
- 每条 assert 自问"产品代码完全写反这条还能过吗"——能就是假测试，看见即删
- schema 变化要走 migration，不允许在 store 里 ad hoc runtime ALTER

## 近期新增的真测试模式（2026-06，值得复制）

- **字节级 Uint8Array / Buffer 比对**：媒体分块重组测试用 `bytesEqual(decoded, source)`（mobile 端用 RN-safe Uint8Array）或 `Buffer.equals(reassembled, original)`（server 端）—— **不**用 base64 字符串相等（256KB 不是 3-byte 对齐，字符串拼接错也能"看起来一样"骗过）。anchor：`packages/mobile/__tests__/relay-media-cache.test.ts`、`tests/unit/relay-rpc-media-get.test.ts`
- **静态护栏 grep 模块源码**：单测里读模块 `*.ts` 文件，去注释/字符串字面量后 `expect(stripped).not.toMatch(/\bForbiddenSymbol\b/)`，防未来回归引入禁用 API（如 RN 模块不能用 `Buffer` 全局）。anchor：`packages/mobile/__tests__/relay-media-cache.test.ts` 末段
- **真 store 集成穿透 push 路径**：mobile 出站测试 `store.registerMobileChatListener(spy)` 注册 spy，再走 `store.insertMobileChatMessage` 验 listener 真 fire——这是 `app.ts:218 relayConnector.pushEvent('chat_message')` 的同一入口，不 mock pushEvent 也能验"推送链路通"。anchor：`tests/server/team-mobile-send-media.test.ts`
- **决策表纯函数测试**：UI 不可单测的 React 状态机抽成 pure function（`deriveMediaContentImageState({uri, previousUri, imageFailed, isDownloading})`），单测决策表所有分支 + 端到端时序模拟。anchor：`packages/mobile/__tests__/media-content-image-state.test.ts`
- **mutation 实验验红绿对称**：补测试时先临时改产品代码（如注释鉴权 line）跑测试看真挂红，再恢复跑全绿；report 里展示 mutation 失败 + 恢复绿。anchor：见 `tests/server/marketplace-catalog.test.ts` 'POST import 没 UI 凭证拒绝' 的 report 复盘
- **path-traversal + symlink 双层防**：路径校验测试一组 5+ 条覆盖（前缀错 / basename 含 `/` / `..` / 真 `symlinkSync` 注入 `/etc/passwd` / 指向 uploads 内合法文件也拒），Windows 自动 early-return 不假装通过。anchor：`tests/unit/relay-rpc-media-get.test.ts`

## Anchor 文件（按子系统）

- **Team protocol / dispatch / mobile-send**：`tests/server/team-api-authz.test.ts` + `tests/server/team-report-atomicity.test.ts` + `tests/server/team-mobile-send-media.test.ts`（outbound 视频/图片 → store → listener push）+ `tests/server/routes-team-cancel.test.ts`
- **PM 文档与 Cockpit**：`tests/unit/pm-baseline-doc.test.ts` + `tests/unit/pm-baseline-doc-staleness.test.ts` + `tests/unit/pm-tasks-doc.test.ts` + `tests/server/routes-cockpit-questions-answer.test.ts` + `tests/server/routes-cockpit.test.ts`（report-file path-traversal）+ `tests/server/marketplace-catalog.test.ts`（catalog + import 落 role_templates + UI 鉴权红绿）
- **Stalled dispatch / 状态机**：`tests/server/stalled-dispatch-nudge-pty.test.ts` + `tests/server/stalled-dispatch-user-surface.test.ts` + `tests/server/team-operations-orphan-reconcile.test.ts` + `tests/server/runtime-store.test.ts`（含 535cfca markAgentStarted='idle' 回归点位）
- **Agent spawn / Provider 隔离**：`tests/unit/agent-spawn-env.test.ts`（嵌套 Claude Code env strip）+ `tests/server/claude-provider-isolation.test.ts` + `tests/server/codex-provider-isolation.test.ts`
- **Voice / WebRTC / Relay**：`tests/unit/voice-understanding-buffer.test.ts` + `tests/unit/webrtc-callee.test.ts` + `tests/unit/webrtc-upstream-audio.test.ts` + `tests/unit/webrtc-file-downlink-audio.test.ts` + `tests/unit/webrtc-vad.test.ts` + `tests/unit/relay-rpc-handler.test.ts` + `tests/unit/relay-rpc-media-get.test.ts`（chunk + symlink + 鉴权 + 长度钳）+ `tests/unit/relay-deploy-templates.test.ts`
- **Mobile 客户端逻辑**：`packages/mobile/__tests__/relay-config-store.test.ts`（`dmit→aliyun` 迁移）+ `packages/mobile/__tests__/relay-media-cache.test.ts`（RN-safe base64 + 非法 base64 拒 + Buffer 静态护栏）+ `packages/mobile/__tests__/media-content-image-state.test.ts`（图片 render 决策表）+ `packages/mobile/__tests__/mobile-chat-settings-cluster-b.test.ts` + `packages/mobile/__tests__/mobile-runtime-webrtc-disconnect.test.ts` + `packages/mobile/__tests__/webrtc-file-downlink-playback.test.ts` + `packages/mobile/__tests__/chat-media.test.ts` + `packages/mobile/__tests__/app-config-version.test.ts`

## Before claiming done

- 报告 exact 命令和 pass/fail 末尾
- 如果某条必跑 gate 跑不了，写明原因和实际跑了什么
- 确认无关 dirty 文件没被 revert 或动过
- 派单禁止改测试时确认没改
- 编辑 `.hive/` 后跑 `git diff --check -- <changed .hive files>` 抓 trailing whitespace / markdown hygiene
- 编辑 baseline 后跑 `pnpm exec vitest run tests/unit/pm-baseline-doc.test.ts tests/unit/pm-baseline-doc-staleness.test.ts tests/unit/pm-tasks-doc.test.ts` 确认 parser 仍识别
- UI work：build 必须过 + 文本必须在目标容器内不溢出

## ⚠️ Device / ops gates still outside CI

- WebRTC server 已有 focused unit 覆盖，但 CI 没真 `@roamhq/wrtc` + TURN + mobile client 端到端通话；真回归靠真机 / runtime log
- File-segment playback / retract / call-state 已有 root + mobile 包测试，最终信心仍要真机确认"未播可撤、在播不撤"、speaking-gap、Orb phase、Android audio route
- **media.get 4G 真机下载链**：服务端测试覆盖 chunk + symlink + 长度钳；mobile RN-safe base64 + 决策表覆盖；但**真 4G + 真 relay 服务端 + 真 APK 下完真播放**仍是 device gate，必须张飞回归
- `aliyun.servasyy.com` / 计划迁 `relay.yunzhong2020.com` 仍有 code 外 ops gate：DNS/TLS/Web/`~/.config/hive/relay.json`/`HIVE_WEBRTC_ICE_SERVERS_JSON`/新 QR/APK 升级迁移/切换后 smoke
- Local STT/TTS、Expo audio、InCallManager、录音权限与设备 AEC 仍 device-sensitive；claim ship 要带 4010 runtime log + 手机侧证据，不只报 vitest 绿
- Self-built local Android build 仍是 release gate：`bash packages/mobile/build-local.sh`（脱离 EAS；详见 `.hive/research/2026-05-31-local-build-setup.md`）

## Known noisy but accepted test output

- PTY teardown 偶尔打印 `Unhandled pty write error EIO/EBADF` 但测试仍 pass
- Vite build 打印 Radix/lucide `"use client" was ignored` warnings
- jsdom 测试可能 log swallowed fetch/socket errors during intentional server shutdown
- Cold-start 首跑某些 React-Testing-Library 测试（如 `tests/web/terminal-view.test.tsx`）可能因 setTimeout 漂移偶发 flaky；afterEach 显式清 `document.body.innerHTML = ''` 是稳定的关键
