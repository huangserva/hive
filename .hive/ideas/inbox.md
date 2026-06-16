# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

### 2026-06-16 worker compact 卡死自愈 + "卡死 vs 慢"判定 — 一次会话内实测三连暴露 → ✅ **promoted（user 2026-06-16 拍板"立，要解决"）→ M45**

- **idea-18 worker compact-recovery 看门狗（L1 机制）**：2026-06-16 首个 PM 编排 / GLM 执行的真任务（andy 跑 code-review-3x 审 agent-manager.ts，详见 `reports/2026-06-16-agent-manager-audit-code-review-3x.html`）+ 随后的 4 修复 sprint 中，**同一问题在一次会话里炸了三次**，逼出完整设计要点：
  - **【新发现 A·恢复手段】team send 往 stdin 灌文字叫不醒 compact 卡死的 worker**：实测马超卡死后 team send 注入无反应（之前 andy 能活是 user 在终端手动敲了回车）。→ 看门狗的恢复动作必须是**真重启 worker 或给 PTY 发真实按键/中断**，不能只注入系统消息。
  - **【新发现 B·判定信号】状态机/pty 分不清"卡死"还是"慢"**：马超 compact 后 pty 显示 working + 静态边框，与真卡死签名一样；其实它只是慢、没死。**可靠的进展信号是文件 mtime / git diff，不是状态机三态或 pty 行**。
  - **【新发现 C·误判的代价】误判"卡死"去重派，导致重复劳动 + 覆盖过审代码**：我以为马超卡死，把 #3 改派关羽；其实马超在慢慢跑，两人各实现一遍 #3，**后完成的马超用定点编辑覆盖了关羽已过审的版本**（靠 mtime 查出真相 + 补审才发现，补审还多抓出一个真泄漏 bug）。→ 在把"卡死"任务改派别处前，必须**先确定性确认原 worker 已停（或先杀掉它）**，否则并发重复 + 覆盖。
  - 原始摩擦（回传链断）：Workflow 工具后台启动 + 完成回叫；agent 启动后自身 compact → 不知道有后台工作流等回叫 → idle 不 report，dispatch 顶 report_overdue 挂着，产物其实已在 `subagents/workflows/wf_*/journal.jsonl`。
  - **本质**：worker 长跑 + 自身 compact + report_overdue 三者叠加；compact 重置上下文后 agent 丢了"我有未完成派单"的线，PM 端只看到 report_overdue（[[idea-14]] 假阳性又一例），分不清真卡死 / 慢 / 产物没回传。

- **idea-18 原始记录（2026-06-16 首次，保留）**：
  - **现象**：Claude Code 的 Workflow 工具是"后台启动 + 完成后回叫"的。andy 调 Workflow 启动工作流后，**自身上下文正好触发 compact**，会话断 8 分钟没被回叫、没自动 `team report`，dispatch 一直顶着 `report_overdue` 挂着，靠 user 手动提醒 andy 才补报。工作流本体其实在后台已正常跑完（4 agent / 262s），产物可从 `subagents/workflows/wf_*/journal.jsonl` 直接捞——**结果没丢，只是回传链断了**。
  - **本质**：workflow agent 长跑 + 自身 compact + report_overdue 三者叠加。compact 重置上下文后，agent 不知道"我有个后台工作流等回叫"，于是停在 idle。PM 这端只看到 report_overdue（[[idea-14]] 的假阳性又一例），分不清"真卡死"还是"产物在后台没回传"。
  - **方向（待评估 L1）**：①workflow agent 派单时在 prompt 里硬约定"Workflow 完成后必须 team report 产物"，并在 compact 摘要里保留"有未回传的后台工作流"指针；②或 runtime 侧探测 `subagents/workflows/wf_*/journal.jsonl` 出现 `result` 但 dispatch 未 report → 自动把产物捞回灌 orch（兜底，治本）；③overdue 对 workflow_allowed agent 放宽（同 idea-14 按 preset 区分阈值）。
  - **关联**：[[idea-14]]（overdue 假阳性）、[[idea-13]]（worker 崩/中断 WIP 自动保全，同源"产物在但没人收"）、idea-17（claude-workflow worker 本体）、[[feedback_worker_reliability_systemic]]（系统兜住不手捞）。promote 前 scoping：回传保障放 prompt（L2）还是 runtime 捞底（L1）。

### 2026-06-15 专属 `claude-workflow` worker — 把"Claude Code 进程内多 agent workflow"当黑盒 worker 编排（user 拍板"很重要，按你意思推"）→ 🔬 立项中（ADR draft 已起，Phase 1 派单实现）

