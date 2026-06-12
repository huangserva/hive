# Risk Hotspots

> 代码里最易出 bug / 最脆弱的区域。每条带"为什么脆 + 踩过的坑 + 现有防护"，operational 取向。
> **DRAFT 2026-06-12（马超 refresh，待 user 校对）** — 基于 06-09 至今 41 次 commit + 真实代码读核：新增 relay media.get / RN-safe base64 / tasks-watcher ENFILE / agent-spawn-env / markAgentStarted / L1 dispatch 状态机 / marketplace 7 个热点；aliyun→yunzhong2020 hard cut 已落地（旧 aliyun/dmit 降级为 legacy 迁移源）。

## Relay media.get（媒体走 relay 服务端）

- 为什么脆：用户给的 `url=/api/mobile/uploads/<basename>` 直接映射到本地文件读取，是典型 path-traversal + symlink 逃逸 + 协议错配三重攻击面；chunk 协议如果错配 offset/length 会让恶意/出错服务端把另一文件的字节伪造成"正常下载"。
- 踩过的坑：钟馗审 bc96876 时挑出 `realpathSync` 缺失（`ln -s /etc/passwd uploads/<uuid>.mp4` 能让 statSync/openSync 跟随 symlink 读 uploads 外文件）；分块协议早期没用真 decode 的 length 校验，只按字符串长度估算 → `data='!!!!' length=3` 能骗过校验写坏缓存。
- 现有防护（`src/server/relay-rpc-handler.ts:107-166,583-650`）：3 层路径校验（前缀强制 + `[A-Za-z0-9_.-]+` 白名单 + `resolve` startsWith） + `verifyUploadPathNotSymlink`（`lstatSync` 拒 symlink + `realpathSync` 双向比对）+ 鉴权 `read_dashboard`；chunk 流式 `openSync/readSync` 不读全文件入内存；length 钳 [1KB, 1MB]；offset 超 total_size 早拒。测试 `tests/unit/relay-rpc-media-get.test.ts`（12 条含 2 条真 `symlinkSync` 注入，Windows early-return 不假装通过）。
- Watch：任何新 relay 文件 serve 方法必须复用 `resolveSafeUploadPath + verifyUploadPathNotSymlink`，不能各自实现一套字符串校验。

## Mobile RN-safe base64 / 分块重组（Hermes 真机命门）

- 为什么脆："单测 Node 上跑绿，真机 Hermes 崩"是典型陷阱——Node 全局有 `Buffer`，Hermes 没（RN 0.85 默认无 Buffer polyfill）；任何不小心引用 `Buffer.from/concat/equals` 的 mobile lib 在真机 ReferenceError 必崩。
- 踩过的坑：bc96876 首版 `combineBase64Chunks` 用 `Buffer.from/Buffer.concat`，单测全绿（Node 跑），钟馗 blocking #1 标"真机必崩"；同时旧 `decodeBase64ToByteLength` 按字符串长度公式估算 base64 → `data='AAAAAA==' length=5` 假报告 4 字节 vs header 5 不一致都骗不出来（blocking #4）。
- 现有防护（`packages/mobile/src/lib/relay-media-cache.ts:1-230`）：base64 走 `@huangserva/hippoteam-relay-crypto` 的 `decodeBase64/encodeBase64`（`atob/btoa + Uint8Array`，Hermes 标配已 proven 在生产 relay 路径用了几个月）；逐 chunk 真 decode 用 `decoded.length` 校验 `response.length`，恶意 base64 抛 `chunk base64 decode failed`；`concatChunks` 纯 JS `Uint8Array.set` 不依赖 Buffer。**静态护栏**：`packages/mobile/__tests__/relay-media-cache.test.ts` 末段 grep 模块源码去注释/字符串字面量后 `.not.toMatch(/\bBuffer\b/)`，防未来回归引入。
- Watch：任何 mobile lib 改 base64/binary 必须复用同一组 util；新增 mobile npm 依赖时确认它不假设 Node 全局 Buffer。

## tasks-file-watcher（fd 耗尽 ENFILE）

- 为什么脆：chokidar 递归 watch glob 在每个匹配文件上消耗 1 个 fd；Linux inotify 上限默认 ~8192；如果 `.hive/reports/**` 被塞入视频逐帧 jpg 海/帧序列（外部项目把素材误放进 reports/assets/），fd 一次性耗尽 → node-pty `forkpty` 拿不到 TTY → worker 启动 ~2s exit 1。
- 踩过的坑：idea-13 2026-06 user 跨机调研定位（serva CatVacuumGame amy 把逐帧 jpg 塞进 reports/assets 复现）；hive-serva 本机 macOS fsevents + reports/assets 空 + fd=75 健康，未爆——但平台差异（Linux inotify）下会爆，是真实潜伏雷。
- 现有防护（`src/server/tasks-file-watcher.ts:26-115`）：watch glob 显式收窄到 `reports/*.html` / `reports/*.md`，不再 `reports/**`；非 markdown 资产（jpg/mp4/帧序列）永不进 watch 列表。测试 `tests/unit/tasks-file-watcher.test.ts` 锁死不再出现 `reports/**` 这条 glob。
- Watch：新增 PM 文档类型（如 `decisions/screenshots/`）要在 glob 显式列出，不能加 `**`；reports/assets 类二进制资产必须放进 `.gitignore` 的子目录或独立 storage。

