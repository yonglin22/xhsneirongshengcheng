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

# cron 的 PATH/HOME 很精简，显式补全，否则 git/systemctl 可能找不到、git 也可能没法读用户配置
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME=/root
LOG=/var/log/zhusha-deploy.log
log(){ echo "$(date '+%F %T')  $*" >> "$LOG"; }

cd /opt/zhusha || { log "ERR cd /opt/zhusha 失败"; exit 1; }

# 拉取远端最新游标（不动工作区）；失败要记日志，别再静默吞掉
if ! sudo -u app git fetch origin main -q 2>>"$LOG"; then log "ERR git fetch 失败"; exit 1; fi

LOCAL=$(sudo -u app git rev-parse HEAD)
REMOTE=$(sudo -u app git rev-parse origin/main)

# 没有新提交就直接退出，什么都不做（不会无谓重启服务）
[ "$LOCAL" = "$REMOTE" ] && exit 0

# 有新提交：拉取并重启
if ! sudo -u app git pull -q origin main 2>>"$LOG"; then log "ERR git pull 失败"; exit 1; fi
systemctl restart app 2>>"$LOG" || log "WARN systemctl restart app 失败"

log "deployed ${LOCAL:0:7} -> ${REMOTE:0:7}"
