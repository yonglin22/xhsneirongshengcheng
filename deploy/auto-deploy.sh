#!/usr/bin/env bash
# 自动部署：每分钟检查 GitHub main 有无新提交，有就拉取并重启服务。
# 装一次（见下方注释），以后我改完代码推到 GitHub，约 1 分钟内自动上线，你无需再开终端敲命令。
#
# 一次性安装（在 VPS 上以 ubuntu 用户执行，整段复制粘贴回车即可）：
#   sudo chmod +x /opt/zhusha/deploy/auto-deploy.sh
#   ( sudo crontab -l 2>/dev/null | grep -v auto-deploy.sh ; echo '* * * * * /opt/zhusha/deploy/auto-deploy.sh >/dev/null 2>&1' ) | sudo crontab -
#
# 卸载（恢复手动部署）：
#   sudo crontab -l | grep -v auto-deploy.sh | sudo crontab -

set -e
cd /opt/zhusha

# 拉取远端最新游标（不动工作区）
sudo -u app git fetch origin main -q || exit 0

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

# 没有新提交就直接退出，什么都不做（不会无谓重启服务）
[ "$LOCAL" = "$REMOTE" ] && exit 0

# 有新提交：拉取并重启
sudo -u app git pull -q origin main
systemctl restart app

echo "$(date '+%F %T')  deployed ${LOCAL:0:7} -> ${REMOTE:0:7}" >> /var/log/zhusha-deploy.log