- **idea-17 workflow worker（黑盒 workflow 运行器）**：源自 user 分享的 fireworks-design 跨窗口跑 GLM-5.2 设计（Opus 指挥 + 多 GLM 乐手）。PM 评估后给出**更优切法**：不要把 fireworks 的 40 个进程内子 agent 拆成 HippoTeam 跨窗口 dispatch（高风险移植），而是**新增一类 worker**——它本身就是一个跑自己内部 workflow 的 Claude Code，对 HippoTeam 是黑盒：PM 派一个高层任务 → 它内部用内置 subagent/Task 跑完整条多 agent 流水 → `team report` 回产物。HippoTeam 在 **workflow 粒度**编排，fireworks 内部编排原样不动。
- **关键设计点（动了红线）**：现 WORKER_RULES 明令"不要启动内置 subagent"（`role-templates.ts:18` + `hive-team-guidance.ts:50`）。workflow worker 的全部价值就是用内置 subagent——必须**显式豁免**这一类 role。
- **配套 3 件**：① 可观测性 tradeoff：40 个 agent 在一个 PTY 里，HippoTeam 只见 1 个 worker（黑盒），要看内部进度得 workflow 自己吐。② 长跑容忍：40-agent 流水是 10+ 分钟级，会顶着 `report_overdue` 跑 → 撞 [[idea-14]]（overdue 假阳性），workflow preset 要放宽阈值。③ 并行预算 + 模型分配：每个 workflow worker 很重，per-window env 配 Opus（质量）或 GLM（省钱杀延迟）。
- **机制扎实**：Claude Code 指 GLM 用 `ANTHROPIC_BASE_URL=open.bigmodel.cn/api/anthropic` + `ANTHROPIC_AUTH_TOKEN`（GLM key，复用 repo .env `GLM_API_KEY`）+ `ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2` 等；`BuiltinRoleTemplateDefinition.defaultEnv` 正好承载。per-PTY env 隔离天生适配"一地址一进程"。
- **分期**：Phase 1=preset/role 脚手架 + 守则豁免（不需真 GLM 调用）；Phase 2=配 GLM 凭据/模型名真起一个 workflow worker，丢真任务量【质量 / 延迟 / tool-use 成功率】三个数；Phase 3=按数据决定铺几个、Opus/GLM 怎么配 + overdue 放宽。
- **关联**：[[idea-14]]（长任务 overdue）、M11（preset/role catalog 体系，本 idea 是其扩展）、fireworks-design 跨窗口设计（user 提供的图）。ADR draft `decisions/draft-2026-06-15-claude-workflow-worker.md`。

### 2026-06-13 借鉴 Rive 协议强点：dispatch 从「字符串汇报」升级到「evidence + accept gate」— PM 从 Rive 对比调研提炼 → 🔬 **#2+#3 promoted M43**（user 2026-06-13 拍板先做 accept gate + 显式 reviewer/verdict；#1 evidence 顺带、#4-6 defer）

- **idea-16 协议硬化（吸收 Rive 协议内核）**：源自 `.hive/reports/2026-06-05-rive-vs-hive-serva.html` 对比调研。Rive 是跟 HippoTeam 哲学最像的"兄弟"（同为 local-first 多 agent runtime + dispatch ledger + git worktree），但**把协作语义定义得更硬**。⚠️ caveat：当时只核了 Rive 公开 docs/README，**未验证它是否真落地**——"Rive 强"=概念定义强，不是产品成熟度强（HippoTeam 反而已产品化真在跑）。借鉴**吸收不迁移**，且全程保留 HippoTeam 的 human PM control plane（Rive 偏自动调度，我们保留 user 拍板）。
  - **Rive 比我们硬的 5 个语义**：①report done ≠ task done（必须 explicit **accept**，typed gate）②task node 与 dispatch attempt 分离（**Work DAG** 投影）③report/review 引用 **evidence/snapshot/ref**（不只自然语言）④worker 改文件进独立 worktree + **integrate/reject/ref 状态机** ⑤成功 workflow 存成不可变 **DAG + node prompt + output contract + capability policy** 模板。
  - **6 步借鉴路线**：1) dispatch artifacts → evidence bundle（path 存在性/hash/manifest/diff·test·terminal refs）2) reviewable/accepted gate（先只高风险代码 dispatch）3) M34 兜底上加显式 reviewer assignment + accepted verdict 4) 给 M32 worktree gate 补 workspace_ref/integrate/reject/abort 协议 5) Work DAG MVP（task node 与 dispatch attempt 分离）6) reusable workflow template + DAG scheduler。
  - **现成吸收点**（不用推倒重来）：直接接在在途的 **M32（worker worktree）+ M34（未审代码兜底）+ dispatch ledger** 上；已有 `team report --artifact` / `messages.artifacts` / `dispatches.artifacts` / `HIVE_WORKER_WORKTREES` gate / stale-dispatch push 作为升级地基。
  - **勘误存档**：旧结论"hive-serva 没有 worktree/evidence/review 兜底"是错的——已有入口+兜底，真实差异是 artifact 仍是字符串、worktree 仍是隔离层、未审仍是启发式（Rive 把这些做成强事实投影）。
  - **promote 条件**：user 拍是否立 milestone（建议拆 Phase：先 1+2 evidence bundle + 高风险 accept gate，价值最高、改动可控）；排在视频 4G + 现有在途 milestone 之后。关联 [[idea-8]]（远程可诊断性 M33，evidence 与 doctor/证据链同源）、M32、M34。

### 2026-06-10 app 内视频传输 + 内置播放 + 缩放 — user 手机端口述立项 → ✅ **promoted M41**（2026-06-12，PM 补里程碑；Phase 1/1.5 shipped，Phase 2 媒体走 relay 待 4010 重启+4G 真机验）

