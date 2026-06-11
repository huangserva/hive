# Tasks

> 长 narrative 和决策上下文在 `.hive/handoff.html` 和 `.hive/reports/*.html`。
> 这个文件只放 GFM checkbox 格式的当前 sprint 任务和历史归档。

## In progress

> 📦 **2026-06-12 通宵｜上游 tt-a1i/hive triage 4 项 backport — ✅ 全 ship**（当前活跃）
>
> user 拍板把 triage（[reports/2026-06-11-upstream-hive-triage.html]）里值得拿的全做，每件不同人 + 钟馗独立审。一夜 4/4 收口 push origin/main：① **535cfca** worker 状态错(idea-13) 关羽 `5527a8a` ② **shell 防竞态**(in-flight lock+workspace token+optimistic TTL) 赵云 `4ea95da` ③ **terminal 性能**(addon async+parking 复用切 tab 不重建 xterm) 吕布→马超接力 `17c29ac` ④ **marketplace catalog Phase1**(native, read-only→role_templates, 无 UI) 马超 `6bae080`(+ADR draft+设计报告)。共抓修 5 blocking(钟馗串行审,terminal 2/shell 1/marketplace 1)。中途吕布(opencode)崩→马超接力(idea-13 又一例)。**待 user 拍**：marketplace Phase2 UI 范围(ADR draft `decisions/draft-2026-06-12-template-marketplace-native.md`)；未拿的小项 eac529f/ed042e2/c920110。

> 🔧 **2026-06-11｜Hive 启动健壮性 — 两个启动根因修复**（当前活跃）
>
> user 跨机复盘定位 Hive worker 启动即静默退出的根因，PM 在 hive-serva 落两修复（均 push origin/main，**生效需重启 4010**）：
> 1. **ENFILE watcher**（`e4d1bc1`）：tasks-file-watcher 递归 watch `.hive/reports/**` 把视频帧海 watch 进去 → fd 耗尽 ENFILE → node-pty 无 TTY → worker 崩。收窄 glob 只 watch `*.md`/`*.html` + 锁死测试。本机 macOS fsevents 未爆（fd 75/reports 26 图），serva/Linux 机已复现。详见记忆 project_hive_enfile_watcher_crash。
> 2. **嵌套 Claude Code env 泄漏**（`bed6ebc`）：从 Claude Code 会话跑 `pnpm dev` 时 4010 继承的 CLAUDECODE/CLAUDE_CODE_SESSION_ID 等 marker 传给 spawned orch/worker → 嵌套检测异常致 orch 不能派单（此前靠 `env -u` 手动兜）。`createAgentSpawnEnv` 在 orch+worker 统一 spawn 边界显式删 6 个 nested marker。**独立审(马超 claude 审 codex)抓出 blocking B1**：原前缀守卫 `startsWith('CLAUDE_CODE_')` 误删 OAuth/Bedrock/Vertex 鉴权 env → 那些用户 worker 反起不来(自相矛盾)；改只匹配显式 set + 真实 process.env 路径回归测试。**第二次独立审救场**(视频 B1 / 此 env B1 都 PM-sanity 漏、马超逮到)。
> 待办：① user `git pull`(serva 对齐) + 重启 4010(两台)激活两修复 ② env-strip 真机验(普通 API key + OAuth 模式各起一次 worker) ③ 钟馗 codex reviewer 仍 down 待 [Restart]。
> **idea-15 视频功能下行缺口**：立项"你也可以传视频给 app"的发送端没建(只建渲染+上行+播放)，2026-06-11 PM 手动 sqlite 注入 + adb 演示能播；Phase 1.5 待建 `team mobile-send-media`(渲染端现成)。

> 🎬📡 **2026-06-10 下午｜relay 4G 真机修通 + app 视频功能立项开工**（当前活跃）
>
> - **relay 4G 上线 ✅ 真机验证**：手机连不上的真根因 = 昨日切的 `aliyun.servasyy.com` **未 ICP 备案**，被阿里云按 SNI 对 443 TLS 做 RST（**非** nginx/宝塔/证书，内部回环 WS=101 健康）。已迁到 **`relay.yunzhong2020.com`**（user 已备案子域，同台阿里云机，延迟更低）— DNS A 记录 + acme.sh LE 证书 + nginx 443 反代→:8787 + `relay.json` 改域 + user 重启 4010。手机裸 4G（**关 Clash**，它会把境内域名劫持成 fake-IP）→中继→「Orchestrator 在线」，工作区+聊天满血加载。**此口径取代下方 aliyun.servasyy.com hard cut 块**（servasyy 未备案走不通）。详见记忆 project_relay_aliyun_443_sni_reset。
> - **idea-15 app 视频功能 Phase 1 开工**：user 手机端立项（传视频 + app 内播放 + 双指缩放，单文件 ≤100MB）。PM scoping 已查实代码（上行 upload 已通 / 图片缩放手势现成 / 唯一缺口=视频播放器，选 expo-video）。派单波折：关羽 codex 启动即崩（`8455ce08` cancel）→ 改派马超 `56aa83f4`，但马超被旧单 e5134140 占住、挂 2h 零 WIP（周瑜升级），cancel。拆两小单并行：服务端 50→100MB → 赵云 `1cfcd0b2` ✅completed；移动端 expo-video 播放器+缩放 → 关羽 `6ceb7e83` ✅completed。**独立审**：钟馗 codex 启动即崩+不自愈，改用**马超(claude)审 codex 码=跨provider独立**（`54ee1a07`）——审出 1 个 **blocking B1**（PM sanity 漏的真 bug）：`relay-rpc-handler.ts` 的 relay/4G 上传路径**还是 50MB**，赵云只升了 routes-mobile 的 LAN 路径 → 4G 传大视频会被拒+误导文案。修复均 ✅completed + PM 复验：B1+N2 → 赵云 `360a9c3e`（upload-limits.ts 抽公共常量、relay-rpc 路径升 100MB、新 relay-rpc 测试 51过/101拒红绿齐、死代码删净，28/28+47/47 绿）；N1+N4 → 关羽 `bdee962f`（size 预检+try/catch+loading，11 tests 绿）。N3(缩放黑边)留 Phase 2。**代码全到位+独立审+blocking 修复+全绿**。已 commit+push origin/main（`3d6b1a2`/`c3ff81f`）。本地出 APK 2.8.15（prebuild --clean 打入 expo-video，gradle 5m54s）+ adb 装机。**✅ PM 真机 device-verify 全链路通过**（华为 2PV0224423000586）：① 选视频→挂可点视频卡(N1 size 预检没误拦 114K) ② 待发附件本地播放(expo-video H.264 硬解、原生控件、进度走) ③ 发送→上传(服务端 uploads 收到 114463B 原样) ④ 发出渲染可点视频卡 ⑤ 远端 URL+Bearer 鉴权播放(无 401，视频+音频齐，马超 flag 的鉴权风险确认兜住)。**两点留底**：a) 双击缩放被 expo-video nativeControls 截走(变播放/暂停)——pinch 双指不被拦但 adb 测不了，待人手指验；b) 本次上传走 LAN 路径，B1 的 4G+>50MB 大视频路径靠 relay-rpc 单测覆盖，未真机 4G 实测。**Phase 1 SHIPPED**。N3(缩放黑边)+B1 4G 真机+pinch 人验留尾。钟馗 down 待 user [Restart]（idea-13 同源）。

> 🧹 **2026-06-10｜大批次收口 sprint — ✅ 完成并 push（`3c91ca9`..`d449cbd`）**
>
> 挂 3 天的 ~60 文件未提交改动 + main 存量红测试全部审查闭环、分 13 个逻辑 commit 收口并 push origin/main：pairing 统一规则 / aliyun hard cut / M40 手机端播放闸门+retract / relay-crypto dist / sentinel 契约 / GRM Turn Decision contract / PM 文档+ARCHITECTURE.md / M40 服务端下行一致性 / L1 dispatch 状态机+report/mobile-reply 协议硬收口 / 存量红测试修（17 个：3 测试过期 + 14 并行 env 污染&过期 fixture）。
> - 全部审查线钟馗多轮 0 blocking + 典韦验证；L1 语义裁决：completed=收到明确 team report 关账，旧 reported 行兼容读取。
> - **默认并行全量 1813/1813 全绿 + mobile 390/390 绿**（近几周首次完全干净全绿）。
> - 🌐 **aliyun relay cutover 已执行**：relay 部署上阿里云 ECS（systemd + Let's Encrypt + nginx wss 反代）、daemon `relay.json` 已切 aliyun；wss 真握手验通；**待 user 重启 4010 激活** + 手机 4G 验证上线。

> ⚠️ **2026-06-10｜worker 可靠性跟进（待立项）** — 今早同一修红测试链上赵云、关羽两个 codex worker 均 `status=error` 异常退出（非任务边界停），report 前 crash → 两次 orphaned，WIP 靠 PM 手动验证收口。符合 [[feedback_worker_reliability_systemic]]：要系统性兜住而非每次手捞。关联 idea-8 completion evidence。已落 ideas/inbox 待评估 L1 机制。

> 🧠 **2026-06-08｜M40 GRM Turn Orchestrator 协议化重写**
>
> user 已拍板：**保留强前台，不降级成“拿不准就全甩 PM”**；当前要治的不是“会不会回”，而是**“按协议回”**。
> 1. **冻结统一 turn / verdict contract**：收敛 M38 `fast-voice-reply` 与 M40 `voice-intent-front` 口径。
> 2. **把 handled / escalate 从 prompt judgement 改成 L1 决策表**：写死哪些必须交 PM、哪些允许前台自答，治“胡说八道 / 该交没交”。
> 3. **补齐统一 turn timeline**：把 verdict / handoff / mobile-reply / downlink 串成一条证据链，结束猜问题。
>
> 第一刀 **contract + adapter + decision-table tests** 已落地；当前 In progress 只收协议尾项：`mobile-reply` ↔ WebRTC handoff correlation、无 correlation 歧义场景 `409` 硬收口、CLI hidden flag 显式传 `voice_latency_turn_id`，以及 **PM 结果完全回流前台单声道** / **device-verify**。

> 🌐 **2026-06-09｜aliyun.servasyy.com hard cut 准备**
>
> relay deploy/template/keygen 默认口径与 mobile relay config 迁移逻辑已代码收口；对应 **线上切换 checklist** 与 **APK 出包 preflight** 已产出（`2026-06-09-aliyun-hard-cut-checklist` / `2026-06-09-aliyun-relay-apk-preflight`）。当前只差 **真实切换**（DNS/TLS/Web server/真实 `relay.json`/TURN/新 QR）与 **新 APK 出包 + 真机 smoke**，本单不做外部操作。
- [ ] aliyun hard cut：代码与文档已收口，待真实切换（DNS/TLS/Web server/真实 `relay.json`/TURN/新 QR）与新 APK 出包 + 真机 smoke；checklist / preflight 已产出。

> 🎙️ **2026-06-07 夜｜实时通话三主线**
>
> 当前 sprint 只盯 user 明确点名的 3 个问题，不再扩题：
> 1. **APP 端播放闸门**：下行语音先入队，只在前端本地判断用户没在说话且静默窗口到期后才起播，避免 AI 抢话。**已交付（关羽）**。
> 2. **误打断坐实**：把 interrupt、上行 RMS、下行播放状态/片段绑到同一时间线，下一轮真机可直接判“人声 vs 回音”。**已交付（赵云）**。
> 3. **乱序 / 重复 / 错位回复**：`generation` / `intent_generation` / retract 队列一致性已校正，落实“未播可撤、在播不撤”，旧 generation 补充回复不再混入当前播单。**代码已收口，待 device-verify**。
>
> 已有铁证：4010 重启后新代码已生效；GLM 已在实时处理并已实际发回下行语音；当前卡点已从“有没有处理”收敛到**何时播、为何被打断，以及真机下是否按新协议稳定工作**。
>
> 执行方式：谁先回报我先审；当前先收完三主线，再安排独立 review / 真机复现。

