# 调研/实现索引：M19a Expo app skeleton + LAN 连接

**日期**: 2026-05-25  
**触发**: M19 原生 app epic 开工；本单负责 Expo 项目初始化和 LAN 连接 spike。  
**关联**: `.hive/decisions/2026-05-25-hippoteam-frontend-app.md`

## 一句话结论

已在 `packages/mobile/` 初始化 Expo + TypeScript skeleton，接入 `expo-router` tabs，并用 `GET /api/runtime/status` 验证 LAN runtime host 可连通。

## 技术选型

- Expo blank TypeScript template：保持最小原生 app 起点。
- `expo-router`：后续 dashboard / workers / tasks / settings 走 file-based routing。
- `expo-secure-store`：保存 runtime host，M19b pairing/auth 可继续用 SecureStore 存设备私钥或 token。
- `react-native-safe-area-context`：所有 tab 页面统一 safe area。
- `expo-build-properties`：Android 开启 `usesCleartextTraffic`，支持局域网 `http://<host>:4010`。

## 项目结构

```text
packages/mobile/
  app.config.ts                 Expo app metadata + Android cleartext config
  app/_layout.tsx               root Stack + SafeAreaProvider
  app/(tabs)/_layout.tsx        Dashboard / Workers / Tasks / Settings tabs
  app/(tabs)/index.tsx          Dashboard placeholder
  app/(tabs)/workers.tsx        Workers placeholder
  app/(tabs)/tasks.tsx          Tasks placeholder
  app/(tabs)/settings.tsx       runtime host input + Connect action
  src/api/client.ts             runtime HTTP/WS URL builder
  src/api/use-runtime-status.ts SecureStore-backed runtime status hook
  src/components/Screen.tsx     shared dark safe-area shell
```

## LAN spike

- 默认 host：`192.168.1.100:4010`
- Settings 输入 host 后点 Connect：
  - `GET http://<host>/api/runtime/status`
  - 成功显示 `version` / `cwd`
  - 失败显示错误消息
- WebSocket URL builder 已支持把 `http://host` 转成 `ws://host`，后续可接 `/ws/cockpit` / `/ws/tasks`。

## 验证记录

- TDD: `tests/unit/mobile-api-client.test.ts` 先 RED（client 文件不存在），再实现。
- `pnpm exec vitest run tests/unit/mobile-api-client.test.ts`
- `pnpm --dir packages/mobile exec tsc --noEmit`
- `npx expo start --no-dev --minify` 用超时方式验证 Metro 能启动并输出 QR / dev server 地址。

## 后续

- M19a 子任务 3：等协议 audit 确认 mobile-safe endpoints 后，接 Dashboard read-only Cockpit / Workers / Tasks 数据。
- M19b：pairing/auth，不在本次 skeleton 内。