- **idea-15 app 视频收发 + 内置可缩放播放器**：user 手机语音口述、明确要求**立项**。现状=文件传输双向已通，但**视频不能在 app 内播放**。诉求三段：①能把视频传给 app（上行，复用现有文件 upload）②app 接收并在**内置播放器**里播（下行 + player）③播放时能**放大缩小**（双指 pinch-zoom）。
- **✅ PM scoping（2026-06-10，已查实代码）**——比预想小，缺口集中在播放器：
  - **上行**：`POST /api/mobile/workspaces/:id/upload`（routes-mobile.ts:1019）mime 无关、**50MB 限制**、存 `~/.config/hive/uploads/` 返 `/api/mobile/uploads/<id>` URL 并塞进 chat `media` 字段。→ **视频 ≤50MB 今天就能传**，无需新管线。
  - **缩放**：`ImagePreviewModal.tsx` 已有完整 pinch-zoom/pan（`image-preview-gesture`）→ 视频缩放**复用同一手势容器**，不用从零做。
  - **唯一真缺口 = 视频播放器**：`chat-media.ts` 解析 media，但渲染只有 `Image`（ImagePreviewModal），无 Video 组件 → 需按 mime `video/*` 分流到播放器。
  - **编码兼容低风险**：H.264 硬解 = AOSP/硬件能力，与华为无 GMS（谷歌服务）无关；ExoPlayer 原生支持 H.264/HEVC。推荐 H.264 主、HEVC 尽力。
  - **播放器选型**：推荐 **expo-video**（Expo 现行推荐，替代旧 expo-av；纯原生 ExoPlayer 无 GMS 依赖）。
- **方案分期**：
  - **Phase 1（快，先 ship）**：chat media 按 `video/*` 分流 → expo-video 播放器套进可缩放 modal（复用 ImagePreviewModal 手势）。覆盖核心诉求：传视频(已通)+app 内播+双指缩放。约束=单文件 ≤100MB（user 2026-06-10 拍板，含服务端 upload 限制 50MB→100MB；base64 膨胀 limitBytes≥140MB）。**派单已拆两小单并行（关羽崩/马超 wedged 后周瑜建议降 context 压力）：服务端 50→100MB → 赵云 `1cfcd0b2`；移动端 expo-video 播放器+缩放 → 关羽 `6ceb7e83`**。
  - **Phase 2**：大视频分片上传 + 抬限制 +（可选）服务端首帧缩略图；评估 relay/4G 大文件带宽与超时。
  - **⚠️ device-verify 必查（赵云 flag）**：100MB 上传走 4G/relay 时，可能被**部署侧 body 限制**卡住——relay nginx 若无 `client_max_body_size`（默认 1MB）会 413（若上传走 nginx HTTP 代理而非 relay WS 帧隧道）；或撞 relay server/daemon 的 WS 单帧/单消息大小上限。张飞真机发大视频时重点验这条，失败则按"上传路径=nginx 代理 还是 relay WS 帧"分别修（加 client_max_body_size / 抬 WS 帧上限）。
- **✅ 2026-06-11 Phase 1 SHIPPED + 真机验**：代码 push origin/main、APK 2.8.15 装机、PM adb 全链路 device-verify 通过（详见 tasks.md narrative）。
- **⚠️ 发现下行发送缺口（idea-15 立项原话"你也可以传视频给 app 上去播放"未落地）**：Phase 1 只建了 **app 渲染 + 上行（user→app 选发）+ 播放**，**没建"PM/orchestrator 主动发视频给 app"的发送通道**——`team mobile-reply` 只发 text、无媒体 CLI/endpoint，出站插入全是 `{text}`。2026-06-11 user 手机要"你直接发个视频给我看看"，PM 只能从后台手动 sqlite 插一条 outbound media 消息（`f8c12c11` pm-demo.mp4）+ adb 强制 app re-fetch 才显示（raw 插入不触发 app.ts:218 relayConnector.pushEvent 实时推）。渲染端 OK（index.tsx outbound 也走 MediaContent，验证可播）。**✅ Phase 1.5 SHIPPED 2026-06-12（`f393997`）**：新 `team mobile-send-media --file <path> [--text]` 命令 + `POST /api/team/mobile-send-media` 端点 —— 文件 copy 进 uploads + `store.insertMobileChatMessage`(outbound media) **走 store wrapper 自动触发 mobileChatWatchCallbacks → app.ts:218 relayConnector.pushEvent 实时推**(不用刷新；user 手 SQL 没 push 是绕过了 store wrapper 这层)。支持视频+图片(mime 按扩展名推断)。6 真集成测试 + 钟馗审 0 blocking。**4010 重启后真机发视频+图片验过**。注：这是 PM scoping 把立项"你也可以传视频给 app"的下行发送端漏成 Phase1.5 的教训——立项时方向词("下行")歧义没跟 user 对清。
- **🔴 2026-06-12 真机暴露架构 gap：视频/图片在 4G 下放不了(只 LAN 能播)**：user 4G 上收到视频卡(下行 push 经 relay 成功)但点播放 `00:00/00:00` 全黑。根因=`packages/mobile/app/(tabs)/index.tsx:1374 resolveMediaUrl` 把媒体 URL 直接拼 `runtimeHost` 做 **HTTP GET 取字节**,这条直连只在 LAN 通;4G 走 relay,而 **relay-rpc-handler 没有任何 serve 媒体下载的方法**(只有 `workspace.upload` 上传 + 控制方法,无 media.get)。所以 4G 取不到字节。**影响范围=整个视频/图片显示在 4G 下都不工作**(不只下行,user 自己上传的也一样),Phase1 的 device-verify(2026-06-11)在**局域网**做的,漏了这条——**教训:device-verify 必须覆盖 user 真实场景的 4G/relay 路径,不能只 LAN**(同 [[feedback_verify_real_artifact_not_proxy_metric]])。**真修法(大活,待 user 拍)**:relay-rpc 加媒体下载方法(fileId→分块 base64 over E2E relay WS,54MB 要 chunk;app 在 relay 模式下经 relay transport 取媒体而非直连 HTTP)。即时 workaround:连同 WiFi 局域网就能播。

