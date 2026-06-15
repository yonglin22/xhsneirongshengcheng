#!/usr/bin/env bash
# 服务器首次/更新部署：在项目目录运行  bash deploy.sh
set -e
cd "$(dirname "$0")"

# 1) Node 版本检查（需 ≥22，用到 node:sqlite）
command -v node >/dev/null || { echo "❌ 未安装 Node，请先装 Node ≥ 22"; exit 1; }
MAJ=$(node -p "process.versions.node.split('.')[0]")
[ "$MAJ" -ge 22 ] || { echo "❌ Node 版本过低（当前 v$MAJ），需 ≥ 22"; exit 1; }

# 2) .env 必须存在
[ -f .env ] || { echo "❌ 缺 .env：先 cp .env.example .env 并填好（NODE_ENV=production / SESSION_SECRET / PUBLIC_BASE_URL / AI keys 等）"; exit 1; }

# 3) 装依赖（officeparser，可选；失败不阻断核心）
npm install || echo "⚠ npm install 失败（officeparser 没装：仅影响“上传文档喂知识库”，核心不受影响）"

# 4) pm2 守护启动
command -v pm2 >/dev/null || npm i -g pm2
pm2 start ecosystem.config.cjs 2>/dev/null || pm2 restart zhusha
pm2 save

echo ""
echo "✅ 已启动：本地 http://127.0.0.1:8787"
echo "   下一步：配 Nginx 反代到 8787 + 绑 yonglin.chat 的 HTTPS（见 部署上线手册.md §4）"
echo "   查看日志：pm2 logs zhusha"
