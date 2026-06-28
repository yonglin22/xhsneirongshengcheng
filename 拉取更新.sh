#!/usr/bin/env bash
# 一键拉取最新代码并重启服务（在 VPS 的 /opt/zhusha 下运行：bash 拉取更新.sh）
set -e
cd "$(dirname "$0")"

echo "→ 拉取 origin/main …"
sudo -u app git fetch origin main
sudo -u app git reset --hard origin/main

echo "→ 重启服务 …"
if command -v systemctl >/dev/null && systemctl list-units --type=service 2>/dev/null | grep -q app.service; then
  sudo systemctl restart app.service
  echo "✅ app.service 已重启"
elif command -v pm2 >/dev/null; then
  pm2 restart zhusha
  echo "✅ pm2 zhusha 已重启"
else
  echo "⚠ 没找到 app.service 或 pm2，请手动重启服务"
fi

echo "→ 当前版本："
git log --oneline -1
echo "完成。浏览器对受影响页面 Ctrl+Shift+R 强刷一次即可。"
