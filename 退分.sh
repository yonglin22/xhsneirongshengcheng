#!/usr/bin/env bash
# 查流水 / 手动补分脚本（在 VPS 的 /opt/zhusha 下运行）
# 用法：
#   查流水：   bash 退分.sh 13696504558
#   补积分：   bash 退分.sh 13696504558 160 "退回poster模式误扣"
#   扣积分：   bash 退分.sh 13696504558 -80 "手动扣减"
#
# 端口与令牌自动从 .env 读取（PORT、ADMIN_TOKEN）；也可用环境变量覆盖：
#   PORT=8787 ADMIN_TOKEN=xxx bash 退分.sh 13696504558 160 "说明"
set -e
cd "$(dirname "$0")"

# 从 .env 读取 PORT / ADMIN_TOKEN（命令行环境变量优先）
if [ -f .env ]; then
  [ -z "$PORT" ]         && PORT=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
  [ -z "$ADMIN_TOKEN" ]  && ADMIN_TOKEN=$(grep -E '^ADMIN_TOKEN=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
fi
PORT=${PORT:-8787}
BASE="http://127.0.0.1:${PORT}"

PHONE="$1"; DELTA="$2"; REASON="${3:-管理员手动调整}"

if [ -z "$PHONE" ]; then
  echo "用法：bash 退分.sh <手机号> [补分数量(正充负扣)] [原因]"
  echo "  只给手机号 = 查余额+最近流水；给数量 = 直接调整"
  exit 1
fi
if [ -z "$ADMIN_TOKEN" ]; then
  echo "⚠ 没读到 ADMIN_TOKEN（.env 里需有 ADMIN_TOKEN=xxx，或用 ADMIN_TOKEN=xxx bash 退分.sh …）"
  exit 1
fi

if command -v python3 >/dev/null; then PP="python3 -m json.tool"; else PP="cat"; fi

if [ -z "$DELTA" ]; then
  # 只查流水：余额 + 最近 30 条；顺带高亮出图扣费(-80)
  echo "→ 查询 $PHONE 的余额与最近流水 …"
  RESP=$(curl -s "${BASE}/api/admin/user?phone=${PHONE}" -H "x-admin-token: ${ADMIN_TOKEN}")
  echo "$RESP" | $PP
  echo ""
  echo "— 出图扣费(consume)统计 —"
  echo "$RESP" | python3 -c '
import sys, json
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
led = d.get("ledger", []) or []
img = [x for x in led if x.get("type") == "consume"]
tot = sum(-x.get("amount", 0) for x in img)
print(f"  最近 {len(led)} 条里，出图/生成扣费 {len(img)} 笔，合计 -{tot} 积分")
print("  （poster 模式修复前，每次一键生成会有 2 笔 -80：1 笔海报 + 1 笔白扣的 AI 封面。数一下白扣笔数 ×80 = 应补数量）")
' 2>/dev/null || true
  echo ""
  echo "补分示例：bash 退分.sh $PHONE 160 \"退回poster模式误扣\""
else
  echo "→ 调整 $PHONE 积分：${DELTA}（原因：${REASON}）"
  curl -s -X POST "${BASE}/api/admin/adjust" \
    -H 'content-type: application/json' \
    -H "x-admin-token: ${ADMIN_TOKEN}" \
    -d "{\"phone\":\"${PHONE}\",\"delta\":${DELTA},\"reason\":\"${REASON}\"}" | $PP
fi
