// 固定工作流(Opus 编排,andy 在 GLM 上执行)。
// 目的:对 HippoTeam 整个项目做一次彻底审查——8 个子系统并行深读真代码挖 bug/安全/回归/一致性,再综合成按严重度+置信度排序的优先级清单。
// 范式:fan-out(8 面并行,各读对应真文件) → synthesize(去重 + 净结论)。
// 相对 06-24 版:① schema 更到 v38 ② 新增第 8 面专审 2026-06-25~28 新改动(派单注入重写 / delivery-ack ledger / PTY 输出 buffer)的回归与交互。
// 运行:Workflow({ scriptPath: '<abs>/workflows/full-project-audit-2026-06-28.mjs' })
export const meta = {
  name: 'full-project-audit-2026-06-28',
  description: 'HippoTeam 全项目彻底审查(8 子系统并行深读真代码挖 bug/安全/一致性/回归 → 综合优先级清单)',
  phases: [
    { title: 'Audit', detail: '8 个子系统并行审查' },
    { title: 'Synthesize', detail: '去重 + 按严重度/置信度排序 + 净结论' },
  ],
}

const COMMON = `只读不改,必须真 ls/grep/read 仓库里的真文件再下结论,别凭文件名猜。逐条输出:文件:行 + 问题 + 触发条件 + 严重度(高/中/低) + 置信度(高=读到真代码确信/中=需复核/低=可能假阳性) + 是【真实可利用】还是【理论/纵深】+ 最小修复建议。基于真读到的代码,找不到问题就如实说"这块没发现问题"。别复述已知已修的东西。`

