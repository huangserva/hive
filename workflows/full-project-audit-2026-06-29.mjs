// 固定工作流(Opus 编排,andy 在 GLM 上执行)。
// 目的:对 HippoTeam 做一次【怀疑式/对抗式】全项目彻底审查。
// 触发背景:PM 一次次声称"根治",但派单/孤儿/汇报/worker 状态类 bug 反复复发
//   (今天又冒出 false-orphan + late-report 静默吞掉)。user 不信"根治",要一次真正完整的独立审计。
// 范式:fan-out(9 面并行,各读对应真文件,对抗式不信任既有"根治"声称) → synthesize(去重 + 净结论 + 专列"声称根治但仍复发"的结构性根因)。
// 当前代码状态:今天 30 commit 已合并到 main(a3a2851);relay 退回 v1(手机已连通);
//   false-orphan + late-report 修复在【工作树未提交】(team-operations.ts / dispatch-ledger-store.ts / sqlite-schema-v39.ts),需对抗式验证它到底成不成立。schema 到 v39。
// 运行:Workflow({ scriptPath: '<abs>/workflows/full-project-audit-2026-06-29.mjs' })
export const meta = {
  name: 'full-project-audit-2026-06-29',
  description: 'HippoTeam 怀疑式全项目彻底审查(9 子系统并行+对抗式验证"根治"声称 → 综合优先级清单+复发根因)',
  phases: [
    { title: 'Audit', detail: '9 个子系统并行对抗式审查' },
    { title: 'Synthesize', detail: '去重 + 净结论 + 复发结构性根因' },
  ],
}

const COMMON = `只读不改,必须真 ls/grep/read 仓库里的真文件再下结论,别凭文件名猜,也别信代码注释或 commit message 里"已根治/已修复"的声称——【对抗式】亲自读代码验证它到底成不成立。逐条输出:文件:行 + 问题 + 触发条件 + 严重度(高/中/低) + 置信度(高=读到真代码确信/中=需复核/低=可能假阳性) + 是【真实可利用】还是【理论/纵深】+ 最小修复建议。基于真读到的代码,找不到问题就如实说"这块没发现问题"。`