### 2026-06-10 dispatch 超期阈值对长任务过紧 = overdue 假阳性"狼来了" — 周瑜巡检发现

- **idea-14 dispatch long-task 阈值 / 预期时长标记**：周瑜巡检观察，今天 amy 的两单视频生产任务（`af9f281b`、`c8170214`，memos 出片）**全程都顶着 report_overdue 跑完**——`c8170214` 派出仅 ~6 分钟就被标超期。视频渲染/出片本就是 10+ 分钟级长任务，当前统一 overdue 阈值对这类明显过紧，**每单必假阳性**。
- **风险**：长期下去把 overdue 信号训练成"狼来了"——真异常（worker 卡死/crash）的红条被淹没在常态误报里，PM/user 学会无视，反而漏掉真卡死（与 [[feedback_worker_reliability_systemic]] 要的"系统兜住真异常"背道而驰）。
- **方向（待评估 L1）**：①给 `team send` 加可选 `--expected-duration` / `--long-task` 标记，dispatch 携带后 overdue 计时按标记放宽；②或按 worker preset 区分默认阈值（视频/渲染类 preset 天然长）；③overdue 只在"超过该单自己的预期 + 无语义进展"时才亮（结合 idea-8 completion evidence 的 last 进展时间，已有产物持续更新就不算超期）。
- **关联**：M30 stale-dispatch / 本轮 L1 report_overdue（阈值持有方）、idea-8（completion evidence 可作"真进展"判据）、[[feedback_worker_reliability_systemic]]。promote 前 scoping：阈值来源（per-dispatch 标记 vs per-preset）+ 是否复用 idea-8 进展时间做兜底判据。

### 2026-06-10 worker crash 中途死、report 前 orphaned 的系统性兜底 — PM 巡检发现

- **idea-13 worker crash WIP 自动保全 + 可见**：2026-06-10 同一修红测试链上赵云、关羽两个 codex worker 先后 `status=error` 异常退出（非任务边界、report 前 crash），各自把 14→5、5→0 的修复 WIP 留在工作树没 report 就死，靠 PM 手动跑全量验证才收口。这不是任务难度问题，是 worker 运行时崩溃（疑 codex context 耗尽或 CLI crash，JS 层拦不住）。
- **现状基础**：M30 stale-dispatch + 本轮 L1 report_overdue 已能把"有产出未 report"标红进 Cockpit；但 **crash 后的 WIP 既没自动验证也没明确告诉 user"这堆改动没人收"**，全靠 PM 在场手捞。
- **方向（待评估 L1）**：①worker run `status=error` 退出时，若工作树有该 dispatch 相关 diff，自动把 dispatch 转 report_overdue 并在 Cockpit 高亮"crash 遗留 WIP 待 PM 收口"；②可选自动跑一次 targeted 验证给 PM 参考；③关联 idea-8 completion evidence（last 语义进展时间）判断 crash 前进度；④**orphaned-but-done 人工关闭**：活儿被 PM 验证收口后，orphaned 终态单应能被显式标记"已人工确认关闭"，免得在巡检/Cockpit 反复当悬案（6e19307b 实例：cancel 返 409 因 orphaned 非 open，当前只能靠 narrative 注明）。
- **2026-06-10 夜补充（idea-15 视频功能批次踩到）**：codex worker"首次注入 dispatch 即崩"反复发作——关羽(`8455ce08`)、钟馗(`7d6eda13`)启动即崩，重启/恢复后第二次才成功；疑 worker 坐在 "Press enter to continue" 待输入态时被 dispatch 注入冲突。⑤**reviewer preset 必须纳入兜底**：钟馗(唯一 codex reviewer)崩掉**直接断审查链**，本次靠临时改派 马超(claude，跨 provider 仍独立)补审才没卡死，但若无空闲 claude 就彻底阻塞 ship。兜底应覆盖 reviewer 崩溃 → 自动提示 PM 改派替代独立 reviewer 或 [Restart]。⑥codex 崩"首次注入即崩"若可复现，考虑 dispatch 注入前先探测 worker 是否处于待输入态、或注入前发一个 no-op 唤醒。
- **2026-06-11 新增·独立根因（user 跨机调研定位，区别于上面的 codex inject 崩）**：**Hive tasks watcher 递归监听 `.hive/reports/**`（及 ideas/research/baseline/decisions/archive 的 `/**`）把二进制资产/视频帧海一起 watch → fd 耗尽 ENFILE → node-pty 分不到正常 TTY → worker 启动 ~2s exit 1**。`src/server/tasks-file-watcher.ts:89-101` 实证有 6 个 `/**` glob。在 serva 机（CatVacuumGame，amy 把逐帧 jpg 塞进 reports/assets）已复现并修；**hive-serva repo 此修复未同步**（无 commit、test 缺）。修法=watch 路径收窄成 `reports/*.html`、`reports/*.md`，其余目录 `**/*.md`，加 `tests/unit/tasks-file-watcher.test.ts` 锁死不再出现 `reports/**`/不 watch assets。⚠️**注意区分**：本机(macOS fsevents、reports/assets 空、fd=75 健康)当前未爆 ENFILE，本 session 的 worker 崩(崩一次重试就成)更像 codex inject race 非 fd 耗尽——两根因别合并。但递归 watch 是真潜伏雷，平台差异(Linux inotify 一文件一 watch)下会爆，应修。
- **关联**：[[feedback_worker_reliability_systemic]]（要系统兜住不手捞）、idea-8、[[feedback_no_self_review_claude_code]]（reviewer 崩时跨 provider 改派要保持独立性）。promote 前 scoping：agent_runs status=error 事件钩子 → dispatch 状态联动 → Cockpit 可见。

