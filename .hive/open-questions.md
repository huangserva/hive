# Open Questions

> AI 自动维护此文件。每条 Q 是 AI 遇到"自己办不了、必须问 user"的事。user 在 Cockpit Questions tab 答复。

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- [x] **Q19 · 实时语音"强前台+PM异步"架构 3 个 sub-decision（M38）**【✅ user 2026-06-05 深夜拍板：(1) **前台模型=GLM-5.1**（走现成 GLM 端点，无 Anthropic key；比 glm-4-flash 强一大截治废话/过度声称）(2)(3) "按你原来的意思做就行"=采纳 PM 推荐（扩上下文 plan/dispatch、Phase1 先行）。**已派关羽 Phase1**（dispatch 0b75c3cc：fast-voice-reply 换 glm-5.1+真对话前台提示词+扩上下文+可回退 env flag+回归测连续对讲；含 glm-5.1 真 API 验延迟卡口）。待实现+钟馗审+user 重启 4010 真机验】（草案 `decisions/draft-2026-06-05-realtime-voice-front-agent-pm-async.md`，2026-06-05 深夜你怒吼点醒后起）→ 你已拍**根治方向**：把实时对话和后台干活分开——前台换真能对话的 agent（扛 70-80%、可 barge-in 打断、真要动手才说一次"我让团队上"），PM(opus) 移出实时环路只在后台异步干重活、结果回灌前台念出来。当前根因=GLM(flash) 被绑死只读+一遇实质就甩"需要主管处理"等慢 PM=一边倒废话。ADR 已起草分 3 阶段（Phase1 升级前台 agent 先做）。**待你拍**：(1) **前台模型**：claude-haiku-4-5（实时优先、已接、推荐）vs sonnet（质量优先略慢）vs 其他？(2) 前台扩权读哪些上下文（plan/tasks/commit/dispatch 全给还是限范围）？(3) Phase1 先行（只动 fast-voice-reply 前台逻辑）OK 否？成本提醒：付费模型替 glm-flash，每句通话成本上升（haiku 便宜但非免费），按你"求最优非最省"默认接受，照报你拍。

### 🟠 medium — 影响下一步规划

- [x] **Q18 · STT 引擎换 FunASR/Paraformer？**【✅ user 2026-06-05 拍板"换！换！"=采纳推荐方案 Paraformer主+whisper兜底,sherpa-onnx Node addon 落地。已派赵云实现 `15625f67`(加 ParaformerSttProvider 排头 whisper 兜底+模型管理;抗幻听补丁层先保留防御纵深)。ADR draft 转采纳。待实现完真机A/B验中文转写】（马超调研，dispatch `65a91c79`，2026-06-05）→ user 真机中文转写老乱/幻听团队名，问能否换 FunASR。调研结论：**转写乱是两病根叠加**——① 现用 whisper `base`（最小档，中文 CER 20%+量级）② whisper 自回归静音/噪声下幻听 initial_prompt（含团队名），`local-stt.ts:48-232` 整层抗幻听补丁正是症状铁证。**Paraformer 治本**：中文 CER 领先 whisper-large-v3 约 2-4×（AISHELL-1 1.68% vs 4.72%）；非自回归结构上根除幻听类；自带 VAD+标点；有流式版直通 M37 WebRTC。**推荐换 Paraformer 主+whisper 兜底，落地用 sherpa-onnx Node addon（零 Python，同 Node 栈）**。报告 `reports/2026-06-05-funasr-vs-whisper-stt.html` + ADR draft `decisions/draft-2026-06-05-stt-engine-funasr.md`。**待你拍**：①方向（Paraformer 主+whisper 兜底【推荐】/ 只先升 whisper-large-v3 看够不够 / 维持现状）②路线（sherpa-onnx Node addon【推荐】/ FunASR Python sidecar 精度全但加 Python 运维面）③是否先做 sanity A/B（whisper-large-v3 跑一次拿基线数）④谁实现（涉服务端+native addon+模型管理）？