const SURFACES = [
  {
    key: 'dispatch-reliability-recurrence-ROOT',
    prompt: `【本次审计最高优先·对抗式】审查【派单/孤儿/汇报/worker 状态 可靠性的【结构性复发根因】】。背景:这一类 bug 被反复声称"根治"(delivery-ack 两层 ff062bc/17d1657、worker-status 派生投影 reconcile、compact-recovery watchdog、stale-dispatch、idle 自愈),但【今天又复发】=false-orphan(活着的 worker 跑 31min 长任务被 reconcileOrphanedDispatches 误判 stopped 而 orphan)+ late-report 被静默吞掉不注入 orch。
    读真文件:src/server/team-operations.ts(reconcileOrphanedDispatches/isReconcilableOrphan/late report 路径/orphan 判据)、dispatch-ledger-store.ts、runtime-store-helpers.ts(谁调 reconcileOrphanedDispatches)、agent-status-reconciler.ts / 派生状态、sentinel-heartbeat.ts、stalled-dispatch-nudge.ts、compact-recovery-watchdog.ts、post-start-input-writer.ts、agent-manager*.ts。
    必须回答:① reconcileOrphanedDispatches 在【运行期(无完整重启)】到底被什么路径触发?(静态只找到 runtime-store-helpers.ts:509 startup 唯一直接调用点,但今天无重启却在运行期触发了它——把真实触发链/或同进程 lifecycle 重建重跑 startup reconcile 的机制坐实,这是关键悬案)。② 今天工作树里的修复(orphan 改"连续二次确认 stoppedConfirmationMs"+ late report 补投 orch + late_report_forwarded_at 去重)——【对抗式验证】:若触发其实是 startup/重建跑一次,跨 tick 累积的 stopped candidate map 每次会被重置 → 二次确认永不累积 → 修复【失效】。判定这个修法对真实触发场景到底有没有效。③ 为什么这一类反复复发——是不是 worker 状态/dispatch 终态有【多个真相源仍未真正收敛成单一派生投影】、点修一直在补症状没动根?给出结构性根因 + 真正的治本方向(不是又一个点修)。${COMMON}`,
  },
  {
    key: 'runtime-dispatch-lifecycle',
    prompt: `审查【runtime / dispatch / agent 生命周期 脊柱】(除上面那条复发根因外的其余生命周期问题)。读真文件:src/server/agent-manager.ts、agent-manager-support.ts、agent-runtime*.ts、runtime-store*.ts、dispatch-ledger-store.ts、agent-status-reconciler.ts、team-operations.ts、compact-recovery-watchdog.ts、sentinel-heartbeat.ts。找:状态真相源漂移/多写口竞态、静默吞错、PTY 启停泄漏/僵尸、dispatch 生命周期(submitted/reported/accept)边界、启动窗口误判、事件乱序(onError/onExit)、schema v39 late_report_forwarded_at 接入边界。${COMMON}`,
  },
  {
    key: 'security-authz-guards',
    prompt: `审查【安全 / 鉴权 / 能力护栏】。读真文件:src/server/agent-manager.ts(env 白名单/PROXY/GLM key 剥离)、secret-store.ts、secret-redactor.ts、team-authz.ts、command-preset-capabilities*.ts、local-request-guard.ts、feishu-approval-ledger.ts、routes-*.ts(尤其 mobile/feishu/relay/diagnostics 入口)、ui-auth.ts、desktop/electron/path-env.mjs、relay-room-auth.ts(今天新抽出)。找:密钥泄漏到错 provider / 经诊断包或 spawn 失败明文外泄、鉴权可绕过、高风险动作闸门漏洞、注入(命令/SQL/路径)、本地请求护栏绕过、autostart 可信边界、代理 URL 含凭据透传、relay v1 退回后 auth token 处理。这是命门,宁可多疑。${COMMON}`,
  },
  {
    key: 'voice-webrtc-tts',
    prompt: `审查【语音线:对讲 / 通话 / WebRTC / STT / TTS】。读真文件:src/server/fast-voice-reply.ts、webrtc-*.ts(upstream-audio/downlink-audio/file-downlink)、glm-turn-decision.ts、local-tts.ts、local-stt.ts、session-capture-codex.ts;packages/mobile/src/lib/push-to-talk.ts、neural-voice-vad.ts、packages/mobile/app/(tabs)/talk.tsx、app/call.tsx、webrtc-caller.ts。找:回声被当用户语音的自激循环(barge-in/AEC)、turn 永不收口、TTS 兜底链、通话崩溃(缺 native module)、并发/竞态、降级掩盖失败。${COMMON}`,
  },
  {
    key: 'relay-mobile-crossmachine',
    prompt: `审查【relay / 移动端 / 跨机】(今天 daemon 退回 v1 已让手机连通;v2 代码保留待服务器升级)。读真文件:packages/relay/src/*(relay-server/keygen/index)、src/server/relay-*.ts(relay-connector/relay-config/relay-rpc-handler/relay-room-auth)、relay-crypto、src/server/routes-mobile.ts、mobile-push.ts;packages/mobile/src/api/relay-transport.ts、mobile-runtime-context.tsx、lib/relay-config-store.ts、connection-qr.ts、connection-qr-scan.ts。找:v1/v2 协议切换边界(默认 v1 是否真不发 v2 字段、env 切 v2 是否完整)、房间/鉴权绕过、E2E 加密弱点、连接态多真相源漂移、断线/重连竞态、LAN host 失效不切 relay 死区、relay 帧处理边界、移动端配置存储/迁移/降级保护坑。${COMMON}`,
  },
  {
    key: 'desktop-packaging-deploy',
    prompt: `审查【桌面打包(Electron) / 部署健壮性 / Windows】(今天 30 commit 桌面打包刚合并 main;发布包缺 relay keygen 模块的 P0 刚修=deriveRoomAuthToken 抽到 src/server/relay-room-auth.ts)。读真文件:desktop/electron/main.mjs、path-env.mjs、runtime-launch.mjs、electron-builder.yml、package.json(files)、scripts/prepare-build-artifacts.mjs、scripts/pack-smoke.mjs、src/cli/hive.ts、agent-command-resolver.ts、agent-manager.ts。找:还有没有【其它 server runtime import 了 monorepo 源码路径但发布包没含】的同类打包 P0(用 grep 找 ../../packages/ import)、Windows spawn 子进程瞬退根因(env 白名单仍漏、命令解析、cmd 包装、node-pty conpty 打包/asarUnpack、stderr 丢失致盲)、GUI 启动环境重建缺口、端口冲突、未签名分发、.env 是否仍可能进分发包。${COMMON}`,
  },
  {
    key: 'data-schema-persistence',
    prompt: `审查【数据 / schema / 持久化一致性】。读真文件:src/server/sqlite-schema.ts + sqlite-schema-v3*.ts(到 v39,含今天新 v39 late_report_forwarded_at)、dispatch-ledger-store.ts、workspace-store*.ts、runtime-store*.ts、各 *-store.ts。找:schema 迁移非幂等/对存量库不安全/丢数据、v39 加列对存量库安全性、DB 写与内存写非原子、SQL 约束缺失、序列化/反序列化不一致、新字段(late_report_forwarded_at/input_acknowledged_at/evidence_json)的边界与对账、水合与运行期 reconcile 窗口。${COMMON}`,
  },
  {
    key: 'pm-governance-acceptgate',
    prompt: `审查【PM 文档体系 / accept-gate(M43) / tasks / cockpit / 前端白屏加固】。读真文件:src/server/team-operations.ts(accept/report/reviewer 铁律)、tasks-file*.ts、cockpit-doc.ts、pm-*-doc.ts、hive-team-guidance.ts、diagnostics-support.ts;web/src/ui/ErrorBoundary.tsx、cockpit/cockpit-normalize.ts、terminal/terminal-control-frame.ts、terminal/pending-output-buffer.ts。找:accept-gate 反作弊铁律是否仍焊死(reviewer 必须真审在 coder 之后+真 link、PM 无法伪造审过)、tasks.md 写口竞态、诊断导出脱敏面、白屏加固(ErrorBoundary/payload normalize/control 帧校验/终端 ack)是否真覆盖所有渲染硬访问与坏帧、L2 护栏可被 LLM 绕过的已知边界(诚实标注)。${COMMON}`,
  },
]