const SURFACES = [
  {
    key: 'runtime-dispatch-lifecycle',
    prompt: `审查【runtime / dispatch / agent 生命周期 脊柱】。读真文件:src/server/agent-manager.ts、agent-manager-support.ts、agent-runtime*.ts、runtime-store*.ts、dispatch-ledger-store.ts、agent-status-reconciler.ts、team-operations.ts、compact-recovery-watchdog.ts、stalled-dispatch-nudge.ts、sentinel-heartbeat.ts。找:状态真相源漂移/多写口竞态、静默吞错、PTY 启停泄漏/僵尸、dispatch 生命周期(submitted/reported/accept)边界、启动窗口误判、事件乱序(onError/onExit)。${COMMON}`,
  },
  {
    key: 'security-authz-guards',
    prompt: `审查【安全 / 鉴权 / 能力护栏】。读真文件:src/server/agent-manager.ts(env 白名单/PROXY/GLM key 剥离)、secret-store.ts、secret-redactor.ts、team-authz.ts、command-preset-capabilities*.ts、local-request-guard.ts、feishu-approval-ledger.ts、routes-*.ts(尤其 mobile/feishu/relay/diagnostics 入口)、ui-auth.ts、desktop/electron/path-env.mjs。找:密钥泄漏到错 provider / 经诊断包或 spawn 失败明文外泄、鉴权可绕过、高风险动作闸门漏洞、注入(命令/SQL/路径)、本地请求护栏绕过、autostart 可信边界、代理 URL 含凭据透传。这是命门,宁可多疑。${COMMON}`,
  },
  {
    key: 'voice-webrtc-tts',
    prompt: `审查【语音线:对讲 / 通话 / WebRTC / STT / TTS】(近期暴露多个真机 bug)。读真文件:src/server/fast-voice-reply.ts、webrtc-*.ts(upstream-audio/downlink-audio/file-downlink)、glm-turn-decision.ts、local-tts.ts、local-stt.ts、session-capture-codex.ts;packages/mobile/src/lib/push-to-talk.ts、neural-voice-vad.ts、packages/mobile/app/(tabs)/talk.tsx、app/call.tsx、webrtc-caller.ts。找:回声被当用户语音的自激循环(barge-in/AEC)、turn 永不收口、TTS 兜底链、通话崩溃(缺 native module)、并发/竞态、降级掩盖失败。${COMMON}`,
  },
  {
    key: 'relay-mobile-crossmachine',
    prompt: `审查【relay / 移动端 / 跨机】(当前真机连不上后台,v2 真机路未验)。读真文件:packages/relay/src/*(relay-server/keygen/index)、src/server/relay-*.ts(relay-connector/relay-config/relay-rpc-handler)、relay-crypto、src/server/routes-mobile.ts、mobile-push.ts;packages/mobile/src/api/relay-transport.ts、mobile-runtime-context.tsx、lib/relay-config-store.ts、connection-qr.ts。找:v2 强制无 v1 兜底导致真机连不上、房间/鉴权绕过、E2E 加密弱点、连接态多真相源漂移、断线/重连竞态、relay 帧处理边界、移动端配置存储/迁移/降级保护坑。${COMMON}`,
  },
  {
    key: 'desktop-packaging-deploy',
    prompt: `审查【桌面打包(Electron) / 部署健壮性 / Windows】(Windows 真机 pty 起即退未解决)。读真文件:desktop/electron/main.mjs、desktop/electron/path-env.mjs、runtime-launch.mjs、electron-builder.yml、src/cli/hive.ts、agent-command-resolver.ts、agent-manager.ts(COMMON_PARENT_ENV_KEYS 白名单)、scripts/。找:Windows 上 spawn 子进程瞬退的可能根因(env 白名单仍漏的变量、命令解析、cmd 包装、node-pty conpty/winpty 打包/asarUnpack 边界、stderr 丢失致诊断盲区)、GUI 启动环境重建缺口、端口冲突、未签名分发、原生模块跨平台。重点:为什么 ea3048a env 修复后 Windows 仍 pty exit。${COMMON}`,
  },
  {
    key: 'data-schema-persistence',
    prompt: `审查【数据 / schema / 持久化一致性】。读真文件:src/server/sqlite-schema.ts + sqlite-schema-v3*.ts(到 v38,含新 v38 input_acknowledged_at/input_delivery_failed_at)、dispatch-ledger-store.ts、workspace-store*.ts、runtime-store*.ts、各 *-store.ts。找:schema 迁移非幂等/对存量库不安全/丢数据、DB 写与内存写非原子、SQL 约束缺失、序列化/反序列化不一致、新字段(input_acknowledged_at/input_delivery_failed_at/evidence_json)的边界与对账、水合与运行期 reconcile 窗口。${COMMON}`,
  },
  {
    key: 'pm-governance-acceptgate',
    prompt: `审查【PM 文档体系 / accept-gate(M43) / tasks / cockpit】。读真文件:src/server/team-operations.ts(accept/report/reviewer 铁律)、tasks-file*.ts、cockpit-doc.ts、pm-*-doc.ts、hive-team-guidance.ts、dispatch-ledger-serializer.ts、diagnostics-support.ts。找:accept-gate 反作弊铁律是否仍焊死(reviewer 必须真审在 coder 之后+真 link、PM 无法伪造审过)、evidence 注入面、tasks.md 写口竞态、诊断导出脱敏面、L2 护栏可被 LLM 绕过的已知边界(诚实标注)。${COMMON}`,
  },
  {
    key: 'recent-changes-regression-0625-0628',
    prompt: `审查【2026-06-25~28 新改动的回归与交互】(这几天集中改了派单注入 + 投递确认 + PTY 输出 buffer,需重点查新代码本身 + 与既有路径的交互)。读真文件并聚焦最近改动:① src/server/post-start-input-writer.ts(claude busy/compact 检测、bracketed-paste ack 门控、CLAUDE_MAX_PASTE_ATTEMPTS 限次重试、onPasteAck/onPasteGaveUp 回调)② src/server/agent-manager-support.ts 的 RunOutputBuffer(chunk 数组 + headIndex 丢最老 + 惰性 join 缓存 + 写侧物理压缩;getter/setter 接入 run.output)③ src/server/stalled-dispatch-nudge.ts(90s delivery-unack surface + startupAt 防洪泛 + nudge 去重)④ src/server/dispatch-ledger-store.ts + team-operations.ts(input_acknowledged_at/input_delivery_failed_at 回写两条投递路径)。找:RunOutputBuffer 边界(单 chunk>max、压缩后 read 错位/stale、setter 灌回、并发读写、内存)、busy 正则误报/漏报、ack 门控下正常派单是否被拖延、delivery nudge 与旧 stalled/idle-self-heal/compact-watchdog 的叠加或重复、startupAt 取值是否导致新单永远跳过或历史单误报、回写竞态(markSubmitted 清空 vs 并发 ack)。这些虽经钟馗审过,你做独立第二视角,真读代码挑钟馗可能漏的交互。${COMMON}`,
  },
]

log('full-project-audit-0628 启动:8 子系统并行彻底审查真代码(含近几日新改动回归面)')

phase('Audit')
const reviews = await parallel(
  SURFACES.map((s) => () => agent(s.prompt, { label: `audit:${s.key}` })),
)

phase('Synthesize')
const sections = reviews
  .map((r, i) => (r ? `### 子系统:${SURFACES[i].key}\n${r}` : `### 子系统:${SURFACES[i].key}\n(该审查员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 8 个审查员对 HippoTeam 全项目各子系统的彻底审查。综合成一份给 PM 的优先级清单:
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