### 2026-06-07 app 内可调通话音量（设置页）— user 真机反复要求

- **idea-12 通话音量 app 内自调**：user 12h 真机马拉松反复卡在音量，原话"希望这个声音在设置页里面可以去调整，而不是每次重新安装/重启"。现状=下行音量靠服务端 env `HIVE_WEBRTC_DOWNLINK_GAIN`(改要重启 4010)；手机通话音量其实硬件(音量键/免提路由)主导，软件增益叠加感知有限。
- **方向**：设置页加通话音量控制(滑块/档位)，即时生效、持久化、不重启不重装。已派马超调研(`df411be1`)两条路：A 客户端直接调 react-native-webrtc 远端 track 播放音量(最干净，待证 API 支持)；B 设置存偏好→经 voice_stream/relay 传 daemon→当 per-call downlinkGain(需服务端配合关羽改 webrtc-downlink-audio gain 来源)。
- **promote 条件**：马超方案 report 回 → PM 拍路径 → 排实现(下个 APK 批次)。这是结束"音量靠重启折腾"的结构性解法。

### 2026-06-06 WebRTC 通话流式 ASR + early-response — user 实测口述

- **idea-10 流式 STT + 边收边算架构**：user 在 WebRTC 通话实测中指出，当前"等静音→攒完→STT→AI→TTS"链路导致 5-6s 延迟，根本原因是客户端攒完再传。user 正确方向：
  - 服务端实时收 10ms PCM 帧 → 流式 ASR 边收边出局部文字 → 理解语义后**立即**触发 AI
  - 不等用户停顿，检测到"意图完整"即响应（intent-complete 而非 silence-boundary）
  - AI streaming 回复 + streaming TTS 同步推下行 → 端到端延迟可降到 ~1-2s
  - 技术路径：streaming Whisper（whisper.cpp server-sent events）或 cloud streaming ASR（Google/Azure），配合 LLM streaming + edge-tts streaming
  - **rolling session transcript**：流式 ASR 副产品——每次 utterance 的 partial transcript 自动 append 到 session-level rolling transcript；AI 处理新 utterance 时把历史 transcript 直接带上，上下文完整、无重复音频处理；同时解决现有"每次 VAD 触发无记忆"问题（当前 AI 只拿当次 utterance，历史靠 chat history 文字还原，数据源不统一）。2026-06-06 user 口述补充。
  - **当前差距**：audioSink 在 webrtc-upstream-audio.ts 等 VAD 静音后整段 inject；改成流式需重构 STT 接入层
  - promote 条件：当前 WebRTC 通话体验稳定后（M38 收尾）进入 backlog 评估

### 2026-06-03 GLM↔orchestrator 双 agent 连续协作环 — user 语音口述（M36 衍生）

- **idea-9 双 agent 分工协作环**：user 在 M36 连续对讲实测中口述（两次描述方向一致）。当前两套机制：①GLM 快嘴（知情前台,只读,~2-3s）②orchestrator（OFH,管 worker 的重活执行者,~28s）。user 设想让二者**显式协作成连续闭环**：
  - GLM 先接所有语音 → 能直接答的简单问题（user 估 70-80%:进度/worker 状态/上下文澄清）**当场答掉**；
  - 判断复杂/需派 worker/办不了的 → **转交 orchestrator**（GLM 不自下指令,只移交）；
  - orchestrator 后台处理完 → 结果**回流给 GLM**,由 GLM 整理成口语再念给 user；
  - user 体感 = 一个**连续对话过程**,而非"GLM 应付一句 + orch 半天后另起一句"两个割裂的声音。
  - **本质**:GLM = 对话前台（低延迟/有人味/负责所有 user 交互口径）,orchestrator = 后台执行引擎（结果不直接面向 user,经 GLM 转述）。把"两个声音"收敛成"一个前台 + 一个隐形后厨"。
  - 现状差距:当前 GLM 与 orch **并行各自投递**,没有"orch 结果回流给 GLM 二次整理"的环。促成此环 = 让 user 只跟 GLM 一个"人"说话。
  - 关联:依赖 GLM 知情前台先真能用（本 session 修 GLM 5s 超时后验证）；应纳入 M36 ADR。promote 前 scoping:orch→GLM 结果回流的触发与注入机制（orch 完成事件 → 喂 GLM 二次润色 → 念回）。

