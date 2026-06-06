# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

### 2026-06-06 WebRTC 通话流式 ASR + early-response — user 实测口述

- **idea-10 流式 STT + 边收边算架构**：user 在 WebRTC 通话实测中指出，当前"等静音→攒完→STT→AI→TTS"链路导致 5-6s 延迟，根本原因是客户端攒完再传。user 正确方向：
  - 服务端实时收 10ms PCM 帧 → 流式 ASR 边收边出局部文字 → 理解语义后**立即**触发 AI
  - 不等用户停顿，检测到"意图完整"即响应（intent-complete 而非 silence-boundary）
  - AI streaming 回复 + streaming TTS 同步推下行 → 端到端延迟可降到 ~1-2s
  - 技术路径：streaming Whisper（whisper.cpp server-sent events）或 cloud streaming ASR（Google/Azure），配合 LLM streaming + edge-tts streaming
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
