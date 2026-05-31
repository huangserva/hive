#!/usr/bin/env bash
# 本地 Android APK 构建 —— 彻底摆脱 EAS 云构建额度。
#
# 一次性环境（已装好则跳过）：
#   brew install openjdk@17
#   brew install --cask android-commandlinetools
#   export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
#   yes | sdkmanager --licenses
#   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
#              "ndk;27.1.12297006" "cmake;3.22.1"
#
# 用法：
#   bash packages/mobile/build-local.sh              # 出 release APK（debug keystore 签名，可直接侧载）
#   bash packages/mobile/build-local.sh assembleDebug  # 传别的 gradle task
#
# 产物：packages/mobile/android/app/build/outputs/apk/release/app-release.apk
set -euo pipefail

# JDK17 是 openjdk@17 keg（未 symlink 到 /Library/Java，所以直接指向 brew 路径）。
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "❌ $ANDROID_DIR 不存在；先 cd packages/mobile && npx expo prebuild --platform android" >&2
  exit 1
fi

# gradle 优先读 local.properties 的 sdk.dir；按当前 ANDROID_HOME 生成（机器相关，不入库）。
echo "sdk.dir=$ANDROID_HOME" > "$ANDROID_DIR/local.properties"

echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"
"$JAVA_HOME/bin/java" -version

TASK="${1:-assembleRelease}"
shift || true
cd "$ANDROID_DIR"
./gradlew "$TASK" "$@"

# assembleRelease → release/app-release.apk；assembleDebug → debug/app-debug.apk
APK="$(find "$ANDROID_DIR/app/build/outputs/apk" -name '*.apk' -type f 2>/dev/null | sort | tail -1)"
if [ -n "$APK" ] && [ -f "$APK" ]; then
  echo ""
  echo "✅ APK 产出：$APK"
  ls -lh "$APK"
  echo "侧载：adb install -r \"$APK\""
else
  echo "❌ 未找到 APK，构建可能失败" >&2
  exit 1
fi