### 2026-06-01 双竞品三角合成：远程可诊断性 + provider 证据 → ✅ **promoted M33**（user 2026-06-01 经手机 Cockpit 提升为正式 milestone）

- **idea-8 远程可诊断性 = HippoTeam 远控产品的签名缺口**：拿两个哲学相反的竞品（OpenTeams 重控制云引擎 / CCB 单机深 runtime）三角定位 HippoTeam，**两家独立指向的同一批缺口 = 高置信度真缺口**。其中最该补的是「远程可诊断性」——我们是三方里唯一"远程优先"，却最缺"user 在手机上看底层证据"的能力。
  - 双重印证：OpenTeams=全 SQLite 事件流可回放可审计；CCB=`doctor`+`support bundle`+**completion evidence**（语义进展标记，不靠"pane 安静了"）。
  - **关键洞察（拆"假矛盾"）**：OpenTeams 报告说我们 liveness 已领先（卡死**探测** never-silent，成立）；CCB 报告说 completion evidence 是真差距（桶A）。两者不矛盾——我们**探测**卡死强（4/8/15/30min 分档+哨兵+自愈），但**解释不了"一个活着的 agent 此刻在干嘛"**（last tool / 语义进展 / 真挂还是在跑）。**探测 ≠ 可解释性。** 对远程 PM，"为什么还在 working"的证据是签名级需求，且直击本 session 的 worker 可靠性痛点。
  - 现状基础（不是从零）：已在 M25 line 251 标为"可单列 M25b：hive doctor / support bundle"。本 idea = 把它**升格为独立 milestone**（见 plan M32 候选），因为现在两家竞品独立双重印证。
  - promote 时拆三块（参考 CCB 报告 A2/A4）：①只读 `hive doctor --json`（runtime instance / schema_version / agents status+pending / dispatches open / relay+mobile+feishu status / PM docs orphan）②`hive doctor --bundle` 导出诊断包（排 secrets）③**provider activity evidence**（采 provider hook/session log 的 last 语义进展时间/last tool/last assistant chunk，手机+Cockpit 显示"working, last progress 8m ago, evidence: tool_call/test"，**不改三态、不自动 kill，只触发 ActionBar"可能需 PM 查看"**）。
  - 配套已落地：worktree 隔离（两家都指）已 ADR `2026-06-01-worker-code-worktree-shared-hive.md`+派实现；provider managed home 已是 M25 在推进。报告依据：`.hive/reports/2026-06-01-openteams-vs-hippoteam.html` + `2026-05-30-ccb-vs-hippoteam-comparison.html`。

### 2026-05-31 错误账本（错误归类 + 复犯追踪 = 自我优化源）— user 提