- [x] **Q17 · M37 WebRTC TURN 近节点形态（B 决策）**【✅ user 2026-06-05 拍板"零成本 TURN 方案，做！"=采纳两步走:先 Phase 0 零成本(metered.ca免费/Cloudflare TURN)验通+实测中国RTT;终态(managed vs 自建HK)+近节点/供应商/部署待 Phase 0 数据后定。ADR draft 已更新已采纳 Phase 0】（赵云调研，dispatch `535e96a1`，2026-06-04）→ WebRTC 主线已拍，TURN 必须架近节点否则白做（现 relay 在美国洛杉矶，到沪实测 ~505ms 跨太平洋）。调研报告 `reports/2026-06-04-webrtc-turn-coturn-deployment.html` + ADR draft `decisions/draft-2026-06-04-webrtc-turn-near-node.md`。**关键发现**：DMIT 本就有香港 CN2 GIA / 东京近节点，不必换供应商；单用户量级成本不是分水岭（managed $0-3 vs 自建 $15/月），决策变量=中国末端延迟稳定性。**推荐两步走**：Phase 0 先 metered.ca 免费档/Cloudflare TURN 零成本验证 WebRTC 打通+实测中国 RTT → managed 稳定 <80ms 就直接用，否则自建 coturn @ DMIT 香港 CN2 GIA。**待你拍**：①终态形态（两步走 vs 直接自建）②近节点位置（香港推荐 / 东京 / 境内最低延迟但需备案+UDP 合规风险）③供应商（DMIT/阿里腾讯云/搬瓦工）④relay 要不要也迁 HK（最小=只放 coturn，信令仍走美国）⑤谁部署 coturn（涉 VPS SSH/systemd/certbot/防火墙安全加固）？

- [ ] **Q14 · `team approve` 是否从 feishu 路由解耦**（马超 M28 Track A 起，2026-05-31）→ 已修：`team approve` 现在会把 `approval_request` 写进 mobile_chat_messages，手机端审批卡有数据了（item 2 完成）。**但**该路由 `/internal/feishu/approval-request` 仍保留原有 feishu 门控：无 `feishuTransport` 返 503、无 recent feishu chat 返 400——所以对**纯 mobile-origin、且 agent 近期没碰过飞书**的高风险动作，`team approve` 仍可能被门挡下，手机端审批拿不到卡。当前部署飞书常配置且 orch 常有近期 feishu chat，故常见路径已通；但要彻底闭合手机审批闭环需让该路由在无 feishu 时也能创建审批+写 chat+推送（feishu 卡仅在 transport+chatId 具备时发）。代价：动一个 feishu 命名的路由契约 + 改 2 条现有 feishu 测试（它们断言的正是被修的旧行为）。**待你拍**：① 现在就解耦（彻底修手机审批，承担 feishu 测试改动）？还是 ② 接受"feishu 配置即可用"先 park，等真出现纯 mobile 无 feishu 场景再做？

- [x] **Q12 · M18 preset 能力清单**（answered 2026-05-29：user"都可以做"）→ 做 M18a 能力可见版（不做自动路由），已实现 commit `8300698`（关羽后端+赵云 UI）。（赵云调研，报告 `.hive/reports/m18-preset-capability-manifest-spike-2026-05-29.html`）→ 推荐**缩小做 M18a**：给 command_presets 加轻量 provider capability manifest（mode/risk/unattended/feature 等），显性化 + 展示到 Settings/Worker 卡/orch 上下文；**暂不**把 team send 改成按能力自动路由（改动大、当前收益不足）。待你拍：① 只要"能力可见"还是要进"自动派单路由"？② 自定义 preset 第一版给完整 manifest 编辑还是简化标签？③ M18 是否跟未来 provider marketplace / ACP catalog 合并规划？
- [x] **Q13 · dispatch ledger 孤儿收尾**（answered 2026-05-29：user 经 Cockpit Actions 确认）→ 新增 reconcile 自动收尾明确孤儿，已实现 commit `8300698`+ADR 归档 `.hive/decisions/2026-05-29-orphan-dispatch-reconcile.md`。（周瑜巡检发现 + PM 核实）→ 多条 dispatch 卡在 `submitted` 态清不掉（worker 已停/已在别的 dispatch 下 report，原行没人关；`team cancel` 只认 `open` 态故 409）。当前 `7b08568b`/`9aede49f`/`6c9a009b`/`02679164` 都卡 submitted（活已做/已被取代，无功能影响，但 sentinel 会一直当孤儿报）。待你拍：要不要修机制（让"submitted 且 worker 已停/已别处 report"的 dispatch 可被 cancel 或自动收尾）？还是接受为良性噪音先 park？



- [ ] **Q15 · Worker 模型由谁控制（M31）**（草案 `draft-2026-05-31-worker-model-control.md`，挂 2 天周瑜检出，2026-05-31 起）→ 调研发现 worker 不可靠的隐性根因：**hive 现在完全不控制也不知道 worker 模型**（内置 preset 不带模型参数，真实模型只在 CLI 自绘状态栏、无结构字段）。唯一可靠路径=hive 启动显式注入 `--model`（4 个 CLI 全支持，复用现成 thinking-level 注入器）。**推荐**：① 先治本捷径——把 codex 等弱默认 preset 默认模型钉强档（赵云立即变强，可先于完整 UI）② 完整版 hive 接管模型(launch config+表加 model 列+mobile/web 卡片显示+per-worker 可选)。**待你拍**：(1) 默认钉强档/per-worker 选/两者都要？(2) 各 preset 暴露哪些模型清单 + 要不要自定义串逃生口？(3) 成本：强模型更贵更慢，可接受？

  > **🅿️ PM park（2026-06-12，user 同意）**：当初的 reliability 驱动已弱化——2026-06-10~12 验明 worker 崩的真因是 **ENFILE(tasks watcher 帧海) + codex/opencode 进程崩/inject-race**（process 级，[[project_hive_enfile_watcher_crash]] + idea-13），**不是模型质量**，已分别用 watcher 收窄 + env-strip + idea-13 兜底在治。Q15 的"模型可见/控制"本身价值仍在（hive 不知道 worker 真实模型是真 gap），但不再紧急。**revisit 触发**：启动健壮性收口后、或 user 真遇到"某 preset 输出质量差想钉强档"时。在此之前不当 active 悬案计龄。