### 当前活跃
- [x] **关羽** dispatch `3b3424e5` — 更新 .hive/reports/mobile-app-design-v2-2026-05-27.html，补充以下 6 块缺失内容，使其成为团队可直接照着实现的完整设计文档：
- [x] **关羽** dispatch `c516b226` — 紧急调试：packages/mobile 构建出来的 APK 在华为手机上打开就崩溃（屡次停止运行）。已经做了：1）删除 expo-notifications（dependencies + plugin 都删了）2）加了 react-na…
- [x] **关羽** dispatch `13eb21db` — 紧急任务：HippoTeam 移动端 UI 重新设计。
- [x] **关羽** dispatch `72eb825b` — 移动端 UI 重做——按「移动指挥台」方向重新实现。
- [x] **关羽** dispatch `4b20accd` — 做一份 HippoTeam Mobile App 的完整详细设计文档（HTML 自包含报告），要求：
- [x] **关羽** dispatch `9d3482ef` — 你的 mobile app design spec 缺少核心功能，user 非常不满意。必须补充以下内容，直接修改 .hive/reports/mobile-app-design-spec-2026-05-27.html：
- [~] **关羽** dispatch `28853152` — user 对当前的设计文档非常不满意。要求重做，必须用你的 image generation 能力（调用图片生成函数）为每个页面生成真实的 mockup 图片。 ⊘ worker 被 runtime 重启杀掉，任务未完成
- [ ] **关羽** dispatch `3b3424e5` — 更新 .hive/reports/mobile-app-design-v2-2026-05-27.html，补充以下 6 块缺失内容，使其成为团队可直接照着实现的完整设计文档：
- [~] **关羽** dispatch `02679164` — M24 Phase 1：Chat 双向消息后端。参考设计文档 .hive/reports/mobile-app-design-v2-2026-05-27.html section 5（Chat 双向消息后端协议）。 ⊘ orphan-submitted: worker stopped without reporting
- [~] **赵云** dispatch `6c9a009b` — M24 Phase 3 backend：Mobile Cockpit API endpoints。参考设计文档 .hive/reports/mobile-app-design-v2-2026-05-27.html section 6（Co… ⊘ orphan-submitted: worker stopped without reporting
- [x] **马超** dispatch `f5f1aee4` — M24 Phase 2：Mobile Chat UI 重做。参考设计文档 .hive/reports/mobile-app-design-v2-2026-05-27.html section 4 screen 01（Chat）。
- [x] **赵云** dispatch `3f70d7db` — M24 Phase 3 backend：Mobile Cockpit API endpoints。参考设计文档 .hive/reports/mobile-app-design-v2-2026-05-27.html section 6（Co…
- [x] **吕布** dispatch `d6038691` — L1 机制实现：设计 milestone shipped → 自动检测缺实施 milestone。
- [x] **关羽** dispatch `6e99c326` — 状态检查：你的 M24 Phase 1 Chat 双向消息后端任务进展如何？已经过了一段时间了。请汇报当前进度、遇到的阻塞、或者是否需要帮助。
- [x] **关羽** dispatch `9887e384` — M24 Phase 1 实现：Chat 双向消息后端。这是你现在唯一的任务，立刻开始。
- [x] **赵云** dispatch `c6d2443d` — 严格按照设计图重做 Chat 页面 (packages/mobile/app/(tabs)/index.tsx)。
- [x] **马超** dispatch `4091d345` — 严格按照设计图重做 Status 页面 + 添加 Cockpit tab。
- [x] **赵云** dispatch `f0e44104` — 严格按照设计图重做 Settings 页面。
- [x] **马超** dispatch `a182936b` — 严格按照设计图重构 Cockpit tab 为带顶部 tab 导航的完整 PM 控制台。
- [x] **吕布** dispatch `c0056df6` — 严格按照设计图重做 Worker Detail 页面。
- [x] **关羽** dispatch `83d97fd6` — 严格按照设计图实现 Approval 页面和 Offline/Error 页面。
- [x] **赵云** dispatch `b47d8b3e` — 修复 Cockpit Plan tab UI，严格对齐设计稿 .hive/reports/images/mobile-v2-06-cockpit-plan.png。
- [x] **马超** dispatch `09986723` — 重写 Worker Detail 页面，严格对齐设计稿 .hive/reports/images/mobile-v2-04-worker-detail.png。
- [x] **吕布** dispatch `edae13a5` — 修复 Status 页面 UI，严格对齐设计稿 .hive/reports/images/mobile-v2-02-status.png。
- [x] **关羽** dispatch `676cd123` — 紧急修复：Mobile App 收不到 orchestrator 回复。
- [~] **赵云** dispatch `9aede49f` — 重构 Mobile 认证机制：从 Pairing Code 改为永久 Token 管理模式。 ⊘ orphan-submitted: worker stopped without reporting
- [x] **赵云** dispatch `c6be7240` — 补充要求：Token 机制完全替代 pairing code，不是并存！
- [x] **马超** dispatch `6276bfd2` — 完整审核任务：对比当前 mobile app 所有页面实现与设计稿的一致性，产出 HTML 审核报告。
- [x] **马超** dispatch `ed3574ae` — 你刚才的 UI 审核报告 .hive/reports/mobile-ui-audit-2026-05-28.html 用了英文，user 要求中文。请重新生成一份完全中文的版本，覆盖原文件。内容不变，只是语言改为中文（标题、描述、评分说明…
- [x] **马超** dispatch `1e817fde` — 综合任务：Mobile App UI 全面修复 + 实时终端同步。中文撰写所有注释和文档。
- [x] **关羽** dispatch `6cc68d4a` — Bug 修复：添加团队成员对话框中，所有角色模板的 CLI 类型都只显示 'claude'，应该能选择不同的 CLI preset（codex、opencode、gemini 等）。之前是可以选择的，现在不行了。请排查 web/src/ …
- [x] **关羽** dispatch `520178a3` — 你上次的 CLI preset 修复没有生效！用户刷新页面后问题依然存在。你必须自己在真浏览器里打开 http://localhost:4010 验证！
- [x] **关羽** dispatch `8c8e6371` — Mobile App UI 与设计稿对齐任务。
- [x] **关羽** dispatch `c83b5859` — 复核 Chat 页面两个改动（packages/mobile/app/(tabs)/index.tsx + packages/mobile/app.config.ts）：
- [x] **关羽** dispatch `4cac1f37` — Cockpit/Plan 页面设计稿对比 Review（只出报告，不改代码）。
- [x] **关羽** dispatch `45e94eca` — 按照你刚才的 Cockpit/Plan 对比报告（.hive/reports/mobile-cockpit-plan-design-review-2026-05-28.html），按以下优先级修改代码：
- [x] **关羽** dispatch `1ffcc394` — Cockpit 页面全面调研 + 设计出图（不改代码）。
- [x] **关羽** dispatch `1fe88c61` — 紧急：Cockpit/Plan 页面必须严格按照设计稿像素级还原。之前的实现完全不达标。
- [x] **赵云** dispatch `dd717fa8` — Mobile App 语音交互 UX 设计（只出设计方案，不改代码）。
- [x] **关羽** dispatch `f75b75d0` — Cockpit 页面三个问题一次性修复（改完后统一 build）：
- [x] **关羽** dispatch `4f1822a6` — 任务：修复 mobile app 的 Cockpit 部分，让它和设计稿一致并真正可用。设计基准：.hive/reports/mobile-app-design-v2-2026-05-27.html 及 .hive/reports/ima…
- [x] **赵云** dispatch `fc4120c1` — 任务：清除 mobile app 里"看起来真、实际写死"的假数据，页面只显示真实数据或优雅留白。app UI 一律英文。设计基准见 .hive/reports/images/mobile-v2-*.png。
- [x] **关羽** dispatch `4f7c578f` — 任务：修两个服务端 bug（同在 src/server/team-operations.ts，所以一并给你避免冲突）。这是经过对抗式核验确认的真 bug，详见 .hive/reports/archived-bug-triage-vs-cu…
- [x] **赵云** dispatch `42b280b6` — 任务：修两个终端流控 bug（terminal-stream-hub.ts + terminal-flow-control.ts）。经对抗式核验确认，详见 .hive/reports/archived-bug-triage-vs-curr…
- [x] **马超** dispatch `385c0ae0` — 任务：修一个 high 级 bug——codex/gemini 会话捕获丢身份判别符，同 workspace 多 agent 会抓串彼此的 session id。经对抗式核验确认仍成立，详见 .hive/reports/archived-…
- [x] **张飞** dispatch `24d62ce4` — 任务：给刚修好的两个终端流控 bug 补回归测试（只动 tests/ 下文件，不改产品代码）。背景见 .hive/reports/archived-bug-triage-vs-current-2026-05-29.html 的 #4 #5…
- [x] **马超** dispatch `4acce000` — 任务：修两个 agent 生命周期 bug（#1 #7），都经对抗式核验确认仍成立，详见 .hive/reports/archived-bug-triage-vs-current-2026-05-29.html。两条放一起给你是因为可能共…
- [x] **赵云** dispatch `164f56f0` — 任务：修 #8 (medium) v15 调度表重建非原子，中途失败永久破坏 dispatches 表。经对抗式核验确认仍成立，详见 .hive/reports/archived-bug-triage-vs-current-2026-05…
- [x] **关羽** dispatch `b9208ee7` — 任务：修一个 stale 测试。tests/server/mobile-routes.test.ts 里 "records orchestrator replies after a mobile prompt reaches stdin"…
- [x] **张飞** dispatch `2fbd87b6` — 任务：把 #8 (v15 迁移原子性) 的失败回滚验证固化成永久回归测试（只动 tests/server/ 下文件，不改 src/）。背景见 .hive/reports/archived-bug-triage-vs-current-202…
- [x] **关羽** dispatch `56b68508` — 任务：修 mobile app 两个 UI 可读性问题（user 真机反馈，附截图分析）。app UI 英文。只动 packages/mobile/ 下文件。
- [x] **赵云** dispatch `0cc2110a` — 任务：修 mobile Chat 页严重回归——往上滚看历史时列表不停跳回底部，根本没法看历史。user 真机反馈"往上一拉它就不停地跳，又跳回原地"。只动 packages/mobile/app/(tabs)/index.tsx。
- [x] **关羽** dispatch `e7c4d17a` — 任务：修 web 端"添加团队成员"对话框的布局 bug。user 真机/浏览器反馈：模板列表太长，对话框看不到底部的"确认/创建"按钮，没法滚动到底，无法完成创建下一步。
- [x] **赵云** dispatch `6ab85499` — 任务：让 mobile app 能看到每个 worker 用的 CLI（如关羽=codex），并把 Worker Detail 页对齐设计稿。只动 packages/mobile/。app UI 英文。
- [x] **关羽** dispatch `43b4a022` — 任务：修 3 个安全/功能高危 bug（routes-mobile.ts + relay-rpc-handler.ts）。经对抗式 3-skeptic 复核确认（3/3 票）。详见 .hive/reports/fresh-bug-hunt…
- [x] **马超** dispatch `67b0d643` — 任务：修 relay-connector.ts 的 3 个高危 bug（崩溃/未处理 rejection/stale channel）。经对抗式 3-skeptic 复核确认（3/3 票）。详见 .hive/reports/fresh-b…
- [x] **马超** dispatch `c11b3d78` — 任务：修 3 个 bug（agent 生命周期 + session 捕获，你熟）。详见 .hive/reports/fresh-bug-hunt-current-2026-05-29.html。可改对应 src/server 文件 + t…
- [x] **赵云** dispatch `c6065e11` — 任务：修 3 个 bug（终端 + WebSocket，你熟 terminal）。详见 .hive/reports/fresh-bug-hunt-current-2026-05-29.html。可改对应 src/server 文件 + t…
- [x] **关羽** dispatch `a8c3edd2` — 任务：修 3 个 bug（mobile 后端 + agent 启动；routes-mobile.ts 你 Wave A 刚改过，继续你来避免冲突）。详见 .hive/reports/fresh-bug-hunt-current-2026-…
- [x] **赵云** dispatch `efe74864` — 任务（mobile UI，排在你当前 Wave B 之后做；你做过 Worker Detail 页 6ab85499 最熟）：按 user 真机反馈重做 worker 卡片交互 + 按状态区分按钮 + 点卡进实时详情页。只动 packag…
- [x] **马超** dispatch `855be716` — 任务（Wave C，4 个 low/medium bug，session/recovery/lifecycle，你熟）。详见 .hive/reports/fresh-bug-hunt-current-2026-05-29.html。可改对…
- [x] **关羽** dispatch `1c5f6ea1` — 任务（Wave C，4 个 low/medium bug：WS/文件watch/PM doc/feishu）。详见 .hive/reports/fresh-bug-hunt-current-2026-05-29.html。可改对应 src…
- [x] **关羽** dispatch `8deabfd8` — 快速修一个你 C7 连带打破的测试（不是真 bug，是测试硬编码了旧 idea id）。
- [x] **赵云** dispatch `09070586` — 任务：修 mobile app 聊天文字【不能选中/复制】的 bug。user 真机反馈：你发给他的消息（orchestrator 回复等）无法选中、无法复制出来，等于看得到拿不走。app UI 英文。主要动 packages/mobil…
- [x] **关羽** dispatch `98f673e5` — 任务：修 mobile Cockpit 里"发给 orchestrator 的动作没有明确反馈"的 UX 问题。user 真机反馈：点 Actions 的执行（也包括 Ideas promote、worker Dispatch）后【没有任…
- [x] **赵云** dispatch `7d72269a` — 任务：修 Worker Detail 页（packages/mobile/app/agent/[id].tsx）两个 bug。user 真机截图确认。app UI 英文。只动 packages/mobile。
- [x] **关羽** dispatch `2ff124a3` — 任务：让 mobile app 能看到 Orchestrator 的实时终端（后端 + 前端，你能同时动）。背景：Status 页点 Orchestrator 卡片进 Worker Detail，赵云已把前端特判好（不再报 "Worker…
- [x] **关羽** dispatch `05babe11` — 任务（设计生产，用你的 gpt image 生成接口出图）：基于【当前 app 实现现状】+【现有 v2 设计】，把 HippoTeam mobile app 每个页面/组件/状态的设计更详细地展开，产出一份完整的细化设计文档 + 配套 …
- [x] **赵云** dispatch `b2e00b05` — 任务：给 Worker Detail 页（packages/mobile/app/agent/[id].tsx）的 Terminal (Live) 面板加【放大/全屏】，让用户能把中间那块终端放大看，更舒服。user 真机反馈：中间终端屏…
- [x] **关羽** dispatch `5bcd3d29` — 任务（设计生产，用你的 gpt image 生成接口出图）：基于【当前 app 实现现状】+【现有 v2 设计】，把 HippoTeam mobile app 每个页面/组件/状态的设计更详细地展开，产出一份完整的细化设计文档 + 配套 …
- [x] **赵云** dispatch `28b2ac32` — 任务：做"扫码配对"，根治"Mac LAN IP 一变手机就连不上、要手敲 IP"的痛点。app UI 英文。可动 src/server + web + packages/mobile（这是跨端 feature）。
- [~] **马超** dispatch `7b08568b` — 任务：mobile Status 页给 sentinel（哨兵 worker，如 周瑜）专门的呈现，别再当普通 worker。app UI 英文。主要动 packages/mobile/app/(tabs)/workers.tsx，必要时… ⊘ orphan-submitted: worker stopped without reporting
- [x] **关羽** dispatch `07ad0fe6` — 任务：修 mobile Chat（packages/mobile/app/(tabs)/index.tsx）消息归属错乱 + 按发送方配色 + 去重。app UI 英文。只动 packages/mobile。
- [x] **关羽** dispatch `620a3e05` — 任务（排在你当前 chat 任务 07ad0fe6 之后做，同文件 packages/mobile/app/(tabs)/index.tsx）：把 system_event 消息渲染成干净卡片，不要再 dump 原始 JSON。app U…
- [x] **马超** dispatch `fd39ff88` — 任务（排在你当前 sentinel 任务 7b08568b 之后，同文件 packages/mobile/app/(tabs)/workers.tsx）：Status 页 worker 列表按状态排序 + 修头部副标题/徽章重叠。app …
- [x] **关羽** dispatch `5c183ca6` — 任务：修折叠屏上 Chat 窗口不停闪动/跳动的 bug。user 真机（折叠屏）反馈：折叠又展开后，Chat（packages/mobile/app/(tabs)/index.tsx）的消息/文字区域不停跳动、闪烁，有时无法控制。app…
- [x] **关羽** dispatch `309a8d07` — 任务：修 mobile Cockpit Questions 页的空状态 + 收紧 Cockpit 几个 tab 的字号/排版（user 真机反馈：0 条 open question 时页面像坏了/不知所云，且字体太大不如设计）。app U…
- [x] **赵云** dispatch `21cd8b92` — 任务：收紧 mobile Settings 页的排版/字号，贴近设计（user 真机反馈：内容基本对，但整体字太大、排版不好看，跟设计比不够精致）。app UI 英文。只动 packages/mobile/app/(tabs)/setti…
- [x] **关羽** dispatch `b7684d6a` — 任务：修 mobile Chat 打字时屏幕上下不停抖（键盘振荡）的 bug。user 真机反馈：在 Chat 输入框打字、键盘弹出后，屏幕/输入框上下不停跳动振荡（不是折叠，是打字+键盘场景）。app UI 英文。动 packages/…
- [x] **关羽** dispatch `2f683e7f` — 任务：M23 Agent Run Timeline 可恢复事件流 — Phase 1（后端基础）。这是已批准的独立 milestone（idea-4 promote，user 拍板），调研报告已在 .hive/reports/idea-4…
- [x] **赵云** dispatch `21973d5d` — 任务：M18 Provider capability manifest — scoping spike（只调研出报告，不实现）。这是 plan 里 M18(proposed) 明确的下一步："先做 scoping spike，调研现有 p…
- [x] **关羽** dispatch `eae31d3f` — 任务：M18a — preset 能力清单（capability manifest）后端 + 数据暴露 + orch 上下文（user 拍板做，先做"能力可见"版，暂不做按能力自动路由）。先读调研报告 .hive/reports/m18-…
- [x] **马超** dispatch `ebf0a322` — 任务：Q13 — 修 dispatch ledger 收尾机制：让"已做完但卡在 submitted 态"的孤儿派单能被收尾/取消（user 拍板做）。周瑜巡检发现 + PM 核实：worker 在别的 dispatch 下 report…
- [x] **赵云** dispatch `d75db332` — 任务：M18a 能力清单 UI 渲染（后端已由关羽做完，capabilities 数据已在 worker/preset payload 里，可读）。把 preset 能力可视化到 web + mobile。app/UI 英文。
- [x] **关羽** dispatch `9c5d0131` — 快速修你 M18a 连带打破的 3 个精确断言测试（不是真回归，是你给 team-list/worker payload 加了 capabilities 字段，老测试 deepEqual 没带）。
- [x] **关羽** dispatch `51ae43a0` — 任务：彻底修 Chat 输入框被键盘遮挡的 bug（你上轮 resize+KAV height 在 user 真机仍没生效）。user 真机截图：键盘弹出后输入框被完全盖住，看不到打的字、错了也没法改。app UI 英文。动 packag…
- [x] **马超** dispatch `b53dcae2` — 任务：清理 Cockpit "AI Recommended Actions" 的噪音——已解决/已完成/已取消的东西不该还显示成待办行动。user 真机反馈：刚确认归档的决策还显示"确认"按钮（像还能点）；idea-5 已 shipped…
- [x] **关羽** dispatch `538c60f7` — 任务（排在你当前键盘任务 51ae43a0 之后，同文件 packages/mobile/app/(tabs)/index.tsx）：修发图片显示成"巨大空绿块+只有文件名、没图片"的 bug。user 真机截图：发一张截图，聊天里是一个…
- [x] **赵云** dispatch `5056c2c8` — 任务：Status 页普通 worker 卡片【默认收起，点开才显操作按钮】。user 反复要求、仍没对：现在 WorkerCard 永远显示 Role/Status 格子 + 能力 chips + Dispatch/Restart/St…
- [x] **关羽** dispatch `ac5695e9` — 任务：修折叠屏【展开(大屏)状态下，Chat 往下拉一直闪、且拉不动】的 bug。user 真机反馈：折叠(小屏)时上下滑正常不闪；【展开成大屏时】往下拉就不停闪动、不让往下拉。只动 packages/mobile/app/(tabs)/…
- [x] **关羽** dispatch `93565e91` — 修流程 bug：orchestrator 收到手机 app 消息时，按当前注入的提示词会"用纯文本回复"，但纯文本回灌通道(mobile-orchestrator-reply-capture.ts startPendingReply)已被…
- [x] **关羽** dispatch `99ea0a6a` — 任务：给 mobile app 加"构建标识"，让 user 打开 Settings 一眼能确认装的是不是最新版。只动 packages/mobile。app UI 英文。
- [x] **关羽** dispatch `db06c50f` — 紧急回归：折叠屏【展开大屏】状态下 Chat 现在【完全拉不动】(user 真机第三次反馈，已装含你上次修复 ac5695e9 的 APK，问题反而从"会闪"恶化成"拉不动")。只动 packages/mobile/app/(tabs)/…
- [x] **关羽** dispatch `d1cad3cc` — 补充关键线索(承接 db06c50f 滚动单)：user 说【时好时坏】——'又打开一次折叠大屏，又可以下拉了'。即不是硬锁死，而是【展开瞬间的测量竞态】：unfold 时 onLayout/onContentSizeChange/onS…
- [x] **关羽** dispatch `94be8d36` — 功能：给 mobile app 加【中文/英文双语】，在 Settings 页切换。只动 packages/mobile。（注意：这是 user 明确要求，反转了之前"app 全英文"的决定。汇报/报告仍中文，与本单无关。）
- [x] **赵云** dispatch `6983823f` — 致命 bug（手机 app 完全收不到 orchestrator 新回复）：src/server/mobile-chat-store.ts 的 listChatMessages 分页排序错误。
- [x] **关羽** dispatch `d7b52b99` — 修 mobile app【断连后不自动恢复收消息】的韧性 bug（user 真机：后台 4010 重启后，app 还能发消息但收不到 orchestrator 回复，必须手动杀进程重开才恢复）。主要动 packages/mobile/sr…
- [x] **赵云** dispatch `01ea4646` — 修 Status 页【SENTINEL（周瑜）卡片排版坏掉】的 bug。user 真机截图：sentinel 卡【没有显示 worker 名字(周瑜)和角色】，反而把一排 capability chips（CLI AGENT / HIGH…
- [~] **关羽** dispatch `a67f37df` — 任务：把现有 v3 设计文档修订成【HippoTeam Mobile App 唯一权威指导文档】——未来所有移动端实现的 single source of truth。中文撰写（user 要求报告中文）。self-contained HT… ⊘ 关羽卡在旧 dispatch 上下文，重派
- [~] **赵云** dispatch `da1ab40f` — 修 Status 页【工作区概览】markdown 没渲染的显示 bug。user 真机截图：工作区概览"当前阶段"显示成原始 `**maintenance + PM 体系 rollout**`——plan.md 里的值带 markdow… ⊘ 卡在提示符未开始，重新派
- [~] **马超** dispatch `72c0092c` — 调研任务（先调研、出方案，【不要改代码】，避免和赵云的 workers.tsx 改动冲突）：手机 app 的 Status 页要支持【新增 worker】，和 PC 端一样。请调研并给出可落地方案。 ⊘ 卡在提示符未开始，重派
- [x] **赵云** dispatch `5c964c30` — 立刻开始这个任务（上一条同任务卡住了，这是重派）：修 mobile Status 页【工作区概览】markdown 没渲染的 bug。截图：'当前阶段'显示成原始 **maintenance + PM 体系 rollout**，plan.…
- [x] **马超** dispatch `b2ffaf03` — 立刻开始（上一条同任务卡住了，这是重派，请马上动手不要只报待命）：调研任务——手机 app Status 页要支持【新增 worker】（像 PC 一样），先调研出方案、【不改产品代码】。要查清：①PC 端 Add Worker 怎么实现…
- [x] **关羽** dispatch `533afbad` — 重派（你之前卡在旧的 5bcd3d29 v3 出图任务上下文里、一直没做这个新任务，请现在专注做这个）：把现有的 .hive/reports/mobile-app-design-v3-2026-05-29.html【修订】成 HippoT…
- [x] **马超** dispatch `f5ec15cb` — 落地实现：手机 app Status 页【新增 Worker】。按你自己的 spike 方案（.hive/reports/2026-05-30-mobile-add-worker-spike.html）实现【最简安全版】。user 已拍板…
- [~] **赵云** dispatch `4cc9701b` — 接手一个任务（关羽 session 卡住了，转给你）：把现有 .hive/reports/mobile-app-design-v3-2026-05-29.html【修订】成 HippoTeam Mobile App 唯一权威指导文档。不是… ⊘ v3 文档关羽已完成，避免重复
- [x] **马超** dispatch `8a95919c` — 修系统 bug 根因 A（治本，派单注入热路径）：重启 4010 后 worker resume，新派单注入失效→卡 submitted。根因详见 .hive/research/2026-05-30-worker-stall-after-…
- [~] **赵云** dispatch `f306747d` — 修系统 bug 根因 B（兜底巡检）：现在只有 worker【退出】才提醒未完成 dispatch；对"worker 还活着但 dispatch 卡 submitted 不动"完全没检测。根因详见 .hive/research/2026-… ⊘ 卡在提示符未开始，重派
- [~] **赵云** dispatch `68723fa9` — 立刻开始（上一条 Fix B 卡住了，重派，请马上动手别只待命）：加【活着但卡住的 dispatch 周期巡检】兜底。详见 .hive/research/2026-05-30-worker-stall-after-restart.md 根… ⊘ 赵云连续卡住，转马超
- [x] **马超** dispatch `9c107fd7` — 接手 Fix B（赵云那边注入卡住了，转给你；你刚做完 Fix A 最懂这个 bug）：加【活着但卡住的 dispatch 周期巡检】兜底。根因详见 .hive/research/2026-05-30-worker-stall-after…
- [x] **关羽** dispatch `6f51adfd` — mobile Chat 体验改进（user 真机痛点）：每次打开 Chat 页都停在顶部，要手动翻到底看最新，很痛苦。只动 packages/mobile/app/(tabs)/index.tsx（如需图标可用现有 Ionicons）。a…
- [x] **关羽** dispatch `7e7d6e91` — M24 Phase 7：推送通知打通 + 审批 deep link（手机审批通道）。先读现有基础再补缺：后端 src/server/mobile-push.ts(已有 notifyWorkerDone + createHighAiActi…
- [~] **赵云** dispatch `54ecf3d7` — M24 Phase 8：离线韧性 + 缓存 + 增量同步。先读现有基础：packages/mobile/src/api/mobile-runtime-context.tsx(已有 connectionMode LAN/relay/disc… ⊘ 赵云卡死15min，转关羽
- [x] **关羽** dispatch `08565100` — 接手 M24 Phase 8（赵云那边注入卡住了，转你）：离线韧性 + 缓存 + 增量同步。先读现有基础：packages/mobile/src/api/mobile-runtime-context.tsx(已有 connectionMo…
- [x] **关羽** dispatch `7ed07409` — 修 mobile app 两个真机确认 bug。主要动 packages/mobile/app/(tabs)/index.tsx（+ workers.tsx Bug1 部分）。app 双语(i18n)。
- [x] **关羽** dispatch `e9c07a91` — 补充（承接你正在改的 index.tsx 2-bug 单，顺手一起修）：Chat 页【顶部工作区概览 header】渲染 dashboard.plan.current_phase 时【没剥 markdown】，user 真机截图仍显示 '…
- [~] **关羽** dispatch `769ef0e4` — 再补一条（同 index.tsx 滚动，承接你正在修的 chat scroll，一起处理）：user 真机反馈——在 Chat 输入框发消息、点发送确认后，屏幕【跳到别处】而不是落到刚发的最新消息底部，很不友好。期望：用户【发送自己的消息… ⊘ 发送落底修复已随 1f2b580 提交，关羽合并报告留下的孤儿，清理
- [~] **关羽** dispatch `858f8b08` — 产出【HippoTeam relay 外网访问完整部署包 + 调研文档】。user 有公网 VPS(DMIT，会绑域名)，要把我们 M19c 的 relay 部署上去打通外网访问。这是调研+交付类工作，按硬规则同时产 reports/*.… ⊘ 关羽卡死49min零产出，转马超
- [x] **马超** dispatch `29140801` — 接手（关羽卡住了49分钟没开始，转给你，请马上动手别只待命）：
- [x] **马超** dispatch `b51ff98c` — 实现：补上 mobile app 的 relay 配置录入入口，让外网 relay 访问端到端打通（你刚在 relay 部署调研里发现的缺口：传输/握手/加密都实现了，但没有任何写入 relayConfig 的入口）。参考你自己的部署调研…
- [x] **钟馗** dispatch `42078367` — 对比调研：CCB（/Users/huangzongning/development/claude_codex_bridge）vs HippoTeam（本仓 /Users/huangzongning/development/hive-ser…
- [~] **马超** dispatch `39baefce` — 修 app 外网 relay 回落失效的关键 bug（user 真机：关 WiFi 用 4G → app 卡"连接中"然后离线，没切到 relay；relay 配置和 VPS daemon 都正常，VPS 实测手机根本没来连 relay）… ⊘ 卡 submitted 4min(Fix B 检出)，重派
- [x] **赵云** dispatch `cc60021b` — 修 web UI 的二维码 UX 痛点（user 很不满）：现在设备 token 的二维码【只在创建那一刻显示一次】，想再看就得新建一个 token，很蠢。给【已有设备】加"查看/显示二维码"功能。主要动 web/src/workspac…
- [x] **马超** dispatch `c7a52dfe` — 立刻开始(上一条同任务卡住了,重派,马上动手):修 app 外网 relay 回落 bug。根因:client.ts 的 readJson(LAN fetch,约263-285行)没超时,4G 下连不通的 LAN(192.168.110.…
- [x] **关羽** dispatch `20f1b8c1` — --stdin
- [x] **关羽** dispatch `e35e75ae` — 【手机 relay 连接风暴 bug — app 端单例 connect 修复（TDD）】
- [x] **钟馗** dispatch `c7484045` — 【重写 CCB vs HippoTeam 对比报告 v2 — intent-first + code-deep】
- [x] **关羽** dispatch `80033a8a` — 【4G relay 连不上的真根因——mobile-runtime-context 多 relay transport 互相 evict（已用 relay 日志+代码双证锁定，别再排查根因，直接修）】
- [x] **关羽** dispatch `35c8bdbf` — 【高优先级：mobile app 加"连接诊断面板"——让一张截图暴露所有连接信息，终结截图猜谜】
- [x] **赵云** dispatch `47137770` — 【飞书(及手机 app)入站图片接收——让 user 能发截图给 orchestrator】
- [~] **马超** dispatch `8e9c1a48` — 【M25 Phase 1：Codex provider managed home + session 隔离（P0，ADR 已拍板，强 TDD）】 ⊘ M25 Phase 1 已完成并经 PM 独立验证(18/18 测试+tsc 全绿)；马超用文字 recap 收尾未真正 team report 致原 dis…
- [x] **马超** dispatch `bc36cd7d` — 状态检查：你的 M25 Phase 1 (Codex session 隔离) 进展如何？我看到你已落笔 src/server/provider-runtime-profile.ts + tests/server/codex-provide…
- [x] **关羽** dispatch `fa537685` — 【可靠性根治：worker「干完没真 report」自愈 + Fix B 误报根治（L1 机制 + L2 提示词，强 TDD）】
- [~] **赵云** dispatch `484e74fe` — 【紧急·连接最后一公里：relay RPC 方法注册表补全（诊断面板已精确定位，别再排查根因）】 ⊘ codex 注入落空卡 idle 提示符 28s+ 零改动，cancel 后重派
- [x] **赵云** dispatch `952b5550` — 【重派·relay RPC 方法补全（连接最后一公里，诊断面板已实锤根因，立即开工别再排查）】
- [~] **关羽** dispatch `dde2f011` — 【连接 churn 最终修复·照 workflow 完整方案一次改对（不再增量、珍惜 build 额度）】 ⊘ codex 注入落空卡 idle 35s+ 零改动，cancel 重派
- [~] **关羽** dispatch `e4b55f31` — 【连接 churn 最终修复·立即开工，方案已写好别再排查】 ⊘ codex 关羽 重派后仍卡 idle 零改动，进程疑 wedged，转派马超(claude)
- [x] **马超** dispatch `17e5546d` — 【连接 churn 最终修复·照已写好的完整方案一次改对（codex 几个 worker 卡住，转你来）】
- [~] **钟馗** dispatch `1fbc2793` — 【整理报告：4G 外网 relay 连接攻坚全过程（自包含 HTML 报告 + research 索引笔记，中文）】 ⊘ 钟馗 codex 注入落空卡 idle 45s+ 零文件，转吕布(opencode)写报告
- [x] **马超** dispatch `8cb009de` — 【M27 relay 远程体验优化：跳过 LAN 空试(治慢+假重连) + 实时推送(治轮询延迟)，强 TDD，最终一个 build】
- [~] **吕布** dispatch `64d67bfb` — 【整理交付报告：4G 外网 relay 连接攻坚全过程（自包含 HTML + research 索引，中文）】 ⊘ 吕布 opencode 卡 92% context 多次无产出、报告文件未建，止损 cancel；saga 已在 tasks.md narrative+com…
- [x] **马超** dispatch `0eb320b9` — 【小修·手机端 milestone 显示统一编号（删手机自己编的位置号，改显示真实 id）】
- [x] **马超** dispatch `70b871d5` — 【审计：手机 cockpit vs web(PC) cockpit 全 tab 一致性，列清单 + 修清楚的显示不一致】
- [x] **马超** dispatch `12c299b6` — 【手机 cockpit 5 个 tab 内容跟 web 对齐（user 拍板：不加缺的 tab，只修现有 5 个的内容一致性）】
- [x] **马超** dispatch `c953a831` — 【小补·让手机 Cockpit 标签页也实时（补 M27 推送缺口，搭 build #19）】
- [x] **马超** dispatch `8ee7d903` — 【revert·手机 Tasks tab 改回旧的派单时间线视图（user 拍板：手机上旧视图更直观，其它一致性保留）】
- [x] **马超** dispatch `5aec1a70` — 【高优先级·cockpit 标签页加载体验大改：下拉刷新 + loading + 保留旧数据（user 强烈要求，受不了空白像断网）】
- [x] **马超** dispatch `b902d041` — 【基建·本地构建路线 A 跑通：装 JDK17+Android SDK + eas build --local 验证出 APK + 写脚本/文档（彻底摆脱 EAS 额度）】
- [x] **关羽** dispatch `d282afb2` — 【手机 app 切后台→回前台体验修复：温和重连 + 断线期间消息进队列自动补发（user 实机反馈，进 #20 批次）】
- [x] **关羽** dispatch `6d3ec07b` — 【bug 修复：手机 Worker 详情页"派单历史"对正在干活的 worker 显示"暂无派单"（user 实机，进 #20）】
- [~] **马超** dispatch `1243cdfa` — 【M28 Phase 1 Track A：手机端服务端根因修复】 ⊘ 注入卡住，精简后重派
- [~] **赵云** dispatch `5be356fc` — 【M28 Phase 1 Track B：手机端前端独立 P0 修复】 ⊘ 注入卡住，精简后重派
- [x] **赵云** dispatch `004f9ea8` — M28 Phase1 Track B(纯前端,只动 packages/mobile/*,马超在并行改后端别碰)。先读 .hive/research/2026-05-31-mobile-vs-web-ui-audit.md + plan.m…
- [~] **马超** dispatch `4329cdff` — M28 Phase1 Track A(只动 src/server/*,别碰前端,赵云在并行改前端)。先读 .hive/research/2026-05-31-mobile-vs-web-ui-audit.md + plan.md 的 M2… ⊘ 马超输入缓冲卡死,待restart后重派
- [x] **马超** dispatch `f44a91fd` — M28 Phase1 Track A(只动 src/server/*,别碰前端,赵云在并行改前端 packages/mobile/*)。先读 .hive/research/2026-05-31-mobile-vs-web-ui-audit…
- [x] **赵云** dispatch `ffae1b4d` — M28 追加修复(纯前端,只动 packages/mobile/*,马超在改后端别碰)：里程碑排序错误。
- [~] **赵云** dispatch `8cfa4f4e` — M28 手机端 UX 增强 3 项（user 装上 #20 后提的，纯前端 packages/mobile/*）： ⊘ work 已完成+PM 验证(77测试绿)+整批提交 ad7b52c;赵云 codex 未逐个 team report,PM 收尾
- [~] **赵云** dispatch `ed1a5e6d` — M28 手机端 UX 追加第 4 项（接在你当前 3 项之后做，纯前端 packages/mobile/*）： ⊘ work 已完成+PM 验证(77测试绿)+整批提交 ad7b52c;赵云 codex 未逐个 team report,PM 收尾
- [~] **赵云** dispatch `2c9a9eae` — M28 状态页「工作区概览」卡修复（纯前端 packages/mobile/*，接你当前队列后面做；这是状态tab的概览卡，跟你在改的 chat/settings/banner 不同文件，先确认文件边界避免跟你自己前面改动冲突）： ⊘ work 已完成+PM 验证(77测试绿)+整批提交 ad7b52c;赵云 codex 未逐个 team report,PM 收尾
- [x] **赵云** dispatch `e3b62d12` — M28 聊天图片消息 2 项（纯前端 packages/mobile/*，接你队列后；都在 chat/消息气泡区域 app/(tabs)/index.tsx，跟你前面 chat 改动同文件，注意一起改别覆盖）：
- [x] **马超** dispatch `c0bc94e6` — M29 Phase1：推送通知调研 spike（调研类，必须产出 .hive/reports/*.html + .hive/research/*.md，中文，调研硬规则）。只调研不改产品码（可写最小 PoC 验可达性）。
- [x] **马超** dispatch `7e299a54` — M26 加固：worker"干完不汇报/卡住"必须由系统可靠兜住，不依赖 user 或 orchestrator 盯。背景：user 强烈不满——赵云干完 6 项 UX 却不跑 team report，是 user 先发现的、不是系统兜住…
- [x] **马超** dispatch `10fdd7f2` — baseline 体检 + 刷新（PM 文档维护，runtime 提示 module-map.md 已 stale：上次更新 3 天前、之后 83 处代码变动未同步）。
- [~] **赵云** dispatch `4a55bf26` — M28 紧急修复：手机「从相册选二维码」解不出码（user 真机 #21 第一个功能就 fail，弹"未找到二维码"）。读 packages/mobile/app/(tabs)/settings.tsx 的 launchImageLibr… ⊘ QR jsQR 转马超(claude)重做,质量优先
- [x] **钟馗** dispatch `4deca2e6` — 独立代码审查：#21 手机 UX 批（commit ad7b52c，6 项）刚出包，但 user 真机第一个功能（扫码读相册）就 fail。我（orchestrator）只自己 review+跑测试就出了、没经你审查，user 批评流程缺…
- [~] **赵云** dispatch `a71e27e1` — M28 追加（接在你 QR 修复后做，纯前端 packages/mobile/app/(tabs)/index.tsx 的图片预览 Modal）：聊天图片点击放大现在只能全屏 fit-to-screen，**不能双指缩放**，user 要… ⊘ pinch 已完成在树里,PM 整批提交收口
- [~] **赵云** dispatch `3acf3537` — M28 追加（接你队列后，纯前端）：中继徽章跟「在线」没对齐。聊天页 header「Orchestrator ⟷中继 ●在线 ⌄」一行里，中继徽章偏高、在线药丸偏低，没齐平、看着丑。 ⊘ 中继对齐已完成在树里,PM 整批提交收口
- [x] **马超** dispatch `6e3e1dde` — M28 手机端 UI 设计稿（设计先行：user 嫌当前实现"丑死了"，要先出设计再照做）。产出 .hive/reports/2026-05-31-mobile-add-worker-redesign.html（自包含 HTML，中文说明…
- [x] **赵云** dispatch `84f6ddbd` — M28 #22 修复批 — 钟馗独立审查发现的 3 个真问题（接你队列后，纯前端，跟你前面 QR/pinch/中继 同区域，一起改别覆盖）：
- [x] **赵云** dispatch `bcb60d09` — M28 #22 追加（跟你「中继徽章对齐」那条一起做，同 header 区域 packages/mobile/app/(tabs)/index.tsx 顶部）：聊天页 header 在**离线**状态排版坏了——离线徽章带刷新↻图标比"中…
- [x] **马超** dispatch `b97cef9c` — M28 QR 读相册修复（从赵云转来，质量优先）。背景见 .hive/research/2026-05-31-push-notification-spike.md 旁。**关键纠偏**：之前怀疑"华为无 GMS 导致 scanFromUR…
- [x] **钟馗** dispatch `08bc56f2` — 复审 #22（commit 654a4c8）：确认你上轮提的 3 个发现是否真修好 + 扫新增代码。具体：
- [x] **赵云** dispatch `15b927be` — M28 #23 修复（钟馗复审 #22 又抓 2 个，纯前端）。**重要：别碰 settings.tsx（马超正在改它做 QR，会冲突）——settings 那处 i18n 我另处理。**
- [x] **赵云** dispatch `6662e1fc` — i18n 补充（更正我之前"别动 settings.tsx"——马超已改完 settings.tsx 的 QR，现在你可以安全改它了）：把 settings.tsx 的漏翻也并进你这轮 i18n 一起做，跟 index/workers 同…
- [x] **钟馗** dispatch `4f17eff8` — 复审 #23（commit a898db2，QR jsQR + 去重 + i18n）。重点：
- [x] **马超** dispatch `5c27d9f7` — M28 #23 修复（钟馗复审抓到，含 1 个 HIGH 回归。**你接 index.tsx + settings.tsx + chat-message-dedupe.ts 全部，赵云只动 workers.tsx，文件不冲突**）：
- [x] **赵云** dispatch `d32d047d` — M28 #23 i18n 残留（**只动 workers.tsx，马超在改 index/settings，别碰那俩**）：workers.tsx:847-850 的 worker 状态 Working/Idle/Stopped 还是硬编码…
- [x] **钟馗** dispatch `312967e1` — 三审 #23（commit 见 git log -1，二轮修复）。重点确认你上轮提的 3 个是否真修好：①HIGH 去重——chat-message-dedupe.ts 现按 created_at 一对一"新鲜消费"（每条 server …
- [x] **赵云** dispatch `a27be968` — M28 #23 i18n 最后收口（只动 workers.tsx，这次一次补干净别再漏）：钟馗三审发现 workers.tsx 还有硬编码英文没翻——不只状态，还有 role/feature 标签。具体 line 39-83 + 847-…
- [x] **赵云** dispatch `e2b6c1f7` — M28 UI 一致性铺开（进下一个 build）：把 状态/驾驶舱/设置 3 个页的「中继」连接徽章也做成 chat 页那样紧凑，别再独占整行。
- [~] **赵云** dispatch `e8ec5b9a` — M28 chat 多图渲染坏了（进下个 build，接你 中继 badge 后）：user 发 3 张图，聊天里显示成 **3 个空绿框、完全看不到缩略图**。比审查说的"多附件只显示第一张"更糟=全空。 ⊘ 赵云 codex 卡死(index.tsx 没动),转马超
- [x] **赵云** dispatch `25118247` — M28 连接模式手动切换（进下个 build，接你 multi-image 之后；改 settings.tsx 连接详情 + 必要时 client.ts）：
- [~] **赵云** dispatch `368f3b69` — M28 chat header + 输入框两处（进下个 build，index.tsx，跟你 multi-image/连接切换同文件一起改，别互相覆盖）： ⊘ 赵云 codex 卡死,转马超
- [x] **马超** dispatch `550fef9e` — M31 Phase1 调研 spike：worker 模型可见 + 可配置（调研类，产出 .hive/reports/*.html + .hive/research/*.md 中文）。只调研（可最小 PoC 验证），不改产品码。
- [x] **马超** dispatch `4c111e03` — M28 #24 接手赵云卡死的 2 项（纯前端 packages/mobile/app/(tabs)/index.tsx；赵云 codex 卡死没做，转你 claude）：
- [x] **钟馗** dispatch `549245bf` — 复审 #24（commit 3d71938）：赵云+马超合并的批次。重点：
- [x] **马超** dispatch `d3a0929c` — M28 index.tsx i18n 彻底收口（进 #25，一次扫干净别再漏；钟馗 #24 复审发现 index.tsx 还有系统事件/媒体标签英文）：
- [x] **马超** dispatch `0599e989` — M28 #26 修 3 个（都在你 #24/#25 改的 index.tsx + i18n 区域）：
- [x] **赵云** dispatch `3dadfa24` — M28 Cockpit 计划页里程碑详情 markdown 渲染（纯前端 packages/mobile/src/cockpit/PlanView.tsx，跟马超在改的 index.tsx 不同文件、不冲突）：
- [x] **钟馗** dispatch `2070fe15` — 审查待出 2.3.0 的两批未提交改动（赵云 markdown + 马超 #26，都在工作树未 commit）：
- [x] **马超** dispatch `7cada171` — M28 手机端「终端（实时）」视图渲染改进（独立任务，进单独 build；先定位文件——orchestrator/worker 的实时终端视图，可能在 app/agent/[id].tsx 或相关终端组件，自己 grep "终端" / 实…
- [x] **赵云** dispatch `b64d46f4` — M28 Cockpit 计划页里程碑时间线视觉微调（PlanView.tsx，跟你刚做的 markdown 同文件，一起改别覆盖）：
- [x] **赵云** dispatch `1a65b58b` — M28 markdown 渲染修复（钟馗审出 HIGH，PlanView.tsx，跟你正在做的圆圈一起改、同文件）：
- [x] **钟馗** dispatch `e8ac94da` — 复审赵云对你 HIGH 发现的修复（未提交，PlanView.tsx + plan-markdown.ts）：
- [x] **钟馗** dispatch `f9fcef68` — 再复审一项（接你 PlanView 复审之后）：马超的「终端（实时）」渲染改进（未提交）。文件：packages/mobile/src/lib/terminal-text.ts(新) + app/agent/[id].tsx。
- [x] **马超** dispatch `febe64dc` — M28 服务端配套：mobile transcript route 修复（让你客户端 terminal-text 的 \r覆盖+缩进保留真生效；服务端改、需 4010 重启）：
- [x] **钟馗** dispatch `a6017ce7` — 复审马超的服务端 transcript 修复（未提交，src/server/routes-mobile.ts + tests/server/mobile-routes.test.ts）：
- [~] **马超** dispatch `12157eaa` — 任务：写一份 4G relay 远程连接攻坚的正式 HTML 交付报告（中文，自包含单文件）。 ⊘ 通道阻塞时马超没做成,转给刚证明可靠的赵云
- [~] **关羽** dispatch `bc859aad` — 任务：仪表盘待办（Cockpit ActionBar）按钮文案做多语言 i18n。最小正确改动，做完要能跑测试。 ⊘ worker submitted 即停，未做任何 i18n 改动，重派
- [~] **关羽** dispatch `af08272f` — 重派（上次注入后没启动就停了）。任务：仪表盘待办（Cockpit ActionBar）按钮文案做多语言 i18n。立刻开始，先读文件再动手。 ⊘ 关羽第二次 working 后停、零产出，codex 连续两卡，转 claude
- [x] **马超** dispatch `14ef03bd` — 排队任务（关羽 codex 连卡两次没做成，转给你 claude，做完手头的 4G 报告再接这个）。
- [x] **赵云** dispatch `971fdfdf` — 任务：worktree 隔离设计 spike（只出设计方案，不改任何产品代码）。中文撰写。
- [x] **赵云** dispatch `f3b26bdd` — 任务：写一份 4G relay 远程连接攻坚的正式 HTML 交付报告（中文，自包含单文件）。你刚才的 worktree spike 报告质量很好，这个同标准。
- [x] **马超** dispatch `547e5138` — 排队任务（做完手头 i18n 再接）。任务：OpenTeams vs HippoTeam 竞品对比正式交付报告（中文）。要读 Rust，所以给你 claude。
- [~] **马超** dispatch `48e8f102` — 任务：M32 Phase 1 — worker 独立 CODE worktree + 共享 .hive 治理根。高风险（动 agent launch 路径），强 TDD，分阶段，这次只做 Phase 1。 ⊘ prompt 反引号被 shell 命令替换污染,重发
- [x] **马超** dispatch `73bc8ea7` — M32 Phase 1：worker 独立 CODE worktree + 共享 .hive 治理根。高风险（动 agent launch 路径），强 TDD，分阶段，这次只做 Phase 1。
- [x] **马超** dispatch `62cbe900` — 排队任务（做完 M32 worktree 再接，两者都动 launch 路径必须串行，别同时改）。
- [x] **钟馗** dispatch `7c6747d3` — 代码审查（只出结构化 review，不改代码，中文）。审 commit 28b8417 = M32 Phase 1 worker 独立 CODE worktree + 共享 .hive 治理根。马超(claude)做的，高风险动 agen…
- [x] **马超** dispatch `9874141b` — 排队任务（做完手头 M25 Phase 2 再接）。M32 Phase 1 返工：钟馗审你的 commit 28b8417 找出 4 个 blocking + 1 medium，全部成立，必须修。修完重新交我让钟馗复审。
- [x] **钟馗** dispatch `f3d579ba` — 代码审查（只出结构化 review，不改码，中文）。审 commit 8a2b0c1 = M25 Phase 2 Claude provider managed home + session 隔离。马超(claude)做的，高风险动 la…
- [x] **钟馗** dispatch `4fcd4c6a` — 复审 commit 6867cc9 = M32 Phase 1 返工（你上轮审 28b8417 出的 4 blocker + 1 medium，马超已修）。只出结构化 review 不改码，中文。重点：确认每个 blocker 真修好了 …
- [x] **钟馗** dispatch `6d10e807` — 代码审查 commit 538d004 = Cockpit ActionBar 待办按钮文案 i18n（马超 claude 做的，之前 PM 图省事自审了没派你，现补审）。只出结构化 review 不改码，中文。
- [x] **马超** dispatch `c6bb87b5` — M34 设计 spike：未审代码改动看板兜底（只出设计方案 + 读现有代码，不改产品代码）。中文，产出 reports+research 双份。
- [x] **马超** dispatch `7a5ead11` — M34 Phase 1 实现：未审代码改动看板兜底。你刚做的 spike，照推荐方案实现。强 TDD。
- [x] **钟馗** dispatch `d5ea3476` — 复审 commit 7000f5c = M34 Phase 1 未审代码改动看板兜底（马超 claude 做，纯函数零 schema）。只出结构化 review 不改码，中文。审 commit 本身（git show 7000f5c）。
- [x] **赵云** dispatch `8e8e9958` — 任务：扩展周瑜（sentinel）巡检——加"陈旧决策草案"检测。最小改动，强 TDD。
- [x] **马超** dispatch `e6124fc1` — M34 Phase 1 返工：钟馗复审 commit 7000f5c 出 1 BLOCKING + 2 风险，全成立，必须修。修完重交钟馗复审。
- [x] **钟馗** dispatch `87bcf17c` — 代码审查 commit 872befd = 周瑜 sentinel 巡检扩展（赵云 codex 做，加陈旧决策草案检测）。只出结构化 review 不改码，中文。审 commit 本身（git show 872befd）。改 sentin…
- [x] **钟馗** dispatch `e382b71c` — 复审 commit ff6f29f = M34 Phase 1 返工（你上轮审 7000f5c 出的 1 BLOCKING + 2 风险，马超已修）。只出结构化 review 不改码，中文。审 commit 本身（git show ff6…
- [x] **马超** dispatch `aa3b23f3` — 任务：做一份完整的 HippoTeam 演示文稿——综合完整版、中英双语、自包含 HTML 幻灯片。这是给 user 的交付件，质量要高。
- [x] **马超** dispatch `0f7119fa` — 任务：给你刚做的 HippoTeam deck（.hive/reports/2026-06-01-hippoteam-deck.html）做两件事——①配进移动 App 设计图 ②加打印 CSS（为转 PDF）。user 要转 PDF 发…
- [x] **马超** dispatch `cb17f3e0` — 任务：重设计手机「新增 Worker」弹窗的 AGENT CLI 选择器——从纯文字 pill 改成「图标 + 文字」。React Native。要美观。
- [x] **赵云** dispatch `a09ce1cd` — 任务：修手机 app bug——切换工作区后 Chat 仍显示上一个工作区的聊天记录。React Native。
- [x] **马超** dispatch `ad49c033` — 任务：手机端补齐 orch/worker 控制（追平 PC）——user 急着出包，尽量做成纯 APK 改动（复用现有后端，别加要 4010 重启的新端点）。React Native。
- [x] **钟馗** dispatch `bc704275` — 复审两个已 commit 的手机修复（user 急着出包，并行审）。只出结构化 review 不改码，中文。
- [x] **赵云** dispatch `ceb47508` — 返工 commit efaa74d：钟馗复审出 1 BLOCKING（你工作区切换修复漏了 disconnect 路径）。修完重交钟馗。
- [x] **钟馗** dispatch `a56c90ff` — 复审 commit a0d5b61 = 工作区切换返工（你上轮在 efaa74d 出的 disconnect BLOCKING，赵云已修）。只审 commit 本身（git show a0d5b61），别看工作树（马超在叠 Task X）…
- [x] **钟馗** dispatch `195667a8` — 复审 Task X 两个 commit（手机 orch/worker 控制，马超 claude）。只审 commit 本身不改码，中文。
- [x] **马超** dispatch `6b817bd7` — 任务：根治手机消息重复 ⑥——mobile chat 加幂等键。schema+server+mobile 三层。强 TDD。
- [x] **马超** dispatch `7a5beb04` — 紧急 P0：2.3.1 把手机发消息彻底搞坏了，user 暴怒、app 不可用。立刻查根因+修。
- [x] **钟馗** dispatch `ec0171d9` — P0 紧急复审 commit 25f6b89 = relay RPC 超时修复（修 2.3.1 发消息发不出，user 暴怒，要出 2.3.2）。马超 claude 做。只审 commit 本身不改码，中文，快。
- [x] **马超** dispatch `108475bf` — P0+ 深层 relay bug 调查（你刚修完 relay-transport 超时，最熟这层，继续）。
- [x] **马超** dispatch `39bf3b7d` — 补：我查了 runtime.sqlite mobile_chat_messages 给你数据点收窄——
- [x] **马超** dispatch `7c502bb5` — 实现治本修复（你的根因报告 2026-06-01-relay-wedge-root-cause 的方案 ①+②）。这是 P0+，user app 现在 wedge 着。强 TDD（复现真实失败模式），做完钟馗审。
- [x] **钟馗** dispatch `63adbec0` — P0+ 复审 commit 1231111 = relay 三方探活修复（治本僵尸 daemon wedge，user app 卡死的根因）。马超 claude 做，relay 基建/M27 territory 敏感。只审 commit …
- [x] **马超** dispatch `cc0e3d30` — P0 修复（根因已确认，代码+诊断面板完全吻合）：LAN 模式下发消息被 relay-readiness 门槛误卡进队列发不出。
- [x] **钟馗** dispatch `81387415` — P0 紧急复审 commit ddbd73e = LAN 模式发消息被 relay 门槛误卡修复（user 卡死的真根因，要出 2.3.3）。马超 claude 做，纯客户端。只审 commit 本身不改码，中文，快。
- [~] **吕布** dispatch `6e76376d` — 任务：研究 GitHub 项目 https://github.com/chekusu/wanman。中文，调研类硬规则=reports+research 双产出。 ⊘ opencode 零产出停了,重派
- [x] **马超** dispatch `8855a45c` — P0 继续（今天做完，user 明确要求不拖）：查 + 修 4G 中继模式发消息时通时不通 + churn。
- [x] **马超** dispatch `1f30813b` — 批准你的 4G churn 修复方案，按「修复1+3+2(a+c)」全部实施。今天做完，强 TDD，做完钟馗审。
- [x] **吕布** dispatch `f7eef40b` — 研究 GitHub 项目 wanman。立刻开始，第一步就 clone。中文，产出 reports+research 双份。
- [x] **钟馗** dispatch `25961549` — P0 复审 commit 2b2718a = 4G relay churn 治本(断环+降频+堵放大器,要出 2.3.4)。马超 claude,纯客户端,relay 命脉。只审 commit 本身不改码,中文。
- [x] **马超** dispatch `3ce5ee09` — P0 追加（折进 2.3.4，今天做完）：workflow 审计在你刚改的 relay/outbox 区抓到 2 个真 bug（带 file:line+复现+验真），churn 修复没覆盖，必须一起修。
- [x] **关羽** dispatch `4d18df62` — P0 mobile bug 修复（cluster B：chat + settings UI，全员并行其中一份）。完整 file:line+复现+验真在 .hive/reports/2026-06-01-mobile-app-bug-aud…
- [x] **赵云** dispatch `aba8e1fb` — P0 relay 服务端 bug 修复（cluster C：packages/relay，全员并行其中一份）。完整 file:line+复现+验真在 .hive/reports/2026-06-01-mobile-app-bug-audi…
- [x] **吕布** dispatch `abc977cc` — P0 mobile bug 修复（cluster D：agent 终端页，单文件隔离，全员并行其中一份）。完整 file:line+复现+验真在 .hive/reports/2026-06-01-mobile-app-bug-audit.…
- [x] **马超** dispatch `da09f462` — 范围扩展（接着你正改的 critical clobber + ghost socket 一起做，全在你这三个文件里，别人不碰，避免冲突）。完整 file:line+复现+验真在 .hive/reports/2026-06-01-mobil…
- [x] **赵云** dispatch `d697e19f` — 更正派单（我上一单文件路径写错了，pendingUploadPaths 不在 packages/relay，你没越权是对的）。bug 2 真实位置在**本地 daemon**：src/server/relay-rpc-handler.ts…
- [x] **钟馗** dispatch `bf17c8ab` — 审查任务（吕布 opencode 的 mobile bug 修复，将进 2.3.5 APK 投递 user 真机，要独立审）。
- [x] **吕布** dispatch `ed90656b` — 返工（钟馗审出 2 个 BLOCKING，必须修，这正是本 session 反复栽的"测试绿但生产坏"）。文件还是 packages/mobile/app/agent/[id].tsx + 测试。
- [~] **钟馗** dispatch `37bdc52c` — 审查任务（关羽 codex 的 cluster B，4 个 bug，进 2.3.5 APK 投递 user 真机）。范围：packages/mobile/app/(tabs)/index.tsx + packages/mobile/app… ⊘ orphan-submitted: worker stopped without reporting
- [x] **钟馗** dispatch `32c1aefc` — 审查任务（赵云 codex 的 relay 两条 bug，独立于 mobile cluster，跨两个部署轨）。范围：①packages/relay/src/relay-server.ts + packages/relay/tests/u…
- [x] **钟馗** dispatch `715a292f` — 审查任务（马超 claude 全 cluster 最终态，2.3.5 的核心，含 CRITICAL 消息丢失修复——必须独立审，PM 不自审 claude）。范围：packages/mobile/src/api/relay-transpo…
- [x] **马超** dispatch `236a491a` — 返工（钟馗审你 cluster 出 2 BLOCKING + 2 non-blocking，其余全过。同 3 文件，修完一起再审）。
- [x] **钟馗** dispatch `fd8a9ea9` — 复审任务（马超 claude 返工你上轮 2 BLOCKING + 2 non-blocking 的修复，聚焦这几处 + 回归，其余你已过审）。范围：packages/mobile/src/api/mobile-outbox.ts + m…
- [x] **赵云** dispatch `aa0840b0` — P0 接手吕布卡死的任务（opencode 卡了 1 小时，你来收）。修 packages/mobile/app/agent/[id].tsx 一个文件：切 workspace 后终端轮询 + 初始 load 串台。吕布在树里留了个半成品…
- [x] **钟馗** dispatch `b3d64560` — 重派（你上一条关羽审 37bdc52c 被后续 review 插队饿死、1 小时没接手，现重发，请这次务必处理）。审查关羽 codex 的 cluster B，进 2.3.5 APK 投递 user 真机。范围：packages/mobi…
- [x] **关羽** dispatch `ce002414` — 返工（钟馗审你 cluster B 出 2 BLOCKING，都在 QR 首连，必须根治——这是今晚连接竞态被反复烧的同一路径）。媒体气泡+代码块实现已过，不用动；只修 QR + 补真测试。
- [x] **钟馗** dispatch `04f3a095` — 复审任务（关羽 codex 返工你上轮 QR 首连 2 BLOCKING，聚焦这两处+回归，媒体/代码块你已过审不用再看）。范围：packages/mobile/src/api/mobile-runtime-context.tsx(con…
- [x] **钟馗** dispatch `f1ecee26` — 审查任务（最后一条，进 2.3.5 APK）。agent 详情页切 workspace 串台修复。注意：此文件经历吕布+赵云重复写（同一活），我已验证磁盘是一份连贯版本（requestSeqRef 仅 line 308 一处、7 测绿），…
- [x] **关羽** dispatch `38ff7436` — P0 新 bug：手机端 Worker 详情的"终端(实时)"展示坏了。user 截图实证（看 hive-serva orch 终端）：整个终端**只显示一行** `sqlite3 \"\$DB\" \"SELECT name FROM …
- [x] **钟馗** dispatch `a284e3e9` — 审查任务（关羽 codex 修手机终端展示 bug，进下个 APK）。范围：packages/mobile/app/agent/[id].tsx + packages/mobile/src/api/agent-poll-stale-gua…
- [x] **关羽** dispatch `df851fce` — P0 聊天串台 bug（user 真机实证 + 我已查 DB+代码定位根因，不是猜）。现象：在 HippoMind 发的消息切到 hive-serva 后仍显示在 hive-serva 聊天页。DB 证明后端路由正确（消息确实落 Hipp…
- [x] **钟馗** dispatch `66fc0ab3` — 审查任务（关羽 codex 修手机聊天串台，进下个包）。范围：packages/mobile/app/(tabs)/index.tsx + packages/mobile/src/lib/chat-message-dedupe.ts + …
- [x] **关羽** dispatch `ba3a8e49` — 返工（钟馗审出 1 BLOCKING，又是"修复引入新 bug"）。你 chat 串台修复的方向对，但**第④步破坏性删除要去掉**。
- [x] **钟馗** dispatch `3499645c` — 复审任务（关羽 codex 返工你上轮 chat 串台 BLOCKING，聚焦这处+回归）。范围：packages/mobile/app/(tabs)/index.tsx + packages/mobile/src/lib/chat-me…
- [x] **钟馗** dispatch `7e7e4d3c` — 深度调研任务：wanman vs HippoTeam **代码级**对比，出结论报告。user 明确要求"不能停留在纸面上，要代码细致分析"——吕布上次是 README/web 级(浅)，这次必须读真代码、引 file:line。
- [x] **关羽** dispatch `36c3edf5` — 调研任务：从 user 的 Obsidian Vault 挖「对 HippoTeam 有用的 agent 架构/治理/提示词」精髓。Vault 根=/Users/huangzongning/Documents/Obsidian Vault…
- [x] **赵云** dispatch `4bb9a21d` — 调研任务：从 user 的 Obsidian Vault 挖「对 HippoTeam 有用的 agent 记忆系统」精髓。这是 user 最深的积累（TencentDB Agent Memory 源码级 + MemOS 系列），要认真。V…
- [x] **吕布** dispatch `fe64b3b1` — 调研任务（opencode 高量扫描，正合适）：扫 user Obsidian Vault 的「AI早报」文件夹里 81 篇 Twitter 日报，挑出对 HippoTeam 有用的干货。路径=/Users/huangzongning/D…
- [x] **典韦** dispatch `51ac02fb` — 调研任务（opencode）：读 user Obsidian Vault 里几篇 agent 自动化系统设计文档，挑对 HippoTeam 有用的模式。路径=/Users/huangzongning/Documents/Obsidian …
- [x] **钟馗** dispatch `91ab5888` — 深度调研 spike：实时语音对讲——自建开源 vs OpenAI Realtime vs Agora，给 HippoTeam"开车 hands-free 对讲"场景出结论报告。代码级读两个已 clone 的仓库，别停在纸面。
- [x] **吕布** dispatch `c9d18b76` — 实现任务：给 HippoTeam 补本地 TTS（文字语音念回），续 M14a。**核心要领：完全镜像现有 local-stt.ts 那套，反过来做**——它是音频→文字，你做文字→音频。数据本地、离线、零云（跟 STT 一样的本地路线）。
- [x] **钟馗** dispatch `2a3431d3` — 审查任务（吕布 opencode 实现本地 TTS，续 M14a，进产品）。范围：src/server/local-tts.ts(新) + tests/unit/local-tts.test.ts(新) + relay-rpc-handl…
- [~] **吕布** dispatch `a253bce2` — 返工（钟馗审你 TTS 出 2 BLOCKING，都是真生产 bug，测试没抓到。钟馗亲手验过，按下面精确修，别自由发挥）。 ⊘ orphan-submitted: worker stopped without reporting
- [x] **关羽** dispatch `7550f44a` — P0 实现：M35 实时对讲 Phase 1——自建本地语音对讲最小闭环（方案①复用现有 relay，不碰 Agora、不绕 OpenAI Realtime）。目标：开车 hands-free 跑通"你按住说一句 → whisper 转文…
- [x] **关羽** dispatch `f284afbd` — P0 实现：M35 对讲模式 = 连续 VAD hands-free（user 重点，开车用）。在你刚做的 push-to-talk 基础上扩——**两个模式并存**：push-to-talk(按住说，已有) + **连续对讲(点一下进入…
- [x] **马超** dispatch `61fa0976` — 设计任务：出"实时对讲模式"的 UI 设计稿（HTML mockup，驾驶优化）。这是设计阶段、**只出设计稿不写代码**（talk.tsx 正被关羽改 VAD，你别碰代码，免撞车）。给 user 先看长什么样再拍，照之前 mobile …
- [x] **钟馗** dispatch `52cf871a` — 审查任务（语音子系统整体审，进 2.3.x 包）。两个 worker 的代码纠缠在 synthesizeVoice 契约上，整体审不分开。**注意：吕布干完卡在报告前没 report，你审 git diff 的磁盘态**（我已核实合并树 …
- [x] **关羽** dispatch `504f1953` — 返工（钟馗审语音子系统：吕布 TTS 闭环了，但你的连续对讲 TalkTab 有 2 BLOCKING——都是 hands-free 真 bug，你的 reducer 测试没穿透到 talk.tsx 集成层抓不到）。只改你自己的文件（ta…
- [x] **钟馗** dispatch `166305f1` — 复审任务（关羽返工你上轮连续对讲 2 BLOCKING，聚焦这两处 + 新测试真实性 + 回归）。范围：packages/mobile/app/(tabs)/talk.tsx + src/lib/push-to-talk.ts + __t…
- [x] **关羽** dispatch `d9312a30` — 返工（钟馗复审：BLOCKING1 麦死闭环了✅；但你 BLOCKING2 的修法引入了新 bug——跨设备时钟不可比）。只改你自己的语音文件，别碰吕布 TTS。
- [x] **钟馗** dispatch `3728ae08` — 复审任务（关羽第三轮修连续对讲 BLOCKING2 跨时钟问题，应是语音子系统最后一审）。范围：packages/mobile/app/(tabs)/talk.tsx + src/lib/push-to-talk.ts + __tests…
- [x] **关羽** dispatch `f7ca4239` — P0 紧急：2.4.0 装真机**开打就闪退**。崩溃栈已抓到（adb logcat -b crash）：
- [x] **钟馗** dispatch `2ff2ee45` — 审查任务（关羽把 mobile 语音从 expo-av 迁移到 expo-audio，修真机启动崩溃。这是兼容性迁移,API 模型从命令式换 hook 式,重点审正确性别回归）。范围：packages/mobile/app/(tabs)/…
- [x] **关羽** dispatch `0095ddec` — P0 接力（崩溃修好了，但真机暴露录音 bug）。user 真机截图报错：
- [x] **钟馗** dispatch `0a97fbd9` — 复审任务（关羽修 expo-audio recorder 重复 prepare 真机错误，聚焦录音生命周期+回归）。范围：packages/mobile/app/(tabs)/talk.tsx + __tests__/talk-tab-c…
- [x] **关羽** dispatch `9431905f` — P0 接力（录音 already-prepared 修好了，但真机暴露下一个：读录音文件用了废弃 API）。user 真机截图"需处理"框显示：
- [x] **钟馗** dispatch `e546a570` — 快审（关羽修 SDK56 expo-file-system 主入口 readAsStringAsync runtime throw，改走 /legacy 子入口。小改动但是 P0 firefight 收口前最后一审）。范围：package…
- [x] **赵云** dispatch `e2a027df` — P0：让本地 STT(whisper) 真能转手机录的音频。服务端 src/server/local-stt.ts 改。背景：手机端语音对讲已修好(录音→发 base64 到 voice.transcribe)，但服务端 STT 转不出—…
- [x] **钟馗** dispatch `b6d97803` — 快审（赵云改 local-stt 让 whisper.cpp 能转手机 m4a 音频，P0 语音收口前最后一审）。范围：src/server/local-stt.ts + tests/unit/local-stt.test.ts。git …
- [x] **赵云** dispatch `9255e719` — 返工（钟馗审 local-stt 出 1 BLOCKING，但是**测试隔离**问题不是产品 bug——你产品代码全过审）。根因：PM 刚把真 whisper-cli+ffmpeg+模型装进机器(~/.config/hive/whispe…
- [x] **钟馗** dispatch `dbb7785a` — 复审（赵云返工你上轮 local-stt 的测试隔离 BLOCKING，聚焦这处）。范围：src/server/local-stt.ts + tests/unit/local-stt.test.ts + tests/server/voic…
- [x] **赵云** dispatch `5dc41d92` — P0 收尾：给 whisper-cli 加提示词,中文转写质的飞跃(PM 实测:加提示词后繁体没了+worker 名字全认对)。改 src/server/local-stt.ts 的 whisper-cli 分支。
- [x] **赵云** dispatch `5b6898eb` — P0 语音最后一公里:whisper 把中文转成了英文,因为没锁定语言。PM 已真机确认整条链路通,唯一 bug=输出英文。改 src/server/local-stt.ts 强制中文。
- [~] **赵云** dispatch `eaa493d4` — P0 语音念回不出声——TTS 输出 AIFF 安卓播不了,转 m4a。PM 已真机+代码双重定位。 ⊘ 赵云退出未做,改派关羽
- [~] **关羽** dispatch `df5f84a6` — P0 语音念回不出声——TTS 输出 AIFF 安卓播不了,转 m4a(赵云接此单但退出没做,改派你)。PM 已真机+代码双重定位,改 src/server/local-tts.ts。 ⊘ 关羽 stopped 未运行,改派运行中的马超
- [~] **马超** dispatch `df86bf2a` — P0 语音念回不出声——TTS 输出 AIFF 安卓播不了,转 m4a。PM 已真机+代码双重定位(赵云/关羽都是 4010 重启后 stopped 没运行,接单空转,改派你这个在跑的)。改 src/server/local-tts.ts。 ⊘ 马超重启后卡在旧session(design稿)没启动本任务,改派赵云
- [x] **赵云** dispatch `0ac982e0` — P0 语音念回不出声——TTS 输出 AIFF 安卓播不了,转 m4a。你刚被 user 恢复,这是新任务,立刻开始别管旧 session。PM 已真机+代码双重定位。改 src/server/local-tts.ts。
- [x] **赵云** dispatch `88ed55f5` — M36 流式语音 Spike A：relay 隧道扛不扛常开实时音频流?(调研型,出中文报告)
- [x] **关羽** dispatch `970faa2f` — M36 流式语音 Spike B：能否从 orchestrator 输出流增量取回复、按句切?(调研型,出中文报告)
- [x] **关羽** dispatch `bb59c6fd` — M36 流式语音 2a-土版：手机端【音频队列】顺序播多条 orch 回复(实现型,你做过 talk.tsx)。
- [x] **钟馗** dispatch `9b3f16d1` — M36 流式语音 2a 审查:手机端 orch_reply 音频队列(关羽实现,codex 独立审,ship-critical 语音件)。
- [x] **关羽** dispatch `7a215790` — M36 2a 返工:钟馗审出 1 BLOCKING(异步竞态)+1 兼容回归,修完复审。改 packages/mobile/app/(tabs)/talk.tsx + push-to-talk.ts。
- [x] **钟馗** dispatch `0c7d15c5` — M36 2a 复审:关羽已按你上轮 review 修。确认 BLOCKING 真闭环再放行。改 packages/mobile/app/(tabs)/talk.tsx + push-to-talk.ts + 两测试文件,git diff …
- [x] **赵云** dispatch `804840a2` — M36 ⓠ 第一增量:常开中继双工音频通道(协议+延迟实测,先不灌真音频)。你做的 Spike A 已给蓝图(.hive/reports/2026-06-02-spike-relay-streaming-audio.html)。
- [x] **钟馗** dispatch `df99c0a2` — M36 ⓠ 审查:常开中继 voice_stream 双工通道(赵云实现,relay 高危区必审,codex 独立审)。git diff 看。
- [x] **赵云** dispatch `246242c3` — M36 流式输出核心:voice_stream 灌真音频 + 手机播放(你建的通道,继续往里灌音频)。
- [x] **钟馗** dispatch `1b892b08` — M36 审查:voice_stream 灌真 TTS 音频(赵云实现,relay+音频 高危区必审,codex 独立)。git diff 看。
- [x] **赵云** dispatch `5c0767b7` — M36 voice_stream 灌音频【返工】:钟馗审出 2 个 BLOCKING,都必修,修完复审。
- [x] **钟馗** dispatch `7f50afe0` — M36 voice_stream 灌音频【复审】:赵云已修你上轮 2 个 BLOCKING。确认真闭环再放行(relay+音频+安全 高危)。git diff 看。
- [x] **关羽** dispatch `1b4439de` — M36 流式输出:把对讲念回接到 voice_stream(真实回复走验证过的新路)。你做的 2a 念回队列。
- [x] **钟馗** dispatch `bd5e1c00` — M36 审查:真实对话念回切到 voice_stream(关羽实现,codex 独立审)。改 packages/mobile/app/(tabs)/talk.tsx + talk-tab-continuous.test.ts,git di…
- [x] **关羽** dispatch `d865d8a6` — M36 收尾修两个真 bug(user 真机发现,PM 过度承诺的锅):
- [x] **赵云** dispatch `62036725` — M36 P0 最高优先:语音'秒回'层——干掉 30 秒延迟。user 暴怒,实测 orchestrator 回复要 28-30 秒(全是我这重 agent 先做完一堆活才回),user 要 2-3 秒应声。
- [x] **钟馗** dispatch `0382fc93` — M36 P0 审查:语音'秒回'层(赵云,改了核心 prompt 注入路径,高危必审)。git diff 看。
- [x] **赵云** dispatch `97487352` — M36 修转写吐提示词 bug:whisper 无语音时把 initial prompt 吐出来当转写结果。
- [x] **赵云** dispatch `a7ac763d` — M36 给秒回层加【无 key 兜底:即时固定确认】。
- [x] **钟馗** dispatch `152f9646` — M36 快审:秒回层加'无 key 兜底固定确认'(赵云,消息路径,你上轮审过核心安全)。git diff src/server/fast-voice-reply.ts 看。
- [x] **赵云** dispatch `063300ea` — M36 无 key 兜底【返工】:钟馗抓到 1 BLOCKING,必修。fast-voice-reply.ts:147-150 fallback 插入会冒泡阻断发消息。
- [x] **钟馗** dispatch `e4a3e12c` — M36 无 key 兜底复审:赵云已修你上轮 BLOCKING(快嘴异常冒泡阻断发消息)。确认真闭环再放行。git diff src/server/fast-voice-reply.ts 看。
- [x] **赵云** dispatch `88e94ba3` — M36 P0 快嘴换国产模型 GLM(智谱)——user 给了 key,PM 实测 ~1秒/自然中文,比 Haiku 还快。改 src/server/fast-voice-reply.ts。
- [x] **钟馗** dispatch `835b95f9` — M36 审查:快嘴层切换 GLM(智谱)+ .env 加载(赵云,消息路径高危,你前几轮死守过"快嘴怎么炸都不连累发消息")。git diff 看。
- [~] **赵云** dispatch `6aca6c3f` — M36 GLM 快收尾(钟馗复审提的,大多小修): ⊘ 被 e3581d4d 纠正版覆盖(改/paas/作废,已按/coding/做完并报),过时孤儿
- [x] **赵云** dispatch `e3581d4d` — 【紧急纠正·覆盖上一条的 URL 部分】user 刚明确:https://open.bigmodel.cn/api/paas/v4 【要收费】,https://open.bigmodel.cn/api/coding/paas/v4 才是【…
- [x] **赵云** dispatch `9443a09a` — M36 P1 吐字 bug 做 robust:whisper 在不清晰/静音音频上把 STT 提示词(尤其团队名单)回吐成转写。现有过滤(isDefaultPromptEcho,3655376)只抓【连续子串】⊆prompt,抓不住【跳选…
- [x] **关羽** dispatch `92b33d50` — M36 P1 连续对讲听不到回复:VAD 已修好(speechEnd 能触发、消息能发),但连续模式下念回播放听不到。PM 判断是录音/播放音频模式切换问题——连续模式为持续监听把 allowsRecording 占着,我的回复没切到扬声…
- [x] **关羽** dispatch `1a14fd98` — M36 P0 对讲连续念回:让对讲模式把【所有新 orch_reply】都念出来,不只"你说完紧接着那一条"。
- [x] **钟馗** dispatch `5b4c426c` — M36 P0 快审:对讲连续念回(关羽,user 暴怒的核心点,talkback 微妙,回归=再激怒 user,务必稳)。git diff talk.tsx + push-to-talk.ts 看。
- [~] **吕布** dispatch `1dd63bf2` — 代码级对比调研:上游 Hive(tt-a1i/hive)vs 我们改过的 HippoTeam。user 点名一定你(OpenCode)做。 ⊘ orphan-submitted: worker stopped without reporting
- [x] **关羽** dispatch `5d0d2348` — M36 P0【返工·灾难防护】对讲连续念回:钟馗抓到 baseline 漏洞,会念历史消息,必修。
- [x] **钟馗** dispatch `4e97c759` — M36 对讲连续念回复审(第3轮):关羽按你建议修了"念历史灾难"。确认灾难路径闭环再放行。git diff talk.tsx 看。
- [x] **吕布** dispatch `527e25bd` — 续上次:上游 Hive vs HippoTeam 代码级对比(你上次中途停了没出报告,clone 已经做好了,这次专注对比+出报告)。user 点名一定你做。
- [x] **赵云** dispatch `46d6644b` — M36 P1 给 GLM 快嘴喂历史上下文(user 拍板的"只读知情前台"):现在 GLM 只拿到当前 transcript、没上下文,所以只会空壳回"收到处理一下"。user 要它能看历史、答有料的。
- [x] **赵云** dispatch `7407df2f` — 【补充·扩展上一条 GLM 喂历史的活】user 进一步要求:GLM 不光看对话历史,还要能查【当前状态】,这样它能直接答 70-80% 的问题(进度/工人状态/orch状态),不用等 orch。
- [x] **钟馗** dispatch `bdc49854` — M36 快审:GLM 快嘴喂"历史+状态"(赵云,你审过多轮的 fast-voice-reply,这次加了读 worker/dispatch 状态喂 GLM)。git diff src/server/fast-voice-reply.ts…
- [x] **关羽** dispatch `bc7f42e8` — M36 P0 连续对讲 VAD 改【自适应阈值】:固定阈值在不同环境失效。PM USB logcat 实测:user 当前环境背景底噪 ~-40dB(安静时 -50),但 voice-vad 固定 speechThreshold=-42/…
- [x] **关羽** dispatch `69b96d0e` — M36 P0 连续对讲 VAD 仍不结束监听——抓到 USB logcat 铁证,自适应底噪估计器写坏了,重修。
- [x] **钟馗** dispatch `8101081f` — M36 P0 连续对讲 VAD 重写已真机验证通过(USB logcat 确认 floor 正确追到 -44、speechEnd 触发两次、转写发送成功),现需你独立审查后再 commit。关羽(claude coder)改了 packa…
- [x] **关羽** dispatch `96760f90` — M36 P0 连续对讲"假触发投递垃圾"——user 没说话时,whisper 在静音/杂音上幻听吐出"网络中文普通话语音指令"/团队名等垃圾,被误投到后台。user 明确要:没真说话/太短/解析不出→不投递。加两道闸:
- [x] **关羽** dispatch `dd7f436a` — M36 P0 钟馗复审抓到 1 个 BLOCKING,必须修后才能 commit/出包。
- [x] **钟馗** dispatch `0ee3eaa8` — M36 复验:关羽已修你上轮的 BLOCKING(连续对讲首句丢失)。请只读复验这一个 blocking 是否真的修掉、有没有引入新问题。
- [x] **关羽** dispatch `163e6421` — M36 调研任务(不是实现,是调研+评估):开口打断(barge-in)怎么实现 + 改动多大、对现有可用语音系统影响多大。user 明确要先调研评估风险。
- [x] **赵云** dispatch `fdc61508` — M36 实现:念回 TTS 升级到 edge-tts 晓晓(user 拍板,嫌 macOS 婷婷难听)。改 src/server/local-tts.ts。
- [x] **钟馗** dispatch `8a6e70ca` — M36 审查:赵云(coder)把念回 TTS 升级到 edge-tts 晓晓,出包前审。改 src/server/local-tts.ts + tests/unit/local-tts.test.ts。git diff 看。
- [x] **关羽** dispatch `379c1cbc` — M36 实现:开口打断(barge-in)P1a — Android 最小版,user 已拍板做。按你自己的调研报告(.hive/reports/2026-06-03-barge-in-调研.html)P1a 方案落地。
- [x] **钟馗** dispatch `84fecd2d` — M36 审查:关羽(claude coder)实现开口打断 barge-in P1a Android 最小版,出包前审。改 packages/mobile/app/(tabs)/talk.tsx + push-to-talk.ts + v…
- [x] **赵云** dispatch `99a38bdd` — M36 UX 修复:outbox 失败消息只能重试不能清除,user 要加"清除"。截图右上角红标"X 条失败 重试"(ConnectionModeBanner)一直在,user 想能清掉旧的失败消息(多半是几次重启 4010 时发失败的…
- [x] **赵云** dispatch `bbfa2da7` — M36 双音色区分 GLM vs orchestrator(user 拍板的调试+体感功能):念回时,GLM 快嘴回复用一个声音、orchestrator 回复用另一个声音,user 一听就知道是谁在回。
- [x] **关羽** dispatch `a0d658b2` — M前端 UX:桌面 Cockpit 的「AI 准备好的待办行动」ActionBar 要可折叠。user 截图反馈:10 条待办占太多竖向空间、影响看板使用,要能收起。
- [x] **钟馗** dispatch `6f97e2aa` — M36 批量审查(3 件,出包/部署前)。git diff 看全部改动。逐件审,各自给 verdict。
- [x] **关羽** dispatch `28bf04b7` — M36 P0 连续对讲严重回归:连续大声说话被提前切断。USB BARGEDBG 铁证:
- [x] **钟馗** dispatch `e81584dd` — M36 P0 复审:关羽修连续对讲"大声说话被提前切断"回归(命脉,刚把连续对讲做坏了)。改 talk.tsx + voice-vad.ts + 测试。git diff 看。审:
- [x] **关羽** dispatch `53a9368c` — M36 P0 纠正决策错误(我判断错了,要回滚 barge-in 默认关):
- [x] **钟馗** dispatch `a375de34` — M36 P0 复审(快):关羽纠正——barge-in 改回默认开(恢复打断好功能),同时保留 voice-vad relative-drop speechEnd 修复(防大声被切)。改 talk.tsx(flag !=="0" 默认开)…
- [x] **关羽** dispatch `2f345ce0` — M36 开口打断调优(有 USB BARGEDBG 数据兜底,精确调):
- [x] **赵云** dispatch `87f9ebb8` — M36 调研任务(user 拍板要"真正听懂人声"的神经 VAD,不是简单调阈值):调研如何给 HippoTeam mobile 语音(连续对讲/开口打断)集成【神经网络人声活动检测(neural VAD)】,让打断和判停只对【真人说话】…
- [x] **钟馗** dispatch `e44c4e3c` — M36 快审:关羽给开口打断调优(治回声自触发+瞬响误触发)。改 talk.tsx 的 BARGE_IN_VAD(margin22→25,startup-30→-26)+ 新增"连续3样本才触发打断"门槛。git diff 看。
- [x] **赵云** dispatch `378bf81b` — M37 神经人声 VAD 实现 Phase 1 — Probe(可行性验证,user 已拍板"要上",按你自己的调研报告分阶段走第一步)。先趟最大风险,不要一上来全量集成。
- [x] **关羽** dispatch `1ed45239` — M37 idea-9:GLM 门卫化 — 简单问题 GLM 自己答完、不惊动 orchestrator(user 反复提的核心诉求,已拍板"可以")。★安全第一:绝不能丢 user 的需求。
- [x] **钟馗** dispatch `b90d19a4` — M37 idea-9 关键审查(★碰发消息核心路径,审查重点=绝不丢 user 消息,user 出门了不能快速纠错,必须审死)。关羽实现 GLM 门卫:简单语音问题 GLM 答完不注入 orchestrator。改 fast-voice-…
- [x] **关羽** dispatch `d9eebb86` — M37 idea-9 钟馗抓到 BLOCKING(消息黑洞,必修):
- [x] **钟馗** dispatch `3b256db2` — M37 idea-9 复审(只验你上轮的 BLOCKING 消息黑洞修没修掉,快审):
- [x] **赵云** dispatch `11984b5e` — M37 STT 收紧团队名回吐拦截(user 反复被这串乱码烦):whisper 在听不清/噪声音频上会回吐 DEFAULT_STT_PROMPT 里的团队名,比如"词:张飞、吕布、赵云、钟馗、赵云、钟馗"。现有 src/server/l…
- [x] **赵云** dispatch `c29bfe5f` — M37 神经人声 VAD Phase 2 — Shadow(把 Silero ONNX 模型集成进来,影子模式打分,先不改行为)。接在你当前 STT 拦截任务之后做。这步是你调研报告里的 Phase 2,基于你 Phase1 的 PCM …
- [x] **钟馗** dispatch `ffd193d6` — M37 快审:赵云收紧 STT 团队名回吐拦截(治"词:张飞、吕布、赵云、钟馗"这种乱码漏网)。改 src/server/local-stt.ts 的 isDefaultPromptEcho:新增并列判据——团队名出现>=3次 且 去掉团…
- [x] **关羽** dispatch `a8f0a32f` — M37 STT 团队名拦截 BLOCKING 修(钟馗抓的误杀,赵云在忙 Phase2 你接手这个小修)。
- [x] **钟馗** dispatch `5795533a` — M37 复审(只验你上轮 STT 误杀 BLOCKING 修没修掉,快审):关羽加了短动作词白名单(看/看下/查/测/审/停/重启/汇报/做/去/来/等),residual 含动作词→保留真指令,只在 residual 空/纯噪声时才拦团…
- [x] **钟馗** dispatch `052461c1` — M37 神经 VAD Phase2 Shadow 审查(★大改动:加了 native 依赖 onnxruntime-react-native + Silero ONNX 模型 asset + pnpm patch + Metro conf…
- [x] **赵云** dispatch `6fc5a5d2` — M37 神经 VAD 修测试开关(shadow/probe flag 在 release 构建不生效):
- [x] **赵云** dispatch `b4b2b929` — M37 手机 app bug(user 报,frustrated):打开 app 后/点右上角某按钮(user 称"重置",但 mobile 无字面"重置"标签,可能是刷新/重连图标)→页面【一直在加载/读取数据、停不下来、没法中断】,只…
- [x] **关羽** dispatch `a32502b7` — M37 手机 app P0 真 bug(user 截图澄清):【念回播放时没有"停止"按钮,user 停不下来只能退 app】。
- [~] **钟馗** dispatch `2bd5ff0c` — M37 手机 app 两个修复批量审(都碰 mobile,出包前)。git diff 看。 ⊘ 审查 dispatch 卡死~2h(周瑜哨兵报+sqlite 证 submitted 12:33 未 report),收口重派
- [x] **钟馗** dispatch `e7747088` — M37 手机 app 两修复批量审(上一条审查 dispatch 卡死了已 cancel,这是重派)。git diff 看。
- [x] **赵云** dispatch `84a63151` — M37 件2 UI加载超时 BLOCKING(钟馗抓,必修):你的 withUiOperationTimeout 超时会 reject UiOperationTimeoutError,但两个调用点没 catch→变 unhandled p…
- [x] **赵云** dispatch `9554c61a` — M37 神经 VAD Silero 真机崩溃——抓到 native crash buffer 铁证,是 JS 错误不是 native 崩溃,可修。
- [x] **钟馗** dispatch `45493668` — M37 神经 VAD Silero 保命修复审查(★碰真机崩溃路径,赵云改,出 shadow 验证包前必审)。
- [x] **赵云** dispatch `f7eae2c5` — M37 神经 VAD 崩溃【保命没生效,换打法】(★紧急,真机仍崩)。
- [x] **钟馗** dispatch `11d60849` — M37 神经VAD 探测式保命修复【快审】(★碰真机崩溃路径,上一版catch-after真机仍崩,这版改catch-before探测式)。
- [x] **赵云** dispatch `ade26ae5` — M37 神经VAD【治本】让 Silero 真正能跑(崩溃已焊死,这单让 native 模块真注册)。
- [x] **钟馗** dispatch `83197936` — M37 神经VAD治本审查(★碰 native 构建/崩溃路径,赵云改,出真机验证包前必审)。
- [x] **赵云** dispatch `96bb79f9` — M37 神经VAD Phase3 — 用 Silero voice_prob 接管【连续对讲判停(speechEnd)+ 开口打断(barge-in)】(user 真机痛点驱动:"我说话中途走动/有背景音,它识别不出我其实已经停了"=老音…
- [x] **钟馗** dispatch `11c5a28f` — M37 神经VAD Phase3 审查(★碰连续对讲判停+开口打断核心决策路径,user 痛点驱动 + barge-in 是敏感区[历史上改坏过 user 暴怒],出包前必审)。
- [x] **赵云** dispatch `0f621378` — M37 神经VAD Phase3 钟馗抓到 2 个 BLOCKING(必修闭环,都是致命区,出包前必须修掉)。
- [x] **钟馗** dispatch `0a63bb39` — M37 神经VAD Phase3【复审】(只验你上轮抓的 2 个 BLOCKING 闭环没,快审,别重审全部)。
- [~] **关羽** dispatch `68448784` — M37 idea-9 v2:GLM↔orchestrator 单声音协调(user 真机验收提的 2 个问题,DB 坐实)。 ⊘ 方向改:user 要两 agent 协调接力(orch 知道 GLM 说了啥、只补未答、不重复、简洁),不是单声音静默。重派
- [x] **关羽** dispatch `eaccf055` — M37 idea-9 v2【改方向:两 agent 协调接力,不是单声音】(我上一单方向错已 cancel,这是重派,看清新设计)。
- [x] **钟馗** dispatch `3be4dcd9` — M37 idea-9 v2 两 agent 协调接力审查(★碰发消息核心路径,绝不丢 user 消息=最高优先,user 出门只能语音不能快速纠错,必须审死)。关羽改,未 commit。
- [~] **赵云** dispatch `3c3deecf` — M37 idea-10 流式实时语音架构【调研 spike】(user 已开绿灯"可以考虑做了";这是 spike 调研出方案,★不是实现,先把路看清给 user 拍方向)。 ⊘ orphan-submitted: worker stopped without reporting
- [~] **赵云** dispatch `9bcc50d2` — [调研收窄] user 已拍板 WebRTC 方案(原话"我同意你说的 webrtc 方案")。所以你的 idea-10 调研【RTSP vs WebRTC 对比段一句带过即可,不用展开】,重点全部放在: ⊘ orphan-submitted: worker stopped without reporting
- [x] **赵云** dispatch `0be7da5c` — [WebRTC 调研重要前置]开做前必读 .hive/decisions/2026-06-02-m36-streaming-voice.md(你自己写过里面 Spike A relay + voice_stream 那几段)。WebRTC…
- [~] **关羽** dispatch `709df380` — M37 对讲 UI 驾驶优化落地(user 看了设计稿说"现在差距很远",拍板【驾驶必需优先】,动画放第二轮)。 ⊘ 关羽重启后未重放,卡 submitted,重派
- [x] **关羽** dispatch `5cecf271` — M37 对讲 UI 驾驶优化落地(user 拍板【驾驶必需优先】,2.7.0 已 checkpoint,全力开动;动画放第二轮)。
- [~] **赵云** dispatch `8a4b2a03` — M37 WebRTC Phase A 前置 de-risk spike(user 已拍 WebRTC 方向+"尽量派"并行开;这步 de-risk 你调研报告里标的 #1 残余风险:react-native-webrtc 在 Expo/R… ⊘ 赵云 派单时停了(4010 重启后状态虚假),待 user 重启后重派
- [x] **马超** dispatch `535e96a1` — M37 WebRTC 近节点 TURN/coturn 部署调研(user 拍 WebRTC over TURN+要决定"近节点 TURN 现成 vs 采购";这调研喂他这个决策,并行做)。
- [~] **钟馗** dispatch `4ee60206` — M37 对讲驾驶 UI 审查(★碰 talk.tsx——刚真机验"好行"的神经 VAD/判停/打断/发消息逻辑就在这文件,首要审"UI 重构没破坏这些")。关羽改,未 commit。 ⊘ 钟馗 派单时停了(4010重启后死PTY),待重启重派
- [x] **钟馗** dispatch `0172562f` — M37 对讲驾驶 UI 审查(★碰 talk.tsx——刚真机验"好行"的神经VAD/判停/打断/发消息逻辑在这文件,首要审"UI重构零行为回归")。关羽改,未commit。
- [x] **赵云** dispatch `735471c6` — M37 WebRTC Phase A 前置 de-risk spike(user拍WebRTC方向+"尽量派";验你方案#1残余风险:react-native-webrtc在Expo/RN本地build集成成本)。
- [x] **关羽** dispatch `528fa35d` — M37 对讲驾驶 UI 钟馗审过 0 blocking,补 2 个 non-blocking 硬化(出包前小修,你刚做的 UI):
- [x] **钟馗** dispatch `be583f5a` — M37 WebRTC Phase A de-risk 审查(★碰 native 构建/config plugin/运行时探针,赵云改,未commit)。
- [x] **关羽** dispatch `c076f441` — M37 对讲驾驶 UI 真机暴露 3 个严重 bug,彻底修(★这次必须真机验过才能再发 user,user 被坑红屏卡死很不满)。
- [x] **钟馗** dispatch `54d1992a` — M37 对讲驾驶 UI 三坑修复审查(★碰 talk.tsx,刚被真机炸过的区域,关羽 re-fix,出包真机验前审)。关羽改,未commit。
- [x] **关羽** dispatch `9e3891d5` — M37 对讲UI 音效guard BLOCKING 闭环(钟馗抓的真漏口,出包前必修):
- [x] **钟馗** dispatch `e12be4af` — M37 对讲UI 音效guard BLOCKING【复审】(只验你上轮抓的"recorder active 窗口 cue 漏播",快审别重审全部)。
- [x] **赵云** dispatch `f906b2f4` — WebRTC #1 命门攻坚(user 定为最高优先):react-native-webrtc 只要被 config plugin 链接进包(WebRTCModulePackage 注册),其 native 音频模块初始化就抢/重配 An…
- [x] **马超** dispatch `f695eedd` — WebRTC Phase 0 信令(signaling)设计(并行,不依赖赵云的音频共存攻坚):设计 WebRTC 建连握手怎么走我们【现有 relay 隧道】。
- [x] **钟馗** dispatch `68e90fa1` — WebRTC 音频共存"生存线"审查(★碰 native 构建/config plugin,赵云改,真机验前审)。
- [x] **关羽** dispatch `598a0d02` — M37 连续对讲判停太敏感(user真机反馈,真痛点):"说话时经常被打断,我没停那么久就断了"。很可能也是STT转写乱的根源(判停太早→半句→whisper转乱)。
- [x] **钟馗** dispatch `8492c3e4` — M37 连续对讲判停时长调整【快审】(只验这一处,别重审全部)。
- [x] **关羽** dispatch `fbbf436d` — M37 连续对讲检测还有音量依赖,户外场景失效(user真机关键反馈):user 户外骑车、风噪大,反映"得说很大声,不然检测不到;还是靠音量阈值"。但我们有神经人声VAD(Silero voice_prob)本该【跟音量无关】——靠声纹…
- [x] **钟馗** dispatch `01b9fd72` — M37 神经 speechStart 修复审查(★碰连续对讲检测核心,关羽改,治 user 户外要喊)。
- [x] **赵云** dispatch `da91190b` — WebRTC 下一步:lazy-init 可行性调研(user 要彻底解决 WebRTC 真通话;你已解了"不注册=不破坏录音"的生存线,这步是让 webrtc 能【真用】)。
- [x] **赵云** dispatch `42947502` — WebRTC Phase 0a:lazy-init patch 原型(你调研推荐的路,user 要彻底解决 webrtc;flag-gated 不扰已备好的 2.7.5 综合包)。
- [x] **钟馗** dispatch `99f005d9` — WebRTC Phase 0a lazy-init patch 审查(★碰 native patch + 录音命脉 + 默认路径必须不扰已备好的 2.7.5,赵云改,出实验包真机验前审)。
- [x] **钟馗** dispatch `90bd72b8` — 对讲页 UI 完整视觉重设计(user 拍:现在功能能用了但页面【丑】,要 Codex 用视觉能力先出【漂亮的设计图】,user 看了再实现,不要现在那个"像但离设计很远"的近似版)。
- [x] **赵云** dispatch `e47357e7` — WebRTC 继续推进(user 拍:赶紧攻克不要浪费时间,然后他要测)。Phase 0a lazy-init patch 已 committed(cc65370)。下一步两件并行做:
- [x] **关羽** dispatch `3843eca6` — M37 idea-9 GLM prompt 修:GLM 越权 claim 派单/行动(user 真机抓到,架构问题)。
- [x] **关羽** dispatch `257a6a2c` — 连续对讲严重bug:user说话【一直没检测到、也没停】(真机,user称严重)。
- [x] **钟馗** dispatch `bb15f618` — [设计追加约束]对讲页重设计要解决一个真bug:user截图反映【状态文字一多就挡住/溢出到中央按钮上】。新设计务必:状态文字/转写/错误信息区域【高度受限+滚动或截断省略】,绝不溢出覆盖中央大按钮;文字区和按钮区布局隔开,文字再长也不挡…
- [x] **钟馗** dispatch `f62b7cc6` — M37 连续对讲"神经VAD全零死流卡死"修复【快审】(★碰检测命脉,user称严重bug,关羽修)。
- [x] **马超** dispatch `65a91c79` — FunASR(阿里Paraformer)vs whisper STT 调研(user提:看到FunASR中文识别比whisper好,问能不能替换;user转写老乱,这可能治本)。
- [x] **钟馗** dispatch `115bb44d` — M37 idea-9 GLM prompt 越权claim修复【审】(碰发消息路径,关羽改 src/server/fast-voice-reply.ts 的 GLM system prompt)。
- [x] **关羽** dispatch `17ffbaa2` — M37 念回TTS净化(user真机暴怒:发的链接/符号被TTS念成一长串字母数字,听着灾难。user要系统级:念回绝不念URL/符号/代码,只念人话)。
- [x] **钟馗** dispatch `9ced09bd` — M37 念回TTS净化【快审】(user最烦的点:链接/符号被念成一长串。关羽改)。
- [x] **赵云** dispatch `15625f67` — M37 STT换Paraformer实现(user拍板Q18"换!换!")。治本user中文转写老乱/幻听团队名。
- [x] **钟馗** dispatch `26715626` — M37 STT换Paraformer审查(★碰转写命脉,赵云改 src/server/local-stt.ts,改STT引擎,审后4010重启激活+真机A/B)。
- [x] **钟馗** dispatch `3b2a6292` — WebRTC Phase 0b 录音通话互斥壳【审】(赵云改,flag-gated,出commit前审)。
- [x] **赵云** dispatch `2591210b` — WebRTC Phase 0c 连接层(user授权彻底实现WebRTC,自主推进不等测):目标=手机↔电脑建立真WebRTC连接(DTLS connected)走TURN,信令走现有relay。这步只做【连接建立】,音频路由是下一步。
- [x] **钟馗** dispatch `472e2a52` — WebRTC Phase 0c 连接层审查(★大改动:daemon新依赖werift+新信令协议+ICE config RPC+mobile caller,赵云改,出实验包真机验前审)。只建连接不接音频。
- [x] **赵云** dispatch `3aa2ef69` — WebRTC Phase 0c 钟馗抓2个BLOCKING(必修闭环):
- [x] **钟馗** dispatch `e81b1158` — WebRTC Phase 0c 两BLOCKING【复审】(只验你上轮抓的2条,快审):
- [x] **赵云** dispatch `469b6428` — WebRTC Phase 0c-2a 上行音频路由(连接层已commit 3a9aea5,这步接真实麦克风音频走WebRTC=往真通话迈)。先做上行(手机麦→daemon→STT),下行(TTS→手机)是0c-2b。
- [x] **钟馗** dispatch `9360ed8f` — WebRTC Phase 0c-2a 上行音频审查(★碰音频路径+互斥接线+daemon STT注入,赵云改)。连接层0c已commit,这步接上行真实麦克风音频。
- [x] **赵云** dispatch `c3e066eb` — WebRTC Phase 0c-2a 钟馗抓2个BLOCKING(互斥假闭环+失败泄漏,必修):
- [x] **钟馗** dispatch `30cad138` — WebRTC Phase 0c-2a 两BLOCKING【复审】(只验你上轮抓的2条):
- [x] **赵云** dispatch `c290d2fe` — WebRTC Phase 0c-2b 下行音频(上行0c-2a已commit,这步接daemon→手机的语音播放=完整真通话闭环)。
- [x] **钟馗** dispatch `35a50779` — WebRTC Phase 0c-2b 下行音频审查(★碰daemon下行TTS音频+完整通话闭环,赵云改)。上行0c-2a已commit,这步接daemon→手机播放=完整真通话结构。
- [x] **赵云** dispatch `cf8e8308` — WebRTC Phase 0c-2b 钟馗抓1个BLOCKING(必修):
- [x] **钟馗** dispatch `e8732bb7` — WebRTC Phase 0c-2b downlink初始化失败BLOCKING【复审】(只验你上轮抓的1条):
- [x] **典韦** dispatch `5906fde8` — Bug调查:worker最后状态不对(user真机报,别的机器最新HippoTeam仍复现)。
- [x] **关羽** dispatch `1d604100` — worker状态HIGH bug修复(典韦诊断,user在意):worker从stopped重启时 markAgentStarted 把 pendingTaskCount 清零→排队dispatch丢失变孤儿。
- [x] **钟馗** dispatch `69ce25ee` — worker状态HIGH bug修复【快审】(碰状态机,关羽改,user在意+要bundle进重启):
- [x] **关羽** dispatch `3d51949d` — 修"假idle"worker状态bug(典韦诊断的第2个,user要求修)。
- [x] **赵云** dispatch `a9888493` — ★修Paraformer性能病根(user真机一堆卡顿/念回不出声/不灵的根)。
- [x] **钟馗** dispatch `9520cf48` — 审关羽的"假idle"worker状态bug修复(claude代码,按铁律必独立审)。
- [x] **钟馗** dispatch `58787b44` — 审赵云的Paraformer热路径缓存修复(STT热路径,并发锁,必审正确性)。
- [x] **赵云** dispatch `a2d5cb50` — ★钟馗审出BLOCKING:你上轮Paraformer cache【没真生效】,必须改。
- [x] **钟馗** dispatch `97b9ec89` — 复审赵云Paraformer cache修复(你上轮抓的BLOCKING:实例级cache每请求新建provider丢弃没真修)。赵云已改:
- [x] **关羽** dispatch `8a994be7` — 修WebRTC中继探针失败(user华为真机验:WebRTC麦克风+PeerConnection可达✓,但中继连接探针失败,报"crypto.randomUUID is required for WebRTC call ids")。
- [x] **赵云** dispatch `907c1901` — 钟馗复审又抓2个真并发BLOCKING(模块级cache好了但有竞态),必须修:
- [x] **钟馗** dispatch `b9341e82` — 审关羽的WebRTC call_id UUID修复(claude代码必独立审)。
- [x] **钟馗** dispatch `43fd13a2` — 三审赵云Paraformer cache(你二审抓的B1 use-after-free竞态+B2 in-flight单槽锁)。赵云已改:
- [x] **赵云** dispatch `0e65bf80` — 钟馗三审:B1/B2/跨实例全闭环了,只剩最后1个小blocking收尾:
- [x] **钟馗** dispatch `2702e5dd` — 四审赵云Paraformer cache(你三审唯一blocking:finally里stream.free抛错则lease.release不执行→泄漏)。赵云已改:
- [x] **吕布** dispatch `9d8b3ed1` — 诊断+方案:WebRTC中继连接超时(user华为中国4G真机)。
- [x] **关羽** dispatch `b13adb87` — ★WebRTC实验:强制ICE relay-only两端,治libwebrtc↔werift双中继握手没谈拢。
- [x] **钟馗** dispatch `3ab53735` — 审关羽的WebRTC relay-only实验改动(claude代码,codex恢复了必独立审)。这是gated实验开关,默认行为不能变。
- [x] **关羽** dispatch `1fb7f4cb` — 钟馗审出1个BLOCKING(健壮性,修了让实验开关可靠):
- [x] **钟馗** dispatch `31fe6fca` — 复审关羽的force relay flag解析修复(你上轮blocking:只认精确小写1/true)。关羽改:
- [~] **关羽** dispatch `00955762` — ★大活:daemon侧WebRTC库 werift→@roamhq/wrtc(libwebrtc binding),治werift双中继ICE握手谈不拢(详见 .hive/research/2026-06-05-webrtc-ice-re… ⊘ 关羽退出没接,卡submitted,重派
- [x] **关羽** dispatch `7fa5ea86` — ★大活(重派,上次你退出没接):daemon侧WebRTC库 werift→@roamhq/wrtc(libwebrtc binding),治werift双中继ICE握手谈不拢(详见 .hive/research/2026-06-05-w…
- [x] **钟馗** dispatch `7f7bcafb` — 审关羽的werift→@roamhq/wrtc第一步(daemon WebRTC连接握手换库,claude代码必独立审)。这是治werift双中继握手谈不拢的fix第一阶段(只换连接,音频defer)。
- [x] **关羽** dispatch `77d88b2c` — ★大突破!你换的@roamhq/wrtc第一步真机验证【连上了】(state=connected 0.6秒,werift卡死的双中继握手新库一下就过)。现在做第二步=搬音频,做完就能真打电话。
- [x] **钟馗** dispatch `2d288965` — 审关羽WebRTC第二步音频迁移werift→@roamhq/wrtc(claude代码必审)。第一步连接已真机验connected,这步搬音频上下行。
- [x] **关羽** dispatch `ac719892` — ★WebRTC音频两步都通了(连接connected真机验过,音频上下行迁wrtc完成钟馗在审)。现在做最后一块=让手机能【真打电话测】:现在的WebRTC探针是waitForConnected后立刻close(连接测试),没法真说话。要…
- [x] **赵云** dispatch `f39ca4d3` — 修钟馗审出的WebRTC第二步BLOCKING(server端,关羽在做手机端不冲突)。
- [x] **钟馗** dispatch `c0eac042` — 复审赵云修的WebRTC第二步blocking(你抓的:ontrack audioSink.start失败不cleanup→半坏通话)。赵云改:
- [x] **钟馗** dispatch `c98b0c86` — 审关羽的WebRTC手机端hold-open测试通话(claude代码必审,真打电话最后一块)。
- [x] **关羽** dispatch `efbed6d5` — 钟馗审出2个BLOCKING(真资源泄漏,会让user通话掉线后麦克风卡住不放,真打电话必修):
- [x] **钟馗** dispatch `5259a110` — 复审关羽修的WebRTC测试通话2个BLOCKING(你抓的:connected后掉线不cleanup+start setup失败麦克风泄漏)。关羽改:
- [x] **关羽** dispatch `00ecaf1e` — ★WebRTC真打电话:连接已通(state=connected,国内TURN relay候选),但【音频帧不流动】=真打电话最后一块。
- [x] **关羽** dispatch `8039e48e` — ★WebRTC真打电话音频不流动=病根锁定在手机端(我自主测过:Node wrtc↔wrtc双向音频经国内TURN relay完美1200帧,服务器侧100%没问题;连接通+track协商了但手机没真发收audio RTP)。
- [x] **钟馗** dispatch `2c3b2fea` — 审关羽WebRTC音频InCallManager修复(claude代码必审,真打电话音频最后一块)。背景:我自主测过服务器侧wrtc音频经国内TURN完美(双向1200帧),病根=手机Android音频模式没设,关羽加react-nati…
- [x] **关羽** dispatch `50d87f47` — 钟馗审出2个BLOCKING(InCallManager helper音频模式残留,会让手机卡在通话音频模式,必修):
- [x] **钟馗** dispatch `8ad33816` — 复审关羽修的InCallManager 2个BLOCKING(你抓的音频模式残留)。关羽改 packages/mobile/src/lib/webrtc-incall-manager.ts:
- [x] **关羽** dispatch `04d8d2b4` — ★WebRTC真打电话音频:2.8.1(InCallManager)真机验=连上+下行track到手机(0→1条),但上行还是0 STT(user没听到、DB无WebRTC转写)。InCallManager不够。
- [x] **钟馗** dispatch `9fb6ee06` — 审关羽WebRTC音频路由前移(claude代码,真打电话音频)。2.8.1验=连上+下行track到手机但上行0 STT无声;新假设=InCallManager要在mic track创建前设MODE_IN_COMMUNICATION。关…
- [x] **关羽** dispatch `48285304` — ★大活:WebRTC通话改成【实时对话】(边说边回)。已打git存档点checkpoint-pre-webrtc-streaming-20260605,放心改。
- [x] **钟馗** dispatch `881600a3` — 审关羽的WebRTC实时通话(claude代码必审,真打电话核心)。把上行从"挂断后batch转写"改成"通话中按句实时切+逐句转写+触发回复"。
- [x] **关羽** dispatch `55820e05` — 钟馗审出3个BLOCKING(实时通话长通话资源泄漏+短噪声,必修):
- [x] **钟馗** dispatch `693fa118` — 复审关羽修的WebRTC实时通话3个BLOCKING(你抓的资源泄漏+短噪声)。关羽改:
- [x] **关羽** dispatch `11853346` — ★WebRTC实时通话【双向已真机验通】(user听到回复了,上行STT/orch/下行push全链路服务端日志铁证)!但上行VAD漏句:2分半只切2句(utterance1="好的"、utterance2幻听),user说"这么多只收到…
- [x] **赵云** dispatch `84bee594` — ★WebRTC实时通话下行声音糊(user:听到声音但听不清"听不出播放什么")。根因我已定位:src/server/webrtc-downlink-audio.ts 把TTS的PCM帧【一股脑burst推完】没按实时节奏——日志铁证一通…
- [x] **钟馗** dispatch `dc5047f3` — 审关羽的WebRTC上行VAD调参(claude代码,真打电话调优)。背景:实时通话双向已验通,但VAD门限0.018太高漏话(2分半只切2句),user正常音量大部分没逮到。关羽改:
- [x] **钟馗** dispatch `68a0cfa6` — 审赵云的WebRTC下行节奏修复(claude代码,真打电话听清的最后一块)。背景:下行646帧1毫秒burst全推→播放糊听不清。赵云改:
- [x] **关羽** dispatch `2f04c09b` — 修复 WebRTC 下行音频【断断续续】(underrun)。根因已实测定位,不要重新猜。
- [x] **关羽** dispatch `b0b4fac8` — 接着你刚改的下行,实现 WebRTC 通话【barge-in 开口即停】。这是user今晚最痛的点(原话:'我没办法打断,AI不停说废话轰炸我耳朵,这根本不叫流式通话')。完整设计我已写在 .hive/research/2026-06-0…
- [x] **钟馗** dispatch `a34e516a` — 审关羽两块 WebRTC 下行改动(都已带单测,29 tests过)。中文 review,以问题为先按严重度排,blocking 列前。
- [~] **关羽** dispatch `0b75c3cc` — M38 Phase 1：把语音前台从'只读播报机 glm-4-flash'升级成'真对话前台 GLM-5.1'。设计见 ADR ,先读。这是user拍板根治'一边倒废话'的第一步。 ⊘ 重启打断+新增关键情报(glm-5.1是推理模型),重派
- [x] **关羽** dispatch `830c4d6e` — 补充上条任务:背景设计文档路径是 .hive/decisions/draft-2026-06-05-realtime-voice-front-agent-pm-async.md(上条消息里这个路径被我的shell反引号吞了)。开工前读一下…
- [x] **关羽** dispatch `6b4f546b` — M38 Phase1 有个【生产会炸的 blocking】,你上轮漏了,修它。
- [x] **关羽** dispatch `d4358338` — M38 还有个【生产会跑错模型】的集成bug,修它。
- [x] **钟馗** dispatch `86dcb459` — 终审 M38 Phase1 强前台(关羽实现,2个blocking已修,22单测过)。中文review,问题为先按严重度排。
- [x] **关羽** dispatch `3336a453` — M38 钟馗终审抓到 1 个 blocking,修它,这是最后一道。
- [x] **钟馗** dispatch `bc5354b9` — M38 快复审:你上轮抓的 blocking(strong prompt 越权话术'我让团队上')关羽已修,只验这个修对没+没引新问题。范围同前 src/server/fast-voice-reply.ts + tests/unit/fa…
- [x] **赵云** dispatch `033c6d86` — 诊断【连续对讲念回播放断断续续】。user 真机确认:对讲里 AI 回复的语音念回播放是断断续续的(卡顿/有空档)。
- [x] **关羽** dispatch `e346c565` — 念回播放断续的最省事缓解+A/B验证(不出APK)。赵云诊断(.hive/research/2026-06-05-talkback-playback-stutter-diagnosis.md):念回断续高概率=对讲为支持打断,播放念回时手…
- [x] **钟馗** dispatch `edeb263f` — 快过关羽一个小调优(念回断续的A/B缓解)。范围:src/server/fast-voice-reply.ts + tests/unit/fast-voice-reply.test.ts(git diff,很小)。
- [x] **关羽** dispatch `e5dd8ec1` — 把语音前台做成【快准狠】。user原话:'我需要的永远是快准狠',前台【留着别砍】(砍了直连PM就慢)。问题不是有没有前台,是前台不够准、交接不够狠=user说的'无序、不知所云、不解决问题'。只改 src/server/fast-voi…
- [x] **钟馗** dispatch `7914d92e` — 审关羽'快准狠前台'(语音前台加项目认知+犀利提示词+干净交接,23单测)。范围:src/server/fast-voice-reply.ts + tests/unit/fast-voice-reply.test.ts(git diff)…
- [x] **关羽** dispatch `f6b14b29` — 你'快准狠前台'有1个blocking(钟馗确认),修它,这是commit前最后一道。
- [x] **钟馗** dispatch `39b90485` — 复审:你上轮抓的 blocking(fast-voice 热路径同步IO阻塞事件循环)关羽已改异步,只验这个修对没+没引新问题。范围 src/server/fast-voice-reply.ts + tests/unit/fast-voi…
- [x] **赵云** dispatch `0cb9e994` — 诊断【连续对讲STT把噪音/不清楚的话硬转成乱码】=user最痛点,原话'这种对讲模式不能降噪会非常垃圾'。实例:噪音环境下STT吐出'你有没有奶还个要的哎我是十那个推荐你去牛奶'这种纯乱码,然后还被当真喂给前台。
- [x] **关羽** dispatch `4794d3f1` — 降噪第一步:服务端拦截STT乱码,不喂前台(no-APK,4010重启生效)。赵云诊断见 .hive/research/2026-06-06-stt-noise-gibberish-diagnosis.md:连续对讲STT(Parafor…
- [x] **钟馗** dispatch `05d11301` — 审关羽'服务端STT乱码质量闸'(降噪第一步止血,35单测)。范围 src/server/local-stt.ts + tests/unit/local-stt.test.ts(git diff)。中文review。
- [x] **赵云** dispatch `15aef8d8` — 真降噪第二步(治本,你诊断报告的方案2):App侧上传STT前加【整段语音质量门控】,噪音/含糊段不上传,从源头掐掉乱码。见你自己的 .hive/research/2026-06-06-stt-noise-gibberish-diagno…
- [x] **钟馗** dispatch `95a50a01` — 审赵云'App侧降噪质量门控'(连续对讲上传STT前用voice_prob整段质量评估丢低质段,43单测)。范围:packages/mobile/src/lib/neural-voice-vad.ts + packages/mobile/…
- [x] **赵云** dispatch `f8bd1876` — 你的App降噪质量门控钟馗抓到1个blocking(会误杀短真话),修它再出包。
- [x] **钟馗** dispatch `1d1d3a26` — 复审:你上轮抓的blocking(App降噪门控误杀短真话)赵云已修,只验修对没。范围 packages/mobile neural-voice-vad.ts + talk.tsx + 两个__tests__(git diff)。
- [x] **马超** dispatch `723bed0e` — user 要你看 2026-06-02 的语音对讲 UI 设计稿,对比现状、评估差距 + 是否要更新。
- [~] **典韦** dispatch `0402bd09` — 核查【worker 完成任务后状态显示不对】。user 在另一台机器的 hippoTeam 观察到:团队 worker 做完事情,状态都不对。你来复现+定位。 ⊘ 典韦已停止未启动该dispatch,转张飞
- [~] **张飞** dispatch `e8879690` — 核查【worker 完成任务后状态显示不对】。user在另一台机器观察到团队worker做完事状态都不对;且就在刚才,典韦被派这个任务后【自己停止了、dispatch卡submitted没启动】——这本身可能就是同一个worker可靠性问… ⊘ user要典韦做,转回典韦避免重复
- [x] **关羽** dispatch `64fc008c` — 实现【理解层降噪】=语音前台攒完整意思+干净交PM。user已拍板设计,见 .hive/reports/2026-06-06-understanding-layer-front-pm-handoff.html。服务端改、不出包、重启生效。…
- [x] **典韦** dispatch `0f09be30` — 核查【worker 完成任务后状态显示不对】(user指定你做)。user在另一台机器观察到团队worker做完事状态都不对;而且就在刚才,你被派这个任务后自己停止了、dispatch卡submitted没启动——这本身可能就是同一个wo…
- [x] **钟馗** dispatch `37fcb035` — 审关羽'理解层降噪 Phase1'(服务端按workspace缓冲语音转写,窗口期合并成完整意思再走前台,4/4单测)。范围:src/server/voice-understanding-buffer.ts(新)+routes-mobil…
- [x] **关羽** dispatch `17971d39` — 理解层Phase1钟馗审出2个真blocking,修它们。
- [x] **钟馗** dispatch `e022a16e` — 复审:你上轮抓的理解层2个blocking(B1 LAN收不到flush回复 / B2 flush失败静默丢用户话)关羽已修,只验修对没+没引新问题。范围:packages/mobile/src/api/mobile-runtime-co…
- [x] **马超** dispatch `3806b45d` — 落地 6-05 对讲 UI 视觉到代码。user已拍板:6-05亮色视觉 / 先落地视觉(WebRTC通话UI这轮不做) / 默认模式=连续对讲 / 打总包。
- [x] **赵云** dispatch `a0168fe6` — 落地一个【诊断了2次但一直没改】的确认bug:markAgentStarted 清零 pendingTaskCount。诊断见 .hive/research/2026-06-05-worker-status-bug-diagnosis.m…
- [x] **张飞** dispatch `2881066d` — 诊断【worker做完事情后状态不变idle】=user在另一台机器看到的真实症状(user不确定那台版本最新否,但坚持bug真实)。注意:这跟之前典韦/赵云查的markAgentStarted清零、重启假idle【不是一回事】,是wor…
- [~] **钟馗** dispatch `3d4beb17` — 审马超'6-05对讲UI视觉落地'(只视觉层,330测过tsc/biome0,要打APK真机验)。范围:packages/mobile/app/(tabs)/talk.tsx + src/lib/talk-ui-cues.ts + 3个测… ⊘ 钟馗停止孤儿dispatch85分钟产出丢失,重派
- [x] **钟馗** dispatch `c7f233cd` — 重派(上一条评审dispatch你停止后孤儿了产出丢失)。审马超'6-05对讲UI视觉落地'(只视觉层,330测过tsc/biome0,要打APK真机验)。范围:packages/mobile/app/(tabs)/talk.tsx + …
- [x] **马超** dispatch `7e9786e5` — 对讲视觉重做——user装了2.8.3说'跟设计稿对不上、搞笑',我看了截图,你上次是按自己理解搭的、没忠实照6-05稿。这次【死规矩照设计稿做,不许自由发挥加自己的动画】。
- [x] **马超** dispatch `c109cc5f` — user拍板:装 react-native-svg 把对讲orb做到跟6-05稿【像素级一样】的渐变发光。你上轮已确认项目没svg、零依赖近似辉光是硬边到不了像素级,现在上svg正路。
- [~] **钟馗** dispatch `237be46e` — 审马超'对讲orb svg像素级重做'(装了react-native-svg,330测过)。范围 git diff:packages/mobile/app/(tabs)/talk.tsx + talk-ui-cues.ts(上轮)+ pa… ⊘ 钟馗停止孤儿,重派
- [x] **马超** dispatch `b66f4f9a` — 对讲orb你做对了(user认了svg发光球),但【整页布局没照设计稿】,user明确指出:头部摆放不对、按钮摆放不对、退出对讲按钮设计稿根本没有。这轮只改【布局结构】,orb保留。
- [x] **钟馗** dispatch `06980cb7` — 重派(你上轮svg审停止孤儿了,worker反复停的问题,已取消)。审马超'对讲orb svg像素级'的【svg部分】。注意:马超【正在并行改talk.tsx的布局结构】(另一个任务),所以这轮你【聚焦不会被布局改动的稳定部分】,talk…
- [x] **钟馗** dispatch `83c0d8f5` — 终审马超'对讲整页布局照6-05稿重排'(orb保留,330测过)。上轮你审过svg稳定部分0block,这轮专审【布局结构改动】。范围 git diff:packages/mobile/app/(tabs)/talk.tsx(rende…
- [x] **马超** dispatch `360f7087` — 对讲页加一个【随时退出/急停】按钮。user反馈:现在照6-05稿重排后,录音中/播放中/出错时【没有明确的退出口子】(设计稿本身漏了这个,user要补)。约束:【不打乱现在已认可的布局】,只加个不抢眼的角标。
- [~] **赵云** dispatch `4863b2b7` — 诊断【连续对讲barge-in被回声压住,打断不灵敏】=命门(user最在乎开口即停)。我USB抓了真机logcat铁证:念回播放时 voice_prob=0.999(高,有声),但BARGEDBG全是 volume-suppressed… ⊘ 赵云停止孤儿,重派
- [~] **钟馗** dispatch `eeaa5f59` — 审马超'对讲页加右上角急停/退出角标'(补6-05稿漏的退出口,纯新增,331测)。范围 git diff:packages/mobile/app/(tabs)/talk.tsx + talk-tab-continuous.test.ts… ⊘ 钟馗停止孤儿,重派
- [x] **赵云** dispatch `266eb67b` — 诊断【连续对讲经常进入error错误状态】=user真机反馈,我USB抓了线索。注意你之前的barge-in诊断我取消了(你停止孤儿),这轮先查error态(user当前最烦的)。
- [x] **钟馗** dispatch `e3e7c65d` — 重派(你上轮停止孤儿了)。快审马超'对讲右上角急停退出角标'(小改,纯新增,331测)。范围 git diff:packages/mobile/app/(tabs)/talk.tsx + talk-tab-continuous.test.…
- [x] **关羽** dispatch `ce4b13b1` — 实现【连续对讲频繁进error态】的修复。赵云已诊断,报告在 .hive/research/2026-06-06-talkback-error-state-diagnosis.md,先读。根因=权限/录音启动不稳定:talkState='…
- [x] **钟馗** dispatch `12eb2cb7` — 审关羽'连续对讲error态修复'(权限稳态化+软降级+自动恢复+preserveMode,43测)。范围 git diff:packages/mobile/app/(tabs)/talk.tsx + 2个talk测试。中文review。
- [x] **赵云** dispatch `7a2acdf5` — 查【barge-in打断不灵敏】的精准修法(你之前诊断被stop打断了,重来)。我USB抓的铁证(已存):念回播放时 voice_prob=0.999(高),但BARGEDBG全是 mode=volume-suppressed reaso…
- [x] **关羽** dispatch `9d8686d3` — 你的error修复钟馗审出1个blocking(B1),修它。你的非致命自动恢复【矫枉过正】了。
- [x] **钟馗** dispatch `d786b6a2` — 复审:你上轮抓的B1(连续录音启动非fatal失败无限软恢复)关羽已修,只验这个。范围 git diff:packages/mobile/app/(tabs)/talk.tsx + 2个talk测试。
- [x] **关羽** dispatch `bbb6e1ee` — 实现barge-in打断灵敏度修复(赵云已出方案,报告 .hive/research/2026-06-06-talkback-barge-in-sensitivity-plan.md,先读)。在刚commit的error修复基础上做,只动…
- [x] **钟馗** dispatch `790e5f8a` — 审关羽'barge-in音量override'(治打断不灵敏,55测)。范围 git diff:packages/mobile/src/lib/neural-voice-vad.ts + packages/mobile/app/(tabs…
- [x] **关羽** dispatch `cdf7eee7` — 紧急:两个问题,按优先级修。先读最近对讲代码再动手。
- [x] **关羽** dispatch `6d3fb6a6` — 【WebRTC+对讲 TTS 双重叠放 bug 修复】
- [x] **赵云** dispatch `7ac9a108` — 【WebRTC 下行 TTS 音量偏小修复】
- [x] **钟馗** dispatch `58e39bbf` — 【review：WebRTC 下行 PCM 增益改动】
- [x] **钟馗** dispatch `16da4b8b` — 【review 附加：关羽的 WebRTC+对讲 TTS 双路由修复】
- [x] **关羽** dispatch `a0fa85da` — 实现 WebRTC 通话流式 ASR + rolling session transcript。只改通话部分（webrtc-upstream-audio.ts 及相关），不动对讲（relay-voice-stream-tts.ts）。
- [x] **周瑜** dispatch `c54a0b0e` — baseline 体检任务。risk-hotspots.md 最后更新 2026-05-28，此后有 92 个代码改动，需要检查是否有新的热区。
- [x] **马超** dispatch `c459972a` — 为 HippoTeam 实时 WebRTC 通话设计一个专属页面，产出 HTML 设计稿 + 配套 research 笔记。
- [x] **赵云** dispatch `806f0484` — 根据周瑜的 baseline 体检报告，更新三份 baseline 文件。只更新文档，不改代码。
- [x] **钟馗** dispatch `1b78db11` — 审查关羽的 M39 流式 ASR 实现，重点查真实性和边界风险。
- [x] **关羽** dispatch `c8d60b36` — 钟馗审出 4 个 blocking，退回修复。所有修复完成后 team report，钟馗会复审。
- [x] **钟馗** dispatch `96f36051` — M39 关羽修复 4 个 blocking 后的复审。只验 4 条是否真修干净，不重新全面 review。
- [x] **关羽** dispatch `80a8e712` — 紧急生产事故修复：M39 流式 ASR 一来电就把整个 daemon 崩掉 → 手机"webrtc不通"。我（PM）已冷诊断出确切根因+修法，按下面精确改，别自由发挥。
- [x] **钟馗** dispatch `72c975e9` — 复审关羽的 M39 流式 ASR 生产事故修复（一来电 native exit(-1) 崩 daemon → webrtc不通）。范围 git diff：src/server/streaming-stt-online.ts + src/s…
- [x] **赵云** dispatch `a3147d4f` — M40 实时通话理解层——端到端技术方案设计 spike（先设计不写实现，我拍板后再派实现）。决议已采纳：.hive/decisions/2026-06-06-speculative-voice-front-pm-handoff.md，先…
- [x] **关羽** dispatch `6eeb753c` — M40 第一波·来源通路分离（独立可先落地，不依赖赵云的大设计）。决议见 .hive/decisions/2026-06-06-speculative-voice-front-pm-handoff.md 支柱③。
- [x] **赵云** dispatch `f765daa8` — M40 Phase 1 核心模块实现（按你自己的设计 reports/2026-06-06-m40-speculative-voice-design.html）。**只建独立新模块+状态机+单测，先不接进 webrtc-upstream-…
- [x] **钟馗** dispatch `c96e0876` — M40 第一波·复审关羽「来源通路分离」（已采纳 ADR 支柱③的窄实现）。范围 git diff：src/server/voice-input-source-tags.ts(新) + src/server/webrtc-upstream…
- [x] **钟馗** dispatch `acdc839a` — M40 Phase 1 核心模块复审：赵云的 src/server/voice-intent-front.ts（GLM 结构化意图 verdict + VoiceIntentSession latest-wins/abort + PM h…
- [x] **赵云** dispatch `fa7291b8` — M40 Phase 1 模块 voice-intent-front.ts 钟馗审出 3 个 blocking，退回修。都是真问题，按下面精确修，别自由发挥。
- [x] **钟馗** dispatch `a6422e36` — M40 Phase 1 voice-intent-front.ts 复审（赵云修完你上轮 3 个 blocking）。只验这 3 条修干净没，不重新全面 review。范围：src/server/voice-intent-front.ts…
- [x] **赵云** dispatch `45fe857b` — M40 Phase 1 shadow 集成（把你的 voice-intent-front 接进 WebRTC 通话路径，纯 shadow 只打日志、零行为变更）。关羽来源分离已 commit(037b898)、你的核心模块已 commit…
- [x] **钟馗** dispatch `6032ee0c` — M40 Phase 1 shadow 集成复审：赵云把 voice-intent-front 接进 WebRTC 上行（纯 shadow 打日志、flag HIVE_VOICE_INTENT_FRONT 默认关、零行为变更）。范围 git…
- [x] **赵云** dispatch `59630f37` — M40 Phase 1 shadow 集成钟馗审出 1 个 blocking，修它再 commit。
- [x] **钟馗** dispatch `db5880e9` — M40 Phase 1 shadow 集成 close 泄漏 blocking 复审（赵云修完你上轮那条）。只验这一条。范围：src/server/webrtc-upstream-audio.ts + tests/unit/webrtc-…
- [x] **马超** dispatch `ea72e25f` — 实现 WebRTC 正式通话页（把设置页的"测试通话"扶正成全屏通话页）。依据你/赵云的设计稿 .hive/reports/2026-06-06-webrtc-call-ui-design.html + research 同名 .md（先…
- [x] **钟馗** dispatch `b2ef7cef` — 复审马超的 WebRTC 全屏通话页实现（设置页测试通话扶正成正式页）。马超是 claude 我不自审，你 codex 审。范围 git diff/新文件：app/call.tsx(新) + src/components/Orb.tsx(…
- [x] **关羽** dispatch `529da80a` — 紧急修复（user 命门·真机现场实测炸出）：WebRTC 通话流式识别开着时 barge-in(开口即停)完全失效——AI 一路说到底、user 说话打不断。PM 已冷诊断坐实根因，按下面修。
- [x] **钟馗** dispatch `4b4e19d0` — M40/M39 关联·复审关羽的 barge-in 回归修复（流式识别开着时开口即停失效，user 真机命门）。范围 git diff：src/server/webrtc-upstream-audio.ts + tests/unit/we…
- [x] **关羽** dispatch `d49f7170` — 紧急根因修复（user 真机命门·实时通话回声→上行STT全是乱码+假打断）。PM 已定位确切根因，按下面修。
- [x] **钟馗** dispatch `6281c87d` — M40关联·复审关羽的 WebRTC 回声根因修复(user真机命门:通话回声→上行STT全乱码+假打断)。范围 git diff：packages/mobile/src/lib/webrtc-caller.ts + packages/m…
- [x] **关羽** dispatch `7ec8febf` — 紧急服务端调参（user 真机现场:装 2.8.8 后通话"一点声音都没有"）。PM 已用日志数据定位,按下面改。
- [x] **钟馗** dispatch `195668f0` — M40关联·复审关羽的 barge-in onset RMS 门限修复(治 2.8.8 装机后"AI被回声打断到没声音")。范围 git diff：src/server/webrtc-vad.ts + tests/unit/webrtc-…
- [~] **马超** dispatch `df411be1` — WebRTC 通话音量控制做进设置页（user 真机反复要:不想每次重装/重启调音量,要在设置里直接调）。先调研最干净的实现路径再做,出方案我看。 ⊘ 马超 submitted 19min 未真启动,PTY idle,卡住,重派关羽
- [x] **关羽** dispatch `d8eacdf4` — WebRTC 通话音量控制做进设置页——调研方案（马超卡住了重派给你，你这轮做过 webrtc-caller 熟 RN-webrtc）。先调研最干净路径，出方案我拍，别直接大改。
- [x] **关羽** dispatch `bcff1436` — M40/通话·实现设置页音量控制（按你自己调研的路径 A，PM 拍板了）。报告 reports/2026-06-07-webrtc-call-volume-control.html。
- [x] **钟馗** dispatch `a0e99d55` — 复审关羽的设置页通话音量控制（路径 A：客户端 RN-webrtc _setVolume，即时生效，PM 已拍板）。范围 git diff：packages/mobile/src/lib/webrtc-track-volume.ts(新)…
- [x] **关羽** dispatch `25bbcef3` — WebRTC 通话 AI 声音太轻的根治（从 TTS 源头提电平）。user 真机:_setVolume 华为不认、下行硬乘 6x 也没感觉,软件放大顶不破。正解=让 edge-tts 在合成时就生成更响的语音。
- [x] **钟馗** dispatch `a903f3f0` — 复审关羽的 edge-tts 源头音量提升(治通话 AI 声音太轻,软件下行 gain 顶不破设备天花板→从合成源头提)。范围 git diff:src/server/local-tts.ts + tests/unit/local-tts…
- [x] **关羽** dispatch `2ba705e9` — edge-tts 音量提升钟馗审出 1 个 blocking(小 typing),修一下。
- [x] **关羽** dispatch `f275d5bd` — WebRTC 通话音量小的真根因+修法调研(user 真机铁证:对讲念回很响,通话很闷,同一手机=不是设备天花板,是音频流不同)。先调研提方案,别盲改音频模式(device-sensitive,改不好回声/麦克风会坏)。
- [x] **关羽** dispatch `4ec79c4f` — M40/通话·实现通话音量真修(按你自己调研报告 reports/2026-06-07-webrtc-call-volume-root-cause-plan.html 路径1,PM 拍板)。flag-gated,默认不变,出实验包验。
- [x] **钟馗** dispatch `187529d0` — 复审关羽的 WebRTC 通话 media 音频路由实验开关(治通话音量小=被 InCallManager 塞进通话流;media 路由走媒体流像对讲那样响,PM 拍板路径1)。范围 git diff:packages/mobile/ap…
- [x] **赵云** dispatch `fc3daa46` — WebRTC 通话音量深度调研(治本,别瞎试)。user 真机 14h:通话音量小;media 路由实验包反而声音发劈有杂音更糟;但**对讲念回在同一个手机上就是响且清的**。关羽试了 _setVolume(华为不认)/下行gain(没感…
- [x] **关羽** dispatch `b742ac94` — WebRTC 通话延迟埋点(让 user 能一眼看到"停说话→AI出声"7-11秒花哪了,数据驱动,别猜)。纯服务端加日志,不改逻辑。
- [x] **赵云** dispatch `829c6413` — M40 Phase 2 设计 spike:文件分段播放下行(=音量根治+你刚调研的对讲文件播放路+分段撤回,一箭双雕,user 拍板)。先出实现蓝图我拍,别改代码。承接你的 reports/2026-06-07-webrtc-call-a…
- [x] **钟馗** dispatch `0e966dca` — 复审关羽的 WebRTC 通话延迟埋点(让 user 看清"停说话→AI出声"7秒花哪了)。范围 git diff:src/server/webrtc-voice-latency.ts(新) + webrtc-upstream-audio…
- [x] **赵云** dispatch `af16e027` — M40 Phase 2a 实现(按你自己设计 reports/2026-06-07-m40-phase2-segmented-file-downlink-design.html,PM 拍板分阶段先做 2a)。**只做 2a:把通话 AI …
- [x] **关羽** dispatch `f52470cc` — 延迟埋点钟馗审出 1 个 blocking(内存泄漏),修它。
- [x] **钟馗** dispatch `69e9b3af` — M40 延迟埋点内存泄漏 blocking 复审(关羽修完你上轮那条)。只验泄漏修干净没。范围:src/server/webrtc-voice-latency.ts + webrtc-downlink-audio.ts + fast-vo…
- [x] **钟馗** dispatch `2fcf861d` — M40 Phase 2a 复审(大改:WebRTC 通话下行加 file_segments 文件播放路径,治音量;默认 webrtc_track 零变更)。这是音量根治第一刀,跨服务端+移动端,认真审。中文 review。
- [x] **赵云** dispatch `da494bb9` — Phase 2a 钟馗审出 3 个 blocking,修完再出包。都是真问题(泄漏+barge-in 没真停TTS)。
- [x] **钟馗** dispatch `dd5d7df4` — Phase 2a 复审:赵云修完你上轮 3 个 blocking。只验这 3 条修干净没。范围 git diff:src/server/webrtc-file-downlink-audio.ts + voice-downlink-segm…
- [x] **赵云** dispatch `e7aa71c5` — Phase 2a 钟馗复审:B2/B3 修干净了,B1 还漏一条路,补上即可。
- [x] **钟馗** dispatch `fe5fc80a` — Phase 2a 最后复审:赵云补完你上轮 B1 残口(disconnect 漏清 file_segments)。只验这一条。范围:packages/mobile/src/api/mobile-runtime-context.tsx(di…
- [x] **赵云** dispatch `4e4fa216` — Phase 2a 钟馗最后一条 blocking:**只补一个穿透 disconnect 入口的回归测试,代码不用改**(disconnect 行为代码钟馗已确认修干净)。
- [x] **关羽** dispatch `e131010b` — 把通话延迟埋点(你之前加的 webrtc-voice-latency)的 breakdown 汇总扩到 file_segments 下行路。现状:埋点汇总行 voice latency breakdown 只在 webrtc-downli…
- [x] **赵云** dispatch `ccf01409` — 紧急:file_segments 模式下 barge-in 不停播(user 真机:音量已修好✅,但开口打断时 AI 文件还在自顾自播)。
- [x] **钟馗** dispatch `4bb096e6` — 复审赵云的 file_segments 模式 barge-in 停播修复(user 真机:file 模式音量好但打不断)。范围 git diff:src/server/voice-downlink-segment-protocol.ts …
- [x] **赵云** dispatch `7a1ee709` — file 模式 barge-in 停播钟馗审过功能,只剩 1 个 typing blocking,修一下。
- [x] **赵云** dispatch `606b8797` — M40 Phase1 shadow 日志增强:给 voiceIntent shadow verdict 带上"GLM 当时判的那句转写原文",让 PM 能验 GLM 判意图准不准(现在日志只有 completeness/confidenc…
- [x] **关羽** dispatch `39506841` — 【M40 Phase 2-core：把实时语音前台从『老每句把关』升级为『意图引擎驱动』】
- [x] **钟馗** dispatch `a6108afa` — 【复审 M40 Phase 2-core：意图引擎驱动实时语音前台】关羽实现，改 src/server/webrtc-upstream-audio.ts + tests/unit/webrtc-upstream-audio.test.ts…
- [x] **关羽** dispatch `4b617965` — 【M40 Phase 2-core 钟馗复审 1 blocking，修】你上一单的意图驱动前台，钟馗审出一个 blocking 必须修，另收一个 non-blocking。
- [x] **钟馗** dispatch `0a3ff22f` — 【复核 M40 Phase 2-core blocking 修复（窄）】关羽按你处方修了，只需复核 blocking 是否真闭环，不用重审全单。
- [x] **关羽** dispatch `26cbaa7d` — 【紧急·M40 Phase 2-core 把延迟埋点搞断了，重建端到端时间线日志】
- [x] **赵云** dispatch `0631008f` — 【M40 通话页处理状态可视化·手机端（不碰服务端流水线，避开关羽正在改的 webrtc-upstream-audio.ts）】
- [x] **钟馗** dispatch `03135d80` — 【复审 M40 端到端延迟时间线日志重建】关羽实现，改 webrtc-voice-latency.ts + webrtc-upstream-audio.ts + webrtc-file-downlink-audio.ts + 3 测试文件…
- [x] **关羽** dispatch `05ed9dba` — 【M40 时间线日志 钟馗复审 1 blocking，修】你上一单 PM handoff 的 latency turn 认领是 workspace FIFO（claimPendingWebRtcVoiceLatencyTurn shift…
- [x] **钟馗** dispatch `73d40496` — 【复审 M40 通话页处理状态可视化·手机端】赵云实现，纯 mobile 端 + 协议契约，未碰服务端 pipeline。366 mobile 测过。
- [x] **钟馗** dispatch `e3459254` — 【复核 M40 时间线 blocking#2 修复（真 correlation 替 FIFO）】关羽按你 option A 修了，复核是否真闭环。
- [x] **关羽** dispatch `2e4aac40` — 【M40 时间线 blocking#3 修复：correlation 改运行时关联，PM 可见文本零注入，根除泄漏】
- [x] **钟馗** dispatch `60adf672` — 【复核 M40 时间线 blocking#3 修复（运行时关联，PM 文本零注入）】关羽按 option C 重做，复核闭环。
- [x] **关羽** dispatch `e64bdcbc` — 【M40 收尾：服务端发 voice_call_state 帧驱动手机 4 态 Orb】最后一块，把你刚建的时间线埋点点位接上手机端可视化。
- [x] **钟馗** dispatch `8c81103c` — 【复审 M40 服务端发 voice_call_state 帧驱动 Orb 4 态】关羽实现，最后一块。56 测 RED-first。
- [x] **关羽** dispatch `65bc8a72` — 【M40 发帧 钟馗复审 2 blocking：Orb 卡 processing 态，所有路径必须回得到 listening】
- [x] **钟馗** dispatch `f4a3b6fa` — 【复核 M40 voice_call_state 卡态 2 blocking 修复】关羽按你处方修了，复核闭环。
- [x] **关羽** dispatch `721bd672` — 【M40 两个观测修复：①timeline na 漏算 ②voice_call_state 发帧加日志好定位】
- [x] **赵云** dispatch `30e50db3` — 【M40 通话页 4 态 Orb 真机看不清，做成一眼可辨】
- [x] **钟馗** dispatch `8a3e6257` — 【复审 M40 通话页 4 态 Orb 可辨性增强·手机端】赵云实现，纯手机展示层，未碰服务端发帧/relay/pipeline。370 mobile 测过。
- [x] **赵云** dispatch `f825a08d` — 【M40 Orb 队列 钟馗复审 1 blocking：timer 延迟时跳过中间态，修】
- [x] **钟馗** dispatch `5eaadff7` — 【复审 M40 关羽两个观测修复：timeline na + 发帧日志】关羽实现，纯服务端观测。65 测。
- [x] **钟馗** dispatch `5b60f2a0` — 【复核 M40 Orb 队列跳态 blocking 修复（窄）】赵云按你处方修了，复核闭环。
- [x] **关羽** dispatch `b02f3654` — 【M40 真机 device-verify 抓到两个真 bug，修。4010 跑 tsx 源码=重启即生效，已确认你的码在线】
- [x] **钟馗** dispatch `fcdea530` — 【复审 M40 两个真机 bug 修复】关羽实现。这是真机 device-verify 抓到的两个真 bug，严审。
- [x] **关羽** dispatch `8d5a5f2e` — 【M40 真机复测:上轮两 bug 各修了一半,收残留】4010 已重启(pid55877)载入你上轮修复。真机复测铁证:
- [x] **钟馗** dispatch `943b1f89` — 【复审 M40 真机两残留修复】关羽实现。看 diff：git diff src/server/voice-call-state-protocol.ts src/server/webrtc-upstream-audio.ts tests/…
- [x] **关羽** dispatch `1fd39c00` — 【M40 治'两个声音抢话+不停说话'——碎话不接 + 单一声音】真机暴露的严重体验问题,user 强烈不满。
- [x] **钟馗** dispatch `ea3a91b7` — 【复审 M40 碎话不接+单一声音】关羽实现。看 diff：git diff src/server/webrtc-upstream-audio.ts src/server/webrtc-file-downlink-audio.ts tes…
- [x] **关羽** dispatch `a7a00bdf` — 【M40 Phase 2-spec 连续投机理解 + 撤回协议——user 否决'等说完再处理',要边说边算】
- [x] **钟馗** dispatch `0ba83efa` — 【深审 M40 Phase 2-spec 连续投机+撤回协议】关羽实现,这是 user 核心设计且投机+撤回最易出竞态,严审。
- [x] **赵云** dispatch `66cd2b0c` — 【M40 Phase 2-spec 手机端撤回播放——补 retract 端到端(钟馗 blocking B1)】
- [x] **钟馗** dispatch `43b3fa18` — 【复核 M40 Phase 2-spec 手机端 retract(你上轮 blocking B1)】赵云补齐手机端。看 diff：git diff packages/mobile/src/api/voice-downlink-segmen…
- [x] **关羽** dispatch `7d8ae7a3` — 【M40 治 GLM 拦住清晰活儿忘转 PM——调判定 prompt】user 真机抓到严重问题:GLM 把语义清晰、本该交 PM 办的事,自己当闲聊答了(action=handled),没标 escalate,PM 收不到→事没人做。
- [x] **钟馗** dispatch `9ca82fcf` — 【复审 M40 GLM 判定 prompt 纠偏(治吞活儿)】关羽改 voice-intent-front.ts 系统prompt + 测试。看 diff:git diff src/server/voice-intent-front.ts…
- [x] **关羽** dispatch `63679fa9` — 【M40 GLM判定改回强前台——我上单(929bef3)过度纠偏被user强烈否决,撤回重做】
- [x] **钟馗** dispatch `58bae85a` — 【复核 M40 GLM判定改回强前台(撤过度纠偏)】关羽撤回上单的'拿不准就escalate'。看 diff:git diff src/server/voice-intent-front.ts tests/unit/voice-inten…
- [x] **关羽** dispatch `8ea26c92` — 任务：修 APP 端【播放闸门】。目标：GRM/PM 返回到手机端的下行语音先入队，不要一到包就立刻播；只有当【前端本地】判断用户当前没在说话、且出现合适空隙时才开始播放。重点回答 user 提出的核心问题：WebRTC 后端知道的是转写…
- [x] **赵云** dispatch `4c812592` — 任务：坐实【误打断】到底是人声还是回音，并顺手补最小必要的可观测性/修复。现有日志铁证：interrupt 都发生在上行 RMS 暴涨之后，但还缺把【当时下行正在播什么】和 interrupt 绑在一起的证据，所以现在只能证明'被强上行声…
- [~] **马超** dispatch `e9ec6f4c` — 任务：修【乱序 / 重复 / 错位回复】主线，重点检查 retract 与播放队列一致性。user 现在明确感知到：旧内容、新内容、补充内容会前后脚进队列，听感像错位、重复、乱说。请先读 src/server/voice-downlink… ⊘ orphaned dispatch 持续两小时未 report，按周瑜升级告警取消并重派
- [~] **钟馗** dispatch `e161489b` — 任务：独立复核【APP 端播放闸门】改动。对象=关羽已完成 dispatch 8ea26c92。请只做 code review，不要改代码。重点看：1) packages/mobile/src/lib/webrtc-file-downli… ⊘ orphaned review dispatch 持续两小时未 report，按周瑜升级告警取消并重派
- [x] **钟馗** dispatch `c406bad5` — 任务：独立复核【误打断证据链】改动。对象=赵云已完成 dispatch 4c812592。请只做 code review，不要改代码。重点看：1) interrupt / 上行 RMS / file_downlink_state 是否真绑…
- [x] **吕布** dispatch `4ec85a06` — 任务：接管【乱序 / 重复 / 错位回复】主线。前单=马超 e9ec6f4c 已因 orphaned dispatch 取消；请你从当前工作树未提交改动继续，不要重做。目标：检查并修正 retract 与播放队列一致性，落实『未播可撤、在…
- [x] **典韦** dispatch `1742fa92` — 任务：接管【APP 端播放闸门】独立复核。前单=钟馗 e161489b 已因 orphaned dispatch 取消；请你直接 review 当前工作树里关羽留下的未提交改动，不要改代码。重点看：1) 前端本地静默窗口后才播是否真的成立…
- [x] **张飞** dispatch `e610dc78` — 任务：校验 Cockpit / tasks 视图不要继续把刚取消的 orphaned dispatch 当正常在途任务展示。对象 dispatch：e9ec6f4c / e161489b。请做真浏览器或最接近 UI 的验证，确认取消后 t…
- [x] **钟馗** dispatch `c7e978dc` — 任务：独立复核【队列一致性 / 顺序播放卡死】补丁。对象=吕布刚接手 e9ec6f4c 后提交的未提交改动。请只做 code review，不要改代码。重点看：1) packages/mobile/src/lib/webrtc-file-…
- [x] **关羽** dispatch `0acd6784` — 任务：修复 WebRTC file downlink 播放 gate 的 2 个 blocking，不能放行前先把用户真实听感语义修正到位。
- [x] **钟馗** dispatch `77a0b1b5` — 任务：独立复核 WebRTC file downlink 播放 gate 的 B1/B2 修复，重点只看这次关羽新补丁是否真的把顺序播放和代际竞态收干净。
- [x] **张飞** dispatch `f217a18a` — 任务：真机/运行态验收 WebRTC file downlink 播放 gate 新修复，确认它在真实播放器事件模型下不再截断/抢播，并且 interrupt/retract 语义没坏。
- [x] **关羽** dispatch `e27eade6` — 任务：排查【通话模式里 GLM 说话后 PM 收不到/不回，用户体感“非常卡/像断链”】的问题，重点不是泛泛看延迟，而是把“哪一跳丢了/卡了”钉死。
- [x] **赵云** dispatch `d4ed56a4` — 任务：把【通话模式 APP 卡住 / 听不到用户说话 / AI 自打断】补成一套可查证的完整日志与信号链，目标是下次遇到同类 bug 不再靠猜。
- [x] **钟馗** dispatch `8a6106e1` — 任务：独立复核这次【WebRTC 通话模式 GLM → PM 交接链路诊断 + 最小可观测日志补丁】是否成立，重点看它是不是真的把三类情况分开钉死：没交 PM / PM 没回 / 下行没播。
- [x] **关羽** dispatch `66d5df66` — 任务：修正【WebRTC 通话模式 GLM→PM 交接诊断 + 最小可观测日志补丁】被钟馗卡住的 2 个 blocking。目标是：不改现有强前台/legacy fallback 行为前提下，把诊断结论、文档、日志锚点测试全部收准。
- [x] **钟馗** dispatch `bce61ea2` — 任务：复核【WebRTC 通话 GLM→PM 交接诊断补丁】这次对两个 blocking 的修正是否已经收干净，重点只看修正项，不重审整套链路。
- [x] **关羽** dispatch `88f2d589` — 把“手机文字提问但 PM 最后没回到手机端”收成 HippoTeam 体制级保障，不要停留在经验规则。
- [x] **钟馗** dispatch `7fbb7eb1` — 独立审查即将到来的“mobile 来源消息必须显式回到 mobile 端，否则告警”的体制修复。
- [x] **钟馗** dispatch `c361f820` — 请对关羽刚交付的“mobile 来源消息显式回复义务”机制做正式独立 code review，只看这批变更，输出中文结论和 blocking 数。
- [x] **关羽** dispatch `68a701a9` — 钟馗正式 review 给了 3 个 blocking，按下面最小闭环修，不要扩题；修完后把 HTML/research 同步更新，中文。
- [x] **钟馗** dispatch `9ea7dd92` — 请对关羽刚修完的 mobile reply obligation 3 个 blocking 做最终独立复核，只看这批修正是否把上次 3 个 blocking 真收干净，输出中文结论和 blocking 数。
- [x] **关羽** dispatch `1d048c21` — 修复 mobile App 聊天气泡把换行转义串 `\n` 原样显示成“乱码”的问题。用户已给真机截图，现象明确：多行 `team mobile-reply` / orchestrator 文本在手机端显示成字面量 `\n`，而不是实际换…
- [x] **钟馗** dispatch `243c7448` — 请预备独立 review 即将到来的“mobile 文本把 `\\n` 原样显示成乱码”修复，只审这件事。
- [x] **关羽** dispatch `be0a3e58` — 做一份“GRM 前台层编排现状与重写骨架”的结构化梳理，不先改行为，先把现状、规则、模板、代码锚点、信号链一次排清楚，产出给 user 审。
- [x] **钟馗** dispatch `e3fb8ffc` — 请对刚交付的“mobile 聊天气泡把字面量 `\\n` 显示成乱码”修复做正式独立 review，只审这件事，输出中文结论和 blocking 数。
- [x] **钟馗** dispatch `b5f47286` — 请对刚交付的“GRM 前台层编排现状与重写骨架”文档做独立 review，目标不是改代码，而是判断这份梳理是否真能支撑后续重写。输出中文结论和 blocking 数。
- [x] **关羽** dispatch `c4691315` — 重做 `.hive/reports/2026-06-08-grm-front-layer-orchestration-map.html` 的呈现方式；不是推翻内容，而是按 user 新要求把它变成“好看、按访问流程走、卡点一眼可见”的 H…
- [x] **钟馗** dispatch `d7704081` — 请 review 即将到来的 GRM HTML 报告重构版，重点不是事实内容，而是“呈现是否真的按 user 要求改对了”。
- [x] **钟馗** dispatch `307ce052` — 请对关羽刚重画的 GRM HTML 报告做正式独立 review，目标就是判断它是不是已经按 user 要求改对了。输出中文结论和 blocking 数。
- [x] **关羽** dispatch `43d412d9` — 【M40 Phase 3｜GRM Turn Orchestrator 第一刀实现】user 已拍板：保留强前台，但把 GRM/GLM 从 prompt judgement 改成协议化 turn orchestrator。请你只做第一刀、最…
- [x] **钟馗** dispatch `34e8fe2d` — 【Review｜M40 Phase 3 GRM Turn Orchestrator 第一刀】先不要改代码，只做审查。等关羽 report 后，严格审以下点，先列 blocking：
- [~] **典韦** dispatch `af77b3e1` — 【Tester｜M40 Phase 3 GRM Turn Orchestrator 第一刀】先不要改产品代码，等关羽实现后，验证这次 contract/adapter/decision-table 改造有没有把关键规则锁住。 ⊘ 关羽实现已回报，原 waiting 派单收口，改派正式验证单
- [x] **钟馗** dispatch `69feb39e` — 【正式 Review｜M40 Phase 3 GRM Turn Orchestrator 第一刀】关羽实现已回报，现在开始正式 code review。请只审，不改代码，先列 blocking。
- [x] **典韦** dispatch `c442e7a7` — 【正式验证｜M40 Phase 3 GRM Turn Orchestrator 第一刀】关羽实现已回报，现在开始正式验证。你不要改产品代码，优先跑真实测试/补最小验证。
- [~] **关羽** dispatch `93acc0f4` — 【返工｜M40 Phase 3 GRM Turn Orchestrator 第二刀】钟馗正式 review 出 3 个 blocking，当前暂不放行。你只修这 3 个 blocking，不扩题；修完必须带红绿测试和明确证据 team r… ⊘ Superseded by later narrowed redispatch 05698a37, whose resulting fix line was …
- [x] **钟馗** dispatch `04156a17` — 【复审｜M40 Phase 3 第二刀】关羽现在去修你报的 3 个 blocking。请你等他新 report 后，只复核这 3 点是否闭环：
- [x] **关羽** dispatch `05698a37` — 【重派并收窄｜M40 Phase 3 第二刀只修 3 个 blocking】钟馗复核说明你上一轮实际上没把 3 个 blocking 改进去，测试还在红。现在不要沿原思路再兜圈，只按下面最小收口做，修完再交钟馗。\n\n你必须真的改到这 …
- [x] **钟馗** dispatch `e4d519ba` — 【最终复审｜M40 Phase 3 第二刀新 diff】关羽说第二刀已真改到位。请你只按这次新改动做最终复审，先看你上轮 3 个 blocking 是否闭环：
- [x] **典韦** dispatch `244f8488` — 【补验证｜M40 Phase 3 第二刀新 diff】关羽这次补了第二刀，请你只补验证这次新修的 3 个点：
- [x] **关羽** dispatch `4d4e5410` — 【L1协议收口｜修 dispatch double-submit 导致 worker 卡 working】这不是历史垃圾，是刚才正常重派链路里的活 bug；目标是把这类问题在 L1 上彻底打死，不靠 PM 记性。只做最小硬收口，不扩题。
- [x] **钟馗** dispatch `8dc00071` — 【独立复审｜L1 dispatch/report 协议收口】关羽刚完成一刀窄修，目标是打死“同轮重派后前一张 submitted 没收口，worker 长卡 working”的活 bug。你不要改代码，只做 blocking-first …
- [x] **典韦** dispatch `f4bfb01f` — 【验证｜L1 dispatch/report 协议收口】关羽已提交一刀窄修，目标是打死“worker report 不绑 dispatch_id + 同 worker 裸叠第二张 submitted”这条活 bug。你做验证，不改代码，中…
- [x] **关羽** dispatch `f8421b84` — 继续收口当前 M40 Phase 3 GRM Turn Orchestrator 协议化主线。
- [x] **赵云** dispatch `451940fd` — 做 mobile 多 Mac backend profile 设计 spike，要求落到当前代码，不要只讲概念。
- [~] **马超** dispatch `65924b3c` — 推进 Q16 推送通知通道选型，要求给出可执行 runbook，不要停留在泛泛比较。 ⊘ 原派单卡在 submitted，改为重派正式归档任务
- [x] **吕布** dispatch `3f9996b1` — 推进 Q15 worker 模型控制方向，做一次落地型审计。
- [x] **典韦** dispatch `616e14be` — 做 idea-12 通话音量 app 内可调 的现状证据审计，给 PM 一个能不能马上立项实现的判断。
- [x] **钟馗** dispatch `50a38bec` — 独立审查当前【乱序/重复/错位回复】修复线，不改代码，先报 blocking 问题。重点检查：1）mobile 侧 retract 是否严格满足‘未播可撤、在播不撤’；2）server latency turn 与 /api/team/m…
- [x] **典韦** dispatch `c6c13e4f` — 独立做验证补证据，不改代码。目标：把【乱序/重复/错位回复】这条线的测试可见性补到可放行级。先复跑：pnpm vitest run tests/unit/webrtc-file-downlink-audio.test.ts tests/s…
- [~] **马超** dispatch `8c42b8b1` — 基于你已完成的【乱序/重复/错位回复】修复，补一条新的正式 dispatch 以闭环归档。要求：1）不要扩 scope，不做无关改动；2）核对并整理最终改动文件清单，重点说明 generation / supplement 竞态修复、in… ⊘ 钟馗已确认存在 blocking：当前不能归档，原证据归档任务作废
- [~] **关羽** dispatch `446a2e8c` — 修复【乱序/重复/错位回复】review 抓到的 2 个 blocking，做最小正确改动，不扩 scope。Blocking 1：修 对 WebRTC handoff turn 的 FIFO 错绑——同一 active call 存在多… ⊘ 上一条派单因 shell 引号污染内容异常，撤销后重派
- [x] **关羽** dispatch `40c08a98` — 修复【乱序/重复/错位回复】review 抓到的 2 个 blocking，做最小正确改动，不扩 scope。Blocking 1：修 /api/team/mobile-reply 对 WebRTC handoff turn 的 FIFO…
- [x] **典韦** dispatch `44adb4a8` — 准备一轮定点复核，等关羽修完后立即验证，不改代码。先按钟馗 blocking 设计验证清单：1）/api/team/mobile-reply 在同一 active call 两个 pending handoff turn 时，PM 乱序回…
- [x] **典韦** dispatch `d1be554e` — 对关羽这版 FIFO 错绑修复做最终验证，不改代码。重点：1）显式 voice_latency_turn_id 时，mobile-reply 必须精确绑定对应 turn/gen；2）同 active call 多 pending 且无 c…
- [x] **钟馗** dispatch `7fd68996` — 对关羽这版 mobile-reply handoff 修复做最终代码审查，不改代码。重点看：1）是否真正消除了两个 pending handoff turn 下的 FIFO 错绑；2）voice_latency_turn_id 精确认领是…
- [x] **关羽** dispatch `63700027` — 修钟馗新抓到的 3 个 blocking，最小正确改动，不扩 scope。1）active WebRTC call 且 pending handoff > 1 且无 voice_latency_turn_id 时，不能再把 PM mobi…
- [x] **典韦** dispatch `0f330ce2` — 准备下一轮定点复核，等关羽修完后验证，不改代码。重点：1）多 pending + 无 correlation 的 mobile-reply 不再进入 downlink 播放链；2）production CLI 实际 team mobile…
- [x] **典韦** dispatch `66e972e1` — 对关羽这版第二轮修复做最终验证，不改代码。重点：1）多 pending + 无 voice_latency_turn_id 时，/api/team/mobile-reply 必须 409，写 system_event，不落 orch_re…
- [x] **钟馗** dispatch `2356fb0c` — 对关羽这版第二轮修复做最终代码审查，不改代码。重点看：1）多 pending 无 correlation 时是否真正硬收口为 409 + system_event + no downlink，而不是只断 latency 关联；2）CLI …
- [x] **赵云** dispatch `a0162b70` — 收口 sentinel team report 契约 drift。现状：sentinel 启动文案仍写 team report "巡检发现"，但 /api/team/report 已强制缺 dispatch_id 400，tests 已锁…
- [x] **马超** dispatch `85ebf404` — 按 PM 文档职责先收口本轮 M40 改动并整理 .hive/tasks.md narrative。目标：把当前 In progress 里已 ship/已收口的历史项归位，明确本轮 M40 协议收口（mobile-reply/WebRT…
- [x] **钟馗** dispatch `227d9c38` — 单独评估 Cockpit report_missing_research 假阳性，先不要改代码。基于周瑜给的三组样本，判断问题更像 pairing matcher 过严还是历史命名噪音；给出最小下一步建议（修 matcher vs 批量改…
- [x] **关羽** dispatch `70932151` — 开 P0：修 Cockpit report/research pairing matcher 假阳性，做共享规则 helper，不改历史文件名。依据钟馗结论，目标是统一 `src/server/pm-reports-orphan-dete…
- [x] **典韦** dispatch `80ed85c8` — 对 Cockpit report/research pairing P0 修复做独立验证，不改代码。重点：1）复跑关羽列的测试与 biome；2）用真实工作区样本 spot check 周瑜/钟馗提到的几类历史假阳性，确认显式引用旧日期 …
- [x] **钟馗** dispatch `7e3f1ee9` — 对 Cockpit report/research pairing P0 修复做最终代码审查，不改代码。重点看：1）共享 helper 是否真正统一了 detector/audit 规则，消除两套逻辑分叉；2）ignore、显式引用、to…
- [x] **关羽** dispatch `6048503f` — 实现 aliyun.servasyy.com 替换 dmit.servasyy.com 的 hard cut，先做代码侧最关键的 mobile relay 迁移，不做无关重构。要求：1）在 packages/mobile/src/lib/…
- [x] **赵云** dispatch `776adcda` — 实现 aliyun.servasyy.com 替换 dmit.servasyy.com 的 checked-in 部署模板/说明切换，不做高风险线上操作。范围：packages/relay/deploy/Caddyfile.example…
- [x] **典韦** dispatch `d527d214` — 对 aliyun.servasyy.com 替换 dmit.servasyy.com 这次 hard cut 做独立验证，不改代码。范围含两部分：A）mobile relay 迁移（packages/mobile/src/lib/rela…
- [x] **钟馗** dispatch `e5631c24` — 对 aliyun.servasyy.com 替换 dmit.servasyy.com 这次 hard cut 做最终代码审查，不改代码。范围含两部分：A）mobile relay 迁移；B）deploy 模板/说明切换。重点看：1）mob…
- [x] **赵云** dispatch `3e4bc606` — 整理 aliyun.servasyy.com hard cut 的真实线上切换 checklist，产出给 user 直接执行的清单，不做外部操作。要求：1）基于当前已合并的 repo 模板与 memory 里已知部署事实，列出从 dmi…
- [x] **关羽** dispatch `eb0441a7` — 准备 aliyun.servasyy.com hard cut 的 APK 出包前置与真机验证前置，不做线上操作。要求：1）基于当前代码改动，确认出包需要改/检查的版本位、env 位、构建前检查项；2）重点核对 mobile 里会不会把实…
- [x] **马超** dispatch `a777b5fe` — 收口 aliyun.servasyy.com hard cut 相关的 PM 文档漂移，只改 .hive 文档，不改产品代码。背景：本轮新增了 relay deploy/config 面（packages/relay/deploy/*、p…
- [x] **马超** dispatch `7143437d` — 只改 .hive PM 文档，收口 Cockpit baseline stale 已切到 .hive/baseline/test-gates.md 这条新漂移。背景：周瑜巡检说 test-gates.md 已 2 天未更新，匹配到 17 …
- [~] **马超** dispatch `3ee18751` — 只改 .hive PM 文档，收口 Cockpit baseline stale 已切到 .hive/baseline/runtime-flows.md 这条新漂移。背景：周瑜巡检说 runtime-flows.md 已 14 天未更新，… ⊘ worker 已 stopped，dispatch 仍 open；按 orphaned 漏收口异常先人工取消，避免 Cockpit 继续错误显示进行中
- [x] **关羽** dispatch `d2709ba7` — 实现一条 L1 机制修复，目标是彻底治住“worker 做完不 report、Cockpit/dispatch 状态还像对的”老问题。不要做提示词/纪律层补丁，要改代码机制。
- [x] **关羽** dispatch `9b41a179` — 修 Cockpit report/research pairing P0 的最后 1 个 blocking（钟馗 06-09 01:26 复审结论：不可放行）。问题：detector 与 audit 的 research 候选集不一致——…
- [x] **钟馗** dispatch `926d36f4` — 一次性补审当前工作树里三条还没过审的改动线，blocking-first，只审不改代码。背景：59 文件未提交大批次里，mobile-reply correlation 线和 aliyun hard cut 线你已分别放行，但以下三条没有…
- [x] **马超** dispatch `e5134140` — 重派：只改 .hive PM 文档，收口 Cockpit baseline stale 指向 .hive/baseline/runtime-flows.md 的漂移（你上一单同任务被 orphan 取消，没做成，这次重来）。背景：runt…
- [x] **关羽** dispatch `fd78e45c` — 修钟馗对 L1 dispatch 状态机增量审出的 2 个 blocking，最小改动不扩 scope。语义裁决（PM 已定，按原 L1 派单 spec）：completed = 收到明确 team report 关账，你 markRep…
- [x] **钟馗** dispatch `2a01daef` — 复审关羽对 Cockpit report/research pairing P0 最后 1 个 blocking 的修复（你 06-09 01:26 报的 detector/audit research 候选集不一致），只审不改代码。关羽…
- [x] **钟馗** dispatch `20aea55d` — 窄项最终确认：关羽已修你审 L1 dispatch 状态机报的 2 个 blocking，请只对这次增量做最终 verdict，可放行就明确写。语义裁决已定（PM 按原派单 spec）：completed = 收到明确 team repo…
- [x] **赵云** dispatch `5b1fb459` — 查修 main 上 3 个存量红测试（已坐实在基线 commit 0a83774 就失败，与当前批次无关）。1）tests/unit/mobile-outbox.test.ts 两个失败：dedupes identical actions…
- [x] **关羽** dispatch `245c5919` — 续修 L1/team 协议契约的测试同步——你修了 tests/unit/team-atomicity.test.ts 但同族失败还有 5 个文件漏掉，安静树全量跑铁证如下，逐个收口：1）tests/unit/team-operation…
- [~] **赵云** dispatch `b837709e` — 诊断+修 main 上另一批存量红测试（已用基线 worktree 在 commit 0a83774 复现，与当前未提交批次无关），共 14 个失败 5 个文件：tests/integration/preset-driven-layer-… ⊘ 赵云改到一半未 report 即 stopped（report_overdue 机制捕获）。14 红已降 5 红，半成品在工作树，带现状重派
- [x] **吕布** dispatch `17ea0a60` — 诊断一个真实产品缺口：手机 app 存的 LAN host 失效时（今天真实案发：WiFi 网段从 192.168.110.x 变成 192.168.1.x，app 存的旧 IP 拨不通），app 显示永久离线，relay fallbac…
- [x] **关羽** dispatch `627faeaa` — 接手赵云的半成品单（原 dispatch b837709e 已 cancel）：修 main 存量红测试。现状：赵云已把 14 红修到剩 5 红，他的半成品改动就在当前工作树（5 个测试文件 + tasks.md，+330/-214 未 …
- [~] **关羽** dispatch `6e19307b` — 续上单收尾：你报全绿的 5 文件里有 2 个在【默认并行】全量跑仍红，只在 --no-file-parallelism 串行下绿——验证门槛必须是默认并行模式全量绿。铁证（pnpm exec vitest run 全量）：tests/se… ⊘ orphan-submitted: worker stopped without reporting
> ↑ **已收口（非悬案）**：关羽 crash 在 report 前，但活儿实际改完——PM 默认并行全量验证 1813/1813 全绿 + 钟馗 `636687fa` 审产品代码 0 blocking，已 commit `d449cbd`。orphaned 是准确终态（worker 异常退出未 report），cancel 返 409 符合 L1 语义。此类"orphaned 但活儿已完成"需可人工标记关闭 → 归入 [[idea-13]]。
- [x] **钟馗** dispatch `636687fa` — 审一批已全绿但含产品代码改动的 WIP（关羽修存量红测试时为根治并行 env 污染顺手改了产品代码，他 crash 在 report 前，未经审查），只审不改代码，blocking-first。背景：14 个 main 存量红测试根因之一…
- [~] **关羽** dispatch `8455ce08` — 【Phase 1 视频功能：app 内传视频 + 播放 + 双指缩放，单文件 ≤100MB】立项见 .hive/ideas/inbox.md 的 idea-15（含 PM scoping，先读它）。 ⊘ 关羽 worker 启动后立即崩溃退出(codex crash, idea-13 模式)，无 WIP，改派赵云
- [~] **马超** dispatch `56aa83f4` — 【Phase 1 视频功能：app 内传视频 + 播放 + 双指缩放，单文件 ≤100MB】（原派关羽因 codex worker 崩溃退出改派你，无 WIP，从头做）。立项见 .hive/ideas/inbox.md 的 idea-15… ⊘ 挂 2h 零 WIP，马超被旧单 e5134140 占住没真做；拆成服务端/移动端两小单重派降 context 压力(周瑜建议)
- [x] **赵云** dispatch `1cfcd0b2` — 【小任务·服务端，idea-15 视频功能 Phase 1 的服务端部分】把 mobile 上传大小限制从 50MB 抬到 100MB（支持视频）。只改 src/server/routes-mobile.ts 的 upload 路由（约 …
- [x] **关羽** dispatch `6ceb7e83` — 【移动端·视频播放器+双指缩放，idea-15 视频功能 Phase 1 的移动端部分】服务端 100MB 限制是赵云另做，你别碰 src/server。先读 .hive/ideas/inbox.md 的 idea-15。
- [~] **钟馗** dispatch `7d6eda13` — 【独立审查·idea-15 视频功能 Phase 1，两个 dispatch 的合并改动】两个 coder 已交付，PM 已 sanity 过，需要你独立审（PM 不替代审查）。审完 team report 结构化 review，bloc… ⊘ 钟馗 codex 启动即崩(同关羽 8455ce08 模式)，无 WIP，待恢复后重派
- [x] **马超** dispatch `54ee1a07` — 【独立审查·idea-15 视频功能 Phase 1，合并改动】钟馗(codex reviewer)崩了不自愈，你(claude)审 关羽/赵云(codex)写的码=独立（你不是作者、跨 provider），按纪律补这次审。审完 team…
- [x] **赵云** dispatch `360a9c3e` — 【修复·idea-15 Phase 1 服务端 blocking B1 + N2】马超独立审抓到 blocking：你上单只升了 routes-mobile.ts 的 50→100MB，但**外网/4G 上传走的是 relay JSON-…
- [x] **关羽** dispatch `bdee962f` — 【修复·idea-15 Phase 1 移动端 N1 + N4，小改动】马超审建议 Phase 1 内补：
- [x] **关羽** dispatch `50f54c3f` — 【Hive 启动健壮性·永久修第二启动根因：runtime spawn agent 时 strip 嵌套 Claude Code env markers】
- [x] **马超** dispatch `3581c32e` — 【独立审查·Hive 启动健壮性 env-strip 修复，关羽 dispatch 50f54c3f】钟馗(codex)崩，你(claude)审关羽(codex)写的码=跨 provider 独立。只审不改代码，team report 结…
- [x] **关羽** dispatch `617b48fc` — 【修复·env-strip blocking B1（马超独立审抓出）】你上单的前缀守卫过度防御，必须收口。
- [~] **马超** dispatch `b6bd635d` — 【调研·上游 tt-a1i/hive 更新 triage：哪些值得拿进 HippoTeam（双产出硬规则）】 ⊘ 改成 3 人分工并行，撤单人全量单
- [x] **马超** dispatch `da91fd72` — 【上游 triage·Bucket A：worker 可靠性 / dispatch / agent 状态机】背景：HippoTeam 是 tt-a1i/hive 的 fork，上游已 fetch 为 remote 分支 upstream-…
- [x] **关羽** dispatch `de0d66ac` — 【上游 triage·Bucket B：终端 / shell / PTY / 性能】背景：HippoTeam 是 tt-a1i/hive 的 fork，上游已 fetch 为 remote 分支 upstream-tta1i/main，分…
- [x] **赵云** dispatch `35d8e3df` — 【上游 triage·Bucket C：marketplace 战略 + 小 UI + misc + 补漏全扫】背景：HippoTeam 是 tt-a1i/hive 的 fork，上游已 fetch 为 remote 分支 upstrea…
- [~] **关羽** dispatch `af20e655` — 【实现·535cfca worker restart 状态错修复（命中 idea-13 '状态错'，user 已拍可做）】 ⊘ 提示词被 shell 反引号转义弄坏,重派干净版
- [x] **关羽** dispatch `d8778e06` — 【实现·535cfca worker restart 状态错修复(命中 idea-13,user 已拍)。注意:上条同任务 af20e655 提示词被 shell 转义弄坏已撤,以此条为准】
- [x] **赵云** dispatch `f2af0e02` — 【实现·上游 triage #2a:shell 启动防竞态最小三件套(user 已拍)】
- [x] **吕布** dispatch `ede59490` — 【实现·上游 triage #2b:terminal 性能关键子集(user 已拍)】
- [x] **马超** dispatch `3ad6c3b1` — 【设计+Phase1·上游 triage #3:marketplace 模板市场 HippoTeam-native 重做(user 已拍按 PM 推荐做)】
- [x] **钟馗** dispatch `004876b9` — 【独立审·535cfca worker restart 状态错修复(关羽 d8778e06)】只审不改,team report 结构化 blocking 优先中文。
- [x] **钟馗** dispatch `c89bf41e` — 【独立审·terminal 性能子集(吕布 ede59490, opencode 写)】只审不改,team report blocking 优先中文。
- [~] **吕布** dispatch `d140ad45` — 【修复·terminal 性能 2 个 blocking(钟馗审出)】 ⊘ 吕布 opencode worker 崩停 64 分钟,terminal 修停在 8/10(2 parking 测试红),WIP 保留,接力重派收尾
- [x] **钟馗** dispatch `d1ab3fdb` — 【独立审·shell 启动防竞态(赵云 f2af0e02, codex 写)】只审不改,team report blocking 优先中文。注意工作树有 terminal(吕布)+marketplace(马超)并行脏改,本单只审 shel…
- [x] **赵云** dispatch `ecb13e29` — 【修复·shell 防竞态 1 blocking(钟馗审出)】
- [x] **钟馗** dispatch `167df593` — 【独立审·marketplace Phase1 HippoTeam-native(马超 3ad6c3b1, claude 写)】只审不改,team report blocking 优先中文。注意工作树有 shell(赵云修中)+termi…
- [x] **马超** dispatch `b84db139` — 【修复·marketplace 1 blocking(钟馗审出)】
- [x] **钟馗** dispatch `76e34c2b` — 【复审·shell 防竞态 blocking 修复(赵云 ecb13e29)】只审不改,team report 中文。上轮你审出 1 blocking(startShell 没检查 remembered run → TTL 没真防重复 +…
- [x] **钟馗** dispatch `7a97f5e9` — 【复审·marketplace blocking 修复(马超 b84db139)】只审不改 team report 中文。上轮你审出 1 blocking(缺 POST import 未授权写红绿测试)。马超已补:tests/server…
- [x] **马超** dispatch `b3983ac3` — 【接力收尾·terminal 性能修复(吕布 opencode 崩停,你接力,claude 最稳)】
- [x] **钟馗** dispatch `8e298a0b` — 【复审·terminal 性能修复全量(吕布 impl + 马超接力修测试 isolation)】只审不改 team report 中文。经历:吕布 implement(addon async + parking 复用)→你审出 2 bl…
## Open（user 回来决定）
- [ ] multica 余下：#4 run 列表最新优先排序+复制一致(S，👍) / #5 Gemini 官方图标(S，看用不用) / #6 复合派单选择器(M，存疑别做成 squad) / #8 OpenCode cwd 防回归测试(低，park)
- [ ] clipboard 写权限 console error（张飞发现 2 条，疑 playwright 环境权限非真 bug）— 先确认真假
- [ ] HippoMind workspace 让那边 orch retrofit `.hive/plan.md`（runtime 重启后自动 seed stub）
- [ ] 是否派关羽 export refactor（mouse normalization / port-in-use formatter / terminal-stream-hub binary 3 个私有函数）— 典韦点名要 export 才能直测
- [ ] Marketplace 深度调研是否回灌（M11，独立于 PM 体系决定）
- [ ] 9 个 🟡 中风险 event handler 是否补修（等 logger 抓到证据）

## Done

### 归档 narrative（2026-06-02 ~ 06-08 语音/WebRTC 攻坚，全部已 ship，留作 build 史）

> 🎙️🔀 **2026-06-07 晚 user 否决"等说完再处理"→ Phase 2-spec 连续投机理解+撤回 提前为当前主线（关羽建中 `a7a00bdf`）** — 真机暴露"两个声音抢话+对每个半截话不停念好我记下"。先派关羽做"碎话不接(incomplete静默,等final complete才回)"钟馗审过0block，**但 user 明确否决这个'等说完'框架**：要的是【边说边算】不是【说完再办】。**user 设计**：①说的过程中连续分析语义(每1-2s,已有partial eval)给每段打标记(intent_generation)②累积到完整语义GLM判complete就【立刻处理不等停】③两路并发:语音下行发app + distilled语义+上下文发PM真办④意图变(新generation supersede)用【撤回协议】撤未播换新——未播可撤在播不撤⑤核心=理解到完整就回不浪费等说完。**=原ADR `2026-06-06-speculative-voice-front-pm-handoff` 投机生成(点6)，我之前排成下一步是保守了，现提前**。地基:投机字段全在但partial只驱shadow、action仍在final;撤回协议**没实现**(只interrupt/segment_chunk/segment_open,要加retract op)。关羽本单=服务端+协议(partial-complete驱动+retract op+两路并发),手机端撤回播放=下一单出包。interim"等说完"diff不commit,进化成投机版。**教训:别把user投机设计降级成'等端点静音' [[feedback_streaming_call_bargein_is_core]] [[feedback_voice_continuous_speculative_not_endpoint]]**。**✅ 全 ship 待 device-verify**:投机+撤回服务端+手机端 `0fb4ab8`(关羽服务端53测+赵云手机端37测,钟馗深审竞态2轮B1撤回端到端闭环0block)+ GLM判定纠偏 `929bef3`(治"GLM拦清晰活儿忘转PM",要查要办拿不准→escalate纯寒暄→handled,13测,钟馗0block提示真机看PM转发率防过度escalate)+ **APK 2.8.15** `43b2a58`(hippoteam-2.8.15-speculative-0fb4ab8.apk,公网200,飞书已发+重启信号已给)。**①②③服务端=重启4010生效(投机+撤回服务端+GLM判定);④手机端撤回=2.8.15进包**。**device-verify清单**:装2.8.15+重启4010→打电话验 ⓐ边说边算(partial凑完整就立刻回不等停,碎片静默) ⓑ撤回(说一半改主意→撤未播换新,在播不打断) ⓒ强前台(普通问题GLM凭上下文利落自己答扛大头,只真要办的事才转PM)。**🔁 GLM判定3版纠偏**:原prompt(GLM吞清晰活儿)→`929bef3`我过度纠偏'拿不准就escalate'什么都甩PM→**user铁律怒否决'强前台!!!'**→`0a83774`改回强前台balance(GLM扛70-80%凭上下文能答的handled,只真动作派工/部署/重启/查未知/PM拍板才escalate,移除'拿不准就escalate'),钟馗审balance对0block。**我栽一跤教训存 [[feedback_strong_front_handles_burden_not_dump_pm]]:治GLM该交没交靠判得准不靠降门槛**。**最终生效**:重启4010加载投机`0fb4ab8`+强前台`0a83774`;装2.8.15(手机撤回)。**飞书已给重启绿灯**。盯日志:partial触发投机/retract帧/escalate转PM比例(强前台扛多少vs真action转多少)。**跟踪TODO**:PM结果完全回流GLM单声道路由(现只串行防重叠)。
> ✅🚀🎯 **2026-06-07 M40 Phase 2 实时语音四件套全 ship（待 user 装 2.8.13 + 重启 4010 device-verify）** — 四块全实现+钟馗严审+commit：①意图驱动前台 `f31fd69`(治26s延迟,GLM直答少甩PM,完整意图才交PM) ②手机端4态Orb `0023afc`(listening/heard/processing/responding 看见处理到哪步) ③后端端到端时间线日志 `60bf2ab`(治盲人摸象,一行 voice turn timeline 看全程秒数,修215s错配根) ④服务端发 voice_call_state 帧 `053f550`(驱动Orb四态+30s看门狗根除卡态)。**钟馗全程拦下6个真blocking**(接管确认误清空/215s时间错配/workspace FIFO错配/correlation marker泄漏/2个Orb卡processing态)全闭环。**APK 2.8.13** `5456967`(arm64 file_segments,DMIT hippoteam-2.8.13-callstate-053f550.apk,公网200,飞书已发)。**①②③服务端纯码=重启4010生效;④4态Orb=2.8.13进包**。**device-verify清单**:装2.8.13+重启4010→打电话验 ⓐ圈按听→收到→处理→回复四态闪 ⓑ日志一行精确时间线(speech_to_final/final_to_verdict/verdict_to_dispatch/dispatch_to_downlink/total) ⓒGLM直答多了forward_pm=false占多数、真动手秒听接管确认不干等。跟踪项:batch/VAD fallback路不走意图引擎、incomplete不持久化、watchdog timer加unref、多设备并发call乱序correlation。**🔧 device-verify 首通(4010 重启 pid37593,call webrtc-...048110)实测**:✅治本生效铁证(driven decision action=handled forward_pm=false=GLM直答没甩PM;timeline首次吐 speech_to_final=6.6s/final_to_verdict=3.0s)。**发现2 bug 正修**:①timeline na漏算(likely_complete播了回复却记total=na没绑downlink→派关羽:任何插非空reply分支都绑latency turn算total+sendCallState加日志好定位)②Orb四态"闪一下看不清"(派赵云:最小驻留~800ms防闪过+大号label+强区分颜色+动效拉开)。关羽后端+赵云手机端并行修,出 2.8.14(`371fb74`,timeline na修dcdd4c2+Orb可辨e619b03)。**🔧 2.8.14+重启 二轮device-verify 又抓2 bug**:①voice_call_state真机0帧发出(Orb全失效)=call_id guard透传②碎语音final superseded→退老慢路11.8s。关羽修(`3c3e64f`:callee边界归一化call_id+final null安全兜底不甩PM),钟馗0block,纯服务端重启生效。**🔧 3c3e64f+重启 三轮retest(call webrtc-...829024045/215478)**:✅**对话真通了**(干净说一句停一下:'团队在忙什么'→GLM正确distilled'获取团队正在处理的任务情况'+handled直答forward_pm=false)✅responding/listening发帧正常(用户看到圈变色)。**仍2残留→已派关羽`8d5a5f2e`**:①heard/processing帧仍0发出(发帧计数listening17+responding11,heard=0 processing=0,upstream路call_id归一化没覆盖callee:396)②个别turn仍走老breakdown escalate(4.3-8.6s,final null兜底没全覆盖)。**核心教训:连续不停说→STT切碎→GLM没法解析,正解=说一句停一下;真机device-verify靠发帧日志+timeline精确揪bug没盲猜。** 下期 Phase 2-spec 投机生成(点6,边说边算一停即播奔近零延迟)。ADR `2026-06-07-glm-front-intent-driven-10rules`(治本10条)。
> ✅🚀 ~~M40 Phase 2-core 意图引擎驱动前台 `f31fd69`~~（并入上面四件套）— 关羽实现→钟馗审 1 blocking（真 handoff 接管确认被净化层误清空，违 ADR 点5）→关羽修（净化拆接管类/结果型：真转 PM 放行"我让团队上"、禁"已完成/已部署"，顺序先转 PM 再插接管确认）+补 4 红绿测试→钟馗复核 blocking 闭环可放行，25 测全绿+biome/tsc 干净。**纯服务端改动，手机 2.8.12 已够，只差 user 重启 4010 加载新 server 码即生效**。**重启后真机验三样**：①GLM 直答多了不每句甩 PM（看 `voiceIntent driven decision` forward_pm=false 占多数）②真要动手时秒听到接管确认垫场不再干等 26s ③只完整意图转 PM、PM 调用次数降。跟踪项(本单不收)：batch/VAD fallback 路不走意图引擎、incomplete 不持久化 inbound。下期 Phase 2-spec 投机生成(点6)。原派单背景：user 打字拍板"先按治本 10 条去做"（ADR `2026-06-07-glm-front-intent-driven-10rules`）。**痛点**：真机实测语音回复到达要 ~26-31s，日志铁证根因 `escalated=true`=老前台每句 final 甩慢 PM(opus)+不判意图完整度排队堆积(`final_to_fast_reply=4837ms`)，GLM 自己才 2s/TTS 1.7s=慢在乱甩 PM+瞎回不在传输。**治本**=把在线决策驱动源从老 `maybeInsertFastVoiceReplyWithGatekeeper`(每句把关)换成 M40 意图引擎 verdict(`voice-intent-front.ts` 已建好只在 shadow 打日志,判意图初看 2/2 准)。**Phase 2-core 范围(派关羽,点2/3/4/5/9+加固7/8/10)**：完整度门控(半截话不交PM不当完成回合)+complete&handled→GLM直答不转PM+complete&escalate→念真接管垫场+转 distilled 完整意图(一回合一次)+净化层去 HIVE_GLM_GATEKEEPER/escalate marker+不假装+超时兜底不静默。**保留**老 gatekeeper 路作 `HIVE_VOICE_INTENT_FRONT≠1` fallback 不删。**Phase 2-spec(点6投机生成,边说边算一停即播)下期单排**。流程：关羽实现→钟馗复审(codex,不自审)→典韦补测→张飞真机验。
> 🎉 **2026-06-07 M40 Phase 2a 音量根治真机验通（15h 马拉松收一大果）** — **user 真机反复确认"声音大了/响亮出来了"**。根因(赵云深挖)=WebRTC track 走通话流(小)、对讲走 expo-audio 文件媒体流(响);解=通话下行改走文件分段播放路(`voice_downlink_segment` 帧族+expo-audio 文件播放,复用对讲响亮路)。2a 全套 `1ef8c29`(钟馗 5 轮审:协议/断线泄漏/barge-in取消/reassembler上限/disconnect清理/穿透测试),APK 2.8.11(arm64,EXPO_PUBLIC_WEBRTC_DOWNLINK_MODE=file_segments)+ .env HIVE_WEBRTC_DOWNLINK_MODE=file_segments,4010 重启日志铁证 `webrtc_downlink_mode=file_segments`+`file downlink segment sent`。WebRTC track 下行 flag 保留不删。**教训:音量不在 WebRTC track 上磨(_setVolume华为不认/gain削波),对讲文件播放路才是解=一箭双雕音量+M40分段。** ⏳剩:① file 模式 barge-in 停播(赵云 `ccf01409`:file播文件不停,需发interrupt帧让app pause player) ② 速度(final→AI出声8-11s,关羽扩延迟埋点到file路定位GLM/TTS;根治=Phase2d投机) ③ GLM前台漏marker/乱诊断待收。
> 🔥 **2026-06-07 早 实时通话真机攻坚 12h 马拉松（2.8.8 已装机）** — user 真机连续测，逐个炸出+修，核心起来了剩 polish：
> ① ✅ **通话页 UI**（2.8.8 adb 装机，arm64 96M，webrtc/onnxruntime native 在；DMIT 链接 hippoteam-2.8.7-callpage/2.8.8-echofix-*）
> ② ✅ **barge-in 流式下失效**（`faef57c`）：M39 流式绕过 VAD onset→barge-in 死；解耦 onset 与 STT；日志铁证开口即停生效（修前零 interrupt 修后一堆）
> ③ ✅ **回声→上行 STT 乱码**（`e61959f`，2.8.8）：根因 `webrtc-caller.ts` getUserMedia 裸 `audio:true` 没开 echoCancellation→AI 下行声被麦克风录回当 user 说话→转写垃圾（下家/三零/心连着心跳啪）。修=开 echoCancellation/noiseSuppression/autoGainControl。**真机见效=转写从 1-2 字垃圾变 text_len 100+ 干净长句**
> ④ ✅ **回声残留误触发 barge-in 把 AI 掐死没声音**（`bc6114a`）：2.8.8 装机后"一点声音都没有"，数据=回声残留 RMS 0.003~0.017 越过门限 0.006→疯狂误打断（downlink 推 2 次 interrupt 十几次）。门限 0.006→0.03（回声挡住/人声 0.06 放过）+ `HIVE_WEBRTC_BARGE_RMS_THRESHOLD` env 可调
> ⑤ ✅ **延迟 ~3s**（user 认"还不错"）；⚠️ **打断后恢复 ~7s**（门限改了待重测）
> ⑥ 🔧 **音量**：服务端 6x 确认逐帧应用但手机硬件主导、感知有限 → **马超调研"设置页直接调音量"**（`df411be1`，user 明确要,一劳永逸不重装不重启）
> ⑦ ✅ **M40 shadow 真在收数据**（voiceIntent shadow verdict 一条条打）；⚠️ **GLM 前台乱诊断**（sherpa崩/信号差/漏 HIVE_GYM_GATEKEEPER marker）→ M40 前台 prompt 待收
> **教训**：① AEC device-sensitive，开了 echoCancellation 仍有残留回声够触发 barge-in→需 RMS 门限分离回声(0.017)与人声(0.06) ② 手机通话音量硬件主导，软件增益叠加有限，正解=app 内可调 ③ GLM 前台不该对不懂的技术根因 confident 瞎诊断 ④ 12h 一通通磨 user 是 grind，核心通了该转 async polish [[feedback_no_blind_iteration_grind_user]]。
> 📞 **2026-06-07 WebRTC 正式通话页已实现+审过(待出 APK 真机验)** — 把设置页测试通话扶正成全屏通话页(设计稿 reports/2026-06-06-webrtc-call-ui-design.html，user 拍入口方案 A)。马超实现 `e650656`(claude)/钟馗复审 0block(codex)：新建 app/call.tsx 全屏 modal(svg发光球+状态pill+大挂断+静音+时长+transcript占位区,5态映射)、抽 src/components/Orb.tsx 共享(对讲页 orb 逐字节等价、逻辑零改)、对讲页右上角加 📞 入口。follow-up(非阻塞,待服务端暴露信号)：实时 partial transcript 流 + aiSpeaking speaking 子态 + ended 时长≤1s 精度 nit。**待 user 出 APK 真机验 6 条**(📞→全屏/球色计时/静音真停上行/ended自动关/动画流畅/进通话页前先退对讲防双mic)。
> 💬✅ **2026-06-06 消息重复气泡修复 → 2.8.6 已装机验通** — user 真机截图：每条发送消息显示两份气泡。PM 真诊断：sqlite3 铁证服务端只有 1 条（`SELECT * FROM mobile_chat_messages`），纯客户端显示 bug。根因=手机 Android 时钟比 Mac NTP 快数百毫秒，`filterPendingOptimisticMessages` 严格 `<=` 时间比较失败 → optimistic 不消费 → relay echo + optimistic 同时显示。修复(`f4dc3e9`)：加 `CLOCK_SKEW_TOLERANCE_MS=3_000` 容差覆盖手机-服务器时钟漂移，新增回归测试（12 测全绿）。版本 2.8.5→2.8.6，USB adb 直装，**user 真机确认"确定了，不重复了！"**。

> 🟢 **2026-06-06 深夜 user 睡后 PM 自主驱动：M40 实时通话理解层 Phase 1 全部落地（待真机收 shadow 数据）** — user 拍板做成决议(ADR `2026-06-06-speculative-voice-front-pm-handoff`)后授权"你决定做到满意为止"去睡。PM 自主驱动团队完成 Phase 1 三件，全 codex 互审闭环：① 来源通路分离 `037b898`(webrtc_call/talk_continuous/voice 三标签,治通话转写混普通语音老坑) ② 意图引擎核心 `9b69557` voice-intent-front.ts(GLM 结构化 verdict+latest-wins+abort+PM闸+安全默认,钟馗首轮3 blocking→闭环,flag HIVE_VOICE_INTENT_FRONT 默认关) ③ shadow 集成 `fc69475`(接 webrtc-upstream 纯观察打日志+endpoint对照,零行为变更,close泄漏修复,钟馗2轮闭环)。**⏸️ 待 user 醒**：开 flag+重启4010+真机打电话→看 `voiceIntent shadow verdict`/`endpoint_compare` 日志验"GLM 判意图完整 vs M39 端点final"可靠度→可靠才进 Phase 2(意图引擎真驱动回复=行为变更)。Phase 3(mobile 播放闸)+真机也待 user。
> ✅🚨 **2026-06-06 生产事故已修复+真机验通：M39 流式 ASR 一来电崩 daemon → "webrtc不通"**（修复 `4ffbb00`，关羽实现 codex / 钟馗复审 codex 0block / PM commit）。**症状**：user 下载流式 paraformer 模型激活 M39 路径后，每通 WebRTC 通话第一帧就把整个 daemon 崩掉（relay 链路随之断 → 手机"webrtc 连不上"）；user 暴怒"中继连不上多次了"。**PM 冷诊断**（一度被带偏去查 relay 服务器，user 点醒"停机前有 WebRTC call 握手"才对上）：Node `/tmp/repro-streaming-stt.mjs` 复现抓到 native 真因——`streaming-stt-online.ts` 在 `acceptWaveform` 后**无条件 `recognizer.decode(stream)`，漏 `isReady(stream)` 闸** → 攒不够帧就 decode → sherpa-onnx `features.cc:GetFrames 0+61>0` → **C++ `exit(-1)` 直接杀进程**（JS try/catch 拦不住）。典型"测试绿生产死"：旧单测 mock 没 isReady。**修法**=drain 循环 `while(isReady) decode` + flush 用 inputFinished + 流式出错通话级回退 VAD 防御（不哑），17 测全绿。**真机验通(4010 pid 53125 重启后)**：call `webrtc-1780761642531` 日志铁证 `streaming partial text_len 8→12→17→19`(边说边出字)+`streaming final segments=2`+干净 closing，**全程零 streaming error/零 exit/daemon 没崩**。M39 流式 ASR 初衷（边说边出、不等说完）达成。**模型保留不回退**。剩余架构风险：native 其他未知 assert 仍可能 exit()，彻底隔离需子进程化（跟踪项）。
> ✅ M38 快准狠前台已 shipped `22d4224`（user 真机验通"快准狠真对话成了"）。详细历程见 plan.md M38/M39。

> ~~🎙️🔬 **6/04 M37 语音治本（当前活跃）**~~ — 详细历程见 plan.md M37 + ADR `2026-06-02-m36-streaming-voice.md`,此处只留当前态。**📌 2.7.0 里程碑 checkpoint 已 push**(`fb8298f`→origin/main 59 commits;user 要求全力开动 UI 前先 push 定版本号)。
> **🟢 当前活跃(2026-06-05 深夜 WebRTC真机攻坚)**:**★国内TURN已部署+验证完美**——user给阿里云上海ECS,我SSH自建coturn(106.14.227.192,记忆 [[reference_webrtc_turn_server]]),turnutils relay-relay外网IP 6发6收0丢RTT4ms(排除hairpin),user开安全组UDP后STUN 3/3通,iceConfig经`.env`指过去。治本公共openrelay中国不可达(Q17 Phase0坐实)。**真机已验**:华为(无GMS)mic+RTCPeerConnection可达+录音存活(lazy-init真机生效)+call_id UUID修复(`aabddc0`)。**当前卡点=ICE双中继握手没谈拢**:verbose coturn铁证 werift(daemon纯JS)对手机所有候选CHANNEL_BIND+发12个连通性检查,但手机分配peer usage sp=0(没用中继回应)→libwebrtc↔werift双relay pair没建成,探针卡connecting 15s超时。relay-only实验已做(`26dad23`关羽实现钟馗审0block,FORCE_RELAY两端门控,实验包装机+服务端env重启)=**仍FAILED**:手机relay-only生效但coturn铁证所有分配sp=0(没一方成功经中继发peer data)→两个WebRTC库都没完成经TURN的连通性握手,relay-only不是解。**user拍板换werift→@roamhq/wrtc(libwebrtc binding)**。**★第一步(连接握手)真机验证成功(`69abe73`,关羽实现钟馗0block)**:state=connected,offer到connected仅0.6秒!werift卡死15秒的双中继握手换成熟库一下就过=坐实werift纯JS TURN-send是病根。国内TURN+wrtc=WebRTC经中国4G↔Mac真连通,最难的关过了。第二步音频迁移(`a36466e`上行RTCAudioSink→STT/下行RTCAudioSource←TTS)+手机hold-open测试通话(`ac1024c`)+2.8.0实验包(arm64 94MB)飞书发user装机。钟馗多轮审全0block。**★★真打电话双向已真机验通**:中途"没声"真因=① 手机Clash代理拦TURN(USB logcat查出`dial 106.14.227.192:3478 i/o timeout`,user关Clash后通)② 旧upstream挂断后batch转写非实时。**已建实时流式(`b71e461`)**:服务器端VAD切句→每句Paraformer STT→inject→orch回复→下行push,通话期间。**真机铁证全链路通**(call 577fc167):audioSink收150万帧+VAD切utterance+DB实时转写"好的"+下行push 646帧,**user确认"听到你说话了"=双向通**!连续对讲未碰,存档点checkpoint-pre-webrtc-streaming-20260605。**两个调优已ship+重启测**(`db6764b`,VAD门限0.018→0.006+下行10ms):**上行=完美**(6秒切2句,漏话治好,转写准"就是"/"我有在说话",实时);**下行=不糊了但断断续续**。**★真正命门浮现(user深夜怒吼点醒)**:user受不了的不是音质,是①**barge-in缺失**=没法打断,AI下行自顾自播完轰炸耳朵②GLM对每句(含语气词/骂人)长篇auto-reply刷废话。我之前优先级搞错(只磨音质)。**当前(进行中)**:① 关羽修下行断续根因=喂帧比实时慢10%(setTimeout≥10ms累积,实测11ms/帧→手机playout underrun),改漂移补偿排程(baseTs+N×10ms,落后立即追平),5单测过fake-timer证不累积,**diff已核干净待钟馗审+commit** ② **关羽接着派barge-in(开口即停,dispatch b0b4fac8)**:上行VAD onset→下行interrupt()掐当前播放+丢排队TTS,跨4文件(vad/upstream/callee/downlink),设计见research末节。修好user重启4010验【能打断+句句接住+声音清楚】。废话抑制(GLM回太多)涉orch reply路径,待user拍方向。详见 `research/2026-06-05-webrtc-ice-relay-interop-diagnosis.md`末3节。**纪律教训:①别学GLM过度声称②真机问题别盲发包,上USB/帧日志诊断(存 [[feedback_no_blind_iteration_grind_user]])③流式通话命门是barge-in+turn-taking不只是音频流,优先级别被音质带偏**。
> **🟢M37已commit+M38强前台在修(2026-06-06重启后接力)**:barge-in+下行漂移补偿 `bb22a08`(关羽实现钟馗0block)已commit,重启已加载,**barge-in+断续可真机验**。**M38 Phase1强前台**:user拍板前台用GLM-5.1(Q19),关羽实现(glm-5.1+strong/readonly双提示词+HIVE_VOICE_FRONT_MODE回退flag+扩上下文)但**漏个blocking**:glm-5.1是【推理模型】,前台max_tokens=80被reasoning吃光→content空→前台对每句掉兜底套话=强前台没生效(关羽只验HTTP200没验content非空;单测mock provider没打真glm)。关羽分三轮修(reasoning空content→thinking:disabled+max_tokens160;env截胡→strong模型与GLM_FAST_MODEL解耦;越权话术'我让团队上'→改'转给主管'对称传递),钟馗终审+复审0block,22单测。**✅已commit `398e32e`**(glm-5.1真对话前台+严禁过度声称+HIVE_VOICE_FRONT_MODE回退+三条语音路共用)。**纪律(更新 [[feedback_dispatch_to_workers]] 主动验证也派下去 + [[feedback_no_winddown_drive_to_done]] 别提休息干到完)**。**当前=两commit(`bb22a08`barge-in+断续 / `398e32e`强前台)就绪,只差 user 重启4010真机验三样:能打断/声音顺/前台真聊不越权**。
> **🟢真机验证中(2026-06-06重启后)**:user重启4010已加载全部。**✅强前台GLM-5.1真机验通**:连续对讲里前台回复全是真对话("我听到了咱俩连着呢说话很清楚"),gatekeeper=handled,不再"需要主管处理"套话(DB铁证,thinking关闭+content非空生效)。**🔧新问题:连续对讲念回播放断断续续**(user真机确认)——是【对讲念回=服务端TTS送app播放】这条路,跟WebRTC下行(已修)是两条路;mobile src无expo-speech/expo-av,念回是服务端TTS流式。aggravator:GLM-5.1回复变长更易暴露播放gap。**赵云诊断(033c6d86,双产出 reports+research `2026-06-05-talkback-playback-stutter-diagnosis`)**:念回=服务端【整段一次性TTS→base64→chunk传→app凑齐reassemble整段player.replace+play】,**排除服务端chunk/句间gap,断续在app播放阶段**。**高概率根因=对讲为支持barge-in,念回播放时keepRecordingForBargeIn录音(voice_communication)与播放/AEC/AGC抢音频焦点,长回复争用窗口长→断续/误pause**;需app日志/AB锁死。**A/B缓解已ship `76dbe92`**(关羽,钟馗0block):strong念回1-3句→1-2句+max_tokens160→120缩短争用窗口(no-APK,user重启验)。**若改短仍卡→下一步=app侧念回播放期间暂停录音/音频会话协调(动packages/mobile talk.tsx+出APK,有barge-in取舍)**。**⏳barge-in+真通话下行始终未验**:user全程在连续对讲,没进设置→测试通话(真打电话),bb22a08那套device未验。**🟡强前台偶发掉兜底**:一次状态问题glm-5.1超时返null→"好的收到",间歇非系统,fast-voice路径不打日志,复发再派加失败日志+调超时。**纪律(新存 [[feedback_no_winddown_drive_to_done]] 别提休息干到完 + [[feedback_dispatch_to_workers]] 主动验证/curl也派下去)**。
> **🟢架构转折→快准狠前台 已commit(2026-06-06,user深度批评后)**:user打字批评M38强前台:'实时通话流程非常不满意,不知所云不解决问题;前台再强也解决不了真问题(只PM能),且它不把意思整理好干净交给PM=两个声音无序;宁愿砍前台直连后台,否则流式是伪命题'。我先提议砍前台直连PM→**user否决:'我要的永远是快准狠,不是砍前台那样就慢了'**=前台【留着】,要快+准(真懂项目)+狠(干净决断交接)。**已ship `22d4224`快准狠前台**(关羽实现钟馗3轮审0block):①准=前台喂当前阶段plan phase+最近3commit+worker在做啥,答得具体②准狠=提示词直接/具体/有判断,禁官腔空话和稀泥③狠=escalate只一句短接管不抢话不假装解决,PM给真答案(消两个声音)④快=项目上下文读取**全异步**(钟馗抓出execFileSync同步冻结事件循环blocking→改fs.promises+promisify execFile,请求只读内存缓存立即返回,fire-and-forget后台刷新+in-flight guard,热路径零同步IO)。**待user重启4010验**:前台答得具体不?派活一句接管干净不?念回短了顺没?(同重启一起加载 `76dbe92`念回改短)。**架构认知存 [[feedback_streaming_call_bargein_is_core]] 旁:前台价值不在'强'在'快准狠+干净交接',别让它变成PM前面一层噪音**。
> **🟢快准狠前台真机验通+新痛点浮现(2026-06-06重启后)**:user重启测,**✅快准狠前台真对话成了**——回复全是项目认知+直接利落('张飞现在闲置着没在跑任务,你想派活给他吗'/'行咱们继续测,你说我听着'),gatekeeper handled,**user从'非常不满意/无序'到自然对话**。新规矩存 [[feedback_fast_accurate_decisive]](快准狠=user恒定标准)+[[feedback_no_winddown_drive_to_done]]。**当前痛点优先级(user测出)**:① **🔴降噪=最痛(user'不能降噪会非常垃圾')**:噪音/含糊音被STT硬转成乱码('你有没有奶还个要的...')还喂前台。**赵云诊断中 0cb9e994**(查采集NS没开/VAD门松/Paraformer幻听 哪段漏,对症降噪,诊断优先不盲发APK)。② **🟡延迟**:user'时间有点久',三段=VAD等说完+glm-5.1想词(~2.8s偏慢)+念回整段转语音传完才播(赵云已定位'凑齐才播');最值钱=改边出边播(要APK),排降噪后。③ no-sound一次=客户端麦克风(前台诊断对,非代码)。④ barge-in+真通话下行始终未验(user全程在对讲)。
> **🟢降噪两层已commit+理解层reframe(2026-06-06)**:赵云诊断(reports/research `2026-06-06-stt-noise-gibberish-diagnosis`)=三层都缺闸(采集NS不可观测/VAD不评质量/Paraformer无置信度)。**已ship**:① `a4c4114`服务端STT乱码闸(极保守只挡已知样本片段+决策日志,sherpa无置信度故只能弱止血)② `00adc92`App侧降噪质量门控(Silero voice_prob整段质量评估,低质段本地丢不上传;active口径剔判停静音尾+真组合条件防误杀短真话;[VADQDBG]日志驱动调阈值;钟馗2轮审0block 45测)。**待APK真机验+看日志收阈值**(APK先不打,等理解层一起)。**★★user重新定义降噪=不只音频杂音**:'前台要真听懂人整个意思,不是一点一点吐;理解完意思+结合上下文判断,快速干净给PM办——是前台和PM配合的事'。**这是更大的'理解层降噪'**:前台不该对每个语音碎片急着接话,该攒成完整意思→听懂→判断→把distill的意图快速交PM。**我已发设计给user确认**:前台攒完整意思+听懂+能答快答/要动手拎成一句清楚话交PM,不对半截话瞎接。**待user确认对不对再拆活做**。⑤延迟(边出边播)仍排后。
> **✅ 本session已commit**:关羽"假idle"修复(`e924dd6`,前端用terminal runs真实信号覆盖stale缓存,钟馗0block)+关羽WebRTC UUID(`aabddc0`)+Paraformer recognizer模块级缓存(`760ec6a`,治卡顿/念回不出声病根:不再每句重载78MB模型,每句省0.7-1.6s,钟馗4轮审闭环B1竞态/B2锁/finally泄漏)。
> **✅ 已激活**:Paraformer STT(`53e9e18`)+worker不丢任务(`cc52a87`)+念回净化(`8d0a01a`)+GLM禁越权,4010已重启激活;2.7.7+webrtc实验包USB装机。
> **✅ 已激活(本轮多次4010重启)**:Paraformer模块级缓存(`760ec6a`)+吕布WebRTC诊断日志(未commit,src/server relay-connector/webrtc-callee纯stderr,待commit-or-revert)。
> **🟡 待**:关羽relay-only实验→真机验WebRTC双中继能否谈拢;若无效升/换werift或daemon换成熟WebRTC栈。TURN relay范围现10口(49152-49161)测试,通了"批量开"全量+放大coturn范围。对讲页设计稿`reports/2026-06-05-talk-ui-redesign.html`待拍板。
> **★★沟通铁律(存 [[feedback_pm_voice_reply_style]])**:回user一律短/人话/不带URL符号代码(user两次暴怒,系统TTS净化双保险)。M36/M37语音治本+WebRTC实时通话=本阶段主线,详细历程见 plan.md M37 接力 breadcrumb。
> ——以下为 6/04-6/05 早 已完成基线——
> **📦 综合语音包 2.7.5【✅真机验证通过 2026-06-05】**(`bc1d44e`):user 回家+USB,我adb装干净2.7.5(非赵云实验包)+开logcat自己盯=**proper device-verify**(从裸发翻车彻底纠正,这次真日志对照)。**日志铁证**:mode全neural-continuous/neural-barge(零volume模式=不用喊)、voice_prob高分488/低分1796区分干净、speechStart/End触发、**FATAL=0零崩溃零录音失败**(webrtc休眠没捣乱)。**user验证**:打断work、判停1.6s不乱切、**转写明显变干净**(garbling治好)、确认"不是真RTSP我懂"。四修全落地真机过。四块全钟馗0blocking:①新UI修3坑(音效抢录音/error困死/沉浸藏死切换→cue录音态禁播+退出对讲键+沉浸留切换)②webrtc默认不注册(`with-webrtc-package.js`,根因=WebRTCModulePackage注册即PeerConnectionFactory.initialize抢音频,默认不注册则.so在包但休眠不破坏录音)③判停900→1600ms(治"中途短停被切断"+STT garble根源)④神经VAD默认开+voice_prob驱动speechStart(治户外风噪要喊=检测脱离音量依赖,低音量人声也检测/高音量风噪不误触发)。静态核实:MainApplication无WebRTCModulePackage✅/neuralVadShadow=1✅/VAD1600✅。
> **📦 综合语音包 2.7.5【✅真机验证通过 2026-06-05】**(`bc1d44e`):user 回家+USB,我adb装干净2.7.5(非赵云实验包)+开logcat自己盯=**proper device-verify**(从裸发翻车彻底纠正,这次真日志对照)。**日志铁证**:mode全neural-continuous/neural-barge(零volume模式=不用喊)、voice_prob高分488/低分1796区分干净、speechStart/End触发、**FATAL=0零崩溃零录音失败**(webrtc休眠没捣乱)。**user验证**:打断work、判停1.6s不乱切、**转写明显变干净**(garbling治好)、确认"不是真RTSP我懂"。四修全落地真机过。四块全钟馗0blocking:①新UI修3坑(音效抢录音/error困死/沉浸藏死切换→cue录音态禁播+退出对讲键+沉浸留切换)②webrtc默认不注册(`with-webrtc-package.js`,根因=WebRTCModulePackage注册即PeerConnectionFactory.initialize抢音频,默认不注册则.so在包但休眠不破坏录音)③判停900→1600ms(治"中途短停被切断"+STT garble根源)④神经VAD默认开+voice_prob驱动speechStart(治户外风噪要喊=检测脱离音量依赖,低音量人声也检测/高音量风噪不误触发)。静态核实:MainApplication无WebRTCModulePackage✅/neuralVadShadow=1✅/VAD1600✅。**待user说"到家了"→发单链接→卸载重装测**。
> **🔭 WebRTC 真通话(user"彻底解决webrtc",大工程,诚实分步)**:命门=react-native-webrtc注册即抢音频破坏录音(2.7.3红屏 vs 2.6.16正常铁证)。①赵云生存线已解=默认不注册(webrtc在包休眠不破坏录音)②马超信令设计交付(`webrtc_signal`帧族走relay+免费TURN,API key不进APK)③TURN决策=user拍零成本(metered.ca免费)④**lazy-init Phase 0a 已落地**(赵云`cc65370`,钟馗0blocking):patch react-native-webrtc 把 PeerConnectionFactory.initialize+ADM 从构造函数移到 ensurePeerConnectionFactoryInitialized()(首用才建)→冷启动注册了也不抢录音;flag-gated(WEBRTC_NATIVE_REGISTER=1),默认三层防线不注册不扰2.7.5。**待真机验**(计划B:实验包冷启动+录音不坏)→0b录音通话互斥→0c最小通话。ADR `draft-2026-06-05-webrtc-native-registration-gate.md`+`draft-2026-06-05-webrtc-lazy-init-direction.md`已记。**已诚实告知user:语音综合包先到位,webrtc真通话是后续大工程,不吹**。
> **⏸️ 到 device-verify 闸口该等user**:后续(测2.7.5/验Phase0a录音不坏/注册metered.ca TURN)全需user手机;WebRTC正确停在此,不在未验地基上空建0b/0c。
> **🩹 今日血教训(已稳,user日常用2.6.16)**:新UI裸发未真机验→三连坑;回退包2.7.3我只退UI没退webrtc仍坏、还grep只验"无新UI"就打包票"肯定对"→被骂"放屁",user自己找2.6.16才好。**绝不裸发、不打无把握包票、build成功≠能用、device-sensitive必真机验**。存 [[reference_voice_vad_glm_gotchas]]。
> ✅**idea-9 v2 接力实战验证**:user语音被STT/判停garble成乱码时,GLM简短先答(澄清),orch补GLM答不了的(状态/技术诊断),不重复=单协调声音工作良好。
> ⚠️**worker 不稳**:4010重启后多worker假idle实死PTY,派单即停需逐个[Restart]。
> **下一步(等user消气+给方向)**:webrtc-free 重建新UI→我真机自验(USB/张飞)→发user;另立项解 webrtc-vs-录音 音频共存。**绝不再裸发、不再打无把握的包票**。
> **✅ 神经人声VAD 三阶段全打通+真机"好行"**(2.7.0):Phase2 Silero 真打分区分人声(静音0.00/人声1.00)→崩溃 firefight 焊死(探测式 catch-before `ee51023`+config plugin 注册 OnnxruntimePackage `6464c01`,Metro 模块工厂同步 throw 绕 try/catch 的硬教训存 [[reference_voice_vad_glm_gotchas]])→Phase3 voice_prob 接管判停(<0.7 持续900ms)+barge-in(≥0.7+新鲜metering过回声门)`849a440`。赵云实现,钟馗多轮审(Phase3 抓判停黑洞+回声绕过 2 blocking→闭环)。user 19:50-19:56 实时来回测验收判停跟手+打断成功+回声不误触发。阈值 DEFAULT_NEURAL_VOICE_VAD_CONFIG 可再调。
> **✅ idea-9 v2 接力协调【已激活】**(关羽 `b9e613b`,4010 15:20 重启):GLM 简短先答→escalate 注入 GLM 原话+协调指令(只补未答/不重复)+团队名噪声 drop。钟馗 0 blocking(102 tests)。**待 user 真机验3条**:①团队名噪声 drop ②真指令不误杀 ③接力不重复简洁。
> **🟡 idea-10 流式=WebRTC【调研已交付,待拍 Phase A】**:赵云出 WebRTC over TURN 方案(`reports/2026-06-04-webrtc-realtime-voice-spike.html` 已 DMIT /view/ 发 user;5 阶段 A骨架+近节点coturn→B流式STT→C transcript接GLM/orch→D逐句TTS→E用WebRTC AEC重校VAD)。承接 ADR 既有发现(P2P需TURN/US relay 505ms/快嘴层已解orch延迟)。**待 user 拍**:①方向+分阶段 ②近节点 TURN(HK/Tokyo)现成 vs 采购。
> **其他待办**:文章核查(《Cockpit架构》夸大处)待 user A/B;⚠️mobile/.env 开着 NEURAL_VAD_SHADOW(神经真生效),出"关 shadow"包须删 flag。

> 🎙️✅ **6/03 下午 语音对讲 M36 — 连续对讲可用 + GLM 知情前台（已 shipped→plan M36;留作 build 史）** — 续早晨,本轮 USB logcat firefight 把连续对讲做到真可用 + GLM 真答。**SHIPPED `5aea765`(APK 2.6.5 已装机+真机验)**:①**自适应判停**(滚动窗口最小值底噪替换会卡死的 EMA;真因=旧 EMA 被录音启动 -160 垃圾锚死、回升 0.02/样本要 20 分钟→silTh 永够不到真实停顿→永不结束;USB logcat floor=-159 铁证)②**真语音闸**(hadRealSpeech,静音/杂音不投递;STT 拦 whisper 幻听"网络中文普通话语音指令";真机验 DB 0 垃圾)③**首句不丢**(floor 未建立前 -38 绝对启动线;钟馗复审抓到"点完即说丢首句"blocking 并验证闭环)④**GLM"只吐收到"真因+修**(独立诊断证明 GLM 本身好/答"钟馗在忙其他空闲"2.4s,但喂历史让 prompt 变大撞穿 2500ms 超时墙→每次 abort 回兜底;改 5000ms;4010 14:16 重启已激活;真机验 GLM 答"你设置的是按住说模式…GAM 不知道让 orchestrator 确认"=答对+优雅转交)。钟馗审+复审 0blocking。**续 ship**:①晓晓念回(`5c58113`,user 真机"比 MacOS 好太多")②开口打断 barge-in P1a(`49371e6`,2.6.6,Android voice_communication AEC,但**真机暴露回声自触发**=外放念回被当 user 插话→打断+偶发"(听不懂)"garbage,2.6.7 加 BARGEDBG 待 USB 调阈值,user 暂用按住说避开)③双音色分 GLM/orch(`6b9b380`,2.6.7,GLM晓晓女/orch云希男,帮 user 听辨谁在答+诊断 idea-9)④outbox 失败可清除(`6b9b380`)⑤Cockpit ActionBar 可折叠(`25bd9df`,web)。**当前**:APK 2.6.7 DMIT 投递,待 user 装+重启4010激活双音色服务端+ActionBar。**🔴核心待推 idea-9**:GLM 该扛70-80%但老往 orch 推(user 反复提)——双音色先诊断 GLM 实际扛多少,再让 GLM 门卫化(简单的独自答、拿不准才上交防误判丢请求)。

> 🎙️🔊 **6/03 早 语音对讲 M36 — GLM 秒回 + 对讲连续念回（早晨阶段,已被上方 6/03 下午条 supersede,留作 build 史）** — 经一整夜+早晨超长 firefight,语音对讲做到"打电话感"基本可用。**关键转折**:实测 orchestrator 回复要 28-30s(真瓶颈是 orch 延迟,非 relay/音频),**user 自己点出用国产 GLM-4-Flash(智谱免费 /coding/ 接口)做快嘴层**(PM 上海实测 ~1s,key 在 repo 根 .env)→说话→GLM ~1s 秒回应声 + 重活后台 orch。**已 commit+激活(4010 已重启 01:56,2.6.4 已 adb 装机)**:① **GLM 快嘴秒回**(`46eac2c`,user 亲耳听到,之前听不到=媒体音量没开)② **吐字 robust**(`965f080`,token 重叠判抓跳选名单回吐)③ **连续对讲 VAD**(`9e5bf44`,silenceThreshold -52→-45,PM USB logcat 实测 user 停顿-50到不了-52)+ **念回播放**(play前切allowsRecording:false)④ **对讲连续念回**(`aa704cc`,2.6.4,user核心诉求:念我所有回复含追加,钟馗3轮审pending-baseline防"念几百条历史灾难")。**全程真机USB调试+钟馗拦一长串会激怒user的回归(base64损坏/权限绕过/fallback冒泡/收费地址/念历史灾难)**。**架构共识(user拍)**:GLM当"只读知情前台"(读状态答问题、不下指令)。**待办**:给GLM喂只读状态;runtime暴露chatHydrated信号彻底解念回残余边缘;双向打断/连续对讲改真流式。**纪律**:别让user打字(他恨),让语音真好用。**并行**:吕布(OpenCode,user点名)做上游tt-a1i/hive vs HippoTeam代码级对比(`527e25bd`,上次orphan重派)。

> 🎙️🌊 **6/02 语音对讲 M36 流式实时建设（已并入上条,留作 build 史）** — M35 批处理版真机可用,user 拍板升级流式("打电话"体感)。**user 关键修正=中继优先**(开车走 relay);**P2P 泼冷水出局**。设计/ADR `draft-2026-06-02-m36-streaming-voice.md`。**user 授权自主开干、节点 mobile-reply 汇报**。
> **已落地三块(全 commit 过钟馗审,APK 2.5.2 投递,4010 已重启激活)**:① **2a 土版手机音频队列**(`6c37aa0`,顺序播多条 orch_reply+打断守卫,钟馗2轮)② **ⓠ 常开中继 voice_stream 双工通道**(`6fd64de`,与现有消息 RPC 隔离,DMIT 不改)③ **voice_stream 灌真 TTS 音频**(`a97a4b4`,服务端合成推→手机播,钟馗抓 base64损坏+权限绕过 2 BLOCKING 返工)。
> **🎉 真机验证通过(2026-06-02 晚)**:user 点"测试流式念回"听到"你好这是流式测试"=**服务端推语音→安卓播 整条通**;"测试中继流"丢0但 **RTT 505ms**。**🔴 关键发现(PM 自测+真机双证)**:DMIT relay 在美国洛杉矶、user+Mac 在上海→声音绕两趟太平洋 ~500ms,是延迟最大头,**远超软件优化**;**头号杠杆=user 换近节点 relay(香港~30-50ms),user 表示后续自己换**。
> **进行中**:关羽 `1b4439de` 把对讲念回从旧 synthesize 换到 voice_stream(真实对话走验证过的新路)。监控 `/tmp/m36_autowire.out`。**后续**:边收边播(PCM/分段+jitter)、②流式输入、④打断。**流程教训**:含服务端 daemon 改动的增量必须先重启 4010 激活再让 user 真机测(这次 user 测出"丢20"才发现 daemon 跑旧代码没重启)。

> 🎙️✅ **6/02 语音对讲 MVP 批处理版 shipped(M35/M14b) — STT+TTS 双向真机打通** — user 要开车 hands-free 语音指挥。本轮 firefight 解决 4 大盲区(都是"写了集成代码但从没真机端到端验"):①**STT 引擎从来没装**(M14a 只写代码,whisper 引擎缺失→飞书语音也一直静默失败)→装 whisper-cpp(whisper-cli/Metal/M4)+ffmpeg m4a→WAV+模型自动发现(赵云 `c687bcd`)②**中文质量**:small 模型+简体/团队名提示词+`-l zh` 锁中文(赵云 `e1cb5d6`/`88b6100`,user 真机"你现在可以收到我这样说话吗?"准确出简体)③**2.4.0 闪退**:expo-av(SDK56不兼容)→expo-audio 迁移+recorder 生命周期+readAsStringAsync /legacy(关羽 `b9f8309`/`aa1df58`/`858f667`,adb 真机验)④**念回无声**:macOS say 出 AIFF-C 安卓播不了→ffmpeg 转 m4a/audio.mp4(赵云 `e44b61b`,user 真机确认"念回确实成功了")。**user 真机双向验证通过**(说中文→转写→注入 + orch 回复→语音念出)。**回复风格 user 选 A**(念全文,ADR 记)。**worker 教训**:4010 重启后 worker stopped/重放旧 session,连累派单空转,都是 user 先在 dashboard 发现("马超早就做完了?")→纪律:重启后派单 ≤30s 核实 PTY 真做本任务。**遗留 UX**:念回只在 push-to-talk 回合后触发,打字消息不念(待流式时一起打磨)。

> 📚⛏️ **6/02 Obsidian Vault 挖掘：哪些对 HippoTeam 有用（4 worker 并行）** — user 让从其 Vault(/Users/huangzongning/Documents/Obsidian Vault，357 md/492MB，混合知识库)挖对 HippoTeam 有用的精髓。PM triage：Vault 重心是 user 的 OpenClaw/MemOS/龙虾生态(另一产品线)，HippoTeam 相关=子集。**4 worker 分主题并行**：①**关羽(codex)** `36c3edf5` agent 架构/治理/提示词②**赵云(codex)** `4bb9a21d` 记忆系统(TencentDB Agent Memory 源码级×4+MemOS 全系列，判该不该补 runtime 记忆层)③**吕布(opencode)** `fe64b3b1` AI早报 81 篇扫干货④**典韦(opencode)** `51ac02fb` agent 自动化方案(情报巡逻/cron→对照 sentinel)。各出 `.hive/research/2026-06-02-vault-mining-*.md`，**PM 最后合成一份给 user 的结论报告**(哪些有用+落 L1/L2/.hive+是否 promote)。**踩坑**：PM 首次擅自把 user 指定的 opencode 换 codex(拿"opencode 今晚卡过"当由)被 user 怒斥→纠正补派吕布+典韦；教训=user 明确指定 worker/preset 不得擅自替换，要换先问。接上"自主↔人驱动谱系"讨论(vault 多是 OpenClaw 偏自主端积累，校准吸收度)。

> 💬🔧 **6/02 早 聊天跨工作区串台修复 → 2.3.7 已出包** — user 真机实证：HippoMind 发的消息切到 hive-serva 仍显示在聊天页。PM 查 DB+代码定位（非猜）：消息后端路由**正确**（确进 HippoMind、orch 也回复"本地代码和GitHub同步"=HippoMind orch 现已正常），纯**显示层串台**——OptimisticMessage(index.tsx:49) 无 workspaceId，切 workspace 时 chatMessages 重置但 optimistic 不隔离→旧 workspace pending 气泡漏显示。关羽修 commit `83748f6`：OptimisticMessage 加 workspaceId(发送写 selectedWorkspaceIdRef 最新值)+allMessages/filterPendingOptimisticMessages 显示层按 currentWorkspaceId 过滤(hide-but-preserve)。**钟馗 2 轮**：首版关羽切 workspace 时 setOptimistic 破坏性删除非当前 workspace 气泡→钟馗拦(切走切回丢 pending/error 气泡+晚失败更新 no-op)→返工删 cleanup 改纯显示层过滤才 0 blocking。**APK `hippoteam-v2.3.7-83748f6-f9b06ae47d`(52M) 已 DMIT+飞书+手机发**（含终端 aaca7f7+chat 串台）。

> 📺🔧 **6/02 早 终端展示修复 → 2.3.6 已出包** — user 真机截图 hive-serva orch 终端"只剩一行/右截断/红色/不刷新"。关羽诊断+修（钟馗 `a284e3e9` 0 blocking 可出包，验证没把切 workspace 串台弄回来），commit `aaca7f7`：①截断→去 nested horizontal ScrollView+numberOfLines=1 行自然 wrap ②误染红→termLineColor 旧 /error|fail|ERR/i 正则误染普通文本，改 resolveTerminalLineTone 只高亮 shell prompt ③stale 清屏→syncRevision 每变都 setTranscript(null) 清黑屏，改 shouldResetWorkerTranscript 只 identity 变才清。**APK `hippoteam-v2.3.6-aaca7f7-f2f3a0bef2`(52M) 已 DMIT+飞书+手机发**。**未结项（关羽诚实标记，列下一轮）**：终端"只剩一行/无完整 scrollback"根因=TerminalStateMirror SerializeAddon(terminal-state-mirror.ts:47-55) 对全屏 alt-screen TUI 只能序列化当前屏、无 raw PTY 历史；要完整滚动历史需 raw PTY ring buffer 或接 web terminal stream 完整恢复——大改，单列 milestone。

> ❓🔧 **6/02 早 HippoMind orch 启动不了（待 user 给实时错误原文）** — user 报 HippoMind 工作区 orch 点重启报错起不来。PM 真诊断（非猜）排除 5 因：bc7b538 orch-restart 修复**已生效**（4010 PID 77581 启动 6/1 20:23 晚于 bc7b538 17:16 commit）、launch config 有效(claude preset)、HippoMind 目录完好(/Users/huangzongning/development/HippoMind 有 .git/.hive)、claude CLI 可用(2.1.159)、restart 端点代码正确(routes-mobile.ts:830/relay-rpc-handler.ts:300 用 getAgent)。orch 最近成功 run 是 5/26，今天重启**连 agent_run 都没创建**=失败在 store.startAgent 前/中。**缺最后数据点=今晚重启的实时错误原文**（服务端日志 21:56 后停写、截图未入可读 DB）→已请 user 截/打那行报错精确定位。**跨 workspace 隔离我无法直接修 HippoMind，只能诊断**。user 转去看终端展示了，此项挂起待 user 回错误原文。

> 🐝✅ **6/01晚→6/02 workflow 审计 21 bug → 全员并行修 → 14 cluster 全过审 → 2.3.5 已出包投递** — user 跑 mobile-app-bug-audit workflow（48 agent/1.57M tok，41 候选→**21 确认**）逮出 1 critical+8 high+8 medium+4 low，多个解释当晚症状（空媒体气泡=media URL 丢、消息丢=flush 覆盖/去重误删）。报告 `.hive/reports/2026-06-01-mobile-app-bug-audit.md`。user 拍"全修+全员开工"。按文件归属切 zero-conflict cluster 并行，**全 banked（钟馗逐批 0 blocking）**：①**马超(claude)** `63f3053` 7bug=outbox/relay/context（critical clobber 消息丢失+ghost socket+onerror泄漏+flush break+去重改id+6 M/L）钟馗 2 轮（抓 id fallback 同毫秒碰撞会复发丢消息）②**关羽(codex)** `990bb63` 4bug=index+settings（空媒体气泡 media URL/气泡永挂/代码块/QR首连竞态）钟馗 2 轮（QR 竞态没修透返工）③**赵云(codex)** `60dcc20` 2bug relay=房间泄漏+upload 孤儿 TTL（**DMIT+daemon 两轨待部署/4010 重启**）④**[id].tsx** `457e933` 终端串台 requestSeq 令牌（赵云/吕布重复写磁盘验证连贯）。强 TDD+变异验证贯穿。整合树 169 测绿/tsc 0。**APK `hippoteam-v2.3.5-457e933-138082a699`(52M) 已 DMIT+飞书+手机发，待 user 真机验**。**教训进 idea-7**：①worker 卡死要主动查 sqlite dispatch 时间戳别信状态机 working 假象（37bdc52c 被并发饿死 1h/吕布 opencode 卡死 1h，user 在面板先发现我才查）②钟馗质量闸今晚硬：3 批返工（吕布假测试/马超 id 碰撞/关羽 QR 没修透）全拦下没带病出包③同工作树两人写同文件会撞车（吕布解卡后与赵云重复做 [id].tsx，幸 idempotent）。**收尾待 user 点头**：relay DMIT 部署(60dcc20 的 relay-server) + daemon bug2(60dcc20 的 routes-mobile/relay-rpc-handler) + ⑥幂等 stash WIP-6 reconcile，后两者需 4010 重启（杀所有 worker 含 orch，留最后）。

> 📋 **mobile/relay 待办清单（6/01 P0 马拉松后，明日做扎实）** — **已修上线**：LAN 发送门槛(2.3.3 `ddbd73e`)、relay RPC 15s 超时(2.3.2 `25f6b89`)、daemon 探活①(`1231111` 本地部署)。**待办（按优先级）**：①**relay 服务器探活②部署到 DMIT**——build packages/relay + scp 到 `/opt/hippoteam-relay` + `ssh root@64.186.227.39 systemctl restart hippoteam-relay`（代码 commit 在 `1231111`，DMIT 跑的还是 5/30 旧版）②**4G 中继 churn 调查**——诊断面板见 `relay_socket_close reason=replaced` 反复替换，4G 不稳时发送时通时不通（21:50/21:52 到了、之后不到），churn 机制要专门查（手机超时→重连→新 socket 顶旧→抖动）③**#4 切工作区后卡队列不自动补发**（黄闹钟消息，flushOutbox 触发不可靠，mobile-runtime-context.tsx:1147 effect）④daemon 自愈 45→25s(user 要更快)⑤**⑥消息重复**(stash `WIP-6-idempotency`，clientNonce 幂等，解 stash+审+出包+4010 重启)⑥mobile 镜像探活。**关键 memory**：[[reference_relay_two_components_topology]](relay=本地daemon+DMIT systemd 两组件)。**血泪教训进 idea-7 5星**：根因没确认别动手、诊断面板优先、多 bug 逐个隔离。

> 🎯🔧 **6/01 P0 真凶（终）：LAN 模式发消息被 relay 门槛误卡 → 2.3.3 已发** — 4010 重启后 user 仍发不出。**PM 反复误判**（连重启 4010/DMIT relay/疑工作区切换/relay 僵尸全错——服务端一直好的），最后靠 **user 诊断面板**定真凶：`connectionMode=lan`/`Relay=none`/`connected`、LAN 读取全 OK、DB 零 inbound。**根因（代码+诊断面板+user"能收发不出"三方印证）**：`shouldQueuePromptBeforeSend`(mobile-runtime-context-logic.ts:53)写成 `...||!relayTransportReady` **无条件卡 relay-readiness 不分 connectionMode**→LAN 模式 relay 永 not ready→每条 prompt 被 queue 永不发；收走 LAN GET 不受影响→"能收发不出"。**修**(马超 `ddbd73e`)：relay 门槛只在 `connectionMode==='relay'` 时卡；connectionMode 设 required 字段→tsc 强制两调用点都传(call-site 防回归非只测纯函数)；flushOutbox 查无 relay 门槛→卡队列消息装 2.3.3 后自动补发。强 TDD 复现 user 真实输入(退回旧逻辑必红)，钟馗 `81387415` 0 blocking。**APK `hippoteam-v2.3.3-ddbd73e-add4ba1204` 已 DMIT+飞书+手机发**，待 user 真机验。**血泪教训进 idea-7**：①诊断面板才是终结猜谜的关键(我瞎重启服务端浪费 1h+)②"能收发不出"该一眼想到 send/recv 走不同判定③根因未确认前别动手修/重启。**两个 relay 真 bug 区分**：本条=LAN 发送门槛(2.3.3 修)；前条=4G relay 半开僵尸(本地①部署、DMIT ②待部署)。

> 🧟‍♂️🔧 **6/01 P0+ relay 僵尸连接 wedge（重登都救不回）→ 治本修复中** — user 2.3.2 后仍遇深层 bug：切到 orch-stopped 工作区(HippoMind)来回切→hive-serva 也发不出→退 app 重扫码登录**仍到不了服务器**。**马超根因报告**（`.hive/reports/2026-06-01-relay-wedge-root-cause.html`+research，带 file:line）：relay 三方（手机/relay 服务器/daemon）**都缺"对端探活"**——4G 半开 socket（对端死但本地 readyState 仍 OPEN）下，daemon 收 heartbeat_ack 只记时间从不检查丢 ack（`relay-connector.ts:339-345`）→永不判死永不重连→**僵尸**；relay 服务器也不按 peer 探活/驱逐（`relay-server.ts:237-259`）。手机 RPC 全转给死连接静默丢。**解三谜**：①切 dead-orch 非直因(其 RPC 快速 ERROR 不挂)是 wedge 背景②图到 DB 没到 orch=upload(写 DB 不注入 `routes-mobile:938`)与 prompt(注入 `:738`)两 RPC，劣化窗口 upload 成功 prompt 卡住③**重登只重置 device 侧，daemon 僵尸不动→救不回**；唯一解=重启 4010(newest-wins 顶僵尸)。我的 2.3.2 15s 超时治标不治本。**治本修复派马超 `7c502bb5`**：①daemon heartbeat-ack 探活自愈(~40s 无 ack 判死+重连重注册)②relay 服务器 per-peer ping/pong 驱逐死 peer；**强 TDD 复现真实失败模式**(吸取本 session 三次"测试绿生产坏")。**实现完成 commit `1231111`**(daemon livenessTimeout 默认 45s=2×心跳20s+5s；relay 服务器 peer 60s 驱逐；真半开 socket 复现测试+反向不误杀；未碰 M27 newest-wins/churn)，**PM 验 12+11 测绿，钟馗 `63adbec0` 0 blocking 通过**(2 LOW defer：daemon join 超时、驱逐测试没断 peer_disconnected 到达)。**需 4010 重启生效**(同步清当前僵尸+解卡死+激活 orch 重启后端 `bc7b538`)；已给 user 绿灯但说明重启杀所有 agent 含 orch(我)、改动已 commit 不丢。**user 追问 45s 太久+网络差会否永卡**：答=send 端 15s(2.3.2 已装)UI 不冻、45s 是 daemon 端到端自愈、绝非永久卡(有界自愈，网络回来自动接)；提议①缩 daemon 心跳 20→10s/阈值 45→~25s 跟重启一起部署 ②手机端镜像探活下个包——待 user 选"先缩再重启"vs"先重启解卡死"。③mobile 镜像探活+④发图原子性+重落 ⑥ client_nonce(stash WIP-6-idempotency) 随后。

> 📱🔧 **6/01 手机端 PC-parity 批量修复 → v2.3.1 已出包发飞书+手机** — user 密集测移动端逮出一批 bug/缺口（M28 手机追平 web），急要出包。**本包修 5 项（全过钟馗审）**：①切工作区 Chat 残留旧聊天+竞态（赵云 `efaa74d`→返工 disconnect 竞态 `a0d5b61`，钟馗 2 轮）②新增 Worker 的 AGENT CLI 纯文字→图标+文字（马超 `8413875`，Ionicons 无新依赖）③④⑤ orch/worker 重启按钮+worker 一键启停+orch 状态修复（马超：APK `f89dbd1` + **后端 `bc7b538` getWorker→getAgent 让 orch 可重启，需 4010 重启生效**；B/C 纯 APK 即时，C=orch"停了却 WORKING"显示 bug）。APK `hippoteam-v2.3.1-f89dbd1-2cf22ae272`(52M)已 DMIT+飞书+手机发。**并发教训**：赵云+马超同时改 mobile，靠改不同文件+分别 commit 锁定避缠。**待办 ⑥消息重复**（发一次出两次，根因=`mobile_chat_messages` 无幂等键→同步滞后触发手机重发，跟"信息滞后"同根；DB 确认两条 1m43s 重复）——改 schema+server+app 且需 4010 重启，单独处理。non-blocking 尾巴：后端控制面缺集成测试、runBulk 缺 finally、跨 host late-fetch connection-generation 守卫。**user 需重启 4010**（激活 orch 重启后端 + 为 ⑥ 铺路）。另：deck（HTML+PDF v2 截图版）已发飞书。

> 🚨🔧 **6/01 P0 回归：2.3.1 发消息彻底坏 → 2.3.2 已修+user 验证发消息恢复** — user 装 2.3.1 后**任何工作区发消息都发不出、app 不可用、暴怒**。**根因（马超逐字节核对，非工作区切换——PM 先误指赵云后纠正）**：`relay-transport.ts call()` 无 per-RPC 超时（M27 起潜伏），4G/切后台后 relay socket 半死（readyState=1 但对端没了不回不 onclose）→RPC promise 永不 settle→sendPrompt 永久挂起+前台重连探针卡 reconnecting=true→shouldQueue 永远 queue+outbox flush 停。DB 实锤无 inbound。**修**：relay RPC 加 15s 超时→reject+关死 socket 触发重连自愈（`25f6b89`，仅 relay-transport.ts，钟馗 0 blocking+15 测绿含 2 条半死 socket 复现）。**2.3.2** `hippoteam-v2.3.2-25f6b89-263cf5498d` 已发→**user 真机验"你好"到达=发消息恢复 ✅**；截图另证 ⑤orch 状态(STOPPED 不再假 WORKING)+③重启按钮 UI 都对。orch 重启点击报 "Worker not found"=`bc7b538` 后端待 4010 重启（已知）。**三重错钉进 idea-7（4 星）**：①催急跳过真机/端到端验证就出包（第三次"测试绿但生产坏"，首次砸到 user）②误判归因先指最显眼改动③假称"张飞真机验"(张飞 codex 没手机)。**⑥消息重复 stash 了**（`git stash WIP-6-idempotency`，没混进救命包；待 2.3.2 稳后恢复+审+单独包，server 部分需 4010 重启）。

> 📱🔧 **6/01 手机端 PC-parity 批量修复 → v2.3.1 已出包发飞书+手机**

> 🛡️ **6/01 审查闭环加固 + 哨兵盲区修复** — ①**架构批全过审**：M32 worktree 隔离(`6867cc9` 返工，钟馗 `4fcd4c6a` 4 blocker 闭环)+ M25 Phase2 Claude 隔离(`8a2b0c1`，钟馗 `f3d579ba` 0 blocker)，均默认关 + 启用前硬化清单已记。②**user 戳穿 PM 自审隐患**：i18n 9 行 PM 自审没派钟馗→user"claude 审 claude 不靠谱"→补派钟馗 `6d10e807`(0 blocking 但原则=claude 不自审，存 memory `feedback_no_self_review_claude_code`)→**立 M34 未审代码看板兜底**(spike→ADR `2026-06-01-unreviewed-code-backstop`→马超实现 `7000f5c`，纯函数零 schema，钟馗审中 `d5ea3476`)。③**user 逮陈旧治理 drift + 疑周瑜**：手机新增Worker决策 5/30 拍板+实现但 PM 2 天没归档(已归档 `2026-05-30-mobile-add-worker-safety`)；诊断=**周瑜活着但巡检盲区**(只覆盖 baseline/git/孤儿 dispatch，不查陈旧草案)→**派赵云扩展 sentinel-heartbeat 加陈旧草案检测 `8e8e9958`**(复用 parseDecisionsDoc + age 阈值 48h)。其余 2 草案(M29推送/M31模型)audit 确认是真等 user 拍非陈旧。**周瑜扩展 commit `872befd`，钟馗 `87bcf17c` 0 blocking 通过**；1 follow-up(MEDIUM，未做)：decisions parseError 被静默当"无陈旧草案"——讽刺地这个防静默漏报的功能自己有静默边角，钟馗建议 surface parseError 成 finding；触发罕见(decisions 有坏文件才会)，待 user 决定是否补。**M34 钟馗 `d5ea3476` 出 BLOCKING(生产 listWorkers 不返回 commandPresetId→兜底形同虚设，第二次"测试绿生产死")→返工马超 `e6124fc1`**。**待 user 拍**：M29/M31 那俩决策搁着。

> 🧭 **6/01 双竞品三角合成 → 落地执行** — 对比 OpenTeams 报告 + CCB 报告（5/30 钟馗）三角定位真缺口。**user 拍 4 项**：①worktree 隔离→**已起 ADR `2026-06-01-worker-code-worktree-shared-hive.md`（已采纳）+ 立 M32 + 派马超 Phase 1 `73bc8ea7`**（workspace 分层+per-worker CODE worktree+cwd 注入+.hive sparse-checkout+symlink 保共享）②远程诊断→**立 M33 候选 proposed + idea-8**（拆"假矛盾"：卡死探测强但缺"活着的 agent 在干嘛"可解释性证据；OpenTeams 全 SQLite + CCB doctor/bundle/completion-evidence 双印证）③provider managed home→发现**就是 M25**（Phase1 Codex 已 ship `b806584`），派马超 **Phase 2 Claude managed home `62cbe900` 排队**④三角合成记 ideas/plan。**约束**：M32(cwd)+M25(env/home)都动 launch 路径，**串行**都给马超避冲突(pending=2)。**踩坑**：派单 prompt 反引号被 shell 命令替换污染(48e8f102 cancel 重发 73bc8ea7 改单引号)→进 idea-7。i18n 已 commit `538d004`(自审 9 行未派钟馗)。

> 🔬 **6/01 OpenTeams 竞品对比战略评审** — user 拿来一份外部深度分析（对比 OpenTeams：Rust+Tauri、DAG 编排、worktree-per-workspace 隔离、全 SQLite 可回放、449⭐ Apache）。PM 核查我们这侧论断：①license BUSL ✅准 ②无 worktree 隔离 ✅准（真缺口）③**liveness"无 timeout/心跳卡死无人知"❌过时**——漏看 M26 自愈+M30 stale-dispatch+周瑜哨兵这层探测（这 session 一直在响应的就是这套）。**根因=文档没写清**：已修 CLAUDE.md 状态机行+L1 清单，讲明"状态机三态≠无 liveness 探测"。**user 拍两决策**：①worktree 隔离→先派设计 spike（赵云 `971fdfdf`，难点=`.hive/` 治理层必须共享不能塞进隔离 worktree，且别被拽成对手重合并模型）②OpenTeams 报告→要落但先复核对手侧。**worktree spike 已完成**（赵云 `971fdfdf`，产出 `.hive/reports/2026-06-01-worktree-isolation-spike.html`+research，PM 核 file:line 全真：agent-run-starter.ts:94 cwd 写死 workspace.path 等；推荐=canonical 主树承 .hive + per-worker CODE worktree + sparse-checkout 排 tracked .hive 后 symlink；待 user 拍板再起草 ADR `worker-code-worktree-with-shared-hive-governance`）。**OpenTeams 报告解阻**：user 给 URL `openteams-lab/openteams`，已重 clone 到 `/Users/huangzongning/development/openteams-compare`(194M)；PM 先验两条承重句全中（crates 结构 ✅、Cargo.toml:14 remote crate exclude ✅）；落报告排马超 `547e5138`(i18n 后接,读 Rust 验余下承重句+改对 liveness 勘误)。**4G 攻坚报告**改派赵云 `f3b26bdd`(原马超 `12157eaa` 通道阻塞没做成已 cancel)。M26/M27 已 shipped 归 plan.md，本段 M26 仅作 liveness 当前能力引用非待办。

> 🟢 **6/01 当前状态** — 4010 已重启（M27 Part B 实时推送 + M28 服务端 transcript/stale-dispatch + orch_reply 倒终端垃圾 revert `00e3bf0` 全生效）。**M27 已 shipped**：user 真机验证 4G relay 确实变快（Part A 跳过 LAN 空试）。新 APK `v2.3.0-4c0ddf6`（里程碑圆圈再缩小一档）已 DMIT + 手机 app 通知。**新派两单**：①马超 `12157eaa` 写 4G 攻坚正式 HTML 报告（吕布 opencode context 爆没出完，重派）②关羽 `bc859aad` 仪表盘 ActionBar 待办文案 i18n（user 已批"可以去做"）。team 模型已升 gpt-5.5（赵云不再 5.4-mini）。**待办**：两单 report 回 → review（关羽非 claude，钟馗审 i18n）→ commit。

> 📱✨ **M28 手机端追平 web + 自建本地构建 sprint（5/31）** — ①**全量审查**：workflow(82 agent/2.5M tok,全 Sonnet)对手机端 10 个展示 surface vs web 逐一对比+对抗验真,确认 **63 问题**(0critical/10high/28medium/25low),报告 `.hive/reports/2026-05-31-mobile-vs-web-ui-audit.html`+research 索引。根因=服务端 routes-mobile 只暴露 5 字段(plan/tasks/questions/ideas/actions),baseline/decisions/reports/research/timeline 源头没输出+错误处理"清空"非"降级"。②**自建本地构建管线(替代 EAS)**：user 受够 EAS 额度,自建 JDK17+Android SDK 本地 gradle 构建(`build-local.sh`,arm64-only,零 EAS/零登录)+scp 到 DMIT `/var/www/dl`+Caddy 静态路由公网投递+飞书发链接;versionCode=分钟时间戳可直接覆盖装。坑:清 `~/.gradle` 前要 `./gradlew --stop`(stale daemon)、versionCode 用 Groovy 属性赋值 `= (...).toInteger()` 非 `(int)(...)`。记 memory reference_local_build_apk_delivery。③**Phase 1 P0/P1 全 ship(4 commit,需 4010 重启激活服务端半)**：Track A 服务端根因(马超 `5a07730`:orch_reply 普通对话回复入库[修对话闭环]+approval_request 持久化[修审批死码]+started_at 回填[修 Uptime]+cockpit 暴露 decisions/baseline)、Track B 前端(赵云 `05fb52d`:thinking_levels 类型+重连保留数据不空白+ConnectionModeBanner 重连态+死按钮)、里程碑排序(赵云 `48e3225`:按日期降序 M28 置顶,弃文档倒序)、本地构建基建(`1c4510a`)。**#20 已本地构建(`b669b20`)+DMIT+飞书发 user 装机**(前端即生效;服务端 4 项+M27 Part B 待 user 重启 4010)。④**UX 打磨批(赵云队列→#21)**:扫码读相册 / 聊天图片点击放大 / 输入框多行自适应 / 中继徽章移到"在线"左 / 状态卡(进行中任务标签错[实为剩余项数]·三统计块可点·当前里程碑选最新 M28) / 图片消息紧凑+发送状态勾(修 sent 误判 error)。⑤**push 通知探讨**:user 问后台收消息(微信靠系统 APNs/FCM/厂商推送非"后台常连"),拟立 milestone 配通 FCM/厂商推送(M24 Phase7 已做一半)。**drift 发现**:M24 Phase5"orch_reply 自动回灌"·Phase7"审批推送通道"标 done 实则坏(Track A 已修)。**待办**:user 重启 4010、赵云队列做完出 #21、Q14 审批从飞书路由解耦归 Phase2。


### 2026-06-07（M40 Phase 2a 音量根治 + 通话页 + 批次）
- [x] **赵云/关羽** — M40 Phase 2a 通话下行改 file_segments 文件播放路 `1ef8c29`：根治音量（WebRTC track 走通话流小→对讲 expo-audio 文件媒体流响），钟馗 5 轮审；**user 真机验通"声音很大了"**；WebRTC track 下行 flag 保留不删
- [x] **马超/钟馗** — WebRTC 全屏通话页 `e650656`：对讲页右上角 📞→全屏 modal（入口方案 A），抽 Orb.tsx 共享
- [x] **PM** — 2.8.12 批次 `e0068c7`/`e7c8fec`/`bace8d0`/`c4eb1a1`：file 模式 barge-in 停播(interrupt 帧)+延迟埋点扩到 file 路+shadow 日志带转写原文；APK arm64 投递 DMIT，4010 重启加载，日志验 file downlink interrupted/segment sent 触发
- [x] **PM** — 延迟根因定位：`voice latency breakdown` 铁证 escalated=true（甩慢 PM）+per-sentence 排队=26s 真凶；shadow verdict 2/2 判意图准 → 拍板治本 10 条 ADR `2026-06-07-glm-front-intent-driven-10rules`

### 2026-06-06（baseline 体检 + 通话页设计稿 + M38）
- [x] **周瑜** dispatch `c54a0b0e` — baseline 体检（只读）：187 commit drift，三文件清单交 PM
- [x] **赵云** dispatch `806f0484` — baseline 三文件更新：risk-hotspots 新增 WebRTC/神经VAD/GLM 热区；module-map 补全 voice/WebRTC 全族；test-gates 补 mobile 18 测试+server 未覆盖区
- [x] **马超** dispatch `c459972a` — WebRTC 通话页 UI 设计稿：reports + research 双产出；推荐入口 A（对讲页 📞→全屏 modal）；3 态设计；发现 ended 态 hook 缺失；待 user 拍板
- [x] **关羽** — M38 快准狠前台 `22d4224`：前台喂 plan phase+最近3commit+worker状态；全异步上下文读取；钟馗 3 轮审 0block；user 真机验通
- [x] **关羽** — barge-in+下行漂移补偿 `bb22a08`：钟馗 0block
- [x] **赵云** — STT 乱码闸 `a4c4114` + App 侧降噪质量门 `00adc92`；钟馗 0block

### 2026-05-26（M19a shipped + worker 启停 + 诊断）
- [x] **赵云** dispatch `f9ad4fe2` — M19a 子任务 1：协议 audit（`59ea75a`）
- [x] **关羽** dispatch `d9666c2d` — M19a 子任务 2：Expo skeleton + LAN spike（`1ef7b00`）
- [x] **赵云** dispatch `24dd5f12` — M19a 子任务 3：mobile API 层 — Bearer auth + dashboard 聚合端点 + WS（`d237009`）
- [x] **关羽** dispatch `b3482627` — M19a 子任务 4：Expo app 对接 mobile API — LAN 只读 dashboard（`a263adf`）
- [x] **关羽** dispatch `01eb31e1` — Worker 一键启停功能（`de752ce`）
- [x] **张飞** dispatch `ac3e5256` — 诊断 Cockpit Tasks 与 Todo 计数差异（结论：非 bug，Done 段 70 + In progress 段 5 = 总 75）

### 2026-05-24 ~ 25（Feishu e2e + paseo 调研 + Cockpit governance + MCP browser + 全 app E2E + M17 handoff）
- [x] **赵云** dispatch `c8867a7c` — **M19 原生 app 架构方案**（epic）：锁不可变需求（真原生 iOS/Android、解决 loopback 外安全远程=host pairing+LAN+加密 relay、覆盖看板/Cockpit/终端/任务 + M14 语音收敛、relay 只转密文+capability/approval）+ M19a-M19f 阶段 + 技术选型（Expo/RN/Expo Router、设备 keypair+SecureStore、direct LAN 优先 relay E2E 加密）。回填 ADR + plan.md M19 confirmed epic。report 457 行+research，全 gate 1167 (`e895380`+`d1775e7`)。推荐先开 M19a
- [x] **关羽** dispatch `6b8951b5` — **M14a Phase 2** 本地 STT 落地：新建 local-stt.ts LocalSttProvider（白名单探测 whisper-cli/whisper，.txt 优先 stdout 兜底，临时目录用完清理，CLI 缺失返 null 不崩），接进 feishu-transport（audio→临时.opus→本地转写→现有 inbound 注入；本地不可用回退飞书 ASR）。真临时脚本测试无 mock，9 focused + 全量 1167 (`0b4cf98`)。⚠️待 user 装 whisper(brew whisper-cpp / pip openai-whisper) + 重启 + 真 E2E
- [x] **赵云** dispatch `1eb7852c` — M19 前端 APP 调研：paseo 拆解（不是单壳，是 Expo+Electron+CLI+relay 连本地 daemon 的 client/server）+ PWA/Tauri/RN 三选项对比。**推荐 PWA-first**（复用现有 Cockpit/9tab/Tasks，0.5-1.5 天 installable+dashboard-first；手机远程仍靠飞书桥不另开 RN）。report+research+ADR draft，新增 plan M19 proposed，全 gate 1167 (`2fa6425`+`d434ce5`)。ADR 待 user 拍
- [x] **关羽** dispatch `701ab29f` — M14a Q10 选项 D 调研（openclaw 本地 STT）：**可行+推荐**。openclaw media-understanding/runner 用无 key 本地 CLI auto-detect（sherpa-onnx-offline→whisper-cli→python whisper→才落 provider key）。建议不搬整套，加 LocalSttProvider 借 CLI adapter/fallback：飞书 audio→临时文件→whisper-cli/whisper→解析→复用 inbound 注入。MVP 白名单 whisper-cli/whisper、不引 native binding、不自动下大模型。坑：user 需装 CLI/模型、冷启动、中文质量、CPU timeout。report+research+Q10 更新，全 gate 1161 (`96cee8a`)
- [x] **关羽** dispatch `4109bb4b` — **M14a Phase 1** 飞书语音接入 spike+第一刀：三未知解（①audio msg content 带 file_key→parseAudioContent ②messageResource.get 下载音频 stream ③飞书 speech_to_text.fileRecognize≤60s 但**免费版不支持**）。实现 audio→下载→飞书 ASR→recognition_text→复用 resolveRoute/inbound 注入 orch（标 `[来自飞书语音]`），失败优雅 drop 不接外部。挂 Q10（STT provider 待拍）。report+research 配对，38 focused + 全量 1161 (`f37b21f`+`c29bf2e`)。真飞书 E2E 待 user 配合
- [x] **赵云** dispatch `d84d31fa` — M14 语音/移动选路 ADR 调研：三路横向对比（自建 mobile / 第三方框架 LiveKit-Vapi / 飞书+voice）+ ADR draft。**推荐先走飞书 voice command MVP**（语音→转写→现有 team 协议，复用 M4 桥，ROI 最高，自建/实时框架二阶段）。reports+research+ADR 配对，全 gate 1156 (`7983182`+`933eedc`)。结论已发 user 飞书，路线待拍（Q9）
- [x] **关羽** dispatch `ea4054a2` — 修 orch 终端流式时底部输入框消失：根因 flex 链缺约束（orch PTY slot 修前 overflow visible/min-height auto/flex 0 1 auto → 修后 hidden/0/1 1 0%），OrchestratorPane root + portal slot + WorkspaceDetail 左 pane 补 min-h-0+overflow-hidden + 回归测试。**playwright 真浏览器量 DOM + 80 行流式验输入区全程可见**（top937/bottom954<1000）。纯前端不用重启，build:web 已跑。4 focused + 全量 1156 (`9b63ae2`)
- [x] **赵云** dispatch `98ca899a` — **multica #7** runtime 状态条：GET /api/runtime/status（UI token 保护）返 port/pid/cwd/log_path/db_path/version + RuntimeStatusStrip 挂 sidebar 底部（独立 useRuntimeStatus hook，不动 api.ts；title 露全路径）+ i18n + 测试。不做心跳。全 gate 绿 1156 tests (`89acb07`)。⚠️新 endpoint merge 后需重启 4010；重启后张飞验收
- [x] **关羽** dispatch `03e7da29` — idea-7：Cockpit 内嵌文档 viewer（CockpitDocumentViewer.tsx，reports 用 iframe / baseline-research-decisions 用 doc-file fetch + `<pre>`，Dialog Esc/遮罩关，i18n loading/error）。4 tab 打开按钮改内嵌不再 window.open。**纯前端不用重启**，build:web 已跑。18 focused + 全量 1153 (`5c7227e` + `8dba38e`)
- [x] **张飞** dispatch `5216b120` — 真浏览器验收 idea-7 viewer **PASS**：baseline/research/decisions/reports 全部 app 内 Dialog 打开（始终 1 个 tab、未开新 tab），md 用 pre / report 用 iframe 真渲染，Esc + 关闭按钮可关，0 console error。附 clipboard 写权限噪声 4 条（非阻塞，记 idea-7 待查）
- [x] **张飞** dispatch `d7e73037` — 真浏览器诊断"baseline 点不开"：**功能本身好的**（5 卡片有按钮、点击开新 tab、doc-file 200 返回 markdown、path 格式对）。根因＝**user 浏览器旧 bundle 缓存**（按钮没渲染），硬刷新解决。附带发现 window.open 新 tab 可能被弹窗拦 + 主 app 2 条 clipboard 写权限 error（记 idea-7）
- [x] **关羽** dispatch `66b92abe` — 两个 Cockpit 修复：① ideas parser bug（pm-ideas-doc parseIdeasDoc 改用 topLevelBullet，缩进子条目不再算独立 idea → 修「想法」虚高计数 + ActionBar 一个 idea 刷成多条噪音）② doc-file 路由 serve `.hive/{baseline,research,decisions}/*.md`（path-traversal+目录+后缀防护，text/plain），3 个 tab 加「打开」按钮 window.open 同浏览器。61 focused + 全量 1153 (`9b62207`)。⚠️parser+新路由 merge 后需重启 4010
- [x] **Orchestrator** — 收尾刷 baseline（消 staleness）：module-map（+pm-reports-doc/reconnecting-websocket/preload-recovery，schema v21→v22，标注 dispatcher 快照注入/cockpit reports+playbook/routes-cockpit report-file+answer）+ runtime-flows（Flow1 Layer4 快照、Flow4 reports/answer/9 tabs）+ state-storage（schema v22）
- [x] **赵云** dispatch `b947680a` — **M13 Layer 4**（5 层全齐 shipped）：buildWorkerCockpitSnapshot 生成 4 行紧凑快照（phase + 活跃 milestone + open Q/high 数 + baseline fresh/stale + 共维护提醒，<520 字符），dispatch 当下经 writeSendPrompt 注入到 PM_DISPATCH_REMINDER 之后。真 PTY CLI 测试断言 worker stdin 真带快照。全 gate 绿 1143 tests + orch 复验 19/19 (`62ca462`)。⚠️注入逻辑 merge 后需重启 4010
- [x] **关羽** dispatch `a3b4606e` — report 在同浏览器内打开：runtime 加 GET report-file 路由（只允许 .hive/reports/ 下 .html，path-traversal/非html/不存在分别拒）+ ReportsTab 改 window.open(_blank)，不再 shell OS open 弹默认浏览器。16 focused + 全量 1141 (`4e20c7f`)。⚠️新路由 merge 后需重启 4010
- [x] **赵云** dispatch `73ebadd8` — **M17 收官**（5/5 playbook 全齐）：advisor + committee + epic 三模板 seed + ORCHESTRATOR_RULES 三段 + plan.md M17 标 shipped。advisor/committee/epic **故意不加 aiAction**（无干净触发信号，硬凑会污染 ActionBar，是 PM 主动选择型）。三 gate 绿 1141 tests + orch 复验 31/31 (`4304d2e`)。⚠️RULES merge 后需重启 4010
- [x] **关羽** dispatch `c883244c` — M12 Cockpit Reports tab（第 9 个 tab）：新建 pm-reports-doc parseReportsDoc（扫 reports/*.html 抽 title/date/topic，mtime 倒序）+ cockpit-doc 聚合 + ReportsTab.tsx（镜像 ResearchTab，复用 open-file endpoint）+ i18n + 测试。全 gate 绿 1131 tests + orch 复验 27+3 (`a7c0860`)。⚠️cockpit-doc server 改动 merge 后需重启 4010 才出数据
- [x] **赵云** dispatch `81b4df68` — M17 loop playbook（第 2 个）：playbook-loop 模板 seed + ORCHESTRATOR_RULES loop 段 + cockpit-doc loopPlaybookActions（保守启发式：只认带 verifier 语义的 failed/blocked，调研失败不触发，max 2）+ 测试。三 gate 绿 1121 tests + orch 复验 42/42 (`1fa7f2e`)。⚠️RULES merge 后需重启 4010
- [x] **赵云** dispatch `8e5bb22e` — 浏览器刷新 bug 根治：app.ts 缓存头（index.html no-cache / assets immutable）+ preload-recovery.ts（Vite chunk 失败自动重载）+ reconnecting-websocket.ts（tasks/terminal/cockpit WS backoff 重连）+ ActionBar 英文漏翻修正。三 gate 绿 1117 tests + orch 复验 21/21 (`3164deb`)。⚠️app.ts 改动 merge 后需重启 4010
- [x] **关羽** dispatch `23eb5cec` — idea-6 闭环：Cockpit 答 question 后自动 nudge orchestrator（answer route→store.notifyQuestionAnswered→writeQuestionAnsweredPrompt 注入 orch PTY；无 active run 优雅 no-op；真 PTY 集成测试无 mock）。三 gate 绿 1114 tests，更新 plan.md M15 (`a990f14`)。⚠️merge 后需重启 4010
- [x] **张飞** dispatch `7a86c021` — 全 app 真浏览器 UI sweep：16 PASS / 0 console error / 1 medium（派单提到 Reports tab 但实际只有 8 tab——Reports 是 M12 未建，预期内非 bug）/ 1 low（ActionBar 英文模式漏翻"查看"，已派赵云修）/ 1 未验证（Questions submit 因无 open question，待 idea-6 落地后造测试数据验）。报告 + research (`eed047e`)
- [x] **关羽** dispatch `ded4e020` — 修张飞巡检发现 #1 aria-describedby（dialog console warning 归零）+ #3 Todo Add Task Save/Cancel affordance + #4 移除 unsupported audio preload。浏览器验证 0 warning (`94dccfc`)
- [x] **赵云** dispatch `4da9662b` — M17 handoff playbook 实现：ADR draft + playbook-handoff 模板 seed + ORCHESTRATOR_RULES handoff 段 + Cockpit playbook aiAction（保守，只 cancel 行触发 max 2）+ tests，1109 tests (`d1cab8a` + `308fc0a`)
- [x] **关羽** dispatch `77f695e8` — 修 Questions parser 静默丢弃非数字 ID：`Q\d+` → `Q[\w-]+`，answer flow 支持非数字 ID，TDD 红→绿 + 浏览器验证 (`708fa0f`)
- [x] **张飞** dispatch `d969941a` — 全 app E2E 巡检：0 blocker / 2 medium / 2 low，findings 报告 + 可复用 regression smoke runbook (`4f0c1b9`)
- [x] **Orchestrator** — M17 handoff bookkeeping：Q7 挂确认归档 ADR + idea-5 记 thinking_level 缓做 + PROTOCOL.md regen (`7d29e89`) + web rebuild
- [x] **Orchestrator** — Q7 确认归档（user 答"可以的"）：M17 handoff ADR draft → 已采纳，提交。后续 4 playbook 基调定。顺手记 idea-6（答 question 自动 nudge orch）
- [x] **赵云** dispatch `e73a7988` — M17 调研+设计：paseo 5 playbook 转译 HippoTeam 设计（templates/RULES/ActionBar 着力点 + 优先级）。推荐先做 handoff。全 gate 过 (1103 tests) (`3b9a5f0` + `81fc4c9`)
- [x] **关羽** dispatch `8501d6e0` — 真浏览器 E2E 验证 Cockpit（playwright MCP）：8 tab 全渲染真数据 + Questions answer flow 真点 PASS + Ideas promote dialog 渲染 PASS + Decisions 0 draft SKIP，0 console error，报告 + research 自己 commit (`c98659b`)
- [x] **Orchestrator** — PM doc 对账（5/25）：Q4/Q2/Q5 答复归档，M12 queued / M14 confirmed / M17 promoted from idea-2，清理 tasks.md In-progress 堆积
- [x] **典韦** dispatch `d4d93723` + `5a19af15` — Cockpit 完整体检 audit + 补 4 个 tab 组件测试 + POST answer route 测试（典韦 opencode preset 写文件但没 commit，orch rescue `bca29a2`）
- [x] **关羽** dispatch `551b829d` — Phase C-2.5 wave 2：ActionBar + IdeasTab + DecisionsTab handlers + 3 个 POST endpoint (`f99b98e` + `aec2598`)
- [x] **关羽** dispatch `160e5438` — Fix UI bug：Cockpit Questions tab 回答按钮无 handler (`738c657` + `96dd211`)
- [x] **赵云** dispatch `22e7791c` — Spike + 实施：给 codex worker 装 MCP browser server (playwright)，schema v22 (`9638a92`)
- [x] **赵云** dispatch `295b7861` + `d9638cd3` — 整个团队共同维护 Cockpit/PM 文档体系（M13 Layer 1+2+3+5）+ hook 测试补全 edge case audit
- [x] **关羽** dispatch `5def6905` + `71d7fde1` — 飞书消息 emoji reaction 两阶段反馈 GLANCE→OK + debug API 失败（M7 UX 补强）
- [x] **关羽** dispatch `b8562201` + `64807571` + `7ef6ff64`(stuck→orch rescue) — paseo 调研 v1→v2→v3 三方横向对照报告
- [x] **关羽** dispatch `9e05b245` — Fix：Cockpit Research tab 时间戳只到日期没分钟 (`9167a6a`)
- [x] **典韦** dispatch `1fddae81` — VERIFICATION TASK：echo 验证 M13 Layer 1 PM_DISPATCH_REMINDER 注入成功

### 2026-05-23 ~ 24
- [x] **Orchestrator** — 重启 4010 + 浏览器刷新 + 真用 Cockpit dashboard（user 自己做的）
- [x] **关羽 + 典韦** — PM 体系 M10 全套 i18n：104 个新 i18n key (×2 locale) + 22 个组件 useI18n 化 + 17 个 i18n 测试 + CJK scan 0 命中 (`2b3e2ed` + `7be5d22`)
- [x] **关羽 + 赵云 + 典韦** — PM 体系 M9 完整性补全：Cockpit 加 Tasks/Research tab + drawer scroll fix + baseline 5 子文档真填（172+77+60+46+73 行）+ 42 个新测试 (`8837995` + `973c4f6` + `a41ae22`)
- [x] **关羽 + 赵云 + 典韦** — PM 体系 Phase C-2 Cockpit UI：5 parser + cockpit-doc aggregate + WS + HTTP endpoint + 10 React 组件 + Topbar 改造（取代 Plan/Todo 独立按钮）+ 63 个新测试 (`7d7ba26` + `b5898c6` + `34f7c0d`)
- [x] **赵云 + 典韦** — PM 体系 Phase C-3a：session-start review nudge（runtime 一次性注入 system message + 3 启动路径 + idempotent + 12 tests）(`be1d633` + `9d1467b`)
- [x] **关羽 + 赵云 + 典韦** — PM 体系 Phase C-1 文件层：4 个新文档（open-questions / ideas / baseline / archive）+ 6 节 ORCHESTRATOR_RULES + 24 个新测试 + 修 plan WS race (`82fc5a2` + `64c7236`)
- [x] **典韦** — PM 体系 Phase B 50 个新测试 (`9619d26`)
- [x] **Orchestrator** — Retrofit `.hive/plan.md` 实样（HippoTeam 10 个 milestones，M1-M6 shipped、M7 blocked、M8-M10 proposed/open）(`57df9d4`)
- [x] **典韦** — Step 2 + PM Phase A 32 个新测试（agent-launch-cache / pm-templates / ensurePmDocs / PROTOCOL.md）(`47e4d0f`)
- [x] **关羽** — Step 2 上游回灌：71fdaaf + b34cfe4 + e57c6be+7bda143 + 4c34bf6 部分 (`dbc7a1e`)
- [x] **关羽** — PM 体系 Phase A：5 个文档模板 + workspace 种子 + system prompt PM 段 (`10322f9`)
- [x] **Orchestrator** — Restructure tasks.md as GFM checkbox + biome HTML ignore + PM proposal HTML (`41dfac0`)
- [x] **关羽** + **典韦** — Step 1 上游回灌：53e3645 tasks WS hardening (`473dc46`) + a2945fe team cancel (`02abda0`) + tests (`24fc7d5`)
- [x] **关羽** — Upstream tt-a1i/hive 5/20 之后 31 个 commit 调研 + 🟢🟡🔴 分类报告
- [x] **关羽** — Rebrand Hive → HippoTeam (`539266f`)：Topbar 圆圈 H logo + favicon + HTML title + package.json @huangserva/hippoteam + README + i18n 16 处 + 移除 upstream npm update badge

### 2026-05-21（飞书桥 Plan B · 16 commit · 757 tests · 132 个 feishu 测试）
- [x] **关羽** + **典韦** — Phase 0：schema v21 + credentials loader + bindings store + RuntimeStore 接线 (`6d7bba2` + `8b5f1a9`) + 45 tests
- [x] **关羽** + **典韦** — Phase 1 inbound：feishu-transport + route-resolver + inbound-handler (`d595f6f` + `445bebd`) + 16 tests
- [x] **关羽** + **典韦** — Phase 2 outbound：team feishu reply CLI + /internal/feishu/outbound + 长消息切片 (`10815af` + `640aaaa`) + 31 tests
- [x] **关羽** — Phase 3 UI：4 个 UI-token endpoints + Topbar 飞书状态灯 + WorkspaceSettings dialog (`fd0db8e`)
- [x] **关羽** + **典韦** — Phase 4 testability refactor + tests + bug fix：parseFeishuReplyArgs/chunkFeishuText/FeishuOutboundTransport export + 38 tests + NotFoundError 404 修复 (`19819b5` / `553f896` / `a879ca6`)
- [x] **关羽** + **典韦** — Phase 5 审批卡片（Hermes 风格）：ApprovalLedger + sendApprovalCard + card.action.trigger + 双语 system prompt (`e601c38` + `1198fe8` + `4347c98` + `6fb3d45`)

### 2026-05-20（多 worker 协作前期 + multica 借鉴）
- [x] **关羽** — multica #3 后端错误消息透传 UI（12 endpoint readErrorMessage，`c223f31`）
- [x] **关羽** — multica #1 + #2 per-worker thinking_level + Add Worker picker（schema v20，`8a2295c` + `d4b64b5`）
- [x] **关羽** — multica 二轮深度调研 → 8 条具体借鉴项报告
- [x] **关羽** — 修 dev 模式 `team` 命令 PATH bug（POSIX sh wrapper 双模式）
- [x] **关羽** — 修 worker stop/restart 卡 working 的 pending bug（方案 B + stopped-only guard）
- [x] hive 旧仓库 archive 到 `~/development/hive.archived-2026-05-20`
- [x] hive-serva 全部改动 push 到 huangserva/hive（remote 改成 SSH）
- [x] **关羽** — P0 logger + 5 个 event handler 防崩
- [x] **典韦** — 全仓 event handler 未 catch 扫描 → 3 🔴 + 9 🟡
- [x] **关羽** — 调研报告（日志、12 commit、hive vs hive-serva、npm 1.3.0）
> **🟢理解层降噪+UI差距+worker状态 三线并进(2026-06-06下午)**:**✅理解层降噪Phase1 commit `7b967ec`**(用户拍板设计 reports/2026-06-06-understanding-layer-front-pm-handoff.html):服务端按workspace缓冲语音转写,1200ms窗口(可调)合并成完整意思再走一次前台,不再对碎片接话;钟馗3轮审揪出并修B1(LAN异步flush回复黑洞→补mobile-chat-message handler)+B2(flush失败静默丢用户话→各路径持久化兜)。**含手机端改=要进APK**。Phase2 distill(拎清意图交PM)未做留下一步。**✅降噪两层commit**(`a4c4114`服务端STT闸+`00adc92`App voice_prob质量门控)。**📦APK待打包**:降噪门控+理解层(都含手机端)+待用户拍6-05视觉,凑一个包。**马超UI差距分析**(reports/research `2026-06-06-voice-ui-design-vs-actual-gap`):关键洞察=逻辑层比设计稿成熟、视觉层几乎没落地,用户'不像一流助手'=视觉缺口非功能;结论不重画,P0落地6-05视觉+新画WebRTC通话UI;3个Q待用户拍(配色/先视觉还是先通话UI/默认连续对讲),PM建议6-05视觉/先视觉/默认连续对讲。**典韦worker状态核查**(research已存):本机后端状态全对非代码bug,另一台'状态不对'最可能=没e924dd6(假idle修复)版本旧→去那台git pull;附带opencode worker context满会自动退出(典韦/吕布)可开restart policy兜;markAgentStarted清pendingTaskCount低优bug仍在(workspace-store-mutations.ts:49,排队>1才暴露)。
> **📦对讲总包 2.8.3 已打包+飞书投递(2026-06-06,待真机验)**:一个包三样——降噪门控(`00adc92`)+理解层Phase1(`7b967ec`)+6-05 premium视觉(`4bceef7`,默认连续对讲)。arm64 94MB,版本2.8.2→2.8.3(`app.config.ts`+build.gradle),build-local.sh assembleRelease BUILD SUCCESSFUL,scp DMIT(hippoteam-2.8.3-voice.apk,HTTP200)+飞书发user下载链接。**待user卸旧装新真机验**:马超列5项(动画流畅/观感像不像一流/默认连续/震动手感/切换正常)+降噪噪音少没少+理解层前台等说完整再回。**理解层有1200ms窗口可能加首响延迟(HIVE_VOICE_UNDERSTANDING_WINDOW_MS可调)+降噪阈值真机看[VADQDBG]/质量门控日志数据驱动收**。worker反复停止(典韦/钟馗codex/opencode context满)周瑜哨兵+stale探测都捅出来没静默,user原始担忧'worker状态'对,值得做'卡死自动强制收尾'更狠。理解层Phase2 distill+WebRTC通话UI+延迟边出边播 排后续。
> **📦对讲6-05视觉SHIPPED 2.8.4(2026-06-06,USB adb+Chrome双向比对验证)**:user装2.8.3说视觉"搞笑跟设计稿对不上"→两轮修:① svg orb(`马超`装react-native-svg 15.15.4用RadialGradient画发光渐变球,替平涂硬边近似)② 照稿布局重排(顶部紧凑状态pill+中间发光球+球下圆点+底部大标题,删大绿卡片/退出对讲按钮/停止监听按钮/orb内文字/dB技术参数文本,停止改点球)。**✅commit `d29fd4f`**(钟馗分svg+布局两轮审0block,330测;逻辑层零改)。**视觉保真闭环建立**:Chrome headless渲染设计稿成图(/Applications/Google Chrome --headless --screenshot) + adb exec-out screencap真机(USB连着,锁屏时黑屏要user解锁) 双向并排比对——不再靠user装了才发现。2.8.4最终包scp DMIT(hippoteam-2.8.4-voice-allinone.apk)+飞书发+adb直装user机。**待user真机最终确认视觉**。**⏳提速未生效**:理解层窗口1200→500写进.env(HIVE_VOICE_UNDERSTANDING_WINDOW_MS=500)+理解层Phase1(`7b967ec`)本身,都要【user重启4010】才加载(现跑的4010是加载强前台那会儿的,之后提交的都没生效)。**连续对讲核实**:识别/打断(barge-in)真机都好,跟RTC无关(RTC是另一条真打电话路);user感觉的变化=降噪门控+理解层窗口+GLM-5.1强前台(都可调)。**worker状态**:本机后端对,另一台"做完不转idle"=worker干完没发team report+那台版本旧缺M26/M30兜底→git pull更新;markAgentStarted清零bug其实已修(典韦误报),赵云补回归测`16738f6`锁住。**待续**:理解层Phase2 distill(拎清意图交PM)、WebRTC通话UI、延迟边出边播。**worker反复停(典韦/钟馗codex/opencode context满)周瑜哨兵+stale探测兜住没静默**。
> **🟢真机USB细节收尾(2026-06-06下午,user USB连着真机2PV0224423000586)**:视觉对到稿后user继续真机测,USB+logcat+Chrome渲染数据驱动收尾。**已commit**:① `9426272`对讲右上角急停/退出角标(补6-05稿漏的退出口,马超钟馗0block,残留非阻塞:idle点✕会切PTT模式待preserveMode修)。**在修(关羽 ce4b13b1)**:② error错误态——赵云诊断(reports/research `2026-06-06-talkback-error-state-diagnosis`):talkState=error唯一入口push-to-talk failed;根因=权限/录音不稳定(startRecorderSegment每次requestRecordingPermissionsAsync,权限抖动/弹窗denied→录音失败→error卡住);修法=权限稳态化(先get不重复request)+barge-in录音失败软降级(不进error继续播)+非致命自动恢复+[TALKERRDBG]日志+preserveMode。**待修**:③ barge-in打断不灵敏——USB logcat铁证:念回时voice_prob=0.999(高)但BARGEDBG全volume-suppressed reason=neural_recent、ev=speech 534帧只1次;根因=念回回声没被AEC消掉→voice_prob顶高→neural_recent抑制把user真插话也压住;修法待精准AEC诊断(赵云原诊断被stop打断)。**待user澄清**:④ TTS配音"突然变"——念回voice是客户端选(双音色晓晓女GLM/云希男PM),问user是女男切(正常)还是同角色变(bug)。**下个APK一次装齐①②③ USB adb直装(不用user下载)**。**worker反复停(钟馗多次/赵云/典韦 codex/opencode context满)持续拖,周瑜哨兵+我cancel重派兜**。USB验证闭环:Chrome headless渲染设计稿+adb screencap真机(锁屏黑屏要user解锁)+logcat抓VAD/BARGE/权限。
> **📦对讲修复包 2.8.5 SHIPPED+飞书发(2026-06-06,user出门期间自主收尾)**:user出门拿手机走USB断,我自主把出门前三个真机问题修到包好飞书投递。**三个全修+全reviewed 0block**:① error态根治(`94aeec3`):权限稳态化(先get不重复request,弹窗抖动不再频繁)+barge-in录音失败软降级(不进error继续播)+非致命自动恢复(不卡error)+连续启动失败重试上限2次防无限假监听(钟馗B1)+preserveMode退出不切PTT+TALKERRDBG日志。② 右上角急停/退出角标(`9426272`,补6-05稿漏的退出口,复用exitTalkMode全态停止)。③ barge-in音量override(barge-in commit+版本2.8.5):根因=念回回声进mic voice_prob 0.999顶高→neural_recent抑制压住真插话;修=user插话音量(m≈-2dB)远高于回声(-35~-63dB)→absolute -12dB/relative baseline+22dB触发,echo baseline跟踪+清理,BARGEDBG日志供真机调;残留(钟馗标)=真机回声若达-13dB+baseline-35可能relative误触发,USB日志盯自触发再收紧。**2.8.5 arm64 96MB scp DMIT(hippoteam-2.8.5-voice-fixes.apk)+飞书发user**,user回来卸旧装新测三样。**待user回来**:① 测2.8.5三修 ② barge-in阈值真机USB[BARGEDBG] m/baseline/delta精调 ③ TTS配音"突然变"待澄清(双音色晓晓女GLM/云希男PM正常 vs 同角色变bug)。**待续(中长期)**:AEC根治回声(barge-in中期,要动native音频路径,比音量override大)、理解层Phase2 distill、WebRTC通话UI、延迟边出边播。**worker反复停(钟馗/赵云/典韦 codex/opencode context满)全程持续,我cancel重派+周瑜哨兵兜住没漏活**。USB验证闭环(Chrome渲染稿+adb screencap+logcat抓VAD/BARGE/权限)是这程真机数据驱动收尾的关键。
