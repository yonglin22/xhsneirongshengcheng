# 整站迁移到腾讯云轻量·香港 VPS（一次性解决数据丢失）

把 Node 主站 + 数据库(billing.db) + 抓取 全部放到一台常开 VPS：
- ✅ 数据存 VPS 永久磁盘，**重启/更新都不丢**（再也不会出现"积分变回20"）
- ✅ 抓取用同机 `xhs` CLI（扫码登录），**不需要 Turso、不需要单独采集服务**
- ✅ 无冷启动；香港免备案，yonglin.chat 直接指过去
- ✅ Render 可以停掉

> 已实测：`NODE_ENV=production` 纯本地模式启动 → `billing:true`、同机抓取返回真实笔记。

---

## 0. 准备
- 腾讯云轻量，地域**香港**，镜像 **Ubuntu Server 22.04 LTS**，配置 2核2G 起（抓取+出图更稳）。
- 控制台 → 实例 → **防火墙** → 放行 `TCP 22 / 80 / 443`（不放行 80/443，证书申请和访问都会失败）。
- DNS：把 `yonglin.chat` 和 `www.yonglin.chat` 的 A 记录指向 **VPS 公网 IP**（香港免备案，DNS 生效后即可）。
- 本地生成一个会话密钥：`openssl rand -hex 32`（待会填进 .env 的 `SESSION_SECRET`）。
- 准备好你现有的各类 API Key（DeepSeek/智谱/Seedream/可灵等）——和你本地 `.env` 里那套一样。

## 1. 装环境（root，整段贴）
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs python3 python3-venv pipx git debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
node -v   # 应 ≥ v22
```

## 2. 建用户 + 拉代码
```bash
useradd -m -s /bin/bash app
git clone https://github.com/yonglin22/xhsneirongshengcheng.git /opt/zhusha
chown -R app:app /opt/zhusha
```

## 3. 配 .env（密钥/配置；这是数据/功能的关键）
```bash
su - app
cd /opt/zhusha
cp .env.上线模板 .env
nano .env          # 按下面填写
```
`.env` 必填项（其余保持模板默认即可）：
```
NODE_ENV=production
COOKIE_SECURE=true
BILLING_ENABLED=true
PUBLIC_BASE_URL=https://yonglin.chat
SESSION_SECRET=第0步 openssl 生成的那串      # ★ 固定写死，别再让它变（变了所有人要重登）
ADMIN_TOKEN=admin888
ADMIN_PHONES=18268346784
SIGNUP_GRANT_CREDITS=200

API_FORMAT=openai
ANTHROPIC_BASE_URL=https://api.deepseek.com
ANTHROPIC_AUTH_STYLE=bearer
MODEL=deepseek-chat
ANTHROPIC_API_KEY=你的DeepSeek key
ZHIPU_API_KEY=你的智谱 key
SEEDREAM_API_KEY=你的Seedream key
SEEDREAM_MODEL=doubao-seedream-5-0-260128
SEEDREAM_SIZE=1728x2304
SEEDREAM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
KLING_ACCESS_KEY=你的可灵AK
KLING_SECRET_KEY=你的可灵SK
KLING_BASE_URL=https://api.klingai.com
KLING_MODEL=kling-v1
# 真实短信(可选，签名/模板审核通过再填)：
# SMS_PROVIDER=aliyun
# ALIYUN_SMS_TEMPLATE=SMS_508250151
# ALIYUN_SMS_SIGN=你的签名名称
# ALIYUN_ACCESS_KEY_ID=...
# ALIYUN_ACCESS_KEY_SECRET=...
```
> 收款码无需配（代码已默认用 /assets/pay-qr.png）。COLLECTOR_URL / TURSO 都**不要填**（同机本地模式）。

## 4. 装依赖 + 装 xhs CLI + 扫码登录（仍在 app 用户下）
```bash
cd /opt/zhusha
npm install                       # 装 libsql / officeparser 等
pipx install xiaohongshu-cli && pipx ensurepath && source ~/.bashrc
xhs login --qrcode                # 终端出二维码 → 手机小红书App扫一扫
xhs status                        # 显示已登录用户即成功
exit                              # 回到 root
```

## 5. systemd 起主程序
```bash
cp /opt/zhusha/deploy/app.service /etc/systemd/system/app.service
systemctl daemon-reload
systemctl enable --now app
systemctl status app                       # active (running)
curl -s http://localhost:8787/api/health   # billing:true
```

## 6. Caddy 反代 yonglin.chat（自动 HTTPS）
确认 DNS 已指向本机 IP，然后：
```bash
cp /opt/zhusha/deploy/Caddyfile.app /etc/caddy/Caddyfile
systemctl reload caddy
curl -s https://yonglin.chat/api/health     # 外网 HTTPS 通
```

## 7. 验证（重点：数据持久）
```bash
# 1) 浏览器开 https://yonglin.chat → 用 18268346784 登录(测试码显示在页面) → 进管理后台
# 2) 抓对标：选维度抓 → 应返回真实笔记
# 3) 关键：重启服务，确认数据还在
systemctl restart app
# 再刷新网站，积分/作品仍在 = 持久化成功（这就是和 Render 的根本区别）
```

## 8. 每日自动备份 billing.db（双保险，防误删/损坏）
```bash
mkdir -p /opt/zhusha/backups
cat >/etc/cron.daily/zhusha-db-backup <<'EOF'
#!/bin/bash
cp /opt/zhusha/billing.db /opt/zhusha/backups/billing-$(date +\%F).db 2>/dev/null
ls -1t /opt/zhusha/backups/*.db | tail -n +15 | xargs -r rm   # 只留最近14天
EOF
chmod +x /etc/cron.daily/zhusha-db-backup
```

## 9. 以后更新代码（不会丢数据）
```bash
cd /opt/zhusha
sudo -u app git pull
sudo -u app npm install            # 有新依赖时
systemctl restart app
# billing.db 是 .gitignore 的，git pull / 重启都不动它 → 数据始终在
```

## 10. 收尾
- 网站稳定跑通后，Render 那个服务可以**暂停或删除**（不再需要）。
- 域名 yonglin.chat 已指向 VPS，用户访问无感。

---

## 排查
| 现象 | 处理 |
|---|---|
| `systemctl status app` 报错 | `journalctl -u app -n 50` 看日志；多半是 .env 缺 key 或 node 版本 |
| 抓取报"未找到 xhs"/"未登录" | app 用户下 `xhs status`；没登录就 `xhs login --qrcode` 重扫 |
| Caddy 证书申请失败 | 防火墙 80/443 没放行，或 DNS 还没生效 |
| 登录后又要重登 | `SESSION_SECRET` 每次启动变了 → 确认 .env 里写死了固定值 |
| 数据还会丢吗 | 不会。billing.db 在 VPS 永久磁盘，重启/更新都保留；另有每日备份 |
