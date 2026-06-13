---
title: HippoTeam
started: 2026-05-20
current_phase: M43 dispatch accept gate + 显式 reviewer/verdict（idea-16 #2+#3，方案 B 旁挂三字段，设计已就绪 user 拍板"继续"→实现 Phase 1 中）。M41 视频/图片 4G relay 已 2026-06-13 真机验通 shipped；对讲 GLM 全传 orch 已 live。语音线 M40 Phase 3 GRM Turn 为较大在途线。
status: active
last_review: 2026-06-12
---

## 目标

把 `tt-a1i/hive` fork 维护成 **huangserva 自用的 HippoTeam 多 agent 工作台**，重点能力：飞书远控（含审批卡片）、orchestrator 升级为项目主管（PM）、保持跟上游有价值改动同步。

## 🔴 POST-RESTART TODO（2026-06-02 深夜 M36 秒回，4010 重启激活 fast-voice-reply）

> **背景**：user 暴怒——实测 orchestrator 回复要 28-30s(全是重 agent 同步做完重活才回),user 要 2-3s 应声、500ms relay 无所谓、要双向打电话感、连续对讲改流式。**真瓶颈=orch 回复延迟,不是 relay/音频(我前几轮抓错层)**。
> **2.6.2 bundle 已 commit+出包(`aedd24a`),APK 已投递 DMIT,需 4010 重启激活**。内含:①**fast-voice-reply 秒回层**(`6bdc8bb`):语音消息 source=voice→有 ANTHROPIC_API_KEY 走 Haiku 1-2s 短回/无 key 秒插固定确认"收到处理中",真答案 orchestrator 随后;钟馗 3 轮审死守"快嘴怎么炸都不连累发消息"②**吐字 bug 修**(`3655376`):无语音不再吐 STT 提示词垃圾③对讲页去测试按钮+版本号修(`cfd0a31`,2.6.1)。
> **【2026-06-03 凌晨最新·GLM 已就位】**：user 自己点出用**国产 GLM-4-Flash(智谱)**替 Haiku——服务器在国内,PM 从上海实测 **~1s**、中文自然,干掉太平洋延迟。**已 commit `46eac2c`**:快嘴 provider 改 GLM(OpenAI 兼容),key+地址在 **repo 根 .env**(gitignored):`GLM_API_KEY`/`GLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4`(⚠️**user 强调:此 /coding/ 接口免费,/api/paas/v4 收费,锁死 coding 别改**)/`GLM_FAST_MODEL=glm-4-flash`。hive.ts 启动读 .env。优先级 GLM>Anthropic>固定确认。
> 重启后:
> 1. **GLM 自动激活**:4010 从 repo 根启动→读 .env→GLM key 生效。
> **【2026-06-03 ~01:30 夜末真机验证结论】**:✅**核心通了**——4010 已重启激活,user 真机实测:说话→source=voice 进来→转写准(清楚说时)→**GLM 真触发 ~1s 应声**(DB 见 `fast_reply:true` orch_reply,GLM 回"明白了我会处理")。但❌**user 听不到回复**=念回声音没播到耳朵。两种可能:①手机媒体音量没开(最可能,user 自己也怀疑"声音没打开")②念回播放有 bug。**adb 当时没连(USB 断)无法抓 logcat 定位**。已让 user 休息(熬到 1 点半),明天:①user 先确认媒体音量开满再试 ②不行就插 USB,新 orch adb logcat 看念回播放时发生啥(设备 `2PV0224423000586`)。
> **【2026-06-03 早晨最新·一大批已修待激活】**:user 早上回来(明确"别再提睡觉"),继续真机磨。这一波全 commit、**本次 4010 重启 + 装 APK 2.6.4 一起激活**:
>   - ✅ **GLM ~1s 秒回 user 已亲耳听到**(之前听不到=手机媒体音量没开,开了就通)。核心打电话感达成。
>   - ✅ **吐字 robust**(`965f080`,服务端,**本次重启激活**):token 重叠判定抓跳选/子集名单回吐(user 实测"马超赵云钟馗张飞周瑜"跳选名字)。**重启前还会吐,重启后停**。
>   - ✅ **连续对讲 VAD**(`9e5bf44`,silenceThreshold -52→-45):PM USB logcat 实测 user 停顿音量 -47~-50 到不了 -52→永不判说完。-45 后 speechEnd 触发(实测确认)。
>   - ✅ **连续对讲念回播放**(`9e5bf44`,关羽):play 前切 allowsRecording:false,否则连续录音占 audio session 听不到。
>   - ✅ **对讲连续念回**(`aa704cc`,APK 2.6.4):**user 核心诉求**——对讲里念我【所有】回复(含处理中追加),不只一问一答。钟馗 3 轮审,pending baseline 防"念几百条历史灾难"。
>   - 🟡 **GLM 喂只读状态**(user 拍板的架构):GLM 当"知情前台"——能读当前状态答问题、**不下指令**(risky 的留 orch)。**待建**:把只读状态喂进 GLM prompt。
>   - 🟡 **对讲 turn-coupled 限制已修**(连续念回),但 runtime 无 chatHydrated 信号,残余极罕见边缘(同步前开口+历史晚于prompt返回)待 runtime 暴露信号彻底解。
>   - 🔬 **吕布(OpenCode,user 点名)在做上游 tt-a1i/hive vs HippoTeam 代码级对比**(clone 到 /Users/huangzongning/development/hive-upstream-compare),出 `.hive/reports/2026-06-03-upstream-hive-vs-hippoteam.html`+research。
>   - ✅ **GLM 知情前台已建**(`fd03365`,**本次/下次 4010 重启激活**):GLM context 喂【对话历史(最近15条)+ 当前状态(worker status/open dispatch/谁在忙)】,system prompt"只读知情前台不下指令"。钟馗审安全(读状态失败降级不阻断发消息)。→ GLM 能答"现在啥情况/谁在干嘛/进度"等 70-80% 状态问题,不用等 orch。**重启后让 user 问 GLM"现在什么情况"验它能答 worker 状态**。
>   - ✅ **上游对比报告交付**(吕布,投 DMIT /view/):HippoTeam vs Hive +76 文件+3 包+8 独有模块。
>   - 🟡 **下一大件·开口打断(barge-in)**:user 明确要"我说话时你也能插话"=真双向。技术较难(外放我的声音麦克风会录到=需回声消除)。列为 GLM 稳后的下一攻坚。
>   - ✅ **连续对讲可用 SHIPPED `5aea765` (APK 2.6.5 已装,14:10)**：本夜 USB logcat firefight 解决三大坑——①自适应判停(滚动窗口最小值底噪,替换会卡死的EMA;真因=旧EMA被录音启动-160垃圾锚死,回升0.02/样本要20分钟)②真语音闸(hadRealSpeech,静音/杂音不投递;STT拦whisper幻听"网络中文普通话语音指令";真机验DB 0垃圾)③首句不丢(floor未建立前-38绝对启动线)。钟馗审+复审0blocking。
>   - ✅ **GLM 知情前台真因+修复+真机验证(`5aea765`,4010 14:16重启已激活)**：GLM本身好(独立诊断:答"钟馗在忙其他空闲"2.4s),但喂历史让prompt变大、持续撞穿2500ms超时墙→每次abort回写死兜底。FAST_VOICE_REPLY_TIMEOUT_MS 2500→5000。**已真机验证**:user 问"现在什么模式"→GLM 真答"目前你设置的是【按住说】模式…GAM 这个我不知道,让 orchestrator 帮你确认"(答对+优雅转交),不再"收到稍等"。连续对讲也真机验过(user"对讲模式通了没"经连续对讲转写干净到达)。
>   - ✅ **念回 TTS 升级 edge-tts 晓晓 SHIPPED `5c58113`+真机验证(4010 14:57重启已激活)**：user 嫌 macOS 婷婷难听,换 edge-tts 晓晓(zh-CN-XiaoxiaoNeural,微软神经,免费已装,~2.3s)。**user 真机听过:"比 MacOS 好太多了"**。优先级 edge-tts>piper>say,失败降级 say 兜底。出 mp3/audio_mpeg,钟馗 code-trace 确认透传手机播放。HIVE_TTS_EDGE_VOICE=zh-CN-YunxiNeural 可换云希男声。
>   - ✅ **开口打断(barge-in)默认开 + 不切断大声说话 — 真机验证通过 `ae98794`(2.6.9 USB装,18:07)**：barge-in(2.6.6/2.6.7)真机暴露两坑:①回声自触发②**连续大声说话被切**(铁证 m=-12.4 floor=-13.9:floor 滚动最小值被持续说话顶到语音电平→floor+6 把说话当静音切;voice_communication AGC 加剧)+连累 whisper 吐团队名提示。**修复历程(吃教训)**:2.6.8 误把 barge-in 整个默认关(以为是 barge-in 本身坏)→user 怒"改好的功能又改坏";真相=切断是【独立 VAD bug】,与打断无关。**正解 2.6.9**:voice-vad speechEnd 改"相对 recentSpeech 明显下降为主、floor+margin 仅辅助不能单独触发"(治切断,关羽,钟馗审)+ barge-in 改回默认开(`!=='0'`,救回打断)。**BARGEDBG 真机铁证 2.6.9**:打断 OK(user 插话 m=-16~-20 触发 speechStart→pause,3次准);不切断 OK(大声说话 floor 保持低位 -46 无误 speechEnd);无团队名乱码(真转写)。**残留可选调优**:回声峰值 -24~-27 距打断触发线(floor+22≈-24)偏近,可把 BARGE_IN_VAD speechMargin 22→26 给更多回声余量(等 user 说要不要)。barge-in 显式 env=0 仍可关。
>   - ✅ **双音色分 GLM/orch SHIPPED `6b9b380`(2.6.7,待4010重启+APK)**：user 实测分不清 GLM 还是 orch 在回,提议双音色(测好再还原)。GLM 快嘴→晓晓(女)、orch→云希(男),voice 全链路透传到 local-tts edge-tts。**直接帮诊断 idea-9**(听出 GLM 扛了多少)。降级 say 时不分音色但念回不断。
>   - ✅ **outbox 失败消息可清除 SHIPPED `6b9b380`(2.6.7)**：ConnectionModeBanner"X条失败"加"清除"(clearFailedOutboxItems 只删failed保留queued/sending);user 截图反馈"6条失败一直在"。
>   - ✅ **Cockpit ActionBar 可折叠 SHIPPED `25bd9df`(web,待4010重启/刷新)**：user 桌面反馈"AI待办行动(10)占空间影响看板",加折叠+localStorage持久化。
>   - ✅ **开口打断调优 SHIPPED `e4ad00b`(2.6.10,DMIT+飞书投递,user 出门路上装)**：user 真机发现 barge-in 两敏感问题:①我念回回声把自己打断(BARGEDBG 回声 -24~-27 够到触发线 floor+22)②鞭炮瞬响误触发。调 BARGE_IN_VAD:speechMargin 22→25(线≈-21,回声够不到、人声-16~-20能过)+ 连续3样本(~500ms)才触发(防单尖峰)。钟馗审 0blocking(含"真插话打不断"反向风险已验)。
>   - ✅ **M37 神经人声 VAD — Phase2 Shadow 真机验证【成功+区分力强】(2.6.15, 赵云)**：on-device Silero VAD ONNX,分阶段 Probe→Shadow→Gate→Replace。**Phase1** `f67197c`:16kHz PCM 通道。**Phase2 集成** `77bf39e` + flag 修 `4dc9267`(EXPO_PUBLIC 改 app.config extra)。**真机崩溃 firefight(6/04)→焊死**:shadow 包真机崩,`-b crash` 定位=Metro asyncRequire 加载 onnxruntime 时顶层 `NativeModules.Onnxruntime.install()` 同步抛(native 未注册)、mqt_v_native 当 FATAL 上报、**绕过 await try/catch**(catch-after 无效)→改**探测式 catch-before** `ee51023`(import 前查 NativeModules.Onnxruntime,缺失绝不 import,2.6.14 真机零崩)。**治本注册** `6464c01`(2.6.15):Expo config plugin `plugins/with-onnxruntime-package.js` prebuild 注入 `OnnxruntimePackage()` 到 MainApplication.kt(autolinking 对该库缺 android package→PackageList 不含;手改 gitignored android/ 不持久故走 plugin;钟馗顺 ExpoReactHostFactory→DefaultReactHost 源码坐实 New Arch 消费手动 packageList)。**真机验证(2.6.15 USB)**:[SILERODBG] **voice_prob 1565 帧真打分、零崩溃**,且**区分力强**:静音 2481 帧→prob≈0.00(frame1 rms0→0.002)、人声 314 帧→prob≈1.00。**模型真的在分辨人声 vs 非人声**。教训存记忆 reference_voice_vad_glm_gotchas。**🟢下一步 Phase3**:用 voice_prob gate barge-in(高分=人声才允许打断,鞭炮/噪声低分不打断)→user 要的"放鞭炮不打断"真正落地(已问 user 是否接)。**❗边界**:神经VAD解决噪声误触发,解决不了"念回回声自触发"(回声是合成人声,模型也判高分)→回声仍靠 BARGE_IN 抬阈值(2.6.10)配合。
>   - 🟡 **idea-9 GLM 门卫化 已 SHIPPED `a62fbd5`(待4010重启激活)**：user 核心诉求(GLM多扛少推、别双回复)。GLM 标 HIVE_GLM_GATEKEEPER handled/escalate,纯状态问题 handled→不注入 orch;带操作→escalate 转交。钟馗死磕"绝不丢消息"+抓到黑洞 blocking(handled+insert失败)已闭环+复审 0blocking(insert失败/超时/异常/无marker/media 全降级 escalate;flag=0 回退;never-throw)。**待 user 回家重启 4010 激活;激活后 user 问简单状态应只收 GLM 一条(非 GLM+orch 双条)**。flag HIVE_GLM_GATEKEEPER=0 可关。
> **接力 orch(2026-06-05 状态)**:神经VAD三阶段+idea-9v2接力+判停1600ms+神经speechStart 全真机验过"好行"。USB真机验是proper流程(adb装+logcat对照,从裸发翻车纠正)。
> **★★沟通风格铁律(已存记忆 [[feedback_pm_voice_reply_style]])**:给user的mobile-reply会被TTS念出来。【短、说人话、绝不带URL/符号(✅→/emoji)/代码/长文件名】(会被逐字念=user两次暴怒)。系统级TTS净化已上(`8d0a01a`)双保险。
> **服务端念回TTS净化+GLM禁越权(`8d0a01a`)已激活**(本session重启)。
> **🔴下次4010重启激活=Paraformer STT(`53e9e18`)+worker重启不丢任务(`cc52a87`)**:user拍Q18"换!换!"。sherpa-onnx@1.13.2 ParaformerSttProvider主+whisper兜底,模型~/.config/hive/paraformer-models/(int8 78MB),ffmpeg转16k喂sherpa,任一异常fallback whisper绝不丢转写,净化层保留。钟馗0blocking,本机sanity识别对~1.6s。**重启后★真机A/B验**:user正常说话→中文转写是否准很多+团队名幻听是否归零(user最痛点治本)。看日志确认命中provider=paraformer。模型不够准可env指大模型。
> **待user(在2.7.x真机测)**:①装2.7.6(VAD零流死锁修复`73a77ef`,USB掉了走DMIT下载;治"说话检测不到")②看对讲页新设计图`reports/2026-06-05-talk-ui-redesign.html`拍板(user嫌现UI丑,要design-first;批了再实现)③FunASR调研Q18拍板(中文比whisper准2-4×,治转写乱,推荐换Paraformer+sherpa-onnx)。
> **🎉WebRTC真通话全闭环结构完整(user授权自主"彻底实现",2026-06-05)**:命门解(默认不注册`cc65370`+lazy-init patch ADM延到首用)→Phase0c连接层`3a9aea5`(daemon werift callee+信令走relay+免费TURN,send_prompt权限闸+45s超时清理)→0c-2a上行`ac2be40`(麦克风→WebRTC→daemon webm→STT,互斥壳真闭环覆盖session,失败必close)→0c-2b下行`ebd82ed`(orch_reply→净化→晓晓TTS→Opus RTP→手机播放)。**完整闭环:user说→WebRTC→STT(Paraformer)→orch→TTS→WebRTC→听,全走一条连接**。钟馗多轮审(连续抓read-only绕权限/peer泄漏/假闭环互斥/downlink初始化泄漏 全闭环)。全flag-gated默认2.7.x零回归。**待出WEBRTC_NATIVE_REGISTER=1+WEBRTC_PROBE=1实验包真机验**:连接connected/双向音频/沪4G↔Mac经TURN的RTT;真recorder互斥需真call UI接(诚实标);werift RTP payload/codec可能要按真机日志调。default公共TURN(OpenRelay/Metered),prod用user注册metered.ca免费档(env HIVE_WEBRTC_ICE_SERVERS_JSON)。马超信令设计+ADR draft已记。idea-11(实时流后GLM是否还需)待议。
> **✅ worker状态bug已修(`cc52a87`,典韦诊断+关羽修+钟馗0blocking,待重启激活)**:HIGH=markAgentStarted重启时清零pendingTaskCount→丢排队dispatch孤儿,删清零行修。**待后续**:user报的"假idle"是另一个【前端WS缓存问题】(reconnect snapshot没覆盖stale状态),典韦标了`research/2026-06-05-worker-status-bug-diagnosis.md`,待单独修。
> **📦 2.7.7最新包已USB装user机**(VAD零流修复+所有语音修复,webrtc休眠默认零回归)。WebRTC实验包(WEBRTC_NATIVE_REGISTER=1)待user想测真打电话时出。
> **★沟通铁律重申**:回user一律短/人话/不带URL符号代码(念回TTS净化`8d0a01a`已激活兜底,但自己也守)。
> **今日血教训**:UI裸发未真机验→三连坑;回退包我没退webrtc仍坏还打包票"肯定对"→骂"放屁";2.7.6我说"已装"其实USB掉没装→自己核实纠正。**绝不裸发/不打无把握包票/build≠能用/claim前核实**。存 [[reference_voice_vad_glm_gotchas]]。
> **【2026-06-05 深夜·WebRTC真机验证 + 一批修复(接力session)】**:user重启4010激活Paraformer+worker修后继续。本session commit:① `e924dd6`假idle修复(前端reconcileWorkerRuntimeStatuses用terminal runs真实信号覆盖stale缓存,钟馗0block)② `aabddc0`WebRTC call_id UUID兜底(新建src/api/uuid.ts三级兜底,治RN无crypto.randomUUID崩中继探针)③ `760ec6a`Paraformer recognizer**模块级**缓存(治卡顿/念回不出声病根:不再每句重载78MB模型,每句省0.7-1.6s;钟馗**4轮**审闭环:实例级失效→B1 use-after-free竞态→B2 in-flight单槽锁→finally泄漏,全修)。
> **★WebRTC真机里程碑(关键进展)**:出了WEBRTC_NATIVE_REGISTER=1+WEBRTC_PROBE=1实验包(注意:build-local.sh不跑prebuild→必须先`npx expo prebuild`重生android带webrtc native,libjingle_peerconnection_so.so验在APK;JAVA_HOME=/opt/homebrew/opt/openjdk@17)USB直装user华为(2.7.7)。**真机验证结果**:① WebRTC native在华为(无GMS)上【麦克风+RTCPeerConnection可达】(最大未知数过了!)② 录音存活(user在webrtc包上按住说话成功录+转写=lazy-init补丁真机生效,2.7.3抢音频灾难没发生)③ **中继连接探针失败="WebRTC connection timed out"**。
> **🟢WebRTC真打电话=突破+已交付2.8.0,待user真机验声音(2026-06-05深夜,接手这里)**。全程诊断+决策详见 `research/2026-06-05-webrtc-ice-relay-interop-diagnosis.md`。**已做+验证**:① 国内TURN(阿里云上海coturn 106.14.227.192,记忆 [[reference_webrtc_turn_server]],治公共openrelay中国不可达)部署+turnutils验证完美+安全组UDP通。② 卡点诊断:原werift(daemon纯JS)双中继ICE握手谈不拢(coturn铁证sp=0),relay-only实验也没救(`26dad23`)。③ **★换库治本**:daemon webrtc-callee werift→@roamhq/wrtc(libwebrtc)。**第一步连接(`69abe73`)真机验state=connected 0.6秒(werift卡死处一过)**;第二步音频(`a36466e`,上行RTCAudioSink→STT/下行RTCAudioSource←TTS+失败cleanup);手机端hold-open测试通话入口+泄漏修(`ac1024c`)。钟馗多轮审全0block。④ **2.8.0实验包(arm64 94MB,版本两源都bump`b0de928`,WEBRTC_NATIVE_REGISTER+PROBE+FORCE_RELAY)已scp DMIT+飞书发user**(链接https://dmit.servasyy.com/dl/hippoteam-2.8.0-webrtccall-*.apk)。**当前状态(2026-06-05深夜,接手这里)**:WebRTC连接彻底verified(多通test call connected+held走国内TURN)。曾"音频0帧没声"→**我自主诊断定位**(Node wrtc↔wrtc经国内TURN双向1200帧✅,证明服务器侧wrtc音频100%没问题)→**病根=手机Android音频模式没设**(react-native-webrtc的JavaAudioDeviceModule要MODE_IN_COMMUNICATION才采mic+路由扬声器,同时解释上行0帧+下行没声)。**修=react-native-incall-manager(`921b01a`,connected后InCallManager.start+setForceSpeakerphoneOn,全路径stop,钟馗2轮审0block)+服务端音频诊断日志**。**2.8.1音频修复包(arm64 94MB)已scp DMIT+飞书发user**(链接hippoteam-2.8.1-audiofix-*.apk)。**当前真相(2026-06-05深夜,我纠正过早的误判)=硬骨头全通了,差实时对话流程**:连接/国内TURN/mic采集(VOICE_COMMUNICATION,USB logcat证实)/音频传输/**上行STT全通了**。曾误判"音频没通"因为:① 手机Clash代理拦TURN(USB logcat查出`dial 106.14.227.192:3478 i/o timeout`),user关Clash后通;② **webrtc-upstream-audio是"挂断时整段批量转写"(a36466e),不是实时**→user说话当时不出来、挂断才一大段冒出(延迟),且`injectWebRtcVoiceTranscript`写DB跟普通voice`{source:'voice'}`一样无法区分,我和GLM都误把WebRTC转写当普通语音/误判没通。**铁证:call b2bec061(held 3min)关闭后16秒DB出现长转写=上行真通**。**实时对话流程=已实现(`b71e461`,关羽实现钟馗多轮审0block,存档点checkpoint-pre-webrtc-streaming-20260605可回滚)**:新建webrtc-vad.ts服务器端能量VAD(RMS>=0.018/250ms最小/900ms静音判停)切句→webrtc-upstream每句立刻Paraformer STT→inject→orch回复→downlink念回,通话期间(非close batch),每句wav用完即删+内存不涨+短噪声不注入。**不碰连续对讲**(独立路径)。**纯服务端改动,不用出包**。**当前=user重启4010加载→真机验边说边回**。post-restart接手:user开始测试通话+边说边停(VAD按900ms静音切句)→查DB是否【通话期间就出现转写】(不是挂断才出=实时成功)+user通话里【听到回复】=真打电话彻底SHIPPED。VAD阈值(RMS0.018/900ms)真机可能要调(查daemon`/tmp/hive-dev.log`"audioSink utterance ready/injected")。v1未做barge-in。详见 `research/2026-06-05-webrtc-ice-relay-interop-diagnosis.md`(末尾"上行其实通了"段)。**纪律:别学GLM过度声称,但也别像我一样过早判死(WebRTC转写延迟+跟普通voice同format,一切对照call close时间戳+daemon日志坐实)**。**出包坑**:arm64-only用`-PreactNativeArchitectures=arm64-v8a`(否则287MB全架构);--clean prebuild删local.properties(写回sdk.dir=/opt/homebrew/share/android-commandlinetools);gradle卡merged_native_libs锁`./gradlew --stop`+rm中间目录;JAVA_HOME=/opt/homebrew/opt/openjdk@17;DMIT投递root@64.186.227.39:/var/www/dl/+飞书chat oc_0d5e...(记忆 [[reference_local_build_apk_delivery]])。
> **【2026-06-05 最深夜·调优+barge-in+M38架构转折(接力session)】**:user重启4010加载调优(`db6764b` VAD0.006+下行10ms)真机测,日志铁证**上行=完美**(6秒切2句漏话治好,转写准"就是"/"我有在说话"实时出现),**下行=不糊了但断断续续**。**★user怒吼点醒真正命门**:受不了的不是音质,是①没法打断(barge-in缺)②GLM对每句刷废话"需要主管处理"轰炸耳朵。我优先级搞错(只磨音质)。本轮:① 关羽修下行断续根因(setTimeout≥10ms累积实测11ms/帧→手机playout underrun,改漂移补偿排程baseTs+N×10ms,5单测fake-timer证不累积)② 关羽实现barge-in开口即停(上行VAD onset 3帧确认→下行interrupt() playbackGeneration停推+queuedGeneration丢旧排队reply,跨vad/upstream/callee/downlink 4文件,29单测)。**钟馗审中(a34e516a)**,0block后commit,user重启4010真机验【能打断+句句接住+声音清楚】(barge-in是device-sensitive必真机验,残留:无AEC回声可能误触发,待真机RMS核)。**★★M38架构转折(user拍板根治)**:user问"都给GLM答吗?PM慢最后也慢,怎么真沟通不一边倒废话?"→核实`fast-voice-reply.ts`=GLM(flash)只读前台+不确定就escalate甩PM(opus慢)。**user选根治方向**:强前台对话agent(扛70-80%+barge-in+真要动手才说一次)+PM异步移出实时环路(后台干活结果回灌前台念出来)。ADR draft `decisions/draft-2026-06-05-realtime-voice-front-agent-pm-async.md`(分3阶段,Phase1先升前台),3个sub-decision(前台模型haiku-4-5推荐/扩权上下文/Phase1先行)挂Q19待user拍。教训存 [[feedback_streaming_call_bargein_is_core]](流式通话命门=barge-in+turn-taking不只音频流)。详见 `research/...webrtc-ice-relay-interop-diagnosis.md`末3节。
> **✅运维约束已解(2026-06-05最深夜)**:之前"暂时别派codex"(codex审查员暂不可用)→本session关羽/钟馗(均codex)派单均成功完工,codex已恢复,约束作废。
> **WebRTC全量真通话**:daemon callee/上下行结构早完整(`3a9aea5/ac2be40/ebd82ed`),但call UI没接进对讲页(只有设置里的probe)→TURN通后下一步=接一键通话UI。真机已验:华为mic+RTCPeerConnection可达+录音存活+UUID修复(`aabddc0`)。
> **WebRTC全量真通话**:daemon callee/上下行结构早完整(`3a9aea5/ac2be40/ebd82ed`),但call UI没接进对讲页(只有设置里的probe)→TURN通后下一步=接一键通话UI。
> **idea-10 流式架构(RTSP/WebRTC 杀延迟)**user 提,记 inbox,待立项调研(关联 line 55 流式 ADR)。文章核查待 user A/B。**别让 user 打字(他恨),让语音真好用**。
> 2. **核心仍未全解**:GLM 快嘴先应声(~1s),但**真任务的最终结果仍是 orch 28-30s**(快嘴只先应声/答简单问)。要真·全程快,下一步=快嘴层承担更多直接对话、只把真重活甩 orch 后台。**双向打断、连续对讲改流式**也待建(user 明确要这俩)。
> 3. **对 user**:少废话、别发半成品。本夜 user 两次关键纠偏(提 GLM、拦收费地址),听 user 的。M36 全貌见 ADR。
> 4. team idle,2.6.2 全 commit 过钟馗审(本夜钟馗拦了 base64损坏/权限绕过/fallback冒泡 3 个"会让发消息坏"的回归),放心重启。

## ✅ 语音对讲 MVP 端到端打通（2026-06-02，STT+TTS 双向真机验证）

> **里程碑达成**：语音对讲输入输出双向全通，user 真机确认。
> - **STT(说话→中文文字)** ✅：whisper-cli(Metal/M4)+small 模型+简体/团队名提示词+`-l zh` 锁中文。user 说"你现在可以收到我这样说话吗?"准确出简体。commits `c687bcd`/`e1cb5d6`/`88b6100`。
> - **TTS 念回(我回复→读给 user)** ✅：根因=macOS `say` 出 AIFF-C 安卓播不了→ffmpeg 转 m4a/audio.mp4（缺 ffmpeg 兜底 WAV）。commit `e44b61b`。user 真机确认"念回确实成功了"。
> - **遗留盲区教训**：STT 引擎从来没装 + TTS 输出 AIFF 都是"写了集成代码但从没真机端到端验"，user 一上手就暴露。语音这类设备/原生链路必须真机端到端验，单测/代码审查测不到。
>
> **🟡 待 user 拍板的下一步决策（延迟）**：user 验完即指出"7~15 秒/轮太慢"。当前是**批处理流水线**（录音→上传→STT→orch LLM→TTS→下载→播放，4G 两次中继往返 + Opus 思考时间）。**对讲(连续)模式不会更快**（每轮同流水线，只是 VAD 免按键更顺手）。要 user 最初要的**"实时对话感"必须做流式**（stream STT partial + stream LLM token→逐句 TTS + P2P WebRTC 砍中继往返，ADR Phase 2，大工程）。已问 user：先用批处理版 vs 立项流式。**等 user 定方向再动**。
> 2. **已就位**：whisper-cli(/opt/homebrew/bin，Metal/M4)+ **ggml-small.bin**(~/.config/hive/whisper-models/,465M；已删 base 换 small,中文更准)+ ffmpeg；local-stt ffmpeg m4a→WAV+模型自动发现已 commit `c687bcd`；**STT 中文提示词**(简体+团队名,whisper-cli `--prompt`/python `--initial_prompt`,赵云做,本 commit)。mobile 三崩溃/录音 bug 已修(voice commits `b9f8309`/`aa1df58`/`858f667`)。**PM 已电脑端实测 STT 转中文准**(say→ffmpeg→whisper-cli:"让关羽汇报进度""让钟馗审查让马超出包"全对),adb 真机验只剩"手机录音→relay→转写"这条链路确认。
> 3. **设计线待 user 拍（开着）**：语音模式 orch 回复风格——A=口语短回复(推荐:即时确认一句+结果一句summary+长详情说"发你文字了") / B=念完整文字 / C=user 想法。定了做成语音请求的回复规则。
> 4. 语音 line 全貌见 M35/M14b。**别重复 review，这是 firefight 接力不是新 session 完整 review。**

## 里程碑

### M44 · 飞书媒体收发（视频/图片双向，对齐 mobile media）· ✅ code shipped 2026-06-13（`38468e7`，待 4010 重启 + 真飞书联调）（user 拍板"做这个"）
> user 2026-06-13 手机拍板：飞书也要支持视频/图片收发，跟 `team mobile-send-media` 那套对称。
> - [x] **出站**（主缺口，orch→飞书）：`team feishu reply --file <path>` + transport `sendMedia`（图片 `im.v1.image.create`→image_key→msg_type image；`.mp4` `im.v1.file.create`→file_key→msg_type media；其它视频/文件→file_type stream→msg_type file，非 mp4 不伪装）。caption trim 非空才跟发 text。
> - [x] **入站**（user→飞书→orch）：消息接收 handler 处理 image/file/media → `messageResource.get` 下载存 uploads（同 mobile 目录）→ surface 路径给 orch（sourceType 扩 video/file，`[来自飞书视频/文件]` 注入串带 media 路径）。入站 100MB。
> - **质量**：Lark SDK API 对照 types 验证；钟馗 3 轮审 0 blocking——命门是穿透测试卡死 CLI→route→transport 整链（删任一层透传必红，马超反向验证）。52 feishu 测 + 208 回归绿，0 字节预拒 + file_key 缺失抛错。
> - **待验**：4010 重启激活 + 真飞书联调（mock SDK 边界跑通，真飞书后端对 .mov→stream/大视频/caption 时序需真机验）。
> 关联：M41（mobile media，本里程碑对齐其能力到飞书渠道）、M4（飞书桥）。

### M43 · dispatch accept gate + 显式 reviewer/verdict（汇报≠完成，硬化审查环）· ✅ Phase 1 shipped 2026-06-13（flag-gated opt-in `HIVE_ACCEPT_GATE=1`）（idea-16 #2+#3，user 拍板）
> 借鉴 Rive 协议强点（报告 `2026-06-05-rive-vs-hive-serva.html`，idea-16）。user 2026-06-13 手机拍板 #2+#3 合并先做。
> **痛点**：worker report 了 = dispatch `reported`，但"完成"是软的——M34 只用启发式时序配对兜底。Rive 把它定义硬：report done ≠ task done，只进 reviewable；done 必须 explicit accept。直接硬化 HippoTeam 命根（实现→审查→修 环今天救过 Hermes 崩/symlink/视频黑屏多次）。
> - [x] **设计 spike**（马超 `497717b1`）：方案 B 旁挂三字段（不动 8 态机，flag-gated 零回归）。产 `reports/2026-06-13-accept-gate-reviewer-verdict-design.html` + research + ADR `decisions/2026-06-13-accept-gate.md`。PM 验承重句（isOpen/isCompleted 仅 2 处用、tasks.md `[~]` 正则本就支持）。
> - [x] **实现 Phase 1**（马超，`124c21b`）：schema v33（review_status/reviews_dispatch_id/accept_verdict）+ `team report --reviews --verdict` + `team accept --reason`（强制引用 reviewer）+ tasks.md `[~]`/`[x]` 闸 + unreviewed-code 精确 link 替启发式 + scope 只高风险代码 dispatch。**反铁律焊死**（钟馗 3 轮审）：accept 的 reviewer 必须真 reported + 审在 coder 之后（同毫秒 sequence tie-break）+ 真 link 本 coder，PM 无法用空单/旧单伪造"审过"。flag 默认关零回归。48 M43 测 + 宽回归绿。
> - [ ] **Phase 2（deferred）**：Cockpit/mobile 一键 accept/reject UI + `listAllWorkspaceDispatches` 分页（现 limit 1000 历史量大可能假拒）+ idea-16 #1 evidence bundle。
> 关联：M34（未审兜底，本里程碑把其启发式升级成显式 gate）、[[idea-16]]、idea-8/M33（evidence 链同源）。

### M41 · app 内视频/图片收发 + 内置可缩放播放 + 4G relay 传输（idea-15 promote）· ✅ shipped 2026-06-11~13（Phase 2 媒体走 relay 2026-06-13 user 真实 4G device-verify 通过：4010 重启后 media.get 在线，112KB 测试视频 4G 下载+播放成功）
> **user 手机口述立项**：能把视频/图片传给 app、在内置播放器里播、双指缩放，单文件 ≤100MB；后续补"主管也能发媒体给 app"。
> - ✅ **Phase 1 渲染 + 上行 + 内置播放器 + 缩放 `3d6b1a2`/`c3ff81f`**（2026-06-11，APK 2.8.15）：expo-video（无 GMS 依赖）播放器 + 图片 pinch-zoom 复用 + 上行 upload 50→100MB。PM adb 全链路 device-verify 通过。
> - ✅ **Phase 1.5 下行发送端 `team mobile-send-media` `f393997`**（2026-06-12）：新 CLI + `POST /api/team/mobile-send-media`，文件入 uploads + `store.insertMobileChatMessage` 走 wrapper 自动实时推（不用刷新）。支持视频+图片。钟馗审 0 blocking，真机发真视频验过。立项"你也可以传视频给 app"被 PM scoping 漏成 Phase1.5 的教训：方向词歧义没跟 user 对清。
> - ✅ **Phase 2 媒体走 relay（4G 下载播放）`bc96876`**（2026-06-12 code，2026-06-13 device-verify）：服务端 relay-rpc `media.get` 分块下载（流式 readSync + path-traversal 三层 guard 含 lstat/realpath）；移动端逐 chunk 真 decode（复用 relay-crypto 的 atob/Uint8Array，零 Buffer 依赖 Hermes 可用）+ 真 length 校验 + 缓存去重 + 进度；图片状态机抽纯函数避免 LAN 失败永久挡。钟馗两审（首审 4 blocking 全真机会崩→修→复审 0 blocking）。服务端 12 + 移动端 18 字节级真测试。**2026-06-13 真机验通**：曾"4G 下载失败"真因=4010 没真重启（codex 助手声称重启但进程号没变、旧进程占端口）；user 用 [Restart] 真重启后（PID 67337→62558）media.get 在线，112KB 测试视频 4G 下载+播放成功。教训记忆 [[reference_mobile_offline_stale_lan_host]] 同源（"重启没生效"要核进程号别信声称）。
> - **教训**：真机 device-verify 必须覆盖 user 真实 4G/relay 路径，不能只 LAN——Phase 1 在 LAN 验漏了 4G 取不到媒体字节这条架构 gap（[[feedback_verify_real_artifact_not_proxy_metric]]）。

### M42 · 启动健壮性修复 + 上游 hive triage backports · shipped 2026-06-11~12
> user 跨机根因分析 + "看看 hive 原版有哪些更新用得上"驱动。每件不同 worker 做 + 钟馗审。
> - ✅ **ENFILE watcher 收窄 `e4d1bc1`**：tasks-file-watcher 递归 watch `reports/**` 把二进制帧海一起监听→fd 耗尽→node-pty 无 TTY→worker 启动 2s 崩。收窄成 `reports/*.html`/`*.md`，其余 `**/*.md`，加回归测试锁死（[[project_hive_enfile_watcher_crash]]）。
> - ✅ **env-strip nested CLAUDE_CODE `bed6ebc`**：worker spawn 剥离 nested CLAUDE_CODE 环境变量（显式集合，保 OAUTH_TOKEN/USE_BEDROCK），治 env 泄漏。钟馗 B1 抓到前缀守卫过度剥离已修。
> - ✅ **上游 4 backport**（每件不同人）：worker-status markAgentStarted 归 idle `5527a8a` / shell + terminal 改进 / marketplace Phase1 只读 catalog `6bae080`（`5527a8a`..`6bae080` 区间）。
> - ✅ **relay 固化进 repo `de75d73`**：`relay.yunzhong2020.com` hard cut + mobile relay-config CURRENT/LEGACY 写死进仓。

### M1 · 稳定性强化（基础设施） · shipped 2026-05-20
- [x] P0 logger（`~/.config/hive/logs/runtime-<port>.log` + uncaught hooks）
- [x] 5 个 event handler 防崩（PTY / WebSocket / upgrade try/catch）
- [x] worker stop/restart 卡 working 的 pending bug fix（stopped-only guard）
- [x] dev 模式 `team` PATH bug fix（POSIX sh wrapper）

### M2 · multica 借鉴 · shipped 2026-05-20
- [x] #1 + #2 per-worker thinking_level + Add Worker picker (`8a2295c`)
- [x] #3 后端错误消息透传 UI (`c223f31`)
- [x] 二轮深度调研 8 条具体借鉴项 HTML 报告
- 余下 #4-#8 UX 偏好类，等 user 看 demo 决定

### M3 · Rebrand → HippoTeam · shipped 2026-05-21~24
- [x] Topbar 圆圈 H logo + favicon + HTML title (`539266f`)
- [x] package.json `@huangserva/hippoteam` + README + i18n 16 处
- [x] 移除 upstream npm update badge（fork 后比较无意义）

### M4 · Feishu Bridge Plan B（远程飞书远控 + 审批卡片） · shipped 2026-05-21
- [x] Phase 0 schema v21 + credentials loader + bindings store (`6d7bba2`)
- [x] Phase 1 inbound WS transport + route resolver + handler (`d595f6f`)
- [x] Phase 2 outbound `team feishu reply` + 长消息切片 (`10815af`)
- [x] Phase 3 UI: Topbar 飞书状态灯 + WorkspaceSettings dialog (`fd0db8e`)
- [x] Phase 4 testability refactor + bug fix (500→404)
- [x] Phase 5 审批卡片（Hermes 风格）+ ApprovalLedger + sendApprovalCard (`e601c38`)
- 16 个 commit / 132 个 feishu 测试，详见 `.hive/reports/feishu-bridge-plan-2026-05-21.html`

### M5 · Upstream backports · shipped 2026-05-23~24
- [x] Step 1 强相关：53e3645 tasks WS hardening + a2945fe team cancel (`473dc46` + `02abda0` + `24fc7d5`)
- [x] Step 2 弱相关：71fdaaf port-in-use + b34cfe4 drawer width + e57c6be+7bda143 OpenCode mouse + 4c34bf6 部分 (`dbc7a1e`)
- 详见 `.hive/reports/upstream-diff-2026-05-24.html`

### M6 · PM 体系 Phase A · shipped 2026-05-24
- [x] 5 个文档模板 (`pm-templates.ts`)
- [x] workspace 第一次启动自动 seed `.hive/plan.md` + `.hive/templates/`
- [x] ORCHESTRATOR_RULES 加 PM 段（中文）+ ORCHESTRATOR_REMINDER_TAIL 加一句（英文）
- [x] PROTOCOL.md builder 加 `.hive/` 目录约定段

### M6.1 · PM 体系 Phase B（plan.md drawer UI）· shipped 2026-05-24
- [x] plan-doc parser + chokidar watch + WebSocket 推送
- [x] PlanDrawer 720px + 6 子组件（PlanHeader / MilestoneList / MilestoneCard / Goal / Scope / Risk）
- [x] 50 个测试 (`588a9c9` + `9619d26`)

### M6.2 · PM 体系 Phase C-1（4 个新文档类型）· shipped 2026-05-24
- [x] 5 个新模板（OPEN_QUESTIONS / IDEAS_INBOX / 3 个 BASELINE）
- [x] ensurePmDocs 扩展 seed 11 个新文件 + 3 个新模板
- [x] ORCHESTRATOR_RULES 加 6 节（Open Questions / Ideas / Baseline / Decisions / Archive / Cross-workspace）
- [x] PROTOCOL.md 目录约定扩展
- [x] 24 个测试 + 修 plan WS race (`82fc5a2` + `64c7236`)

### M6.3 · PM 体系 Phase C-3a（session-start review nudge）· shipped 2026-05-24
- [x] runtime 一次性注入 system message （3 启动路径 fresh / Layer A resume / Layer B fallback）
- [x] idempotent dedupe Set in closure
- [x] 仅 orchestrator agent 生效，worker 不打扰
- [x] 12 个测试 (`be1d633` + `9d1467b`)

### M6.4 · PM 体系 Phase C-2（Cockpit UI dashboard）· shipped 2026-05-24
- [x] 5 个新 parser (questions / ideas / baseline / decisions / archive) + cockpit-doc aggregate
- [x] /ws/cockpit/:id + GET /api/workspaces/:id/cockpit endpoint
- [x] CockpitDrawer 720px + 6 tabs + 底部 ActionBar (aiActions 渲染)
- [x] Topbar 改造：取代独立 Plan / Todo 按钮，Todo 变浮动 mini
- [x] 63 个测试 (`7d7ba26` + `b5898c6` + `34f7c0d`)

### M7 · 真飞书 e2e 验证 · shipped (partial) 2026-05-24
- [x] 凭证 `~/.config/hive/feishu.json` + chat 绑定 + 重启 4010
- [x] 飞书 inbound → hive WSClient → route → orch stdin 注入（多次实测通）
- [x] orch 派 worker（paseo 调研 3 轮 dispatch）+ `team feishu reply` outbound（10+ 次）
- [x] reaction 两阶段反馈 GLANCE → OK（`63c4228` + `9498f96`，飞书肉眼验过）
- [ ] 审批卡片 ✅/❌ 真按一次（未触发 high-risk action，待真实场景）

### M22 · Cockpit Timeline + Worker 利用率统计 · shipped 2026-05-26
- [x] Dispatch Timeline 可视化（倒序列表 + 展开查看完整 task/report）`37d25ee`
- [x] Worker 利用率统计（per-worker dispatch count / reported / cancelled / avg completion time）
- [x] 按天 dispatch 趋势柱状图（最近 14 天）
- [x] Worker / status 筛选器
- [x] Cockpit 第 10 个 tab（History icon）+ i18n 中英文

### M8 · PM 体系 Phase C-3b（A4-A6 主动 trigger）· shipped 2026-05-26
- [x] A4: milestone 完成时自动跑 baseline 体检（plan.md chokidar watch + detectNewlyShippedMilestones + housekeeping nudge）`5f4c3bd`
- [x] A7: post-dispatch conditional nudge（3 条规则：新 milestone 首次 dispatch / dispatch 堆积 / narrative 引用已 shipped）`5f4c3bd`
- [x] A5: 月度 archive audit trigger（tasks Done / reports / research 阈值 + 月度 dedupe）`37d25ee`
- [x] A6: cross-workspace drift 检测（schema version / PROTOCOL.md / baseline 文件存在性）`37d25ee`

### M9 · PM 体系完整性补全 · shipped 2026-05-24
- [x] Cockpit 加 Tasks tab + Research tab（8 tabs 总计）(`973c4f6`)
- [x] Cockpit drawer scroll fix（overflow-y-auto）(`973c4f6`)
- [x] baseline 5 个子文档 stub → 真填 (`8837995`)
- [x] 42 个新测试 (`a41ae22`)

### M10 · PM 全套 i18n · shipped 2026-05-24
- [x] 104 个新 i18n key（中英文各）
- [x] 22 个组件 useI18n 化（Cockpit 8 tabs + ActionBar + drawer + PlanDrawer 7 子组件 + Feishu indicator + WorkspaceSettings 飞书段 + Topbar Cockpit 按钮）
- [x] CJK 扫描 0 命中（PM 范围内无硬编码中文）
- [x] 17 个 i18n 测试（完整性 + 切换 + 组件级）
- 详见 `2b3e2ed` + `7be5d22`

### M11 · HippoTeam-native template catalog · shipped 2026-05-26
- [x] 赵云深度调研 upstream 99d3821 marketplace（429 文件 / 114k 行）— 推荐 B 借鉴概念
- [x] user 确认方案 B：10 个 builtin templates + Add Worker 模板选择器
- [x] 关羽实现：schema v27 seed 10 templates + TemplatePicker UI + governance 纪律内嵌 `9398e09`

### M12 · Cockpit Reports tab · shipped 2026-05-25
- [x] `.hive/reports/*.html` 列表 + 一键打开（复用现有 `open-file` endpoint）
- [x] Cockpit 第 9 个 Reports tab + i18n + parser/UI 测试（本次提交）
- [x] Reports tab 改为当前浏览器新 tab 打开 HTML，避免弹 OS 默认浏览器（本次提交）
- [x] Research / Decisions / Baseline 文档改为当前浏览器新 tab 打开，ideas parser 不再把缩进子条目计为独立 idea（本次提交）
- [x] Cockpit 内嵌文档 viewer：Reports iframe + baseline/research/decisions markdown `<pre>`，不依赖新 tab / 弹窗（5c7227e）
- Q2 答复：要做。优先级从 low 提升为正常队列

### M13 · PM 体系团队共维护 5 层架构 · shipped (Layer 1+2+3+4+5) 2026-05-24
- [x] Layer 1 dispatch prompt 自动注入 PM_DISPATCH_REMINDER（`7c95e2d` + `2432b09`）
- [x] Layer 2 WORKER_RULES + ORCHESTRATOR_RULES + CLAUDE.md + AGENTS.md 明确 PM 文档共维护（`7c95e2d`）
- [x] Layer 3 pre-commit hook 拦截 reports/*.html 缺同日 research/*.md（`7c95e2d` + hook fix `afe9148` + harden `cc529b9`）
- [x] Layer 5 Cockpit orphan report detector → high priority aiAction（`7c95e2d` + nested recursion fix `cc529b9`）
- [x] Layer 4 worker dispatch 注入紧凑 Cockpit snapshot（commit 见本 dispatch report）
- 触发：paseo 调研（5/24）暴露 orch 误读"偏交付 / 偏笔记"为 XOR 而非 AND，连续派 worker 出 3 份 HTML 报告都没补 research note。user 明确要求从 reactive audit 升级为整个团队共同维护 Cockpit / PM 文档。
- 实战首秀：关羽 PTY stuck → orch rescue v3 HTML 时 hook 真拦截 → fix bug → harden audit 6 类 edge cases（10 new tests），1077 tests passing 全绿
- 设计：`.hive/reports/team-pm-co-maintenance-design-2026-05-24.html`
- ADR：`.hive/decisions/2026-05-24-team-pm-co-maintenance.md`

### M14 · mobile + voice 扩张方向（paseo 借鉴） · shipped (M14a) 2026-05-25
- [x] Q4 答复：纳入 plan.md（user 明示"未来方向是语音控制多 agent 开发"）
- [x] 路线拍板：Feishu voice command MVP 先行，self-built mobile 后续（→ M19 实现）
- 核心使能模块：idea-1 (paseo expo-two-way-audio 双向音频，Q5 folded)
- 其余候选 idea：idea-3 (provider catalog) + idea-4 (timeline 模型)
- 开工时拆 sub-task + 起 ADR：自建 mobile vs 借第三方框架 vs 飞书 + voice plugin 第三路径
- [x] 路线 ADR 调研 draft：推荐先走 Feishu voice command MVP，保留 self-built mobile / realtime framework 升级出口（commit 7983182）
- [x] **路线拍板**：user 飞书"干！"确认走 **M14a Feishu voice command MVP**，ADR 转正已采纳（2026-05-25-m14-voice-path.md）
- [x] **M14a Phase 1（f37b21f）**：飞书语音接入 spike（语音事件/音频下载/STT 三未知）+ 第一刀实现（audio→飞书内置 ASR→复用 inbound 注入 orch）。STT 飞书内置 vs 外接 = Q10 待 user 拍；真实飞书 E2E 留后续。
- [x] **M14a Phase 2**：user Q10 拍板 D（本地 STT）。实现 LocalSttProvider：飞书 audio 下载临时文件→本地 `whisper-cli` / `whisper` 转写→复用 inbound 注入；无 CLI 时优雅降级到飞书内置 ASR / drop。

### M14b · 本地 TTS 念回（续 M14a，语音闭环基础）· code-complete 2026-06-02 (commit `8822e03`，钟馗0blocking，需4010重启激活端点)
- 目标：补"结果语音念回"——文字→本地 TTS→手机播放，跟 STT 对称，数据本地/离线/零云。
- [x] **服务端 LocalTtsProvider**（吕布 `c9d18b76`，镜像 local-stt.ts：piper(--model+--input_file 写文本)优先/macOS `say` 中文Tingting fallback；format/mime 贯穿）+ voice.synthesize relay 方法 + /api/mobile/voice/synthesize 端点。钟馗 2 轮（piper stdin 坑+format 谎报→闭环）。
- [x] **移动端念回**：由 M35 对讲模式承载（收到 orch_reply → synthesizeVoice → 播放），契约 {audio,format,mime}。独立 Settings 开关未单做（对讲模式已含念回）。
- **待 4010 重启**激活 voice.synthesize 端点 + user 真机验念回。

### M14c · 语音念回 Settings 开关（非对讲场景）· deferred
- 普通聊天页"收到 orch 回复自动念回"的独立开关（对讲模式之外）——M14b 的念回现绑在对讲模式里，普通聊天场景的念回开关待需要时做。

### M15 · Cockpit Questions answer flow · shipped 2026-05-24
- [x] Questions tab Answer button opens a Radix dialog with Q text + textarea
- [x] POST `/api/workspaces/:id/cockpit/questions/:qId/answer` moves open questions into `## 已答`
- [x] questions parser exposes answered history with `answer` metadata
- [x] tests: parser + routes-cockpit + Cockpit Questions UI (`738c657`)
- [x] wave 2: ActionBar / Ideas / Decisions handlers + POST endpoints (`f99b98e`)
- [x] answer route auto-nudges active orchestrator PTY after user answers a question（M17/idea-6 闭环，本次提交）

### M16 · Codex MCP browser E2E 能力 · shipped 2026-05-24
- [x] 调研 browser MCP 候选：Playwright MCP / Chrome DevTools MCP / Browserbase MCP
- [x] 选择 `@playwright/mcp@0.0.75`，通过 Codex builtin preset `-c mcp_servers.playwright.*` 注入
- [x] schema v22 migration 刷新已有 DB 的 builtin Codex preset
- [x] tests: settings API + agent bootstrap + schema migration
- [x] PM docs: `.hive/reports/codex-mcp-browser-spike-2026-05-24.html` + `.hive/research/2026-05-24-codex-mcp-browser.md` + `.hive/decisions/2026-05-24-codex-mcp-browser.md`
- 注：M15 已被 Questions answer flow 占用；本 milestone 顺延为 M16，避免重写已 shipped milestone 编号。

### M17 · paseo skills playbook 体系借鉴 · shipped (idea-2 promote 5/25)
- [x] 把 paseo 5 个 playbook（handoff / advisor / committee / epic / loop）转译成 HippoTeam 形态
- [x] 调研 + 设计产出：`.hive/reports/m17-skills-playbook-design-2026-05-25.html` + `.hive/research/2026-05-25-m17-skills-playbook.md` (`3b9a5f0`)
- [x] Handoff playbook first slice：template seed + ORCHESTRATOR_RULES + Cockpit playbook aiAction + ADR draft (`d1cab8a`)
- [x] Loop playbook second slice：template seed + ORCHESTRATOR_RULES + conservative Cockpit playbook aiAction (`1fa7f2e`)
- [x] Advisor / Committee / Epic final slice：template seed + ORCHESTRATOR_RULES（commit 见本 dispatch report）
- [x] 产出：`.hive/templates/*` playbook 模板 + ORCHESTRATOR_RULES 对应规则 + Cockpit ActionBar 建议
- 触发：idea-2 promote。成熟度🟢高，不依赖 mobile/voice 决策，直接增强当前 PM 体系
- 先派 worker 出调研 + 设计（reports/*.html + research/*.md 配对），再实现
- 排在 M14 mobile+voice 之前做（user 5/25 排序）

### M18 · Provider capability manifest（paseo 借鉴 idea-3） · proposed (Q8 promote 5/25)
- [ ] preset 加详细能力声明（mode / risk / unattended / feature），orch 派单时按能力路由，取代当前 4 preset 平铺枚举
- [x] **先做 scoping spike**（成熟度🟡）：调研现有 preset 设计的真痛点 + orch 派单实际需要哪些能力维度，产出 reports/*.html + research/*.md，再决定实现范围/是否值得做
- [x] **M18a 能力可见版**：后端 manifest + preset/team/mobile 数据暴露 + worker dispatch 上下文注入（不做自动路由，2026-05-29，待 commit hash 回填）
- 触发：idea-3 promote，user Q8 答"同意"（5/25）。来源 multica/paseo provider catalog
- 注意：别滑成 multica 式重平台；HippoTeam 保持轻量，manifest 只服务"派单更精准"

### M19 · HippoTeam native app / dashboard · shipped 2026-05-27（原生 app + dashboard 已上线在用；细分 M19a-h 全 shipped；productization 接 M24。状态从 confirmed 更正——避免被 active-milestone 误选为"当前"）
- [x] 初版路线调研：拆解 paseo app 端 + 对比 PWA / desktop shell / native mobile（`2fa6425`，结论已被 user 覆写为原生-first）
- [x] **路线拍板**：user 明确要原生 APP / 最佳体验，不因实现难或与飞书重叠降级；ADR 已采纳 `.hive/decisions/2026-05-25-hippoteam-frontend-app.md`
- [x] Epic 架构设计：client/daemon 升级 + Expo/RN app + host token auth + direct LAN + encrypted relay + M14 voice convergence（commit e895380）
- [x] **M19a**：协议 audit + Expo/RN app skeleton + LAN 只读 dashboard（Cockpit summary + Tasks + Workers）— shipped `59ea75a`→`1ef7b00`→`d237009`→`a263adf`
  - [x] 子任务 1：现有 HTTP/WS 协议 audit + native app 稳定 API 缺口分析（`59ea75a`）
  - [x] 子任务 2：Expo skeleton + LAN 连接 spike（`1ef7b00`）
  - [x] 子任务 3：mobile API 层 — Bearer auth + dashboard aggregate + WS（`d237009`）
  - [x] 子任务 4：Expo app 对接 mobile API — dashboard/workers/tasks 数据展示（`a263adf`）
- [x] **M19b**：permanent token auth + device registry + scoped direct LAN control（send/approve/stop/restart）— shipped `c83ae50`
  - [x] 子任务 1：API contract + schema 设计 spike（赵云，reports + research）
  - [x] 子任务 2：runtime 后端 permanent token / device registry / capability checks / mobile control endpoints（关羽）
  - [x] 子任务 3：Web 端设备管理 UI — MobileDevicesSection + i18n（马超）
  - [x] 子任务 4：Expo app 配对流程 + SecureStore + control actions（赵云）
  - [x] 子任务 5：集成测试验证 7 tests（典韦）
  - [x] 补丁：devices endpoints UI auth 支持（关羽）
- [x] **M19c**：encrypted relay remote access（daemon outbound connector + app relay transport + E2E encryption）`414cbae` `71730bb`
  - [x] 子任务 1：独立 Node.js WebSocket room relay package（关羽，6 tests）
  - [x] 子任务 2：shared E2E encrypted channel — tweetnacl NaCl box + handshake（吕布，17 tests）
  - [x] 子任务 3：Runtime outbound connector — relay.json config + WS connect + heartbeat + backoff + RPC handler（关羽，10 tests）
  - [x] 子任务 4：Mobile relay transport — LAN→relay fallback + E2E handshake + JSON-RPC（赵云，7 tests）
- [x] **M19d**：agent/terminal pane + task operations（worker transcript + dispatch task history）— `942cf9c`
- [x] **M19e**：voice + push convergence（M14 voice command 迁入原生 app，push worker done/high aiAction）`9b17101`
  - [x] 子任务 1：Push notifications — schema v26 push_token + Expo push API + worker done/high aiAction triggers（赵云）
  - [x] 子任务 2：Voice input — POST /api/mobile/voice/transcribe + VoiceRecordButton + expo-av recording（吕布，8 tests）
- [x] **M19f**：beta hardening + distribution（EAS internal/TestFlight/Android internal + docs + baseline 回填）— shipped（pending commit hash）
- [x] **M19g**：mobile command center UI redesign（3-tab Chat / Status / Settings，Chat 本地 mock + Status 真实 dashboard，version 0.2.0）— pending commit hash
- [x] **M19h**：mobile app 完整视觉设计 spec（6 组基础手机框架 mockup + mobile Cockpit Plan/Tasks/Questions/Ideas/Actions 补充 + navigation / token / component / API mapping）— `.hive/reports/mobile-app-design-spec-2026-05-27.html`
- [x] **M19i**：mobile app 产品级 v2 设计 spec（12 张 image-generated 手机界面 mockup + Chat/Status/Settings/Worker/Cockpit/Approval/Error 全覆盖 + chat 协议 / mobile cockpit auth / push / offline 实施规范）— `.hive/reports/mobile-app-design-v2-2026-05-27.html`
- 触发：user 问“Paseo 是有 APP 端的，我们是不是可以为 HippoTeam 做一个前端 APP？这样所有任务看起来很方便，也可以有面板。”后继续拍板“要原生、要最好”。

### M20 · Sentinel Worker · shipped 2026-05-26
- [x] 新增 `sentinel` worker role，每个 workspace 最多一个，创建时固定使用 Claude preset
- [x] runtime 每 30 分钟向 active sentinel PTY 注入 Cockpit snapshot + git summary heartbeat
- [x] sentinel guidance / startup prompt 明确只观察和提醒，不写文件、不派单、不通知 user
- [x] `team-authz` 限制 sentinel 只能 status/report/help，禁止 send/cancel/list 等 orchestrator 权限
- [x] Workers 面板顶部独立展示 Sentinel 卡片，不混入普通 worker status 分组
- [x] backend 支持编辑 worker description / preset / thinking_level / sentinel heartbeat interval
- [x] tests: heartbeat 注入、创建唯一性、authz 拒绝 send、UI 独立区域

### M24 · Mobile App 产品化实现 · in_progress
- [x] **Phase 1**：Chat 双向消息后端（mobile_chat_messages 表 + mobile prompt / orch_reply 捕获 / dispatch / worker report 写表 + WS push + REST history endpoint）— 2026-05-27
- [x] **Phase 2**：12 页面 UI 实现（Chat/Status/Settings/Worker Detail/Cockpit 5 tabs/Approval/Offline 全部按设计稿实现）— 2026-05-27
- [x] **Phase 3**：Token 认证替代 pairing code（永久 token CRUD + Web 管理 UI + 删除 pairing_codes 表）— 2026-05-28
- [x] **Phase 4**：Demo Mode（假数据预览全部页面，无需 LAN 连接）— 2026-05-27
- [x] **Phase 5**：Orchestrator reply 自动回灌（PTY 输出捕获 → mobile_chat_messages orch_reply）— 2026-05-27
- [x] **Phase 6**：UI 设计对齐 + 实时终端同步（严格对齐 12 张 mockup + Worker/Orch 终端实时轮询 + Cockpit 子页面接真实 API）— 马超完成 2026-05-28
- [x] **Phase 7**：Push Notification + Approval deep link（真实 Expo push 注册 + 通知 deep-link 路由 approval/worker_done/high_ai_action + notifyApprovalRequested 审批推送=手机审批通道 + 冷启动处理）— 关羽 2026-05-30 `18f68f3`。⚠️ Android 真实投递需配 FCM/EAS push credentials（运维）
- [x] **Phase 8**：Error resilience + 离线缓存（连接模式横幅 LAN/relay/离线 + mobile-outbox 持久化队列 prompt/dispatch/approval 入队-flush-去重 + 重连/回前台 syncRevision 增量追平 dashboard/tasks/cockpit/chat）— 关羽 2026-05-30 `fb5999c`。真断网/重连端到端待真机验
- [x] **新增 Worker（手机端）**：Status 页「+」入口 + AddWorkerModal 最简安全版（只用已有 preset、拒 sentinel、不收 startup_command），后端 mobile create-worker + command-presets 端点（admin_runtime，LAN + relay 双通道），6 后端测试 — 马超 2026-05-30（待 commit hash；spike `.hive/reports/2026-05-30-mobile-add-worker-spike.html`，安全边界 ADR `draft-2026-05-30-mobile-add-worker-safety.md`）
- [x] **L1 机制**：设计 milestone shipped → 自动检测缺实施 milestone
- 设计文档：`.hive/reports/mobile-app-design-v2-2026-05-27.html`
- UI 审核报告：`.hive/reports/mobile-ui-audit-2026-05-28.html`
- 决策：Token 完全替代 pairing code（2026-05-28 user 拍板）
- 前置：M19i 设计 spec 已完成

### M23 · Agent Run Timeline 可恢复事件流 · open
- [x] 设计 AgentRunTimelineEvent schema + AgentRunTimelineStore（SQLite durable，seq/epoch/gap 三概念）
- [x] 实现 tail/before/after cursor fetch API（支持断线重连 catch-up）
- [ ] live event reconciliation（WebSocket 推增量 + gap 检测触发 reset）
- [ ] M22 dispatch row drill down 到 run timeline 视图
- [ ] 调研报告：`.hive/reports/idea-4-timeline-comparison-2026-05-27.html`
- 定位：Terminal/PTY 层的可恢复事件流，补充现有全量 snapshot 模式的缺口
- 来源：idea-4 promote（user 拍板 2026-05-27），paseo seq/epoch/gap 模型借鉴
- Phase 1 后端基础：schema/store/API 已完成（2026-05-29，待 commit hash 回填）
- 前置：不依赖其他 milestone，可独立开工

### M25 · Provider session isolation（借鉴 CCB，补 agent runtime 底层差距） · in progress (user 拍板 2026-05-30；Phase 1 派马超 2026-05-30)
- [ ] 为每个 provider 定义显式 session isolation contract：managed home（独立 config/auth/memory 根）+ session root + binding/完成事件 + diagnostics 边界
- [ ] **先做 Codex + Claude**（本仓最常用、坑最多），再 Gemini/OpenCode
  - [x] **Phase 1 = Codex**（马超 `8e9c1a48`，代码完成待 review/commit）：新增 `provider-runtime-profile.ts`（per-agent managed `CODEX_HOME`=`<dataDir>/agents/<seg>/provider/codex/home` + 派生 `sessions/` 根 + config/auth 投影）；`buildAgentRunBootstrap` 在 fresh+resume 都钉死 managed CODEX_HOME/SESSION_ROOT；`session-capture` snapshot/capture 改读 managed 根（消除多 codex worker 串线根源）；dataDir 经 createAgentRuntime→starter 下穿，无 dataDir 退回全局（向后兼容）。强 TDD：`tests/server/codex-provider-isolation.test.ts` 9 条（禁 mock PTY），server tsc 0 错。产出 `research/2026-05-30-codex-session-isolation-contract.md`。**留后续**：legacy 全局 session 迁移、authority fingerprint 持久化、memory/plugins/skills 投影、Claude/Gemini/OpenCode（Phase 2/3）
  - [~] **Phase 2 = Claude**（马超 2026-06-01，已 commit `8a2b0c1`，钟馗审中 `f3d579ba`；真机验门槛=张飞验 macOS Keychain+重定位 HOME 非交互登录通过后才可默认开门控）：`provider-runtime-profile.ts` 加 `resolveClaudeManagedHome`/`resolveClaudeProjectsRoot`/`resolveClaudeSessionEnvRoot`/`materializeClaudeManagedHome`（建 `.claude/projects`+`session-env` 根 + 投影 settings.json/.credentials.json/.claude.json + macOS Keychain 兼容态）；`buildAgentRunBootstrap` 在 resume 校验**之前**物化 managed home，fresh+resume 都钉死 `HOME`+`CLAUDE_PROJECTS_ROOT`；resume 存在性校验经 `withPresetResumeArgs`→`doesCapturedSessionExist`→`hasClaudeSessionFile` 新增 `claudeProjectsRootOverride` 改扫 managed 根（不串全局历史）；`snapshotSessionIdsForCapture` 加 claude projects 覆盖。**契约确认（CCB `claude-session-isolation-contract.md`）**：Claude 无 `CLAUDE_HOME` flag → 隔离必须重定位私有 `HOME`，`CLAUDE_PROJECTS_ROOT`==`<HOME>/.claude/projects`。**默认关闭，`HIVE_CLAUDE_MANAGED_HOME=1` 显式开**（因 macOS 登录态在 Keychain，重定位 HOME 鉴权风险偏高，需张飞真机验后再默认开；区别于 Codex 的文件 auth 可放心默认开）。与 M32 cwd 维解耦。强 TDD：`tests/server/claude-provider-isolation.test.ts` 11 条全绿 + layer-a-resume 真 PTY 回归绿；server tsc 0 错、biome 干净。**留后续**：memory/skills/commands 投影、authority fingerprint、legacy 全局迁移、Gemini/OpenCode（Phase 3）。**钟馗复审 `f3d579ba` 通过（0 blocking，核心 resume 隔离链路成立）**；3 个 medium = **启用门控前硬化清单**：①(必须)MEDIUM 1——managed HOME 重定位后 `~/.gitconfig`/`.ssh`/`.npmrc`/`gh` 等工具配置缺失，Claude agent 的 git/gh/npm 能力会退化，须按 allowlist 投影必要工具配置才能默认开 ②MEDIUM 2——触发绑 `capture source==claude_project_jsonl_dir` 而非 `provider==claude`，自定义 preset 边界要补显式 provider 判定 ③MEDIUM 3——darwin Keychain 分支无测试，拆可注入 platform 纯函数补测 + 张飞真机验
- [ ] 与已有 session capture / Layer A resume / Layer B fallback 对齐，消除 session 串线 / resume 错绑 / provider 状态污染
- [ ] （配套，可单列 M25b）hive doctor / support bundle：一键导出 runtime.sqlite schema/version + agent runs + dispatch ledger + last PTY lines + logs + PM docs orphan 检查
- 来源：钟馗 CCB vs HippoTeam 对比调研（`.hive/reports/2026-05-30-ccb-vs-hippoteam-comparison.html`）排第一的差距；ADR `.hive/decisions/2026-05-30-provider-session-isolation.md`
- 定位：补 agent runtime 底层（CCB 最强、hive 最薄的一维）；接今天修的 worker 卡死/session 判别符（`04024dd`/`6a3b9b5`/`385c0ae0`）往下做厚
- 代价：动 runtime + 测试，改动大风险高，必须分阶段 + 强 TDD（§13 集成测试禁 mock PTY）；不破坏 PM 治理/远控等 hive 差异化优势

### M26 · Worker 汇报可靠性（idle 自愈 + Fix B 误报根治） · shipped 2026-05-30 (`80cfd91`，4010 重启已生效)
- [x] **L1 机制**：把卡死检测从「时间驱动(4min) nudge orchestrator」升级为「worker PTY 回到 idle 提示符 + 有 submitted 未 report dispatch → 直接 nudge worker stdin 自补 report」，最多 2 次再回退 orchestrator nudge
- [x] 复用 `hasInteractivePromptReady`（post-start-input-writer）+ Fix A「只看新输出」防旧提示符误触发；idle 检测留 nudge/sentinel 层，不侵入 agent 运行热路径
- [x] **顺手根治 Fix B 误报**：真 idle 才触发→正在干活的 worker 永不被打扰（本 session 多次误伤赵云/关羽/马超）
- [x] **L2 提示词**：WORKER_RULES + REMINDER_TAIL 加硬话——文字总结≠汇报，必须运行 team report CLI，turn 结束自检
- 触发：本 session 马超 M25 干完用文字 recap 收尾、没真跑 team report → dispatch 卡 submitted 看着像卡死；agent 状态 `pendingTaskCount>0?working:idle` 是假信号
- 强 TDD（§13 禁 mock PTY）；文件边界避开 M25 未提交改动；PM 待落 ADR
- [x] **加固（马超 2026-05-31，代码完成待 review/commit）：从"只 nudge LLM"升级为"系统直接 surface 给 user，绝不静默"。** 触发：赵云干完 6 项 UX 不跑 team report，是 user 先发现的、不是系统兜住的，user 要彻底解决。
  - 关键澄清：dispatch ledger 状态只有 `queued/submitted/reported/cancelled`，**无 in_progress**——`submitted` 就是"已注入 worker、未 report"的窗口（= "干完没报"场景），现有检测已覆盖；不新增 schema 态（避免迁移风险）。
  - 新增纯函数 `stale-dispatch-status.ts`（`summarizeStaleDispatches`，dashboard 与 nudge 共用单一判定，按 submittedAt 时长出 stale/escalated 两档）。
  - **user 可见看板信号（最关键、立即生效）**：`buildMobileDashboard` 的 cockpit 块新增 `stale_dispatches` / `escalated_dispatches` 计数，user 在手机看板直接看见"N 个派单超时未汇报"，走现有 dashboard 拉取/relay，不靠 LLM nudge。
  - **user 可见推送**：`stalled-dispatch-nudge` 加 `notifyUserOfStaleDispatch` 回调（always-on pass，不 gate worker idle/在线——哪怕 worker 卡死从不回提示符或所有 LLM nudge 被忽略都按时长兜底）；`mobile-push` 加 `notifyStaleDispatch`（stale + escalated 两档各推一次，去重）。⚠️ push 投递半边受 M29 制约（华为机无 GMS，exp.host→FCM 收不到）；**看板计数是当前可靠的 user 可见兜底**，push 待 M29 打通通道后生效。
  - escalation：超 escalated 阈值（默认 8min，约 2 次 worker nudge + orchestrator 兜底应已发生）→ 第二档 user 推送 + 看板 escalated 计数；orchestrator 侧仍是原 fallback nudge。
  - 未破坏 Fix A/B：原 idle 自愈 nudge（submitted + 回 idle 提示符 → nudge worker 最多 K 次 → 回退 orchestrator）原样保留，新机制是其上的 user-surface 层。
  - 改动文件：`stale-dispatch-status.ts`(新)、`mobile-push.ts`、`stalled-dispatch-nudge.ts`、`runtime-store-helpers.ts`、`routes-mobile.ts`；测试 `stale-dispatch-status.test.ts`(新,6)+`stalled-dispatch-user-surface.test.ts`(新,5,真 ledger 无 mock PTY)+`mobile-routes.test.ts`(+1)。
  - 剩余：#4「真在干 vs 干完没报」per-dispatch idle 布尔未单列进 dashboard（需 per-request PTY snapshot，留 Phase2）；现用 stale/escalated 时长分档 + idle-gated nudge 近似区分。

### M27 · Relay 远程体验优化（跳过 LAN 空试 + 实时推送） · shipped 2026-06-01（user 真机验证 4G 确实变快；Part B 推送随 4010 重启生效）· 代码全 commit `ba631cf`
- ✅ **2026-06-01 user 验证**：4G relay 下 app 确实变快（Part A 跳过 LAN 空试生效），Part B 实时推送随 4010 重启生效。剩两项收尾：①4G 攻坚正式 HTML 报告重派马超（吕布之前 opencode context 爆没出完）②仪表盘待办按钮文案 i18n 派关羽（user 已批"可以去做"）。
- 触发：4G relay 连接修好稳定后 user 反馈 ①慢 ②"经常连接像重连"。诊断：app 每请求先试 LAN(client.ts readMobileJson, 4s AbortController)再 fallback relay，4G 下每请求挂 4s + UI 闪连接中；新消息走 5s 轮询有延迟。
- [x] **Part A 跳过 LAN 空试**（马超 `8cb009de`，代码完成待 review/build）：`client.ts` 加 `lanCooldownMs`(默认30s) + `lanCooldownUntil`——LAN 请求失败即开 cooldown 窗口，窗口内 `readMobileJson` 直接走 relay 跳过 ~4s LAN 空试；LAN 成功即解除（回 WiFi 优先直连）；暴露 `resetLanCooldown()` 供网络变化强制重探。TDD 4 条。
- [x] **Part B relay 实时推送**（马超 `8cb009de`，代码完成待 review/build）：daemon `relay-connector` 加 `pushEvent(kind,payload)`（复用 channel.encrypt 推 `{type:'event'}` 无 id 帧给活跃 session）；`app.ts` 在**已有** registerCockpitListener/registerMobileChatListener 通知点同步推 `dashboard_update`/`chat_message`（不另造通知源）；`relay-transport.handleEncryptedPayload` 加 `onEvent` 路由（无 id 的 event 帧不当 RPC 回应）；context 订阅 onEvent→即时 merge chat / 刷 dashboard；chat 轮询 5s→20s 降频兜底。TDD：transport 路由 2 条 + daemon pushEvent 2 条。
- 强 TDD（§13 禁 mock PTY）；不破坏握手/RPC方法/churn修复/evict-old；测试全绿（mobile 40 + server relay 20）；server+mobile tsc 0 错、biome 干净。**B 动 daemon，需 4010 重启生效**。
- **build #19 含全部**：M27 Part A/B + cockpit 一致性批次（milestone 编号 `e4f8106`、Ideas 编号 `b2f4dea`、Tasks 内容对齐 web `8aecdb8`、cockpit 标签页实时 `2956b14`）。Part A/编号/Tasks 装上即生效；Part B 推送 + cockpit 实时需 4010 重启。Action 文案 i18n（后端发 key）单列待 user 拍。
- 关联：本次 4G relay 连接攻坚（5+1 层 bug 全修，commit `9289919`→`dbbb640`，全过程记于 tasks.md 📡🔥 narrative + `.hive/research/2026-05-30-relay-deployment-kit.md`；polished HTML 报告吕布写时 opencode context 超限止损未成，可后续重派）；cockpit 一致性审计 `.hive/reports/2026-05-30-mobile-cockpit-consistency-audit.html`

### M28 · 手机端追平 Web（mobile-vs-web UI 一致性） · ✅ Phase 1 + Phase 2 主体 shipped 2026-05-31~06-01（#20~#24：Track A 服务端扩字段 5a07730 / Track B 前端降级保留 05fb52d / 多图卡片 chat-media / i18n 全收口，钟馗多轮审）；零星 P2 polish（删/编辑 Worker、Actions targetTab 跳转）滚动收
> 依据：workflow 全量审查 `.hive/reports/2026-05-31-mobile-vs-web-ui-audit.html` + `.hive/research/2026-05-31-mobile-vs-web-ui-audit.md`（82 agent / 2.5M tok，0 critical / 10 high / 28 medium / 25 low）。
> 根因不在 UI：**服务端 `routes-mobile.ts` 的 mobile API 只暴露 5 字段**（plan/tasks/questions/ideas/actions），baseline/decisions/research/reports/timeline 源头没输出；且错误处理「清空」而非「降级」。**修服务端一处、多页受益。**
> ⚠️ drift：M24 Phase 5「orch_reply 自动回灌」、Phase 7「审批推送通道」标 done 实则坏了（见 Phase 1 P0/P1）。

- [x] **Phase 1 = P0/P1（阻塞 PM 核心闭环）** — done 2026-05-31（Track A `5a07730` / Track B `05fb52d` + 里程碑排序 `48e3225`；**Track A 需 4010 重启激活，Track B/排序需 #20 装机激活**）
  - **Track A 服务端（派马超）**：`routes-mobile.ts` mobile cockpit/chat API 扩字段 + 修后端根因
    - [x] `orch_reply` 正常对话回复也写 `mobile_chat_messages`（马超：重启用现有 PTY 捕获管道——`startPendingReply` 不再 no-op；mobile 输入开捕获窗，10s 静默 flush，过滤系统消息/派单注入/工具/思考行；`team mobile-reply` 走公共 insert→`noteExplicitReply` 丢弃同轮缓冲防重复）
    - [x] `approval_request` 真正持久化到 chat DB（马超：`team approve` 路由 `approvalLedger.create` 后写一行 outbound approval_request 到 mobile_chat_messages，手机端渲染审批卡；mobile resolve 路径本就不依赖 feishu）⚠️ 见 open-questions：当前仍受 feishu 路由门控，纯 mobile-origin 无 feishu chat 场景待 PM 拍是否解耦
    - [x] run `started_at` 不再硬编码 null（马超：`TerminalRunSummary` 加 `started_at`，agent + shell 两处 listTerminalRuns 回填 `run.startedAt`，`buildMobileDashboard` 输出真实 ISO 时间戳）
    - [x] mobile cockpit API 暴露 decisions/baseline（马超：`/cockpit` 端点复用同一 `parseCockpit` 结果，新增 baseline/decisions/reports/research/archive 字段；timeline 源不在 parseCockpit，留 Phase 3）
  - **Track B 前端独立 P0（派赵云，不依赖 Track A，文件不冲突）**：`packages/mobile/src/*`
    - [x] `thinking_levels` 类型修正（对象数组非 `string[]`）→ 新增 worker 选 thinkingLevel 不再显示原始 value
    - [x] 重连失败 `setDashboard(null)` → 改为保留上次数据降级（命中 user 最怕「出门查一眼全没了」；4G 必现）
  - [x] `ConnectionModeBanner` reconnecting 时显示 disconnected 态而非误显 wifi/relay 图标
  - [x] Dead Button 统一处理（Filter/Menu/「...」点击无响应 → 接功能或隐藏）
  - [x] 最新 active milestone 选择、chat 发送态判定和新英文硬编码已收口（M28 #22）
  - [x] Settings「连接详情」中继/LAN 行改为可点击切换；LAN 可用时前台恢复会先重探 LAN，避免 relay 冷却黏住
- [ ] **Phase 2 = P2（近两 build）**：Sprint Narrative 文字、Cockpit `dashboard==null` 保留旧数据、发文字+附件双消息 bug、Plan 补 Goal/Scope/Risks/currentPhase、补 Baseline/Decisions tab、删除/编辑 Worker、Actions `targetTab` 跳转
  - [x] Chat 图片消息已压缩为单图卡片，发送态区分 `sent` / `queued` / `error`，避免成功后仍显示红叉
  - [x] Chat optimistic 去重改为按 server echo 一对一消费，真实重复发送同文案/同图片不再被误删（**#23 钟馗复审抓到此处仍误删的 HIGH 回归：之前只按文本扫全历史、忽略时间→历史已有同文案就把新连发提前吃掉；马超 2026-05-31 改为「server echo 只能消费在它之前创建的 optimistic」一对一，补反例测试，第三次根治**）
  - [x] Settings 连接徽章状态文案接回 i18n，connected/idle/checking/error 不再直接吐英文 state
  - [x] Workers 卡片状态文案接回 i18n，Working/Idle/Stopped 不再硬编码
  - [x] **#24（赵云 codex 卡死转马超 claude，2026-05-31）多图显示 + composer/标题**：① 发 N 张图原本显示成 N 个空绿框→整合赵云的 `chat-media.ts`（`extractChatMediaItems`/`buildChatMediaEnvelopeJson`），optimistic content 写全部 N 张附件、气泡 `mediaGrid` 渲染 N 个真实缩略图（多图用 104² compact 缩略图）；移除只读单 `media` 的旧 `parseMedia`；#23 去重未丢 uri（content_json 携带 attachments）。② composer 字体 15→14 保 placeholder 单行；③ 左上角标题 `Orchestrator` 硬编码→主标题=当前 workspace 名（取数据）+ 副标题「项目主管·PM」(i18n `chat.header.subtitle`)，保留中继 badge+在线药丸。强 TDD：`__tests__/chat-media.test.ts` 6 测（N 图 round-trip/caption/单图/纯文本无 media/legacy media/丢弃残缺项）。mobile tsc+biome+104 测全绿。待钟馗审 + 真机验。
  - [x] Workers 角色 / 能力 / CLI / 风险 / Unattended 标签全量收口，中文界面不再漏英文
  - [x] **#25 index.tsx i18n 彻底收口（马超 2026-05-31，最后一轮）**：通读全文件，把所有 user 可见硬编码英文接 t()——系统事件标题/摘要（Dispatched / Dispatched→worker / Worker Report / Report from worker + 两条 fallback 摘要，`parseSystemEventPayload` 加 `t` 参数，**复用早已存在但从没接的 `chat.system.*` key** + 新增 reportFallback）、审批兜底主语 `Approval request`、风险标签 `High/Medium Risk`、orch 气泡 senderLabel `Orchestrator`、媒体标签 `Image/Image·size/File/Video/{size} video`（MediaContent 加 useT）。新增 11 个 key（EN+ZH 各）。残留扫描仅剩 `Bearer` auth header（非可见，保留）。mobile tsc+biome+104 测全绿。待钟馗确认 i18n 干净。
  - [x] 状态 / 驾驶舱 / 设置三页的 ConnectionModeBadge 收进标题行，移除独占整行 banner
  - [x] **#26（马超 2026-05-31，钟馗 #24 复审发现的 3 个 regression）**：① 发 1 张图出现 2 个图气泡（真图 + 空绿框）—— 根因：服务端把 1 张图+caption 拆成 2 条 chat 消息（upload echo 带 `media:{}` + prompt echo 文字 `[附件:...]`），客户端 optimistic（attachments[]+caption）与服务端 media echo 文字不一致、按文字 key 去重消不掉 → 重复。修：`chat-message-dedupe.ts` 的 key 改为**带附件按媒体文件名集合**（纯文字仍按文字），同一图的 optimistic 被服务端 media echo 按文件名一对一消掉（沿用 #23 时间门控），剩 1 个图气泡 + 1 个文字气泡。② 文字气泡 ✓：user_text footer 本就无条件渲染发送状态（server 消息 sendSucceeded→sent→✓），#1 去重后最终态=图气泡✓ + 文字气泡✓，清爽；已加 send-status/footer 保证测试。③ placeholder 缩短：`chat.input.placeholder` EN `Message orchestrator...`→`Message...`、ZH `给 orchestrator 发消息...`→`发消息...`，保证单行。强 TDD：dedup +4 测（media echo 消图 / 文字 echo 不误消 / 双 echo 仅 media 消 / 旧图 echo 不消新发）。mobile tsc（我的文件）+biome+113 测全绿。**注**：多图（N>1）服务端拆成 N 条 media echo，optimistic 单条 grid 与之非 1:1，仍可能并存——本派单聚焦 1 图，多图留观察。待钟馗审。
  - [x] Cockpit Plan 里程碑展开详情基础 markdown 渲染（bold/code/quote/list/wiki-link 去壳）已收口
  - [x] **终端（实时）视图渲染改进（马超 2026-05-31，独立 build；`app/agent/[id].tsx`）**：user 截图 orch 终端文字错乱吞字（"secuses/s1rvices"）。根因三层——①`termLine` 用 `'Courier'`，安卓无此族→回退无衬线→不等宽错位；②服务端 headless-xterm 序列化快照只 strip 了 CSI，残留 OSC/字符集/控制字符；③快照 80 列，窄屏 wrap reflow 糊成团。修：① 等宽字体 `Platform.select({ios:'Menlo',default:'monospace'})`；② 新增纯函数 `src/lib/terminal-text.ts`（`sanitizeTerminalLine`/`cleanTerminalLines`：去 OSC/CSI/短转义/孤立 ESC/控制字符 + 解 \r 覆盖 + 去尾随空白），渲染前清洗；③ 终端行包进**横向 ScrollView + 每行 numberOfLines=1**（不再 wrap reflow，长行横向滚动），inline+全屏两处都改。强 TDD：terminal-text 11 测（CSI/OSC/字符集/控制字符/\r 覆盖/CJK 不损/maxLines）。mobile tsc（我的文件）+biome+125 测全绿。**做到 1+2+3 全部**。剩余：深度终端模拟（光标定位/SGR 配色还原）未做，非本轮目标；待钟馗审 + user 真机验。
    - **服务端配套修复（马超 2026-05-31，钟馗审出，需 4010 重启）**：`routes-mobile.ts transcriptLinesFromSnapshot` 之前发手机前 `.replace(/\r/g,'\n')`+每行 `.trim()`，把前导缩进删了、\r 提前拆成残影多行 → 客户端 terminal-text 的缩进保留/\r 覆盖在真实路径失效。改：① 只按 `\n` 切行（不再全量 \r→\n）；② 每行 `.trim()`→`.trimEnd()`（保前导缩进/Tab），空行判断用 `trim().length===0` 不删被保留行缩进；③ 抽 `resolveLineCarriageReturns` 在切行后对每逻辑行解 \r 覆盖（剥行尾 \r\n 残留 + 取最后一次写入），route 输出已正确、与客户端幂等。确认该 transcript 仅 mobile 消费（HTTP `/transcript` + relay `worker.transcript`），未碰 web。强 TDD：+2 route/transcript 层测试（真 PTY 验前导缩进保留 + craft 快照验 \r 覆盖/Tab/ANSI strip）。server tsc + mobile-routes 28 测全绿。
  - [~] **消息重复 ⑥ 服务端根治（马超 2026-06-01，code-complete 待钟馗审；需 4010 重启 + 出包）**：#23/#26 是**客户端** optimistic 去重；本条治**服务端**根因——`mobile_chat_messages` 只有随机 id、无幂等键，inbound 插入路径无去重，手机重发→存两条→注入 orchestrator 两次→回两次（DB 实锤同句两条差 1m43s）。两层防线：**主**=schema v33 加 `client_nonce` 列 + 部分唯一索引 `(workspace_id,client_nonce) WHERE client_nonce IS NOT NULL`；`mobile-chat-store.insertChatMessageIdempotent`（nonce 命中→返既有行 deduped、不插不推 watch）；facade `insertMobileChatMessageIdempotent`（去重命中不触发 watch 回调）；routes-mobile `/prompt` + relay `workspace.prompt` 取 client_nonce、幂等写后**命中则跳过 recordUserInput 注入**；mobile 发送端 compose 时 `createClientNonce()` 生成稳定 nonce、HTTP body + relay params 都带、outbox replay 复用同一个。**兜底**（让旧 app/2.3.1 重启 4010 后也缓解）=无 nonce 时按 `(ws,inbound,type,content,10s 窗口)` 去重。强 TDD：真迁移 store dedup 矩阵 6 测 + 穿透真 RuntimeStore 集成 3 测（同 nonce 一行一回调 / 异 nonce 两行两回调 / 无 nonce 同文本窗口内兜底）全绿；server tsc 0、mobile tsc 0、biome 净；mobile-routes/relay/app/schema 回归全绿。**依赖**：①server+schema 需 **4010 重启** 生效；②mobile 发 nonce 需**新出包**才精确（兜底让 2.3.1 重启后即缓解）。待钟馗审 + 张飞真机验。
  - [~] **P0 发消息彻底发不出去（马超 2026-06-01，code-complete 待钟馗审 + 出 2.3.2）**：user 2.3.1 发'你好' DB 无任何 inbound→消息根本没到服务器（非显示问题）。**根因：relay transport `call()` 无 per-RPC 超时**（`relay-transport.ts`，pending 只在 socket onclose 时 reject）。4G/后台切换后 relay socket 常"半死"（readyState 仍=1、对端没了、不回 RPC、也不触发 onclose），导致：①`sendPromptToOrchestrator` 经 relay.call 永久挂起→消息发不出、`sending` 卡 true；②foreground 探针的 `getMobileRuntimeStatus` 永久挂起→`reconnecting` 卡死 true→所有发送被 queue + outbox flush 与轮询全停；③outbox flush 的 `await sendItem` 挂起→`outboxFlushInFlightRef` 卡 true→永不再 flush。三条共因，全是"promise 永不 settle"。**修**：`call()` 加 15s `RPC_TIMEOUT_MS`，超时→清 pending+reject+主动关掉这条死 socket（onclose→disconnected→上层 state effect 重连重建新连，快速自愈）；超时只关本次 RPC 的 socket 且仅当它仍是当前 socket（防误杀重连后的新连接）；resolve/reject/onclose 都清 timer 防泄漏/误关。强 TDD：relay-transport +2 测（半死 socket RPC 超时 reject+关连 / resolve 后清 timer 不误关），15 测全绿、mobile tsc 0、biome 净。**注**：经逐行核对，赵云工作区切换 commit(efaa74d/a0d5b61)只改 chat 重置/ref 同步，**发送判定输入(state/reconnecting/relayReady)与 2.3.0 逐字节相同**——真正触发是 relay RPC 无超时(latent，M27 起)被 foreground 探针(d264a99)在半死 socket 上引爆。依赖：**需新出 2.3.2 包**（纯客户端修，不需 4010 重启）。
  - [~] **P0+ relay 深层 wedge 治本（马超 2026-06-01，code-complete 待钟馗审；需重启 4010 生效）**：根因报告 `.hive/reports/2026-06-01-relay-wedge-root-cause.html`+research。症状：来回切到 dead-orch workspace 后逐步进入"再也发不出 + 重登也救不回"的坏态（feishu 仍通=orch 没坏、是 relay 路由断）。**根因**：relay 三方都缺"对端探活"——daemon 收 heartbeat_ack 只记时间从不检查丢 ack（relay-connector.ts），relay 服务器不按 peer 探活/驱逐（relay-server.ts）。4G 半开 socket → **daemon 永久僵尸占住 room daemon 槽** → 手机任意 workspace 的 RPC 被转发给死连接静默丢弃；重登只换 device、daemon 僵尸不变 → 救不回（只有重启 4010 才清）。**修 ①daemon 探活**：relay-connector 记 `lastInboundAt`，心跳 tick 若 `livenessTimeoutMs`(默认 2×心跳+5s≈45s)内无任何入站帧→判死→terminate→onclose→重连重 join（newest-wins 顶掉僵尸，daemon 侧自愈不必重启 4010）；加 `WebSocketCtor`/`livenessTimeoutMs` 测试注入；`unref?.()` 容错。**修 ②relay 服务器 per-peer 探活**：JoinedPeer 加 `lastSeenAt`（join+每帧刷新），cleanup tick 驱逐静默>`peerIdleTimeoutMs`(默认 60s)的死 peer（通知对端+清槽+terminate，先 peers.delete 再 terminate 沿用 newest-wins evict 顺序），保留原 room 空闲 5min 清理不破坏。**强 TDD（真失败模式）**：relay-connector-liveness +2（fake socket+fake timers：半开无 ack→判死+重连 / 持续收帧→不误杀）；relay-server +2（真 ws：静默 peer→驱逐+槽释放 roomCount 0 / 持续心跳→不驱逐）。server+relay tsc 0、biome 净；既有 relay-connector 10 测 + relay-server 7 测 + churn/newest-wins 全回归绿（未碰 M27 那批）。阈值：daemon 45s/server 60s（容忍抖动丢 1~2 拍，user 体感 ~1min 内自愈）。**依赖**：①②是 daemon/服务端改动**需重启 4010 生效**（user 重启时同时清当前僵尸）。待钟馗审。
  - [~] **P0 LAN 模式发消息被 relay 门槛误卡（马超 2026-06-01，code-complete 待钟馗审 → 出 2.3.3；纯客户端需出包）**：诊断面板实锤 connectionMode=lan/Relay=none/state=connected/LAN 读全 OK/DB 零 inbound——读走 LAN 通、发被拦。**根因**：`mobile-runtime-context-logic.ts` 的 `shouldQueuePromptBeforeSend` 用 `connectionState!==connected || reconnecting || !relayTransportReady`，**`!relayTransportReady` 无条件 queue、没区分 connectionMode**；LAN 模式 relay 永远 not ready（根本没用它）→ 每条 prompt 被 queue 等一个永不 ready 的 relay → 永不发出。**修（最小）**：`PromptSendDecisionInput` 加 `connectionMode`，条件改 `... || (connectionMode==='relay' && !relayTransportReady)`——relay 门槛只在 relay 模式卡，LAN 照走 readMobileJson 的 LAN 路；两个调用点(mobile-runtime-context.tsx)传 `connectionModeRef.current`（required 字段→tsc 强制两点都传，杜绝漏传）。**flushOutbox 已查**：flushOutbox(:463) + flush effect(:1148) 都**无 relay 门槛**（仅 in-flight/reconnecting/state!==connected/有队列），sendItem 走同一 LAN 路 → user 当前卡队列的消息在新包 connected 时会自动补发，无需改 flush。强 TDD（§13 复现真失败模式）：logic +2 测含**「LAN+relay not ready+connected+不 reconnecting→不 queue」**（退回旧逻辑必红）+ relay 门槛只作用 relay 模式 + lan 仍尊重 state/reconnecting；既有 4 处调用更新带 connectionMode。mobile tsc 0、biome 净，logic 10 测 + relay-transport 15 回归绿。**依赖**：纯客户端修，**需出 2.3.3 包**生效（不需重启 4010）。
  - [~] **P0 4G 中继「时通时不通」+ socket churn 治本（马超 2026-06-01，code-complete 待钟馗审 → 出 2.3.4；纯客户端需出包）**：根因报告 `.hive/reports/2026-06-01-relay-4g-churn.html`+research。诊断面板实锤 relay 模式 state=connected、读全 OK，但 `relay_socket_close code=1008 reason=replaced` 反复（device socket churn），DB 21:50/21:52 到达后停。**根因链（relay-transport.ts）**：①我 2.3.2 的 per-RPC 15s 超时 `close(4000)`，4G 高 RTT 频超时→频关 socket；②真实 RN close() 不同步触发 onclose→socket 滞留 CLOSING(2)、close 帧在途、status 仍 ready；③重连 connect() 时 `connectInternal` 的 closePreviousSocket 守卫只认 readyState 0/1→**CLOSING(2) 被跳过→旧 socket 业务 handler 从未 detach**→立刻开新 socket B；④中继 newest-wins：B join 时服务器仍持旧槽→evict 旧→发 1008 replaced；⑤这条延迟 1008 触发旧 socket 仍挂着的 onclose→`setStatus('disconnected')`+清空 B 的 pending→把活着的 B 打下线→上层重连→又被 replaced→**自激 churn 环**（user 看到的 1008 即此诊断）。间歇性=churn 间隙的 ready 窗口偶发 flush 成功。**修（3 项，PM 批准 1+3+2a+2c）**：**①断环核心**=`connectInternal` 换 socket 前**无条件 detach 旧 socket 业务 handler、覆盖 CLOSING(2)**（0/1 走原「关旧+等 grace」，2 立即 detach 不等待）→ 死 socket 延迟 close/1008 永不进活连接状态机。**②a 降触发**=per-RPC 超时改**只 reject 不关 socket**（删 `close(4000)`）；socket 真死改由**新增 device 端心跳探活**裁决：`startHeartbeat` 记 `lastInboundAt`（任何入站帧含 heartbeat_ack 刷新），tick 时超 `LIVENESS_TIMEOUT_MS`(默认 2×心跳+5s≈45s) 零入站→`close(4001)`→上层重连（对称 daemon ①）。**②c**=relay RPC 超时 15s→**22s**（relay device→relay→daemon 往返，4G RTT 远高于 LAN）。**③堵放大器**=`flushOutbox` effect 加 relayTransportReady 门槛（新纯函数 `shouldFlushQueuedOutbox`，对齐 shouldQueue，relay flapping 不瞎 flush 喂 churn）+ relay 转 ready 时此 effect 重跑自动补发卡队列（连带修 #4）；relayReady 由 getRelayTransport 订阅 transport 状态变更驱动、disconnect 置 false。**强 TDD（§13，本 session 已 4 次"测试绿生产坏"故每项配复现+变异验证）**：relay-transport 新增「延迟 close fake socket」复现 churn（CLOSING 旧 socket 延迟 1008 不得掀翻活 B，**变异 revert detach→必红 expected disconnected to be ready**）+ device liveness 判死/收 ack 不误杀 2 测 + 超时 reject-only 不关 socket（**变异 re-add close→必红**）；logic 新增 shouldFlushQueuedOutbox 4 测（relay-not-ready 不 flush 等）。mobile tsc 0、biome 净；mobile 全量 **139 测全绿**（relay-transport 18 + logic 13 + 其余回归）。**未碰** daemon ①/relay-server ②/握手/RPC 方法/newest-wins/2.3.3 LAN 修复。**依赖**：纯客户端修，**需出 2.3.4 包**生效（不需重启 4010）。真机 4G 验只能 user 验（张飞无手机）。待钟馗审。
    - **折进 2.3.4 的 audit-bug 批（马超 2026-06-01，code-complete 待钟馗审）**：workflow 审计在同 cluster（mobile-runtime-context.tsx + mobile-outbox.ts + relay-transport.ts）抓到的真 bug 一并修（`.hive/reports/2026-06-01-mobile-app-bug-audit.md`）。**CRITICAL** flushOutbox value-set clobber 并发消息丢失 → flushOutboxState 返 sentIds/failedItems + 新 applyOutboxFlushResult **函数式 merge** + flushOutboxConcurrently 编排（context 委托、setOutbox(updater) 回写）。**HIGH ghost socket**：close() 取消不了 closePreviousSocket().then(openNewSocket) → 加 aborted 标志 + abortConnect 钩子，openNewSocket 前 `if(aborted)return` + settle 在途 connect。**HIGH onerror RPC 泄漏**：onerror 不清 pending → 抽 rejectAllPending 在 onerror/onclose 都调（不等 22s 超时）。**HIGH flush 遇错即停**：flushOutboxState 单条失败 break 整队 → 改只挑 'queued' 项、失败标记后继续（failedItems[] 多失败），队头历史 failed 不阻塞。**HIGH 去重误删**：enqueueOutboxItem/parseOutboxState 文本 fingerprint → 改 **id 去重**（同文本两条合法消息都保留；clientNonce WIP-6 stash 留 PM reconcile，id-based 前向兼容）。**MEDIUM/LOW（同 cluster 顺手清）**：connect chooseWorkspace 用 selectedWorkspaceIdRef（修启动丢持久化 workspace + 重连旧值）；refreshDashboard 加到达时 workspace 守卫（防跨 ws 串写）；flushOutbox 用 clientRef.current（防切 token/host 后 stale client）；dashboard WS onmessage 加 workspace 守卫；前台探活成功也触发一次 syncWorkspaceData；chatSince 单调推进（抽 nextChatSince，防 relay 乱序推送倒退重复拉）。**强 TDD + 变异验证**：mobile-outbox.test.ts 新建（clobber 并发竞态 setState 模拟器 + flush-break + id 去重 + applyOutboxFlushResult，变异 value-set/break/text-dedup 均实测红）；relay-transport BugB ghost socket + BugH1 onerror 即时 reject（变异删守卫红）；logic nextChatSince 单调测。mobile 全量 **163 测全绿**、tsc 0、biome 净。**未碰** daemon①/relay-server②/握手/newest-wins/churn(2b2718a)/2.3.3。WIP-6-idempotency stash 未动（跨 server+schema，PM reconcile）。**依赖**：纯客户端，随 2.3.4 出包。待钟馗审。
      - **钟馗复审返工（马超 2026-06-01）**：复审出 2 BLOCKING + 2 non-blocking（其余过），同 3 文件修完待复审。**BLOCKING1** dashboard WS 只守了 onmessage、onerror/onclose 没守 → 切 workspace 后旧 socket 的 error/close 仍 setError/setState(error)/scheduleReconnect 污染当前。修：抽纯工厂 `createDashboardSocketHandlers`，message/error/close **统一**先过 workspace 到达时守卫；context 委托。**BLOCKING2（最关键）** outbox `randomId()` fallback 退化成 `outbox-${Date.now()}`，RN 不保证 randomUUID（只保证 getRandomValues）→ 同毫秒两条撞同 id → 刚改的 id 去重**重造「合法消息静默误删」**。修：randomUUID → 否则 getRandomValues 拼 UUIDv4 → 再不行进程内单调 counter，杜绝同毫秒碰撞。**non-blocking**：refreshDashboard catch 路径加 workspace 守卫（防 A 失败 setError 污染当前）；syncWorkspaceData await 后 bumpSyncRevision 二次 guard。**强 TDD + 变异**：logic 新增 createDashboardSocketHandlers 行为测试（stale socket 的 message/error/close 全忽略，变异删 isStale 守卫→红 spy 被调）；mobile-outbox 新增 randomId 唯一性测试（randomUUID 抹除 + Date.now 固定，getRandomValues 路径 + 纯 counter 路径各保留两条，变异退回纯 Date.now→红 length 1）。mobile 全量 **168 测全绿**、tsc 0、biome 净。未破坏已过审的 clobber/ghost/onerror/flush-break/去重语义/churn/2.3.3。待钟馗复审这两处 + 回归。
- [ ] **Phase 3 = 低优 + 覆盖缺口专项**：Reports/Research/Archive/Timeline tab、派单状态语义统一、各类样式/截断/key 修复
- [ ] **视觉重设计（设计先行，user 嫌"丑死了"）**：先出高保真 mockup 再照做。
  - [x] 新增 Worker 表单重设计 mockup（马超 2026-05-31）：`.hive/reports/2026-05-31-mobile-add-worker-redesign.html`（2 方向 A 精炼/B 活力，深色高保真，全字段保留）+ 可复用设计 token + 落地映射；索引 `.hive/research/2026-05-31-mobile-design-tokens.md`。**待 user 拍方向（A/B/混搭）** → 排实现（关羽，含抽 theme token + Pill/Field/Input/Button/Sheet 复用组件）→ 钟馗审 → 张飞真机验。
  - [ ] 设计 token 落 `theme.ts` 后，其余手机页（Dashboard/Tasks/Workers/Settings/Chat）按同一 token 统一刷新（根治"东一个西一个的丑"）。
- [x] **QR 读相册修复（马超 2026-05-31，代码完成待钟馗复核+真机验）**：纠偏——根因**不是**"华为无 GMS"（相机实时扫能用已证明解码引擎不靠 GMS），而是 expo-camera 的 `scanFromURLAsync` 接口在安卓本身不靠谱。改法：`settings.tsx` 相册路径绕开 scanFromURLAsync，改纯 JS 链路——`expo-image-manipulator` 归一成 PNG base64 → `upng-js` 解 RGBA → `jsQR` 解码 → 复用 `parseConnectionQr` 录入；相机实时扫不动。抽纯函数 `src/lib/qr-image-decode.ts` + 强 TDD（qrcode 真生成 QR PNG→解出预期，6 测）。**新增原生模块 expo-image-manipulator → 必须重出 build（prebuild 重链），不能热更**。
  - [x] #23 钟馗复审跟进（马超 2026-05-31）：QR 失败态拆三类提示（图里没码 / 有码但非连接配置 / 图片解码失败，不再一律"未找到二维码"）+ i18n 残留补全（host placeholder、Workspace 默认名接 t()）。mobile tsc/biome/96 测全绿。待钟馗三审。
- [ ] **遗漏待补审查**：Workspace 切换、Settings/语言、Feishu 绑定+推送深链、relay token 存储安全、长列表性能、横屏适配
- 关联：修完用本地构建出 build（`.hive/research/2026-05-31-local-build-setup` 路线）；改完必须真机验（非 proxy 指标）
- [x] Track B P0 已在当前 workspace 落地：`thinking_levels` 类型修正、非 silent 重连失败保留旧 dashboard、ConnectionModeBanner 重连态、Cockpit/Tasks/Actions/Worker detail 死按钮收口（`05fb52d`）

### M29 · 推送通知打通（后台也能收提醒） · 🚧 BLOCKED on Q16（Phase 1 spike done；Phase 2+ 卡 user 决策：是否注册华为开发者账号实名——HMS Push 硬前置，无 GMS 华为机 FCM 物理不可达）
> 触发：user 问"app 切后台后谁收消息、微信怎么做到的"。讲清=微信靠**系统推送服务**(APNs/FCM/厂商推送)非"后台常连"；user 拍板立此 milestone。目标：app 不在前台也能收到 worker 完成 / 审批请求 / orch 回复的系统推送，点通知进对应页（微信式体验）。
> 现状：M24 Phase7 做了一半（Expo push 注册真 token + 通知点击 deep-link 路由 approval/worker_done/high_ai_action），**缺实际投递通道**。难点：自建本地构建（已弃 EAS）后推送配置要手动接；国内安卓 FCM 常被墙→可能需厂商推送。
- [x] **Phase 1 = 调研 spike（马超 2026-05-31，代码未改、纯调研）**：产出 `.hive/reports/2026-05-31-push-notification-spike.html` + `.hive/research/2026-05-31-push-notification-spike.md` + ADR draft `draft-2026-05-31-push-channel.md`。**核心结论**：user 华为折叠屏无 GMS → FCM（含现有 exp.host→FCM 链）从根上投递不了，不是缺凭据是选错通道；华为机后台推送唯一可靠系统通道 = HMS Push Kit。三档方案 A 前台服务保活 relay WS（最小、复用 M28、需电池白名单非 100%）→ B HMS Push（华为本命、被杀也唤醒、需华为实名账号+AGC+Expo HMS 坑）→ C 极光/个推聚合（最广最贵）。推荐 A→B 渐进。待 user 拍：①A→B 还是直接 B ②是否注册华为开发者账号（实名，HMS 硬前置）③是否上 C 兼容非华为。
- [ ] **Phase 2 = 最小可用推送**：按 spike 方案接通至少一条通道；server 在 worker_done/approval_request/orch_reply 发推送；本地构建包含推送配置；真机验锁屏收到 + 点击跳转。
- [ ] **Phase 3 = 国内厂商推送可靠性**（如 spike 判定 FCM 不够稳）：对接华为/小米等厂商推送 + 保活策略。
- 关联：[[reference_local_build_apk_delivery]]（推送配置要进本地构建）；Q14（手机审批通道）与本 milestone 协同——审批请求推送是高价值场景。

### M30 · Worker 汇报可靠性加固（干完没报必须系统兜住） · shipped 2026-05-31 (`0ec6c41`，需 4010 重启激活)
> 触发：user 强烈不满——赵云（codex）干完 6 项 UX 却不跑 team report，**是 user 先发现的、不是系统兜住的**。user："你自己接管不是彻底解决"。
> 架构铁律（核查确认）：L2 提示词其实已很全（worker 启动提示 + 每轮 REMINDER_TAIL 都注入"必须 team report，文字总结不算，每轮自检"），但 **L2 能被 LLM 绕过**（codex/gpt-5-mini 较弱，读到仍可能不执行；claude 很少犯）；**L1 无法强制 LLM 跑命令**。故解法不是"逼它报"，而是"它不报也绝不静默、user 一定看得见"。
> 澄清（马超核查）：dispatch ledger 状态只有 queued/submitted/reported/cancelled，**无 in_progress**；"领了活干完不报"整个就是 `submitted` 窗口，现有检测本就覆盖（未加 schema 态，避免迁移风险）。
> 否决"自动收尾兜底"：拿 PTY 最近输出伪造一份 report = 垃圾（同 orch_reply 抓终端乱码坑）+ 可能误判仍在干活的 worker→错误收尾。**伪造汇报比不汇报更糟**，改走"可靠 surface + 继续 nudge + PM 验证收尾"。
- [x] 检测覆盖"干完没报"：submitted 即"在办未报"窗口，复用 M26 idle 自愈 nudge worker；新 `stale-dispatch-status.ts` 纯函数 summarizeStaleDispatches 单一事实源
- [x] **直接 surface 给 user（核心兜底）**：`buildMobileDashboard` cockpit 暴露 `stale_dispatches`/`escalated_dispatches` 计数（4min/8min 两档）→ **user 拉看板必见"N 个派单超时未汇报"，不靠 push/LLM/worker 在线**，到点就亮，硬兜底
- [x] 连续超时→escalated 第二档 + 继续 nudge worker/orchestrator；`stalled-dispatch-nudge` 加 always-on surface pass（不 gate idle，worker 卡死也兜）
- [~] 修"working 假信号"：用 stale/escalated 时长分档近似；per-dispatch idle 布尔需 per-request PTY snapshot（性能成本）留 Phase2
- 强 TDD 禁 mock PTY：stale-status 6 + user-surface 5（真 ledger+可控时钟）+ mobile-routes +1，全绿。⚠️ push 投递半边受 M29 制约（华为无 GMS）→ **可靠 user 可见兜底落在看板计数**，push 待 M29 接通 HMS。关联 [[feedback_worker_reliability_systemic]] [[feedback_verify_dispatch_started_after_restart]]。

### M31 · Worker 模型可见 + 可配置（治本 worker 可靠性） · 🅿️ PARKED 2026-06-12（Q15，user 同意：worker 崩真因=ENFILE/进程崩非模型质量[[project_hive_enfile_watcher_crash]]，reliability 驱动弱化；模型可见价值仍在但不紧急。Phase 1 spike done。revisit 触发见 open-questions Q15）
> 触发：**user 洞察一针见血**——赵云反复不守规则/不 report/dedup 修 3 次没对的根因是**模型**（codex preset 跑 gpt-5.4-mini，弱，工具纪律差）；马超=claude 可靠。这正是本轮我一直把硬活从赵云转马超的隐性规律，user 把它点破。
> 现状：worker 数据有 preset/provider_family/thinking_level，但**没有具体模型结构字段**；真实模型（gpt-5.4-mini 等）只在 CLI 状态栏 last_pty 看得到。
> 核心：把"哪个 worker 靠谱"从隐藏变成 **user 能看见 + 能调**。
- [x] **Phase 1 调研 spike（马超 2026-05-31，纯调研未改码）**：产出 `.hive/reports/2026-05-31-worker-model-visibility.html` + `.hive/research/2026-05-31-worker-model-visibility.md` + ADR draft `draft-2026-05-31-worker-model-control.md`。**核心结论**：hive 现在根本不控制也不知道 worker 模型——内置 preset 不带模型参数，模型=各 CLI 自身默认（codex 默认就是 gpt-5.4-mini）；真实模型只在 CLI 自绘 PTY 状态栏、无结构字段。要"可见且正确"唯一可靠路径=hive 显式 set `--model`（可见性是可配置性的副产物）。4 CLI 全支持 `--model`（claude/codex/gemini 直接 id，opencode 要 provider/model），完美套用现成 thinking-level 注入器（加 `getModelArgs`）。**捷径**：把 codex 内置 preset 默认模型钉强档即可治本大半，未必需要 per-worker UI。待 user 拍 5 点（默认策略/模型清单/粒度/默认显示/成本）见 ADR。
- [ ] **Phase 2 显示**：worker status 暴露真实模型（结构字段）→ mobile + web worker 卡片显示「跑什么模型」。
- [ ] **Phase 3 可配置**：Add Worker / Worker 设置 里 per-worker 选模型（下穿 launch config → CLI 调用），user 可把关键 worker 升到强模型。
- 关联 [[feedback_worker_reliability_systemic]]（worker 不可靠要治本）；与 M30（看板兜底）互补：M30 兜"不报"，M31 治"为何不报=模型弱"。

### M32 · worker 独立 CODE worktree + 共享 .hive 治理根 · in progress (user 拍板 2026-06-01 "同意！")
> 触发：两个哲学相反竞品（OpenTeams worktree-per-repo / CCB worktree materializer）**独立都指**"无 worktree 隔离"是真缺口（高置信度）。当前所有 agent 共享同一 cwd（`agent-run-starter.ts:94` 写死 `workspace.path`），并行改重叠文件互踩=真实数据风险。
> 依据：spike `.hive/reports/2026-06-01-worktree-isolation-spike.html`+research；ADR `.hive/decisions/2026-06-01-worker-code-worktree-shared-hive.md`（已采纳）。
- [~] **Phase 1（马超 2026-06-01，`28b8417` 初版 → 钟馗审 4 blocker+1 medium → 返工 `9874141b` 完成，待复审）**：`worktree-manager.ts`（worktree add --no-checkout --detach → core.sparseCheckout + info/sparse-checkout `/*`+`!/.hive/` + read-tree -mu；**不再放 .hive symlink**）+ `agent-launch-roots.ts`；改 `agent-run-starter.ts`（先解析 launchRoots + cwd + 3 env）、`agent-run-bootstrap.ts`（session capture 用真实 cwd）、`agent-runtime.ts` 接线。**默认关，`HIVE_WORKER_WORKTREES=1` 显式开**（无分层=零行为变更）。**返工修的 4 blocker+1 medium**：①弃 symlink（symlink-over-tracked-.hive 被 `git add -A` 暂存污染，已实验三组对照证实）改 `HIVE_GOVERNANCE_ROOT` env，sparse skip-worktree 保 add-A 干净；②session capture/resume 改用 worker 真实 cwd(codeRoot)，与 M25 managed-root override 对齐；③ensure 失败 fail-closed（仅非 git workspace 退回，其它抛 `NotAGitWorkTreeError` 阻断）；④健康检查真比对 git-common-dir realpath（绑错 canonical 残留→重建）；⑤路径段复用 `managedAgentSegment` sanitize+hash。强 TDD：真 git 14 测（add-A 干净 / 绑错重建 / fail-closed / capture cwd=codeRoot）全绿 + launch 回归(layer-a-resume/lifecycle/rehydration 真 PTY)全绿；tsc 0 biome 净。ADR 已回填变更。留后续：worker guidance 引用 `$HIVE_GOVERNANCE_ROOT`（默认开启前必做）、DB 元数据表、冷重启残留清理、真机多 worker 验。
- [~] **钟馗复审（`7c6747d3`，2026-06-01）出 4 blocker（PM 判全成立）**：①`git add -A` 会 stage `A .hive`+`D .hive/plan.md` 污染治理（已复现；symlink-over-tracked-.hive 本质脆弱；测试只验 `git diff HEAD` 没验 add-all）②worker cwd=codeRoot 但 session capture/resume 仍用 workspace.path→抓不到 session/resume 错绑（与 M25 重叠）③git repo 隔离失败静默退回主树 cwd→主树裸跑污染（该 fail-closed）④健康检查没 realpath 比对 symlink 目标（注释说有代码没有）→坏残留复用串治理。+ medium 路径 segment 没 sanitize/hash。**返工已完成 commit `6867cc9`，钟馗复审 `4fcd4c6a` 通过（0 新 blocking，4 blocker 全闭环，钟馗重新复现 B1 git add -A 证实新版干净，52/52 回归绿）→ M32 Phase 1 审过**。2 个 non-blocking 是已知启用前置：①MEDIUM 1 worker guidance 仍说"读 ./.hive"（钟馗精确点位 `hive-team-guidance.ts:26-27,120`/`session-start-review-message.ts:6-9`/`team.ts:40`），启用门控前须改引 `$HIVE_GOVERNANCE_ROOT`（建议文案="优先读 $HIVE_GOVERNANCE_ROOT/.hive，未设退回 ./.hive"+启动提示快照测试）②MEDIUM 2 "ADR 不在 commit"=`.hive/decisions/` gitignored 已知设计（ADR 在盘+Cockpit 可见；若要 ADR 进 git 历史是另一项治理决策待 user 拍）。
- [ ] **Phase 2**：PM review/commit 流程（主树查 N worktree diff → apply/cherry-pick → 主树验证 commit；worker worktree 绝不直接 commit）+ 冷重启/残留 ensure（参考 OpenTeams 建失败回滚）。
- 关键约束：**与 M25 都动 launch 路径，必须串行实施避免冲突**（M32 改 cwd，M25 改 env/session）；保留 PM 主树唯一整合点，刻意不做对手的重合并门/per-worker PR。

### M33 · 远程可诊断性 + provider 活动证据（双竞品三角合成 idea-8） · 📋 roadmap-only / 未开工（2026-06-01 promote 成里程碑但未实现，连 spike 都没派；hive doctor --json/--bundle + provider activity evidence 三项全 open。待视频 4G 收口后排）
> 触发：双竞品三角合成（[[idea-8]] in `.hive/ideas/inbox.md`）——OpenTeams（全 SQLite 事件流）+ CCB（doctor/support bundle/completion evidence）独立印证。HippoTeam 是三方唯一"远程优先"却最缺"user 手机看底层证据"。拆"假矛盾"：我们卡死**探测**强（M26/M30/哨兵 never-silent），但缺"活着的 agent 此刻在干嘛"的**可解释性证据**。探测≠可解释。
> 现状基础：M25 line 251 已标"可单列 M25b：hive doctor/support bundle"；本 milestone = 因双竞品印证升格独立。
- [ ] 只读 `hive doctor --json`（runtime/schema_version/agents status+pending/dispatches open/relay+mobile+feishu/PM docs orphan）
- [ ] `hive doctor --bundle` 诊断包导出（排 secrets）
- [ ] **provider activity evidence**（采 provider hook/session log 的 last 语义进展/last tool/last assistant chunk → 手机+Cockpit 显示"working, last progress 8m ago, evidence: tool_call"；**不改三态、不自动 kill，只触发 ActionBar 软提醒**）
- ✅ user 2026-06-01 经手机 promote idea-8→正式 milestone（idea-8 归 ideas promoted 段）。下一步：派设计 spike 摸 ①hive doctor --json/--bundle 字段+导出边界（排 secrets）②provider activity evidence 怎么采（hook/session log）+ 怎么 surface 到手机/Cockpit 不改三态。待 user 拍是否现在开 spike 还是只上 roadmap。

### M34 · 未审代码改动看板兜底（"claude 必审"从靠记性→系统拦） · ✅ Phase 1 shipped 2026-06-01（实现 ff6f29f，钟馗复审 e382b71c 0 blocking，真 store 集成测试穿透 RuntimeStore 抓回旧 bug）；Phase 2（reviews_dispatch_id 精确配对 / 扩全 coder）deferred
> 触发：本 session **PM 自己演示了这个洞**——审查靠 PM 手动记得派钟馗，结果 PM 图省事自审了 9 行 i18n（`538d004`）漏派钟馗，被 user 当场戳穿"claude 审 claude 不靠谱"。靠人记性会漏，连 PM 自己都漏。
> 目标：coder（尤其 claude preset）report 了**代码改动**、但没有对应 reviewer dispatch 跟上时 → Cockpit **硬亮"⚠️未审"**，never-silent（同构 M30 stale-dispatch 看板兜底，不靠 push/LLM/PM 记性）。
> 关联：[[feedback_no_self_review_claude_code]]（本条根因）；M30 stale-dispatch（同构兜底范式，复用其纯函数 + aiAction 模式）；[[feedback_worker_reliability_systemic]]（治本不靠手动）。
- [x] **设计 spike（马超 2026-06-01）**：产出 `.hive/reports/2026-06-01-unreviewed-code-backstop-spike.html` + `.hive/research/2026-06-01-unreviewed-code-backstop-spike.md`。**核心结论**：①判"产生代码改动"= **worker role 主门(claude coder)+report-only 反向排除器**，弃 git 提交窗口（PM 审后才 commit、M32 worktree 提交不在 main → 高漏报）；②判"已审"= **启发式时序配对**（coder reported 后同 workspace 出现 reviewer dispatch 即消解），精确 link 留 Phase 2；③数据模型 **纯函数零 schema**（照 M30 `summarizeStaleDispatches`，新 `unreviewed-code-status.ts`）；④surfacing 双轨：mobile push+状态计数（照 M30）+ Cockpit ActionBar 合并 DB 派生 action（扩 `AIActionType='unreviewed_code'` high，**注意 aiActions 今天纯文件派生、需在 serve-cockpit 边界合并、不动 parseCockpit**）。**头号误报=spike 类 dispatch（本任务自己即例）→ 必须有 report-only 排除器**。**不需加 schema**（Phase 1 纯函数；Phase 2 可选 `reviews_dispatch_id` 精确配对，仅当启发式噪音不可接受）。
- [~] **实现 Phase 1（马超 `7a5ead11`，2026-06-01，code-complete 待钟馗审）**：新 `unreviewed-code-status.ts`（纯函数 `summarizeUnreviewedCodeDispatches` + `isReportOnlyDispatch` 排除器 + `buildUnreviewedCodeActions` + `augmentAiActionsWithUnreviewedCode` 边界合并器）；`cockpit-doc.ts` 仅扩 `AIActionType+='unreviewed_code'`（parseCockpit/buildAiActions 保持 file-only 不碰 DB）；边界合并接 3 处：`cockpit-websocket-server.ts`(web ActionBar，best-effort try/catch)、`routes-mobile.ts`(buildMobileDashboard 加计数 `unreviewed_code_dispatches`+合并 aiActions / cockpit detail 合并)、`relay-rpc-handler.ts`(远程 parity)；push `notifyUnreviewedCode`(mobile-push.ts，每 dispatch 去重) 经 `stalled-dispatch-nudge.ts` 新增可选 hook `surfaceUnreviewedCode` 复用 M30 60s tick、`runtime-store-helpers.ts` 接线。**report-only 排除器**：含代码 artifact→绝不排除(改动信号优先)；否则 reportText 命中 spike/调研关键词 **或** artifacts 全文档→判 report-only（与 spike 文档字面"且"有意偏离：真实 spike 常无 artifacts，确保 M34 spike 自身被排除）。强 TDD：13 测全绿覆盖 ①未审→亮②出 reviewer→灭(+前置不消解)③spike(有/无 artifacts)→不亮④非 claude coder→不亮⑤parseCockpit file-only 契约+宽限/非 reported/code-artifact override。tsc 0、biome 净；回归 80 测(cockpit-ws/mobile/relay/nudge/app)全绿。钟馗复审（功能本身也走审查闭环）。**commit `7000f5c`；钟馗复审 `d5ea3476` 出 1 BLOCKING + 2 风险（PM 判全成立）→ 返工马超 `e6124fc1` 完成（code-complete 待复审）**：①**BLOCKING**=`workspace-store.listWorkers()` 不返回 `commandPresetId`→`isClaudeCoder` 恒 false→生产里整个兜底形同虚设（第二次"测试绿但生产死"）。**修**：新增**唯一**边界入口 `cockpit-unreviewed-augment.ts::resolveCockpitUnreviewedCode(store, ws, now?)`——内部用 `resolveCommandPresetId`(读 launch config/peekAgentLaunchConfig，真实 preset 源)拼 role map；4 处生产注入点(web WS/mobile dashboard/mobile cockpit/relay/push)全改走它，杜绝各点重复犯错；relay store Pick 补 peekAgentLaunchConfig。**+ 真 store 边界集成测试** `unreviewed-code-backstop-integration.test.ts`(5 测，createRuntimeStore+addWorker+configureAgentLaunch(claude)+dispatchTask+reportTask 真实路径；断言 raw listWorkers 无 preset 但 resolveCommandPresetId 解析出 claude、buildMobileDashboard 真出 unreviewed_code_dispatches≥1、出 reviewer 后清零、codex/spike 不亮)。②HIGH=report-only 收窄：正向代码动词信号(改了/新增/重构…)压过 report-only；无 artifacts 时不用裸"调研/spike"，要强短语(不改产品代码/纯设计/未改…代码)；补测试"无 artifacts + spike 文本 + 改了 src/*.ts→必标"。③MEDIUM i18n：`派 reviewer`→`cockpit.actionBar.action.assignReviewer`+en/zh messages，补 EN/ZH locale 测试。`buildMobileDashboard` 加可注入 `now` 供集成测试越过宽限。tsc 0/biome 净；M34 20 测 + 回归 91 测(cockpit-ws/mobile/relay/nudge/app/web-i18n)全绿。**返工 commit `ff6f29f`（PM 验 20 测绿含 5 真 store 集成）→ 钟馗复审 `e382b71c` 通过（0 blocking，BLOCKER+2 风险全闭环，确认集成测试真穿透 RuntimeStore 能抓旧 bug 回归）→ M34 Phase 1 审过**。1 LOW follow-up：集成测试 `stores` 数组 afterEach 只 splice 没 `store.close()`，建议 close 后再 rm 防未来 watcher/DB handle 泄漏（当前通过，未做）。**Phase 2 留**：reviews_dispatch_id 精确配对（现启发式时序）、扩全 coder（现限 claude）。
- 边界：不阻断 dispatch（不是 gate），只 surface 提醒（PM 仍可判断免审小改）；先覆盖 claude coder，codex/opencode 看需要。

### M35 · 实时语音对讲模式（开车 hands-free 指挥 AI 团队）· spike+路线已定 2026-06-02 → 实现见下方 M36(build)/M37(治本)
> 目标：app 加"实时对讲模式"——开车/看不了手机时，hands-free 用语音实时跟 orchestrator 对话（下指令/问状态/拍板）+ worker 完成语音念回。本质 = **可观测性的语音化**（开车=终极"看不了仪表盘"，接 M33 远程可诊断性）。两条声音通道：①同步对讲(你→系统，低延迟+打断 barge-in) ②异步语音回灌(系统→你，完成/审批/告警念回)。
> **spike 已完成（钟馗 `91ab5888`，报告 `.hive/reports/2026-06-02-realtime-voice-intercom-spike.html`+research）**：代码级读了 tang-changan(berryxia 长安城,Agora) + agora-skills。关键结论：①**不另造协议**——语音 function call 直接映射现有 `workspace.prompt/dispatch/approve` + 念回复用现有 `pushEvent`+mobile chat 管道（复用不另起炉灶）②自建 OSS 最小栈=移动音频→本机 voice bridge + Silero/WebRTC VAD + faster-whisper/whisper.cpp + 本地 TTS(Piper/Kokoro/XTTS) + 现有 relay RPC；**单用户可砍掉 Agora/LiveKit 级 SFU/RTM**③Agora 重且弱化"数据本地"，OpenAI Realtime 最快验 barge-in/function-calling 体感但音频进云。④诚实标注：tang clone 缺 tang-voice-agent 后端目录，后端只按文档核未源码验证。
> **钟馗推荐路线**：先用 OpenAI Realtime 做 1-2 周 hands-free **交互体感验证**（barge-in/turn-taking/回灌体感，跟后端无关）→ 再迁自建单用户本地语音桥。
> **待 user 拍板（3 个岔口）**：①第一阶段是否允许 OpenAI Realtime 处理音频（坚持全本地则验证周期更长）②首版传输 WS 直连(更快) vs WebRTC/LiveKit(更接近最终低延迟/打断)③本地 TTS 在"低延迟普通音色 vs 更自然但 GPU/授权复杂"取舍。
> 依赖：M14b（本地 STT+TTS 基础，进行中）先落，对讲建其上。配套起 ADR 记"对讲走云 Realtime / 日常转写走本地"分界（破 M14a 纯本地需记理由）。
> **2026-06-02 路线已细化（user 拍）**：①**直接自建、不绕 OpenAI Realtime**（user 倾向，贴"数据本地"身份）②**传输方案①=复用现有 relay 隧道**（音频帧走现成 WSS+E2E，不碰 Agora/不上 LiveKit SFU；单用户不需要 RTC 中转）；P2P WebRTC 留 Phase 2③berryxia tang-changan 不可 fork（语音是 Agora 云 + 后端目录缺），只当 UX 参照。**两个交互模式并存（user 明确）**：**push-to-talk 按住说**（关羽 Phase 1 已实现 `7550f44a`，talk.tsx+push-to-talk.ts，输入侧通+念回接契约，181 测绿，**未 commit·待地基收口**）+ **对讲模式连续 VAD hands-free**（user 重点，开车用——开车没法按按钮，要"点一下进入→连续听→静音断句→念回→再听"；barge-in 留 Phase 2）。VAD 简版=expo-av 电平+静音超时，抗噪不够再上 Silero。
> **落地序（防三方撞车，今晚 [id].tsx 已栽）**：吕布 TTS 返工(a253bce2)落 → PM 核实合并 mobile-runtime-context.tsx 连贯(吕布 synthesizeVoice 定义 + 关羽消费类型对齐 {audio,format,mime}) → 钟馗整体审语音子系统(TTS+push-to-talk+共享 synthesizeVoice) → commit 地基 → **再派对讲 VAD（重点）**建其上。
> **2026-06-02 进展**：①管道层全做完——吕布 TTS(piper --input_file+model+format/mime 贯穿，钟馗审 0 blocking✅) + 关羽 push-to-talk + VAD 连续对讲(状态机+voice-vad.ts)。②**钟馗整体审连抓 4 个"测试绿生产坏"**：piper stdin 坑/format 谎报(TTS,已闭环)、连续模式出错麦死/念旧回复(TalkTab)——后者**第三轮**修中(关羽第二轮用手机时钟比服务端时钟的跨设备时钟陷阱被钟馗拦，改 id-based 过滤 `d9312a30`)。③**UI 设计稿 user 看过"没问题"通过**(`voice-intercom-ui-design.html`)，5 项交互默认拍定(连续默认/蓝牙提示/点屏打断/cue 默认开/全屏沉浸)，**ADR draft 起好** `draft-2026-06-02-realtime-voice-intercom.md`。④**待**：关羽第三轮过审→commit 地基→**前端打磨实现**(照设计稿，等 base commit 后做、避开 talk.tsx 撞车)→张飞/user 真机验+VAD 阈值校准。

### M36 · 实时语音对讲实现（连续对讲核心可用）· shipped 2026-06-03~04（真机验证，APK 2.6.x 系列）
> M35 spike/路线落地为可用产品。全程真机 USB logcat 调试 + 钟馗质量闸（抓了一长串"测试绿生产坏"回归）。
> - **STT/TTS 基础**：whisper.cpp 本地中文转写 + edge-tts 晓晓念回（`5c58113`，替换机械 macOS 婷婷，user 真机"比 MacOS 好太多"）。
> - **连续对讲可用 `5aea765`(2.6.5)**：自适应判停（滚动窗口最小值底噪，替换会卡死的 EMA；真因=录音启动 -160 垃圾锚死，USB floor=-159 铁证）+ 真语音闸（hadRealSpeech，静音/杂音不投递，DB 0 垃圾）+ 首句不丢（floor 未建立前 -38 绝对启动线，钟馗抓 blocking 闭环）。
> - **双音色 `6b9b380`(2.6.7)**：GLM 快嘴=晓晓(女)、orchestrator=云希(男)，user 听辨谁在答（voice 全链路透传到 local-tts edge-tts）。
> - **开口打断 barge-in `49371e6`→`ae98794`→`e4ad00b`(2.6.6~2.6.10)**：Android `voice_communication` 音源自带硬件 AEC，念回时可插话打断。多轮血泪：AGC 压平连累判停切断→误把好功能默认关(user 怒)→纠正(打断+不切断并存)→回声自触发/鞭炮误触发调阈值(speechMargin 22→25+连续3样本)。**残留**:回声边际偏薄+只认"响"不认"人声"→催生 M37 神经 VAD。
> - **clear-failed + Cockpit ActionBar 可折叠 `25bd9df`**：outbox 失败消息可清除 + 看板待办面板可收起（user 反馈占空间）。
> - 真机验证通过（连续对讲点完即说不丢首句/静默不投垃圾/双音色/打断）。BARGEDBG 调试日志保留。

### M40 · 实时通话理解层（投机式前台 + 客户端播放闸 + 完整意图交 PM）· 立项 2026-06-06（ADR 已采纳）
> **决议**：`.hive/decisions/2026-06-06-speculative-voice-front-pm-handoff.md`（user 拍板"做成决议"）。承接 M39，把"停顿触发回复"升级为"语义意图触发 + 投机提前算 + 客户端择时播"，达到极快对话体感。
> 四支柱：① 前台 GLM 一身三职（判意图完整 / 投机生成+latest-wins取代 / 完整意图交 PM 绝不碎片）② 客户端播放闸（turn-taking 下放 app，攥着回复等用户让出话权才播最新代际）③ 通路分离+来源打死标签（对讲 vs 通话 vs 普通语音）④ 自我进化评价机制（idea-7 语音化，越用越准）。
> 成本天然有界：只 GLM 投机（便宜快），PM(opus) 只在完整意图上跑一次、永不吃碎片。
> **✅ 设计 spike 已落地+PM vet 通过（赵云 dispatch a3147d4f）**：`reports/2026-06-06-m40-speculative-voice-design.html` + research 同名。核心：新增 server `VoiceIntentSession` 消费 M39 partial→限频调 GLM 出结构化 verdict(completeness/action/confidence/intent_generation/distilled_intent/reply_text)；latest-wins+AbortController 取代；relay frame `webrtc_voice_intent`(op candidate/replace/cancel/ready/handoff) 先行、data channel 后置；PM 只收 `complete && escalate && confidence>=0.75` 每 turn 一次、incomplete 绝不 recordUserInput；`source:'voice_call_webrtc'`。
> **5 阶段实现路线（autonomous 推进中，2026-06-06 深夜 user 睡后 PM 自主驱动）**：
> - ✅ 来源通路分离 `037b898`（webrtc_call/talk_continuous/voice 三标签，钟馗 0block）
> - ✅ Phase 1 核心模块 `9b69557` voice-intent-front.ts（GLM 结构化 verdict+latest-wins+abort+PM闸+安全默认，钟馗首轮3 blocking→返工→复审0block，12测，flag HIVE_VOICE_INTENT_FRONT 默认关）
> - ✅ Phase 1 shadow 集成 `fc69475`（接进 webrtc-upstream 纯 shadow、flag 默认关零行为变更、close 泄漏修复、25 测；钟馗 2 轮 blocking schema安全+close泄漏→闭环）。**Phase 1 全部完成**=来源分离+意图引擎核心+shadow 遥测就绪。
> - **⏸️ 待 user（真机+决策）**：开 flag `HIVE_VOICE_INTENT_FRONT`=1 + 重启 4010 + 真机打电话 → 看日志 `voiceIntent shadow verdict` / `endpoint_compare`，对比"GLM 意图完整度判断 vs M39 端点 final"，**验 GLM 判完整可靠不**。可靠才进 Phase 2（让意图引擎真驱动回复=行为变更）。
> - Phase 2：server latest-wins 候选状态机真接管回复 + GLM/TTS abort 纪律（**行为变更，必须 shadow 数据验过 + 真机**）
> - Phase 2：server latest-wins 候选状态机 + GLM/TTS abort 纪律
> - Phase 3：播放闸帧协议 + app hold/latest generation（mobile）
> - Phase 4：PM complete-distill handoff 闸（绝不喂碎片）
> - Phase 5：relay frame → WebRTC data channel 降 RTT
> **2026-06-08 user 新拍板：M40 从“意图引擎接管”升级为“GRM Turn Orchestrator 协议化重写”**。核心判断：问题不在要不要强前台，而在强前台尚未协议化；当前两大痛点=**胡说八道**（上下文不足仍敢答）+ **该交没交**（handled/escalate 仍像 prompt judgement，不像协议 judgement）。
> - **冻结统一 turn contract**：输入对象统一 `source/workspace_id/call_id/turn_id/partial_seq/transcript/context_snapshot_id`；verdict 统一 `completeness/action/confidence/distilled_intent/reply_text/risk/requires_pm_reason`。legacy `fast-voice-reply` 只能当 adapter，不再直接驱动副作用。
> - **L1 决策表写死 5 个命运**：drop / incomplete / handled / escalate / fallback；明确每类是否 insert outbound、是否 forward PM、是否开 obligation、是否记 timeline、是否发 call state。**行动项/查证未知/部署重启/派工/PM 拍板一律 escalate**；寒暄/已知状态/当前进度/已在 context snapshot 的事实才允许 handled。
> - **partial/final 协议**：partial 只允许抢快 ack/预判 complete，不允许编事实或给行动结论；final 才 settle handled/escalate。继续坚持“未播可撤、在播不撤”。
> - **单声道闭环**：PM 长期只收 distilled intent，结果应回流 GRM 再由同一 persona 对用户说；短期 `webrtc-file-downlink-audio.ts` 只解决串行防重叠，不等于人格闭环。
> - **统一观测**：turn timeline 至少串 verdict / branch / handoff_id / reply_message_id / downlink first segment / obligation status，结束“能查一点但不能一眼判刑”。
> **实施顺序（本轮 user 已拍板，可直接派 worker）**：
> 1. 冻结 contract（输入对象 + verdict schema + handoff 语义 + 禁止词/marker contract）
> 2. 统一 verdict adapter（M38 legacy + M40 intent + safe fallback 都转内部同一决策对象）
> 3. 补 turn decision-table tests（三入口 × handled/escalate/drop/incomplete/fallback）
> 4. 补统一观测（timeline/handoff/mobile-reply/downlink）
> 5. 再收 prompt / 分支 / PM 结果回流 GRM 单声道
> **分工**：关羽=来源通路分离(`6eeb753c`,进行中,touches webrtc-upstream→Phase1集成要等它)；赵云=Phase1 核心 voice-intent-front.ts 模块(新文件无冲突)。钟馗串行复审，user 醒后真机验+拍后续。自我进化(④)后续阶段。

### M39 · 流式 ASR + rolling session transcript · ✅ shipped 2026-06-06（核心打通 `5970988` + 生产崩溃修复 `4ffbb00` isReady 闸治来电 native exit；真机验通）
> **🚨 生产事故+修复（2026-06-06 深夜）**：user 下载流式 paraformer 模型(`~/.config/hive/streaming-paraformer/`)激活 M39 路径后，每通 WebRTC 通话第一帧崩 daemon → 手机"webrtc/中继连不上"。根因=`streaming-stt-online.ts` decode 漏 `isReady` 闸 → sherpa-onnx native `features.cc GetFrames` → C++ `exit(-1)` 杀进程（JS catch 不住）。修复 `4ffbb00`（关羽 codex/钟馗 codex 0block）：`while(isReady) decode` drain + flush inputFinished + 流式出错通话级回退 VAD（不哑），17 测。**真机验通**：call `webrtc-1780761642531` streaming partial `8→12→17→19` 边说边出字 + final 注入 + 零崩溃。教训=native addon 可 `exit()` 杀进程不可 JS catch；流式 sherpa 必须 isReady 门控；"测试绿生产死"（旧 mock 无 isReady）；诊断曾被 relay 服务器带偏，daemon crash-loop 与 relay 中断症状相同要先查 daemon liveness。**剩余**：native 彻底隔离需子进程化（跟踪项）；rolling transcript 上下文回灌效果 + 下行念回顺滑待持续真机调。
> **起源**：user 真机通话中指出：说 20 秒不停顿 = 20 秒白白浪费，VAD 等静音才处理是根本错误。同时提出 rolling transcript 避免重复处理已识别内容。
> - 🔬 **关羽实施中（dispatch a0fa85da）**：
>   - 新 `src/server/streaming-stt-online.ts`：sherpa-onnx `createOnlineRecognizer` 流式识别，模型自动检测 `~/.config/hive/streaming-paraformer/`
>   - 修改 `webrtc-upstream-audio.ts`：有流式模型时绕过 VAD+批处理，直接流式识别；endpoint 触发即注入，不等说完
>   - rolling session transcript：per-call 积累，注入时带上下文
>   - 无流式模型时静默回退原 VAD 路径
> - 🔬 **豆包验证方向**：user 指出豆包已实现实时语音+视频理解，证明此路可行
> - 待：关羽 report 后钟馗审 + 下载流式 paraformer 模型真机验

### M38 · 快准狠前台（实时通话对话体验根治）· shipped 2026-06-06 `22d4224`
> **user 核心要求**：实时通话前台要"快准狠"，不要绕弯，一句话干净交接 PM。
> - ✅ **快准狠前台 `22d4224`**（关羽实现，钟馗 3 轮审 0block）：
>   - 准=前台喂当前阶段 plan phase+最近 3 commit+worker 在做啥，答得具体
>   - 准狠=提示词直接/具体/有判断，禁官腔空话和稀泥
>   - 狠=escalate 只一句短接管不抢话不假装解决，PM 给真答案
>   - 快=项目上下文读取全异步（钟馗抓出 execFileSync 同步冻结事件循环→改 fs.promises+promisify，热路径零同步 IO）
> - ✅ **真机验通**：user 测 "快准狠前台真对话成了"，回复全是项目认知+直接利落

### M37 · 语音对讲治本（GLM 门卫 + STT 守卫 + 神经人声 VAD）· ✅ shipped 2026-06-03~04（GLM 门卫 a62fbd5 + STT 拦截 8c189fd 在 routes-mobile live 默认开；神经 VAD Phase1/2 f67197c/77bf39e shadow 真机验过 2.6.15；Phase3 gate barge-in 代码生效 talk.tsx:821 真打断。唯一未正式收=生效神经 barge-in 一次专门真机复验，并入下次通话）
> M36 暴露的根本问题的治本线，user 拍板。
> - ✅ **idea-9 GLM 门卫化 `a62fbd5`（待 4010 重启激活）**：纯状态/进度问题 GLM 答完不注入 orchestrator（不再 GLM+orch 双回复），带操作的仍转交。钟馗死磕"绝不丢消息"+抓到消息黑洞 blocking（handled+insert失败）已闭环；所有不确定路径默认 escalate；flag=0 回退。
> - ✅ **STT 团队名回吐拦截 `8c189fd`（待重启）**：拦 whisper 在噪声上吐"词:张飞吕布…"团队名垃圾，钟馗抓到误杀真短指令 blocking（动作词白名单）已闭环。
> - 🔬 **神经人声 VAD（Silero ONNX，只认人声不认鞭炮/音乐）**：user 拍"要上"。Phase1 PCM 通道 `f67197c`(useAudioStream 16kHz)→Phase2 Silero 集成 `77bf39e`(onnxruntime-react-native+silero_vad.onnx 2.2MB+pnpm patch 修 Gradle9，**release 构建成功=最大风险已过**，影子打分 flag 隔离钟馗审 0blocking)→flag 修 `4dc9267`(改 expo extra 让 release 生效)。**🟡待**:USB 真机验 [SILERODBG] 打分分布→准了 Phase3(模型 gate barge-in)。**❗边界**:神经VAD解决噪声误触发,解决不了念回回声自触发(合成人声)→仍需 BARGE_IN 抬阈值配合。
> - 报告：`reports/2026-06-03-neural-vad-调研.html` + `barge-in-调研.html`（DMIT /view/ 已投递 user）。
> - **待 4010 重启激活**：idea-9 门卫 + STT 拦截 + 双音色服务端 + ActionBar(web 已重建)。

## Scope

**in（覆盖范围）**：
- 多 agent 协作（orchestrator + worker，4 preset）
- 飞书远控（文本消息 + 审批卡片）
- PM 体系（plan / decisions / research / handoff）
- 跟上游 bug fix / hardening 同步

**out（明确不做）**：
- 上游 marketplace 整包回灌（与 HippoTeam 方向分叉）
- 凭据回传 / telemetry（保持本地）
- npm 发布（fork 自用，不发包）
- 多用户 ACL（单 user 场景，第一个点的算数）

## 已知 risk

| Risk | 影响 | 缓解 |
|---|---|---|
| lark SDK 重连稳定性 | 飞书 inbound 可能丢消息 | 生产观察 1-2 周看 reconnect 频率 |
| upstream 持续分叉 | sync 成本上升 | 按问题域拆小任务回灌，不做 merge main |
| typewriter 测试盲区（私有函数无法直测） | OpenCode mouse / port-in-use / WS binary 等 | 已记录为 Open task，看运行后真实问题再决定是否 export refactor |
| `.hive/plan.md` 让 orch 写但 LLM 偷懒不维护 | PM 体系沦为空架子 | system prompt 加强引导 + 每轮 reminder + Phase B UI 反馈让"跑偏"可见 |
| Marketplace 决策悬而未决 | 错过有价值的预制 worker 资产 | 派关羽深度调研出 HTML 报告 |

## 当前 phase

**maintenance + PM 体系 rollout**

主要工作模式：
1. orch 维护这份 plan.md，每完成一个 milestone 就 mark + 记 commit hash
2. user 提需求 → orch 评估属于哪个 milestone（或开新 milestone）→ 派 worker → review → commit
3. 决策性的事写到 `.hive/decisions/YYYY-MM-DD-slug.md`（参考 templates/adr.template.md）
4. session 结束前更新 `.hive/handoff.html` 给下一个 session 接手
5. 重大调研产物（如本次 upstream-diff、feishu plan、PM proposal）放 `.hive/reports/*.html`

**当前阻塞**：无硬阻塞。PM 体系 rollout 基本完成（M13 五层全齐 + M17 五 playbook 全齐 + Cockpit 9 tabs + idea-6 答题闭环）。

**待 user**：最后一次重启 4010 激活本轮累积的 server 改动（idea-6 答题注入 / app.ts 缓存头 / M17+Layer4 RULES / report-file 路由 / Layer4 快照注入）。

**下一步候选**（user 选）：M14 mobile+voice（大版本，开工起 ADR 选路线）／ M11 marketplace 调研是否启动 ／ M8 主动 trigger（观察期）。详见 Open tasks。