log('full-project-audit-0629 启动:怀疑式 9 子系统并行彻底审查,对抗式验证反复声称的"根治"是否成立')

phase('Audit')
const reviews = await parallel(
  SURFACES.map((s) => () => agent(s.prompt, { label: `audit:${s.key}` })),
)

phase('Synthesize')
const sections = reviews
  .map((r, i) => (r ? `### 子系统:${SURFACES[i].key}\n${r}` : `### 子系统:${SURFACES[i].key}\n(该审查员未返回结果)`))
  .join('\n\n')

const synthesis = await agent(
  `下面是 ${SURFACES.length} 个审查员对 HippoTeam 全项目各子系统的【对抗式】彻底审查。综合成一份给 PM 的优先级清单:
① 去重(同一处被多面命中的合并)。
② 每条标:文件:行 / 问题 / 子系统 / 严重度(高/中/低) / 置信度(高/中/低,因为后续会有独立 codex reviewer 钟馗逐条核,你诚实标注帮他聚焦) / 真实可利用 vs 理论/纵深 / 最小修复建议。
③ 按"该立刻修"排序。
④ 顶部给净结论:全项目当前健康度概览 + 有没有【高危/阻塞】项(列编号)+ 哪几块最该优先治。
⑤ 各子系统一句话健康度速览。
⑥ 【单列一节·复发结构性根因】:针对"派单/孤儿/汇报/worker 状态反复声称根治却复发"——综合 dispatch-reliability-recurrence-ROOT 面的发现,明确说:真正的结构性根因是什么、今天工作树里那个 orphan 修复到底成不成立、治本方向(不是又一个点修)。这是 user 最在意的,要给硬结论别和稀泥。
只综合这些输入 + 真读到的代码,不要新编、不要把猜测当事实。

${sections}`,
  { label: 'synthesize' },
)

return { surfaces: SURFACES.map((s) => s.key), synthesis }