## agent-spawn-env（嵌套 Claude Code env strip）

- 为什么脆：4010 在 Claude Code 会话内启动时，Claude Code 自动注入 `CLAUDECODE/CLAUDE_CODE_ENTRYPOINT/CLAUDE_CODE_EXECPATH/CLAUDE_CODE_SESSION_ID/CLAUDE_EFFORT/AI_AGENT` 等嵌套 marker；如果原样传给 worker PTY，worker 启的 claude CLI 会以为自己 nested → session capture/resume 混乱、orch 派单失败。但 strip 太狠又会误删 user 主动 export 的 `CLAUDE_CODE_OAUTH_TOKEN / CLAUDE_CODE_USE_BEDROCK / CLAUDE_CODE_USE_VERTEX` 等运行时依赖 env，导致企业用户/OAuth 用户 worker 起不来——这是另一种"起不来"。
- 踩过的坑：bed6ebc 首版用 `key.startsWith('CLAUDE_CODE_')` 一刀切，钟馗审挑出会误删 8+ 个用户主动 env；改用 explicit set 才闭合。
- 现有防护（`src/server/agent-manager.ts:66-78`）：`NESTED_CLAUDE_CODE_ENV_KEYS` Set 显式列 6 个 marker，不再 prefix 守卫；`startAgent` 唯一入口经 `createAgentSpawnEnv` strip。测试 `tests/unit/agent-spawn-env.test.ts` 含 `CLAUDE_CODE_FUTURE_MARKER` 兜底测 + `CLAUDE_PROJECTS_ROOT / OAUTH_TOKEN` 保留断言。
- Watch：Claude Code 未来版本加新 nested marker（如 `CLAUDE_CODE_PARENT_PID`）要显式补 set，不能恢复 prefix 守卫。

## markAgentStarted 状态机（5527a8a worker restart）

- 为什么脆：worker 重启时（[Restart] 或 4010 重启后用户点 [Restart]），如果 status 从 pendingTaskCount derive，旧 dispatch 残留让 status 算成 'working' 但 PTY 实际刚启 idle 等 prompt → UI 误显示工作中，给 PM "看着像在工作"假象，崩 crash WIP 留工作树时尤其误导。
- 踩过的坑：idea-13 user 原话"worker 起不来/状态错"——6/10 赵云/关羽 crash WIP 留工作树后，PM Restart 看 UI 显示 working = 假象，要手动 git diff 才能发现没人在做。上游 535cfca 同款修法 backport。
- 现有防护（`src/server/workspace-store-mutations.ts:43-51`）：`markAgentStarted` 硬置 `agent.status = 'idle'`；下次 `markTaskDispatched` 才转 'working'。`pendingTaskCount` 不归零给 WorkerModal/recovery 看 backlog。测试 `tests/server/runtime-store.test.ts` 2 条新断言含 idea-13 case 回归。
- Watch：dispatch 状态机的"working"语义现在严格等于"PTY 当前在跑 dispatch"，不是"有未完成 dispatch"——改 markTaskDispatched / markAgentStopped 时要保此契约。

## L1 dispatch 状态机扩展（5efc986 + 协议硬收口）

- 为什么脆：dispatch_ledger 从旧 3 态（queued/submitted/reported）扩到 8 态（+ running / report_overdue / completed / cancelled / orphaned），状态迁移规则散在 team-operations / stalled-dispatch-nudge / sentinel / mobile-reply / mobile-send-media 多处；任意一处忘改状态判定 isOpenDispatchStatus 会让 stale dispatch 看上去仍 open，sentinel 误捅或 worker 拿到过期派单。
- 踩过的坑：6e19307b orphaned 收口后 cancel 返 409 因 orphaned 非 open 状态——是预期行为，但旧 doc 描述 orph→close 用 cancel 的 UX 不再成立；narrative 注明已收口才闭环。
- 现有防护：`dispatch-ledger-store.ts` 唯一状态转换函数、`isOpenDispatchStatus` 单一判定源；`team-operations.ts` 报错 400 缺 dispatch_id；`tests/server/team-report-atomicity.test.ts` + `tests/server/team-mobile-send-media.test.ts` + `tests/unit/dispatch-ledger-store.test.ts` 覆盖完整状态机。
- Watch：新增状态时要回头检查 isOpenDispatchStatus / report_overdue 计算 / Cockpit stale 计数三个使用点。