- [ ] **Q16 · 推送通知通道选型（M29）**（草案 `draft-2026-05-31-push-channel.md`，挂 2 天周瑜检出，2026-05-31 起）→ 你要 app 后台/锁屏收推送（微信式）。**硬事实**：你华为折叠屏无 GMS，现有 FCM 链对该设备物理不可达（不是缺凭据是选错通道）。**推荐 A→B 渐进**：A(先做)=前台服务保活 relay WebSocket+收 event 弹本地通知（零账号、几天出效果）；B(账号就绪)=华为 HMS Push Kit（app 被杀也能唤醒=真微信级）；放弃 FCM/Expo push；C(将来)=极光/个推聚合多品牌。**待你拍**：(1) A→B 渐进还是直接上 B？(2) 是否愿注册**华为开发者账号(实名)**——B 的硬前置，无它华为机做不到"被杀也能收"？(3) 将来是否兼容非华为设备→要不要一步到位上 C？

### 🟢 low — 灰度区

（暂无）

## 已答（archive 留追溯）

- [x] **Q5** 是否将 idea-1 paseo expo-two-way-audio（双向音频模块）提升为 question？→ **folded into M14**（5/25）：idea-1 是 mobile+voice 的核心使能模块，已随 M14 确认纳入 plan（见 M14 候选 idea）；具体集成等 M14 开工再拆，不单独立 question。
- [x] **Q4** mobile + voice 是否纳入 plan.md 作为未来 milestone？→ **要**（user 拍板 5/25，覆盖 5/24 的"介于 plan 跟想法之间"）。M14 从 proposed(待 Q4) 升为 confirmed。排序：skills playbook（M17，独立不依赖移动端）先做，mobile + voice 作为后续大版本方向，开工时起 ADR 选自建 mobile / 第三方框架 / 飞书 + voice plugin。
- [x] **Q2** Cockpit Reports tab 是否要做（列 `.hive/reports/*.html` + 一键打开）？→ **要做**（user 拍板 5/25）。M12 从 open(low) 升为 queued 正常队列。
- [x] **Q1** PM 全套 i18n（Cockpit 8 tabs + ActionBar + drawer / PlanDrawer / WorkspaceSettings Feishu 段）→ **shipped `2b3e2ed`**：104 个新 i18n key（中英文各），22 个组件改完，CJK 扫描 0 命中。user 切顶栏中/英按钮，重启 4010 + 刷新后所有 PM 文案双语。

- [x] **Q7** 确认归档 M17 handoff ADR（`.hive/decisions/2026-05-25-m17-handoff-playbook.md`，现 status=draft）？它记录的设计裁决——playbook 作为 PM 文档制品（不另造 runtime）/ 先模板后自动化 / ActionBar 只建议不自动执行 / handoff first——会作为后续 4 个 playbook（loop/advisor/committee/epic）的实现基调。你确认就把 status 改 accepted 归档。 → **answered 2026-05-25**：可以的

- [x] **Q8** 是否将 idea 提升为 question：**idea-3 paseo Provider catalog manifest 借鉴**（preset 方向） → **answered 2026-05-25**：同意
- [x] **Q9** M14 语音路线确认（推荐飞书 voice command MVP）→ **answered 2026-05-25（飞书）**：干！→ M14a 路线锁定，ADR 转正归档（2026-05-25-m14-voice-path.md 已采纳），派关羽 Phase 1（4109bb4b）
- [x] **Q10** M14a STT provider 选哪个（A 飞书内置 / B 外接 ASR / C 不做 / D 本地 STT）→ **answered 2026-05-25（飞书）**：D 干！选本地 STT（openclaw 路线，免费无 key 数据本地），派关羽 Phase 2 实现 LocalSttProvider（6b8951b5）

- [x] **Q11** 是否将 idea 提升为 question：**idea-4 paseo Timeline seq/epoch/gap 模型借鉴**（事件流方向） → **answered 2026-05-27**：先调研清楚，和目前做的有冲突还是有重合还是补充？