- **idea-7 错误/教训账本**：把开发中的错误（user 指出的 + 团队自己发现的）系统化**储存 + 归类 + 追踪是否重复犯**，作为团队不停自我优化迭代的源泉。
  - user 原话：错误是我们进步的源泉，最好有个地方把这些错误存起来并归类，再看会不会重复犯同样的错误；慢慢看它怎么变成我们的 plan 和 task。
  - 现状基础（不是从零）：已有零散的 `.claude` memory `feedback_*.md`（如 verify_real_artifact / worker_reliability_systemic / review_and_device_verify_before_ship）+ `decisions/` ADR，但**没有"错误"专门视角的统一归类 + 复犯检测 + Cockpit 可见**。
  - promote 时想清楚：① 存哪（Cockpit 新「教训/错误」tab？/ `.hive/lessons/`？/ 复用 decisions？）② 归类维度（类型=误判/流程缺失/模型弱/沟通漏；谁发现=user vs 团队自己；严重度）③ **复犯检测**（新错跟历史错相似度比对，犯过的高亮"又来了"）④ 怎么自动从"错误"长成 plan/task。
  - 本 session 现成首批素材（可直接录入）：GMS 误判 QR（被 user 一句"相机扫能用"戳穿）、codex dedup 修 3 次没对（=模型弱→M31）、#21 跳过审查直接出包结果带 bug、删旧 APK 让已发链接失效、误称"张飞真机验"其实它没手机。
  - **6/01 续录素材**（类型标注，供未来归类参考）：
    - ［误判/liveness］外部竞品分析说 HippoTeam"卡死无人知"，根因是**我们文档没写清**（CLAUDE.md 状态机行单写"无心跳"被误读成"无 liveness 探测"）→ 已修文档。教训=文档歧义会被外部当事实，单写"无 X"要补"但有 Y 兜底"。
    - ［流程/PM 操作］派单 prompt 用双引号包、内含反引号 `` `git worktree add` `` → 被 shell 当**命令替换**执行污染 prompt（worker 收到 git usage 报错）。教训=team send 含代码/反引号一律用**单引号**包。已 cancel 重发。
    - ［测试盲区/模型，钟馗抓］马超 M32 第一版 8 测全绿却漏 4 真 blocker——**测试只验 `git diff HEAD` 干净，从没测 `git add -A`**，而 add-all 才会暴露 symlink-over-tracked-dir 污染。教训=**测试绿≠对**；高风险改动要测"对抗场景/真实工作流命令"，钟馗靠**亲手复现**而非读测试才抓到。这条是"复犯检测"的好样本（M28 #21 也是"跳过/弱审查→带 bug"同类）。
    - ［正面样本/根因思维］马超 M32 返工没只按钟馗说的改表象，而是**做三组对照实验**证 symlink 方案本质有缺陷，从根上换 env 方案。教训=账本不只存错误，也存"修根因不修表象"的正面范式。
    - ★★★★★［本 session 最痛，调试方法论级］**手机发不出消息，我误判+瞎重启服务端浪费 1 小时+，最后靠 user 诊断面板一眼定位**。3 个不同真 bug 叠一起（relay RPC 永挂[2.3.2]/relay 半开僵尸[4G]/LAN 发送卡 relay 门槛[WiFi]），我没逐个隔离就连环猜：先冤枉赵云工作区切换→再说 relay 僵尸要重启 4010→4010 重启没用→再重启 DMIT relay 服务器→还没用。**真凶**=`shouldQueuePromptBeforeSend` 无条件卡 `!relayTransportReady` 不分 connectionMode，LAN 模式发送被永久 queue（`ddbd73e` 2.3.3 修）。**血泪教训**：①**根因没确认前绝不动手修/重启**——我盲目重启服务端 1h+ 全程服务端是好的；②**"能收发不出"这种不对称是强线索**——收/发走不同代码路（收=LAN GET 轮询正常，发=被 relay 门槛拦），该一眼想到去比对两条路而非猜连接层；③**诊断面板才是终结猜谜的关键**（[[reference_relay_two_components_topology]] 之外，memory 早记"诊断面板是终结猜谜的关键"，我这次又忘了第一时间要、宁可瞎猜）——以后 mobile 连接类问题第一句就是"发诊断面板截图"；④多 bug 叠加时**逐个隔离复现**，别把症状揉成一个猜。关联 [[feedback_verify_real_artifact_not_proxy_metric]]、[[reference_relay_two_components_topology]]。
    - ★★★★［最严重，砸到 user］**2.3.1 发消息彻底坏、app 不可用、user 暴怒**——三重错叠加：①［跳过验证］user 催"现在就修打包"，我**跳过真机/端到端冒烟测**就出包；钟馗审过代码逻辑+单测绿，但**没人验"能不能发出一条消息"这条命脉**→第三次"审过/测试绿但生产坏"，且这次直接砸到 user（前两次钟馗出包前抓到）。②［误判归因］send break 后我看"工作区切换"最显眼**没核对就先指赵云的 diff**；马超逐字节核对证明赵云没碰发送路径，真因是 **relay RPC 无超时（M27 起潜伏）被前台重连探针在半死 socket 上引爆**（4G/切后台 socket readyState=1 但对端没了不回不 onclose→promise 永不 settle→发送/重连/outbox 全冻）。③［假称真机验］我多次说"张飞真机验"但**张飞是 codex 没手机**，根本验不了。**治本**：(a) 核心路径（发消息/连接）出包前必须有**穿透真链路或复现真实失败模式的测试**（如本次半死 socket 复现测试），审代码+单测≠运行时验证；(b) 归因先逐字节核对别指最显眼的改动；(c) 不假称"真机验"，张飞验不了就老实说"只有 user 能最终验"。修复=relay-transport 加 15s 超时自愈（`25f6b89`，钟馗审+15 测绿，出 2.3.2）。关联 [[feedback_review_and_device_verify_before_ship]]、[[feedback_verify_real_artifact_not_proxy_metric]]。
    - ★★★［模式级，最值钱］**"测试绿但生产死" 一个 session 复发两次**：①M32 worktree——8 测全绿但只验 `git diff HEAD`、从没测 `git add -A`，真实工作流命令才暴露 .hive 污染；②M34 未审兜底——13 测全绿但手造带 commandPresetId 的假 worker，没穿透真实 `RuntimeStore.listWorkers`(它根本不返回该字段)→ 整个兜底生产里恒不触发、形同虚设。**共性根因=claude 实现倾向"测纯函数/手造 fixture"，不测"穿透真 store/真工作流命令"的边界**；两次都靠 codex 钟馗**复现式审查**(亲手跑 add-A / 钉死 listWorkers 字段)才抓出，单测自己测不到。**治本=高风险/有生产边界的功能必须有穿透真 store/真 HTTP/真命令的集成测试(AGENTS §9)+codex 对抗审**；M34 返工已示范(新 `unreviewed-code-backstop-integration.test.ts` 断言"raw listWorkers 无字段但 resolveCommandPresetId 有"，写回旧 bug 立即红)。这条比任何单个 bug 都该进账本——它是**类**不是**例**。关联 [[feedback_no_self_review_claude_code]]、[[feedback_review_and_device_verify_before_ship]]。