## Mobile LAN auth / capability 控制

- 为什么脆：`mobile_devices` token 既鉴权 dashboard 读又鉴权 dispatch/stop/restart 等控制动作；scope bug 可让错误设备/workspace 拿到控制权。
- 现有防护（`src/server/mobile-auth.ts` + `routes-mobile.ts` + `relay-rpc-handler.ts:184-210`）：`requireCapability(read_dashboard/send_prompt/approve_risk/admin_runtime/read_terminal/control_worker/upload)` 每个 endpoint 必带；`tests/server/mobile-routes.test.ts` 含负向 403 测试。
- Watch：每个新 `/api/mobile/*` 或 `relay-rpc` 方法必须 named capability；`media.get` 走 `read_dashboard`（已 audit）；marketplace `import` 走 UI cookie（admin 路径）。

## Mobile 客户端 LAN/relay 路径双重实现

- 为什么脆：mobile client 行为可能在 LAN HTTP/WS 路径和 relay JSON-RPC fallback 路径之间分叉；新增控制端点要同时改 LAN route mapping 与 relay method mapping，漏一边就出现"WiFi 能做 4G 不能"的 user-visible bug。
- 现有防护：`tests/unit/relay-rpc-handler.test.ts`（28 测）+ `tests/unit/relay-rpc-media-get.test.ts`（12 测）覆盖 relay 端；`tests/server/mobile-routes.test.ts` 覆盖 LAN 端；`packages/mobile/__tests__/relay-transport.test.ts` 覆盖握手/call/fallback。
- Watch：新增 endpoint 必须 LAN + relay 双 mapping；现有缺口 → media.get **没有** LAN HTTP 对端（直连即可不需要 relay），但**反过来** mobile-send-media 当前只走 LAN（POST /api/team/mobile-send-media），relay 路径未补——这是 PM 已知 follow-up。

## Relay 域名 hard cut（yunzhong2020 已落地，aliyun/dmit legacy）

- 为什么脆：域名迁移必须**新 APK + QR/pairing + Mac `~/.config/hive/relay.json` + 公网 deploy 模板 + WebRTC/TURN 对外口径**一起切到 yunzhong2020；漏一项会出现新旧 host 混跑。旧 `aliyun.servasyy.com` 未备案被阿里云 SNI RST 是真踩过的坑，再迁错域名同样问题。
- 现有防护（de75d73 落地）：`packages/mobile/src/lib/relay-config-store.ts:8` `LEGACY_RELAY_HOSTS = Set([dmit, aliyun])` + `CURRENT_RELAY_HOST = relay.yunzhong2020.com`；hydration 自动从两个 legacy host 迁移到 current；4 个 deploy 模板（Caddyfile / nginx / relay.json / README）全 yunzhong2020；`tests/unit/relay-deploy-templates.test.ts` 测试 legacy host 不再出现。
- Residual：**旧 QR 原始内容仍可能写着 dmit 或 aliyun**；新 app 会迁移落盘，旧 app 不会触发迁移；user 长期不升级就续旧 host。
- Watch：未来再迁要先备案再切，不要又踩 SNI RST；Mac 侧 `~/.config/hive/relay.json` 不在 repo 内，update 仍要 user 手动改。

## WebRTC realtime call path（M37/M38/M40）

- 为什么脆：信令/TURN/native audio/上行 STT/下行 TTS/barge-in 多层互动；server `@roamhq/wrtc` native binding 必装；M40 加投机/撤回协议后 generation/intent_generation 一致性是新失败点。
- 现有 SPOF：TURN 单节点 `106.14.227.192`（阿里云上海 coturn）；公共 openrelay 中国不可达。
- 现有防护：`tests/unit/webrtc-callee.test.ts` + `webrtc-upstream-audio.test.ts` + `webrtc-file-downlink-audio.test.ts` + `webrtc-vad.test.ts` + `packages/mobile/__tests__/webrtc-file-downlink-playback.test.ts` 覆盖核心；`HIVE_WEBRTC_FORCE_RELAY=1` iceTransportPolicy:'relay' 兜底；`HIVE_WEBRTC_DOWNLINK_GAIN` env 调音；retract 不变量"未播可撤、在播不撤"由 generation 映射锁。
- Watch：server-side `webrtc-*.ts` 没真 `@roamhq/wrtc + TURN + mobile` 端到端 CI 覆盖；ship 仍靠真机 + runtime log；M40 Phase 3 GRM Turn 协议仍在途。

## Neural voice VAD（Silero ONNX, mobile）

