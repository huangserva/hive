# Ideas Inbox

> 低承诺想法收集。user 或 AI 都可以加。AI 每开 session 扫一遍找成熟的 promote 到 plan / ADR。

## inbox（按加入时间倒序）

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
