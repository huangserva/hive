# 决策：HippoTeam 前端 APP 先走 PWA-first

**日期**: 2026-05-25
**状态**: draft（待 user 确认）
**关联**: user 飞书诉求“方便看所有任务 + 有 dashboard/面板”

## 背景

user 看到 paseo 有 APP 端，询问 HippoTeam 是否也应该做前端 APP，让任务和面板更容易看。

调研发现 paseo 的 app 端不是单一外壳，而是完整 client/daemon 架构：

- Expo / React Native app 支持 mobile + web。
- Electron desktop app 包装 web 并能管理 daemon。
- optional encrypted relay 支持远程访问。
- app 内有 host profile、direct/relay 连接、sessions/projects/workspaces、agent panes、terminal、voice 等。

HippoTeam 当前已经有 web UI、Cockpit 9 tabs、Tasks tab、Workers 卡片、RuntimeStatusStrip 和 Feishu bridge。用户诉求首先是“看任务和面板方便”，不等同于必须立即做原生移动端。

## 决策

推荐 **PWA-first**：

1. 第一阶段把现有 HippoTeam web 做成可安装 app：manifest、icons、standalone display、install CTA。
2. 第二阶段优化 dashboard-first 布局：常驻展示 Cockpit summary、Tasks、Workers 和 ActionBar，drawer 保留深 drilldown。
3. 暂不立即做 Expo / React Native mobile，也不立即引入 Tauri/Electron 桌面壳。
4. 如果 PWA 不能满足“本机 app 自动管理 runtime”的需求，再 spike Tauri/Electron。
5. 如果 Feishu bridge 不能满足“手机远程看/控任务面板”的需求，再设计 mobile app + relay/tunnel。

## 理由

1. **最贴合当前诉求**：user 要的是任务可视化和面板，现有 Cockpit/Tasks/Workers 已经提供数据和 UI。
2. **最小增量**：PWA 复用现有 React/Vite 前端，不拆新技术栈，不重写 dashboard。
3. **避开远程访问陷阱**：HippoTeam runtime 绑定 `127.0.0.1`，手机原生 app 无法直接访问电脑 loopback；移动远程是连接/安全架构问题。
4. **不重复 Feishu 远控**：M4 Feishu bridge 和 M14a voice command MVP 已覆盖低成本远程控制入口。
5. **保留升级路径**：PWA 不妨碍后续 desktop shell 或 native mobile；反而能先验证 dashboard 信息架构。

## 已知代价

- PWA 不是完整 native app；无法自动启动 runtime，也没有 tray/deep OS integration。
- 手机安装 PWA 仍无法直接访问电脑上的 `127.0.0.1` runtime，除非同设备或另配远程访问层。
- 若未来要 App Store / native push / background voice / relay pairing，仍需 Expo/RN 或 native shell。

## 备选方案

- **Electron/Tauri first**：更像桌面 app，可管理 runtime，但引入打包、签名、auto-update、安全和跨平台维护成本。
- **Expo/RN first**：长期 mobile UX 最好，但对当前“看任务+面板”诉求过重，并与 Feishu 远控/M14 voice 路线重叠。
- **不做 app 化，只保留浏览器**：维护成本最低，但不能解决 user 对“像 app 一样固定打开”的体验诉求。

## 结果（后写）

待 user 确认。如果采纳，下一步可拆为 PWA manifest/icons/install CTA + dashboard-first layout 两个小 milestone。
