#!/usr/bin/env bash
# WebRTC 实验包：prebuild 带 webrtc native 注册 + gradle release + 验 .so
set -euo pipefail
cd "$(dirname "$0")"

export WEBRTC_NATIVE_REGISTER=1
export EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER=1
export EXPO_PUBLIC_WEBRTC_PROBE=1
export EXPO_PUBLIC_WEBRTC_FORCE_RELAY=1
export WEBRTC_FORCE_RELAY=1

echo "=== [1/3] expo prebuild (webrtc autolink ON) ==="
npx expo prebuild --platform android

echo "=== [2/3] gradle assembleRelease ==="
( cd android && ./gradlew assembleRelease )

APK="android/app/build/outputs/apk/release/app-release.apk"
echo "=== [3/3] 验 webrtc native .so 在不在 APK ==="
if unzip -l "$APK" 2>/dev/null | grep -iqE "libwebrtc|libjingle_peerconnection_so|webrtc"; then
  echo "✅ WebRTC native .so 在 APK 里 — 这是真 WebRTC 实验包"
  unzip -l "$APK" 2>/dev/null | grep -iE "libwebrtc|libjingle|webrtc" | head -3
else
  echo "❌ APK 里没有 webrtc native .so — prebuild 没把 webrtc 链进去,别装"
  exit 1
fi
echo "APK: $(pwd)/$APK"
ls -la "$APK"