### 2026-05-24 paseo 调研产出 4 条候选借鉴

### 2026-05-25 张飞全 app 巡检发现

- **idea-5 已存在 worker 改 thinking_level** → **shipped M20**（`575e003`，5/26）
  - WorkerSettingsDialog 支持编辑 name / description / thinking_level / command_preset / sentinel interval

## promoted / shipped

- **idea-6 Cockpit 答 question 后自动 nudge orchestrator** → **shipped `a990f14`**（5/25）
  - answer route → store.notifyQuestionAnswered → writeQuestionAnsweredPrompt 注入 orch PTY；无 active run 优雅 no-op；真 PTY 集成测试。闭合了 user 体感的"答了没反应"半截循环。

- **idea-2 paseo skills playbook 系统借鉴** → **M17**（user 拍板 5/25）
  - handoff / advisor / committee / epic / loop 5 个 playbook，转译成 `.hive/templates/*` + ORCHESTRATOR_RULES + Cockpit ActionBar 建议
  - 独立可做、不依赖 mobile/voice 决策；直接增强当前 PM 体系。见 plan.md M17
- **idea-1 paseo expo-two-way-audio 模块借鉴**（语音方向）→ **M14**（Q5 folded 5/25）
  - 自研 iOS AVAudioEngine `.voiceChat` + Android AudioRecord/AudioTrack VOICE_COMMUNICATION，16kHz PCM + AEC + NoiseSuppressor + playback AEC 适应
  - mobile+voice 核心使能模块，随 M14 确认纳入 plan；M14 开工再拆集成

- **idea-3 paseo Provider catalog manifest 借鉴**（preset 方向）→ **M18**（Q8 user 答"同意" promote 5/25）
  - preset 加详细能力声明（mode / risk / unattended / feature），让 orch 派单时按能力路由，取代当前 4 preset 平铺枚举
  - 🟡 需先做 scoping spike：看现有 preset 设计有多少真痛点、orch 派单实际需要哪些能力维度，再决定实现范围。见 plan.md M18

- ~~**idea-4 paseo Timeline seq/epoch/gap 模型借鉴**（事件流方向）~~ → **M23**（user 拍板 2026-05-27，调研确认与现有架构互补不冲突）

## 待评估（新）

- **idea-10 实时流式语音传输架构（杀延迟）**（2026-06-04 user 真机验收时提）
  - user 原话:"目前这种模式其实还是有很大的延迟,后续应该考虑用 RTSP 流式媒体传输模式"。当前批处理管线(录完整段→上传→STT→orch LLM→TTS→下传→播放)每轮 7-15s,是实时对话感的最大瓶颈。
  - 方向:流式化——流式 STT(边说边出 partial)+ 流式 LLM token→逐句 TTS + 砍中继往返。
  - ⚠️技术选型待调研:user 提 RTSP,但 RTSP 偏单向直播;双向交互语音业界通常 **WebRTC**(延迟更低 + 自带 AEC 回音消除,正好治回声自打断)。需正经调研出报告:RTSP vs WebRTC vs 流式STT+TTS 管线,各自延迟/复杂度/与现有 relay 架构契合度。**调研类硬规则**:出 reports/*.html + research/*.md。
  - 关联:plan.md line 55 已挂的"批处理 vs 流式"大决策(ADR Phase 2);神经 VAD 三阶段已打通后,这是语音体验的下一座大山。
  - 状态:**已立项(2026-06-04 user 拍板"可以考虑做了"+"我同意 webrtc 方案")→方向定 WebRTC**。调研 spike 已派赵云(reports/*.html+research/*.md;3 条 dispatch=同一调研累积细化:广→收窄WebRTC→指 ADR 前置)。承接 `2026-06-02-m36-streaming-voice.md` 既有发现(P2P需TURN、US relay延迟最大头、快嘴层已解orch延迟)。**待调研报告→user 拍落地计划**。ADR 已更新 6-04 WebRTC 段。

- **idea-11 实时流建立后 GLM 快嘴层是否还需存在**（2026-06-05 user 提,明确"以后专门讨论"）
  - user 原话:"如果实时流(WebRTC)已经建立了之后,GLM 它是不是还一定百分之百需要存在,我们都要去讨论和考虑这个问题。"
  - 背景:GLM 快嘴层(idea-9)是为解决 orchestrator 批处理回复 28-30s 太慢、提供 1-2s 秒回应声而生(见 ADR 2026-06-02-m36-streaming-voice §50)。
  - 假设:WebRTC 实时低延迟 + 流式 LLM token 输出后,orchestrator 本身可能就能足够快地直接对话,GLM 快嘴层的"垫场"价值可能下降→是否还需要二层(GLM+orch)?还是 orch 流式直答即可?
  - 关联:idea-9/idea-9 v2(GLM 门卫+接力)、idea-10(WebRTC 实时流)。**待 WebRTC 实时落地后再评估**;user 要专门讨论。
  - 注:同期 user 还指出 GLM 越权 claim 派单/行动的 bug(已派关羽修 GLM prompt,GLM 只许答+对称传递不许声称派单)。
