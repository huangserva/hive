// 固定工作流(Opus 编排,andy 在 GLM 上执行)。
// 目的:对 HippoTeam 整个项目做一次彻底审查——7 个子系统并行深读真代码挖 bug/安全/回归/一致性,再综合成按严重度+置信度排序的优先级清单。
// 范式:fan-out(7 面并行,各读对应真文件) → synthesize(去重 + 净结论)。
// 运行:Workflow({ scriptPath: '<abs>/workflows/full-project-audit-2026-06-24.mjs' })
export const meta = {
  name: 'full-project-audit-2026-06-24',
  description: 'HippoTeam 全项目彻底审查:7 子系统并行深读真代码挖 bug/安全/一致性 → 综合优先级清单',
  phases: [
    { title: 'Audit', detail: '7 个子系统并行审查' },
    { title: 'Synthesize', detail: '去重 + 按严重度/置信度排序 + 净结论' },
  ],
}

const COMMON = `只读不改,必须真 ls/grep/read 仓库里的真文件再下结论,别凭文件名猜。逐条输出:文件:行 + 问题 + 触发条件 + 严重度(高/中/低) + 置信度(高=读到真代码确信/中=需复核/低=可能假阳性) + 是【真实可利用】还是【理论/纵深】+ 最小修复建议。基于真读到的代码,找不到问题就如实说"这块没发现问题"。别复述已知已修的东西。`

