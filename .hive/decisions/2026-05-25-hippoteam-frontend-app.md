# 决策：HippoTeam 前端走原生 APP（Expo/RN 客户端 + 远程接入层）

**日期**: 2026-05-25
**状态**: 已采纳
**确认日期**: 2026-05-25（user 飞书拍板）
**关联**: user 飞书诉求"方便看所有任务 + 有 dashboard/面板" + 明确要原生

## 背景

user 看到 paseo 有 APP 端，要给 HippoTeam 做原生前端 APP。调研（赵云 dispatch 1eb7852c，报告 `.hive/reports/hippoteam-frontend-app-eval-2026-05-25.html`）拆清 paseo：

- **移动端是真原生**（Expo / React Native，编译 iOS/Android）。
- 桌面端 Electron 套壳，可管 daemon 子进程；web 带 PWA manifest。
- 真正使能移动的不是"原生"本身，而是底层 **client/daemon 架构 + WebSocket 协议 + direct/relay 连接 + host 配对/重连**。

调研初版曾推 PWA-first（最省）。**user 否决，明确要原生、要"最好、效果最佳"的方式**——并立规矩：**不因"实现难"或"跟飞书远控重叠"就砍好方案**（见记忆 feedback-pursue-best-not-cheapest）。

## 决策

走 **原生 APP**（Expo / React Native 跨端客户端，iOS/Android 优先，可同栈出 web/桌面），HippoTeam 升级为 **client/daemon 架构**：

1. runtime 暴露稳定的 agent/任务/Cockpit 数据协议（WebSocket，复用现有 /ws/* + 补齐）。
2. 原生 app 作为第一方客户端：dashboard/面板、任务、Workers、agent/终端、（未来）语音控制。
3. **远程接入层**（关键硬骨头）：host 配对 + direct/relay 连接 + auth，让手机能安全连到本机 runtime（loopback 之外）。
4. 与 M14 语音收敛：原生 app 是"语音控制多 agent"的最佳载体，M14a 飞书 voice 是过渡，原生 app 是终局。
5. PWA/Web 可并存作为轻量入口，但**目标形态是原生**，不是 PWA 收尾。

详细架构方案另出（赵云设计 dispatch）。

## 理由

1. **user 明确偏好最优/效果最佳**，原生是第一方、体验最强的形态。
2. **不因难退缩**：远程接入/relay 是真硬骨头，但正是它让"随时随地原生控多 agent"成立——这是核心价值，不是可砍项。
3. **不因飞书重叠退缩**：飞书远控是文本级、借第三方；原生 app 是第一方完整体验（面板 + 终端 + 语音），二者互补不互斥。
4. 与北极星"语音控制多 agent"收敛，一个原生客户端承载看板 + 语音。

## 已知代价（照实记，不劝退）

- 工作量最大：Expo/RN 客户端 + 远程接入/relay/auth 基础设施 + App 分发/证书 + 移动测试。
- runtime 绑 `127.0.0.1`，必须新建远程接入层（隧道/relay + 配对 + 鉴权）才能手机远程用。
- 维护双端（client + daemon 协议）+ 发布链。
- 缓解：分阶段（epic）推进，先打通本地局域网直连 + 看板，再做 relay 远程 + 语音收敛。

## 结果 / 方案

赵云已按 epic playbook 起草完整架构方案：

- 方案报告：`.hive/reports/m19-native-app-architecture-2026-05-25.html`
- 配对索引：`.hive/research/2026-05-25-m19-native-app-design.md`
- plan.md：M19 从 proposed 升级为 confirmed epic，拆 M19a-M19f。

最终方案骨架：

1. **HippoTeam runtime 升级为稳定 daemon**：保留本地-first 模型，但对第一方 app 暴露 versioned HTTP/WS 协议；复用现有 Cockpit / Tasks / Terminal WS，补 workspace/worker aggregate stream、capability negotiation、mobile-safe control endpoints。
2. **Expo / React Native 原生 app**：iOS/Android 优先，首屏 dashboard（Cockpit summary + Tasks + Workers），深层进入 Cockpit 9 tabs、agent transcript、terminal pane、task actions。
3. **远程接入层作为核心能力**：host pairing + device credential + direct LAN + encrypted relay。手机不能依赖 `127.0.0.1`；relay 只转发密文，不读项目/agent 内容。
4. **认证/授权**：每台设备独立 keypair，private key 存 Expo SecureStore，runtime 保存 device public key + scopes；短期 token + rotation；capabilities 控制 read dashboard / read terminal / send prompt / approve / admin。
5. **M14 语音收敛**：Feishu voice command 是过渡；原生 app 承载最终 voice-to-command、STT、push、realtime voice/TTS。

阶段：

- **M19a**：协议 audit + Expo app skeleton + LAN 只读 dashboard。
- **M19b**：pairing/auth + scoped direct LAN control。
- **M19c**：encrypted relay remote access。
- **M19d**：agent/terminal pane + task operations。
- **M19e**：voice + push convergence。
- **M19f**：beta hardening + distribution。

第一阶段建议只做 M19a：先证明原生 dashboard + LAN 连接 + read-only realtime 数据成立，再打开控制、relay、terminal input 和 voice。