- 为什么脆：`onnxruntime-react-native` native binding 可 `.install()` FATAL 崩；threshold drift 会破 barge-in；probe→shadow→takeover flag 顺序漏一步真机回归。
- 现有防护：catch-before-import native probe + config plugin 注册 `OnnxruntimePackage`；feature flag 分阶段隔离；`[SILERODBG]` log 真机调阈值；`packages/mobile/__tests__/silero-vad-shadow*.test.ts` 覆盖状态机。
- Watch：升级 onnxruntime-react-native 或 OS 升级时要重跑真机回归。

## GLM 快嘴前台（fast-voice-reply + GRM Turn）

- 为什么脆：依赖外部 GLM API；超时/降级链不收敛会卡用户；prompt 漂移让前台 over-claim dispatch（其实只能 PM 做）。
- 现有防护：`HIVE_GLM_GATEKEEPER=0` 回滚开关；timeout/abort → null fallback；`appendFastReplyCoordination` 限制前台不许冒充 PM；`tests/unit/fast-voice-reply.test.ts` + `tests/unit/voice-understanding-buffer.test.ts` + `tests/unit/grm-turn-decision*.test.ts` 覆盖决策表（handled/escalate/drop/incomplete）。
- Watch：GLM 模型升级（glm-4-flash → glm-5.1 → 新版）prompt 兼容性要重测；M40 Phase 3 GRM Turn 协议落地后系统消息格式不能再变。

## Sentinel / orphaned dispatch 检测

- 为什么脆：sentinel 巡检/exit fallback 误分类可能把慢 worker 标 stale，或漏真卡死 dispatch。
- 现有防护：sentinel 走 `team status` 不再被旧文案引导到 `team report` 400（db30351）；stalled-dispatch-nudge 在 worker 回 idle 提示符 + submitted 未报后才 nudge；M30 user-surface pass 把 stale/escalated 推 dashboard 不静默。
- Watch：sentinel 角色不应接正常 dispatch（已 PROTOCOL 锁）；若新增 nudge channel 要复用同款判定源 `summarizeStaleDispatches`。

## Marketplace catalog（6bae080 Phase 1）

- 为什么脆：catalog 导入是 admin 路径，鉴权丢/越权会让任意 UI 凭证创建假 role_templates；catalog 是 read-only 内存数据，如果误改成可写 DB 会引入两套真源不一致。
- 踩过的坑：钟馗审 6bae080 挑出 POST import 路径缺无授权红绿测试 → 补 mutation 实验（临时注释鉴权看真挂红）才闭环。
- 现有防护（`src/server/marketplace-catalog.ts` + `routes-settings.ts:207-250`）：catalog 是 TS const array read-only；导入即 `roleTemplateStore.create`，不并存两套真源；`tests/server/marketplace-catalog.test.ts` 13 测含 4xx 未授权红绿 + 不会落进 role_templates 表的端到端断言。
- Watch：未来如 Phase 2/3 拉远程 catalog.json，必须 immutable read 缓存，不能让远程数据直接污染 role_templates。

## PM 文档 / baseline drift

- 为什么脆：schema 改、mobile/relay 大变、PM nudge 加项时，`.hive/baseline/*.md` 比代码更新更慢；老化的 risk-hotspot 让 PM 误判攻击面或维护成本。
- 现有防护：baseline staleness git-log 检测（`baseline-doc-staleness` parser）+ Cockpit baseline aiAction 自动红条 + milestone completion nudge；pre-commit governance 检查 reports/research 双产出（不跑 biome/tsc/vitest）；每条 baseline ≤200 行硬规则。
- Watch：≥30 commit drift 时 PM 必须派 refresh 单（本单就是触发点）；不能等 user 直接喷"baseline 又老了"。

## Web 资产 / 端口混淆

- 为什么脆：dev 5180 Vite HMR vs prod 4010 用户访问端口；rebuild 后旧 tab chunk 失效；user 不知该看哪端口。
- 现有防护：index.html no-cache + assets immutable + preload-recovery auto-reload；reconnecting WebSocket backoff；`tests/web/preload-recovery.test.ts` + `reconnecting-websocket.test.ts`。
- Check：诊断 UI bug 前先确认 user 端口（4010 才是 runtime UI；5180 是 dev HMR），可省一半排查时间。

## Local data / secrets

- 为什么脆：`.hive/` 是 workspace state；credentials + runtime DB/logs 在 `~/.config/hive`；误 commit 会泄漏。
- 现有防护：v2.0.0 后 `.hive/` 大多 .gitignore；pre-commit 治理检 reports/research pairing；secrets 只在 `~/.config/hive` 不在 repo。
- Check：commit 前 review `git status --short`；只 force-add 显式 baseline 文档。
