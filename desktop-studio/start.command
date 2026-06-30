#!/bin/bash
# 双击启动：朱砂真机执行端（Mac）。第一次粘一次 token，以后双击即用。
cd "$(dirname "$0")"
clear
echo "================  朱砂 · 真机执行端  ================"
echo

# 1) 环境检查
if ! command -v adb >/dev/null 2>&1; then
  echo "✗ 没装 adb。请先在终端运行： brew install android-platform-tools"
  echo "（没装 brew 的话先装 brew，见 README）"
  echo; read -p "装好后回车重试…"; exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 没装 node。请先在终端运行： brew install node"
  echo; read -p "装好后回车重试…"; exit 1
fi

# 2) token（存到 ~/.zhusha-studio-token，只需粘一次）
CFG="$HOME/.zhusha-studio-token"
TOKEN=""
[ -f "$CFG" ] && TOKEN=$(cat "$CFG")
if [ -z "$TOKEN" ]; then
  echo "首次使用：到网页「设备看板 → 接入真机/脚本」点【生成接入 token】，"
  echo "复制那串 zd_ 开头的 token，粘到这里按回车："
  read -r TOKEN
  echo "$TOKEN" > "$CFG"
  echo "✓ token 已保存，下次双击不用再填。（要换号：删 ~/.zhusha-studio-token）"
fi
echo

# 3) 检测设备
echo "检测真机…"
if ! adb devices | grep -qw device; then
  echo "✗ 没检测到真机。请：USB 连手机 → 开 USB 调试 → 手机点【允许】。"
  echo "  小米/红米还要开『USB调试(安全设置)』（要登小米账号+插SIM）。"
  echo; read -p "连好后回车重试…"
  adb kill-server >/dev/null 2>&1
fi

# 4) 起投屏（装了 scrcpy 才起，后台运行）
if command -v scrcpy >/dev/null 2>&1; then
  echo "启动投屏窗口…"; (scrcpy >/dev/null 2>&1 &)
else
  echo "（没装 scrcpy，跳过实时投屏。想看画面： brew install scrcpy）"
fi
echo

# 5) 启动执行端
echo "启动执行端，去网页「养号/截流计划」点 📤 下发就会自动跑。Ctrl+C 退出。"
echo "===================================================="
echo
node run-agent.js "$TOKEN"
