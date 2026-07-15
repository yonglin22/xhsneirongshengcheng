#!/usr/bin/env node
// 精确统计某手机号的「出图扣费」并算出 poster 模式白扣的积分（在 /opt/zhusha 下：node 白扣统计.js 13696504558）
// 原理：珠宝账号 poster 模式修复前，每次一键生成会产生 2 笔出图扣费(image_card,-80)：1 笔真海报 + 1 笔用不到的 AI 封面。
//       故「白扣 = 出图扣费笔数的一半 × 单价」。只数 -80 的出图扣费，绝不把 -10 的文案/topic 算进去。
const path = require('path');
const Database = require('libsql');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'billing.db');
const TURSO_URL = (process.env.TURSO_DATABASE_URL || '').trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();
const USE_TURSO = /^libsql:|^https?:/.test(TURSO_URL);
const db = USE_TURSO ? new Database(DB_PATH, { syncUrl: TURSO_URL, authToken: TURSO_TOKEN }) : new Database(DB_PATH);
try { if (USE_TURSO && typeof db.sync === 'function') db.sync(); } catch {}

const phone = process.argv[2];
if (!phone) { console.log('用法：node 白扣统计.js <手机号>'); process.exit(1); }

const u = db.prepare('SELECT id FROM users WHERE phone=?').get(phone);
if (!u) { console.log('用户不存在：' + phone); process.exit(1); }

// 全部消费流水（不限 30 条）
const rows = db.prepare("SELECT amount, meta, created_at FROM credit_ledger WHERE user_id=? AND type='consume' ORDER BY created_at").all(u.id);
const isImg = (m) => { try { const a = (JSON.parse(m || '{}').action) || ''; return /^image/.test(a); } catch { return false; } };

let imgCount = 0, imgSum = 0, textCount = 0, textSum = 0;
const byAction = {};
for (const r of rows) {
  let a = ''; try { a = (JSON.parse(r.meta || '{}').action) || ''; } catch {}
  byAction[a] = (byAction[a] || 0) + 1;
  if (isImg(r.meta)) { imgCount++; imgSum += -r.amount; }
  else { textCount++; textSum += -r.amount; }
}

// 白扣：出图笔数的一半（poster 每次多一笔）。单价取实际均价，兜底 80。
const unit = imgCount ? Math.round(imgSum / imgCount) : 80;
const wastedCount = Math.floor(imgCount / 2);
const wasted = wastedCount * unit;

console.log('==== ' + phone + ' 出图扣费统计（全量流水）====');
console.log('  消费总笔数：' + rows.length + '（文案/topic ' + textCount + ' 笔 -' + textSum + '；出图 ' + imgCount + ' 笔 -' + imgSum + '）');
console.log('  各 action 分布：' + JSON.stringify(byAction));
console.log('');
console.log('  出图扣费 ' + imgCount + ' 笔，单价约 ' + unit + '，合计 -' + imgSum);
console.log('  → poster 每次多扣 1 笔 ⇒ 白扣约 ' + wastedCount + ' 笔 × ' + unit + ' = 【' + wasted + ' 积分】');
console.log('');
console.log('  补分命令：bash 退分.sh ' + phone + ' ' + wasted + ' "退回poster模式误扣AI封面"');