const SURFACES = [
  {
    key: 'runtime-dispatch-lifecycle',
    prompt: `审查【runtime / dispatch / agent 生命周期 脊柱】。读真文件:src/server/agent-manager.ts、agent-runtime*.ts、runtime-store*.ts、dispatch-ledger-store.ts、agent-status-reconciler.ts、team-operations.ts、compact-recovery-watchdog.ts、sentinel-heartbeat.ts。找:状态真相源漂移/多写口竞态、静默吞错、PTY 启停泄漏/僵尸、dispatch 生命周期(submitted/reported/accept)边界、启动窗口误判、事件乱序(onError/onExit)。${COMMON}`,
  },
  {
    key: 'security-authz-guards',
    prompt: `审查【安全 / 鉴权 / 能力护栏】。读真文件:src/server/agent-manager.ts(env 白名单/PROXY/GLM key 剥离)、team-authz.ts、command-preset-capabilities*.ts、local-request-guard.ts、feishu-approval-ledger.ts、routes-*.ts(尤其 mobile/feishu/relay 入口)、ui-auth.ts、desktop/electron/path-env.ts(新增,GUI 启动注入 PATH/proxy 的安全面)。找:密钥泄漏到错 provider、鉴权可绕过、高风险动作闸门漏洞、注入(命令/SQL/路径)、本地请求护栏绕过、autostart 可信边界(M4 已知)、代理 URL 含凭据透传。这是命门,宁可多疑。${COMMON}`,
  },
  {
    key: 'voice-webrtc-tts',
    prompt: `审查【语音线:对讲 / 通话 / WebRTC / STT / TTS】(近期暴露多个真机 bug)。读真文件:src/server/fast-voice-reply.ts、webrtc-*.ts(upstream-audio/downlink-audio/file-downlink)、grm-turn-decision.ts、local-tts.ts、local-stt.ts、session-capture-codex.ts;packages/mobile/src/lib/push-to-talk.ts、neural-voice-vad.ts、packages/mobile/app/(tabs)/talk.tsx、app/call.tsx、webrtc-caller.ts。找:回声被当用户语音的自激循环(barge-in/AEC)、turn 永不收口、TTS 兜底链(edge-tts 失败→say)、通话崩溃(缺 native module)、并发/竞态、降级掩盖失败。${COMMON}`,
  },
  {
    key: 'relay-mobile-crossmachine',
    prompt: `审查【relay / 移动端 / 跨机】。读真文件:packages/relay/src/*(relay-server/keygen/index)、src/server/relay-*.ts(relay-connector/relay-config/relay-rpc-handler)、relay-crypto、src/server/routes-mobile.ts、mobile-push.ts;packages/mobile/src/api/relay-transport.ts、mobile-runtime-context.tsx、lib/relay-config-store.ts、connection-qr.ts。找:房间/鉴权绕过、E2E 加密弱点、连接态多真相源漂移、断线/重连竞态、relay 帧处理边界、移动端单连接存储/迁移逻辑坑。${COMMON}`,
  },
  {
    key: 'desktop-packaging-deploy',
    prompt: `审查【桌面打包(Electron) / 部署健壮性】(新代码)。读真文件:desktop/electron/main.mjs、desktop/electron/path-env.ts/.mjs、electron-builder.yml、src/cli/hive.ts、agent-cli-installer.ts、scripts/prepare-build-artifacts.mjs。找:GUI 启动环境重建的剩余缺口(PATH/proxy 之外还漏什么 env?系统代理读不到的边界)、登录 shell 读取的超时/容错/注入风险、原生模块打包/asar 边界、端口冲突处理、首启动/数据目录、未签名分发风险。${COMMON}`,
  },
  {
    key: 'data-schema-persistence',
    prompt: `审查【数据 / schema / 持久化一致性】。读真文件:src/server/sqlite-schema.ts + sqlite-schema-v3*.ts(到 v37)、dispatch-ledger-store.ts、workspace-store*.ts、runtime-store*.ts、各 *-store.ts。找:schema 迁移非幂等/对存量库不安全/丢数据、DB 写与内存写非原子、SQL 约束缺失、序列化/反序列化不一致、evidence_json/accept_verdict 等新字段的边界、水合(hydration)与运行期对账的窗口。${COMMON}`,
  },
  {
    key: 'pm-governance-acceptgate',
    prompt: `审查【PM 文档体系 / accept-gate(M43) / tasks / cockpit】。读真文件:src/server/team-operations.ts(accept/report/reviewer 铁律)、tasks-file.ts、cockpit-doc.ts、pm-*-doc.ts、hive-team-guidance.ts、dispatch-ledger-serializer.ts;以及 M43 Phase 2 新代码(分页 findDispatchesByIdPrefix、evidence bundle)。找:accept-gate 反作弊铁律是否仍焊死(reviewer 必须真审在 coder 之后+真 link、PM 无法伪造审过)、分页修复有无新漏洞、evidence 注入面、tasks.md 写口竞态、L2 护栏可被 LLM 绕过的已知边界(诚实标注)。${COMMON}`,
  },
]

log('full-project-audit 启动:7 子系统并行彻底审查真代码')

phase('Audit')
const reviews = await parallel(
  SURFACES.map((s) => () => agent(s.prompt, { label: `audit:${s.key}` })),
)

phase('Synthesize')
const sections = reviews
  .map((r, i) => (r ? `### 子系统:${SURFACES[i].key}\n${r}` : `### 子系统:${SURFACES[i].key}\n(该审查员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 7 个审查员对 HippoTeam 全项目各子系统的彻底审查。综合成一份给 PM 的优先级清单:
① 去重(同一处被多面命中的合并)。
② 每条标:文件:行 / 问题 / 子系统 / 严重度(高/中/低) / 置信度(高/中/低,因为后续会有独立 codex reviewer 钟馗逐条核,你诚实标注帮他聚焦) / 真实可利用 vs 理论/纵深 / 最小修复建议。
③ 按"该立刻修"排序。
④ 顶部给净结论:全项目当前健康度概览 + 有没有【高危/阻塞】项(列编号)+ 哪几块最该优先治。
⑤ 各子系统一句话健康度速览。
只综合这些输入 + 真读到的代码,不要新编、不要把猜测当事实。

${sections}`,
  { label: 'synthesize' },
)

return { surfaces: SURFACES.map((s) => s.key), synthesis }
