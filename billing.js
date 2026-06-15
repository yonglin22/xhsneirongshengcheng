// 积分计费核心：账号 + 钱包 + 流水 + 订单 + 定价。用 Node 内置 node:sqlite（需 Node ≥ 22）。
// 单进程同步执行，天然无并发竞争；事务用 BEGIN/COMMIT 保证原子与回滚。
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

// DB 路径可配置：Render 等容器磁盘是临时的，重部署会清空数据 → 挂持久化磁盘后用 DB_PATH 指过去（如 /var/data/billing.db）即可保住用户/作品/积分。
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'billing.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
console.log('  [billing] 数据库:', DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE, nickname TEXT, status INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS wallets(
  user_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, frozen INTEGER NOT NULL DEFAULT 0, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS credit_ledger(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, ref_type TEXT, ref_id TEXT,
  request_id TEXT UNIQUE, meta TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS price_rules(action_key TEXT PRIMARY KEY, credits INTEGER NOT NULL, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(
  out_trade_no TEXT PRIMARY KEY, user_id INTEGER NOT NULL, pack_id TEXT, amount_cny INTEGER NOT NULL,
  credits INTEGER NOT NULL, status TEXT DEFAULT 'pending', pay_channel TEXT, transaction_id TEXT,
  created_at INTEGER, paid_at INTEGER);
CREATE TABLE IF NOT EXISTS login_codes(phone TEXT PRIMARY KEY, code TEXT, exp INTEGER);
CREATE TABLE IF NOT EXISTS pipeline_history(
  user_id INTEGER NOT NULL, run_id TEXT NOT NULL, topic TEXT, track TEXT,
  done_keys TEXT, imgs INTEGER, data TEXT, updated_at INTEGER,
  PRIMARY KEY(user_id, run_id));
CREATE TABLE IF NOT EXISTS agent_config(
  user_id INTEGER NOT NULL, track_id TEXT NOT NULL, config TEXT, updated_at INTEGER,
  PRIMARY KEY(user_id, track_id));
CREATE TABLE IF NOT EXISTS app_settings(k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS staff(phone TEXT PRIMARY KEY, role TEXT, note TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS agent_apps(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, phone TEXT, name TEXT, reason TEXT, status TEXT DEFAULT 'pending', created_at INTEGER, decided_at INTEGER);
CREATE TABLE IF NOT EXISTS qa_log(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question TEXT, answer TEXT, created_at INTEGER);
`);

// 计价（1 积分 = ¥0.01）。用 OR IGNORE：只为缺失的 key 建初值，已有值（含后台改的）不被覆盖。
const seed = db.prepare('INSERT OR IGNORE INTO price_rules(action_key, credits, active) VALUES(?,?,1)');
[
  ['text', 3], ['topic', 5], ['skeleton', 5], ['frame', 5], ['copy', 10], ['cover', 0], ['rule_query', 5],
  ['imgplan', 0], ['compliance', 0], ['vision', 0],
  ['image_std', 20], ['image_hd', 60], ['image_premium', 60],
].forEach(([k, c]) => seed.run(k, c));
// 一次性对齐 PRD §8 建议价（选题5/拆解·框架各5/正文10/配图60/规则5/质检免费）；执行一次后后台改价不再被重置
function priceMigrateV2() {
  if (settingsGet('pricing_v2')) return;
  [['topic', 5], ['skeleton', 5], ['frame', 5], ['copy', 10], ['cover', 0], ['rule_query', 5], ['imgplan', 0], ['compliance', 0], ['image_std', 20], ['image_hd', 60], ['image_premium', 60]].forEach(([k, c]) => setPrice(k, c));
  settingsSet('pricing_v2', 1);
}

// 迁移：邀请字段（旧库平滑升级；已存在则忽略）
try { db.exec("ALTER TABLE users ADD COLUMN invite_code TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN invited_by INTEGER"); } catch {}
try { db.exec("ALTER TABLE staff ADD COLUMN menus TEXT"); } catch {} // 菜单级权限（JSON 数组；空/缺=全部）
try { db.exec("ALTER TABLE pipeline_history ADD COLUMN cover TEXT"); } catch {} // 作品封面缩略（http 图 URL，供「我的作品」显示）
// 一次性回填：给历史作品补封面（仅处理 cover 为空的行，自限）
try {
  const _rows = db.prepare("SELECT user_id, run_id, data FROM pipeline_history WHERE cover IS NULL").all();
  const _upd = db.prepare("UPDATE pipeline_history SET cover=? WHERE user_id=? AND run_id=?");
  for (const r of _rows) { let c = ''; try { const d = JSON.parse(r.data || '{}'); const imgs = d.coverImages || (d.coverImage ? [d.coverImage] : []); c = (Array.isArray(imgs) ? imgs.find(u => typeof u === 'string' && /^https?:\/\//.test(u)) : '') || ''; } catch {} _upd.run(c, r.user_id, r.run_id); }
} catch {}

const SECRET = (process.env.SESSION_SECRET || (process.env.ANTHROPIC_API_KEY || 'dev-secret')) + '|sess';
const SIGNUP_GRANT = parseInt(process.env.SIGNUP_GRANT_CREDITS || '200', 10);
// 邀请返积分（单级·非现金·不可提现；后台可配）
const INVITE_INVITER_SIGNUP = parseInt(process.env.INVITE_INVITER_SIGNUP || '100', 10); // 被邀请人完成注册，邀请人得
const INVITE_RECHARGE_PCT = parseFloat(process.env.INVITE_RECHARGE_PCT || '0.10');        // 被邀请人首充，邀请人返比例
const INVITE_RECHARGE_CAP = parseInt(process.env.INVITE_RECHARGE_CAP || '500', 10);        // 单笔首充返积分封顶
const INVITE_DAILY_CAP = parseInt(process.env.INVITE_DAILY_CAP || '2000', 10);             // 每人每日邀请返积分上限（防刷）
// 付费成品模板：购买扣积分 → 复制成「我的作品」可编辑；已购免费重看
const TEMPLATE_PRICE = parseInt(process.env.TEMPLATE_PRICE || '120', 10);
try { db.exec("CREATE TABLE IF NOT EXISTS template_purchases(user_id INTEGER, tpl_id TEXT, run_id TEXT, created_at INTEGER, PRIMARY KEY(user_id,tpl_id))"); } catch {}

function txn(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } }

// ===== 会话 token（放 Cookie，HMAC 签名）=====
function signSession(uid) {
  const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 30 * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  return p + '.' + sig;
}
function verifySession(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  const want = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (sig !== want) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o.uid : null; } catch { return null; }
}

// ===== 验证码 =====
function setCode(phone) { const code = '' + Math.floor(100000 + Math.random() * 900000); db.prepare('INSERT OR REPLACE INTO login_codes(phone,code,exp) VALUES(?,?,?)').run(phone, code, Date.now() + 5 * 60000); return code; }
function checkCode(phone, code) {
  const r = db.prepare('SELECT code,exp FROM login_codes WHERE phone=?').get(phone);
  if (!r || r.exp < Date.now() || String(r.code) !== String(code)) return false;
  db.prepare('DELETE FROM login_codes WHERE phone=?').run(phone); return true;
}

// ===== 流水 + 钱包 =====
function ledger(uid, type, amount, balAfter, refType, refId, meta, requestId) {
  db.prepare('INSERT INTO credit_ledger(user_id,type,amount,balance_after,ref_type,ref_id,request_id,meta,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(uid, type, amount, balAfter, refType || null, refId != null ? String(refId) : null, requestId || null, meta ? JSON.stringify(meta) : null, Date.now());
}
function getBalance(uid) { const w = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(uid); return w ? w.balance : 0; }

function grantCore(uid, amount, type, refType, refId, meta) { // 不开事务，供已在事务内的调用复用
  const w = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(uid);
  const nb = (w ? w.balance : 0) + amount;
  db.prepare('UPDATE wallets SET balance=?,updated_at=? WHERE user_id=?').run(nb, Date.now(), uid);
  ledger(uid, type, amount, nb, refType, refId, meta);
  return nb;
}
function grant(uid, amount, type, refType, refId, meta) { return txn(() => grantCore(uid, amount, type, refType, refId, meta)); }
// 后扣：调用方已 gate 余额 + 完成 AI；这里扣减并记流水。requestId 幂等防双扣。
function deduct(uid, cost, refType, refId, meta, requestId) {
  if (cost <= 0) return { ok: true, balance: getBalance(uid) };
  return txn(() => {
    if (requestId && db.prepare('SELECT 1 FROM credit_ledger WHERE request_id=?').get(requestId)) return { ok: true, balance: getBalance(uid), dup: true };
    const w = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(uid);
    const nb = (w ? w.balance : 0) - cost;
    db.prepare('UPDATE wallets SET balance=?,updated_at=? WHERE user_id=?').run(nb, Date.now(), uid);
    ledger(uid, 'consume', -cost, nb, refType, refId, meta, requestId);
    return { ok: true, balance: nb };
  });
}
// 管理员手动调整（不走支付）：delta 可正可负
function adminAdjust(uid, delta, reason) {
  const w = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(uid); if (!w) return null;
  return txn(() => {
    const nb = w.balance + delta;
    db.prepare('UPDATE wallets SET balance=?,updated_at=? WHERE user_id=?').run(nb, Date.now(), uid);
    ledger(uid, delta >= 0 ? 'admin_grant' : 'admin_deduct', delta, nb, 'admin', null, { reason: reason || '管理员调整' });
    return nb;
  });
}

// ===== 用户 =====
// ===== 邀请返积分（单级·非现金·不可提现） =====
function genCode(uid) { return (Number(uid).toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase().slice(0, 8); }
function ensureInviteCode(uid) {
  const u = getUser(uid); if (!u) return '';
  if (u.invite_code) return u.invite_code;
  let code; for (let i = 0; i < 6; i++) { code = genCode(uid); if (!db.prepare('SELECT 1 FROM users WHERE invite_code=?').get(code)) break; }
  db.prepare('UPDATE users SET invite_code=? WHERE id=?').run(code, uid); return code;
}
function getUserByInviteCode(code) { return code ? db.prepare('SELECT * FROM users WHERE invite_code=?').get(String(code).trim().toUpperCase()) : null; }
// 当日某用户已通过邀请获得的积分（防刷封顶用）
function inviteEarnedToday(uid) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const r = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM credit_ledger WHERE user_id=? AND ref_type IN ('invite_signup','invite_recharge') AND created_at>=?").get(uid, start.getTime());
  return r ? r.s : 0;
}
// 在封顶内给邀请人发积分，返回实发数
function grantInviteCapped(inviterId, want, refType, refId, meta) {
  const left = INVITE_DAILY_CAP - inviteEarnedToday(inviterId);
  const give = Math.max(0, Math.min(want, left));
  if (give > 0) grantCore(inviterId, give, 'grant', refType, refId, meta);
  return give;
}
function inviteStats(uid) {
  const code = ensureInviteCode(uid);
  const invitees = db.prepare("SELECT id, phone, created_at FROM users WHERE invited_by=? ORDER BY created_at DESC").all(uid);
  const list = invitees.map(u => {
    const rc = db.prepare("SELECT COALESCE(SUM(amount_cny),0) AS c FROM orders WHERE user_id=? AND status='paid'").get(u.id);
    return { id: u.id, phone: String(u.phone || '').replace(/^(\d{3})\d{4}(\d+)$/, '$1****$2'), joined_at: u.created_at, recharge_cny: rc ? rc.c : 0 };
  });
  const earned = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM credit_ledger WHERE user_id=? AND ref_type IN ('invite_signup','invite_recharge')").get(uid);
  return { code, count: invitees.length, earnedCredits: earned ? earned.s : 0, invitees: list };
}

function getOrCreateUser(phone, inviteCode) {
  let u = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (u) return { user: u, isNew: false };
  const info = db.prepare('INSERT INTO users(phone,created_at) VALUES(?,?)').run(phone, Date.now());
  const uid = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO wallets(user_id,balance,frozen,updated_at) VALUES(?,0,0,?)').run(uid, Date.now());
  if (SIGNUP_GRANT > 0) grant(uid, SIGNUP_GRANT, 'grant', 'signup', uid, { reason: '注册赠送' });
  // 邀请绑定（单级、一次性、不可改）：被邀请人手机已通过验证码校验 → 邀请人即时返积分（封顶防刷）
  const inviter = getUserByInviteCode(inviteCode);
  if (inviter && inviter.id !== uid) {
    db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(inviter.id, uid);
    if (INVITE_INVITER_SIGNUP > 0) grantInviteCapped(inviter.id, INVITE_INVITER_SIGNUP, 'invite_signup', String(uid), { reason: '邀请好友注册', invitee: uid });
  }
  return { user: db.prepare('SELECT * FROM users WHERE id=?').get(uid), isNew: true };
}
function getUser(uid) { return db.prepare('SELECT * FROM users WHERE id=?').get(uid); }
function getUserByPhone(phone) { return db.prepare('SELECT * FROM users WHERE phone=?').get(phone); }
function setNickname(uid, name) { db.prepare('UPDATE users SET nickname=? WHERE id=?').run((name || '').trim().slice(0, 24) || null, uid); return getUser(uid); }

// ===== 会员等级（PRD 四级，按累计充值金额，单位分；bonus=充值赠分比例，满 ¥100 生效）=====
// 阈值/比例后台可配（后续接 settings 表）；现金返佣/按邀请数晋升均不在本期（待 D1）。
const RECHARGE_BONUS_MIN = parseInt(process.env.RECHARGE_BONUS_MIN_CENTS || '10000', 10); // 满 ¥100 才赠分
// ===== 通用设置存储（后台可配：等级/价格/规则KB 等）=====
function settingsGet(key, def) { const r = db.prepare('SELECT v FROM app_settings WHERE k=?').get(key); if (!r) return def; try { return JSON.parse(r.v); } catch { return def; } }
function settingsSet(key, val) { db.prepare('INSERT OR REPLACE INTO app_settings(k,v,updated_at) VALUES(?,?,?)').run(key, JSON.stringify(val), Date.now()); return val; }

const DEFAULT_LEVELS = [
  { key: '普通', name: '普通会员', min: 0, bonus: 0.10, perks: '充值赠分 10%（满¥100） · 完整创作闭环' },
  { key: '白金', name: '白金会员', min: 10000, bonus: 0.20, perks: '充值赠分 20% · 高频创作' },
  { key: '黑金', name: '黑金会员', min: 100000, bonus: 0.25, perks: '充值赠分 25% · 高清优先出图' },
  { key: '合伙人', name: '合伙人', min: 1000000, bonus: 0.30, perks: '充值赠分 30% · 团队只读查询 · 优先支持' },
];
function levelsGet() { const s = settingsGet('levels'); return (Array.isArray(s) && s.length) ? s : DEFAULT_LEVELS; }
function levelsSet(arr) {
  const clean = (arr || []).filter(x => x && x.name).map(x => ({ key: String(x.key || x.name).slice(0, 12), name: String(x.name).slice(0, 16), min: Math.max(0, parseInt(x.min, 10) || 0), bonus: Math.min(1, Math.max(0, parseFloat(x.bonus) || 0)), perks: String(x.perks || '').slice(0, 120) })).sort((a, b) => a.min - b.min);
  return settingsSet('levels', clean.length ? clean : DEFAULT_LEVELS);
}
function levelFor(totalRecharge) { const LV = levelsGet(); let lv = LV[0]; for (const L of LV) if (totalRecharge >= L.min) lv = L; return lv; }
function totalRechargeOf(uid) { const r = db.prepare("SELECT COALESCE(SUM(amount_cny),0) AS tot FROM orders WHERE user_id=? AND status='paid'").get(uid); return r ? r.tot : 0; }
function userStats(uid) {
  const balance = getBalance(uid);
  const totalRecharge = totalRechargeOf(uid);
  const LV = levelsGet();
  const lv = levelFor(totalRecharge);
  const next = LV[LV.findIndex(x => x.key === lv.key) + 1] || null;
  const partnerLv = LV.find(x => x.key === '合伙人') || null; // 合伙人等级（门槛后台可改）
  return {
    balance, totalRecharge, level: lv.name, levelKey: lv.key, perks: lv.perks, bonus: lv.bonus,
    estNotes: Math.floor(balance / 60), // 60 积分 ≈ 一篇标清 6 图图文
    nextLevel: next ? next.name : null, nextNeed: next ? next.min - totalRecharge : 0,
    partnerName: partnerLv ? partnerLv.name : null,
    partnerMin: partnerLv ? partnerLv.min : null,
    partnerGap: partnerLv ? Math.max(0, partnerLv.min - totalRecharge) : null,
    isPartnerLevel: partnerLv ? totalRecharge >= partnerLv.min : false,
  };
}

// ===== 定价（price_rules 即可配；后台可改）=====
function getPrice(actionKey, def) { const r = db.prepare('SELECT credits FROM price_rules WHERE action_key=? AND active=1').get(actionKey); return r ? r.credits : (def || 0); }
function getAllPrices() { return db.prepare('SELECT action_key, credits, active FROM price_rules ORDER BY action_key').all(); }
function setPrice(actionKey, credits) { db.prepare('INSERT OR REPLACE INTO price_rules(action_key,credits,active) VALUES(?,?,1)').run(String(actionKey), Math.max(0, parseInt(credits, 10) || 0)); return getAllPrices(); }

// ===== 规则知识库（后台可维护；帮助页/规则Agent 读取）=====
function kbGet() {
  return {
    rules: settingsGet('kb_rules', null),   // null = 用前端默认 help-kb.js
    docs: settingsGet('kb_docs', null),
    faq: settingsGet('kb_faq', null),
    updated_at: settingsGet('kb_updated_at', 0),
  };
}
function kbSet(part) {
  if (Array.isArray(part.rules)) settingsSet('kb_rules', part.rules.filter(x => x && x.t).map(x => ({ t: String(x.t).slice(0, 40), d: String(x.d || '').slice(0, 600), date: String(x.date || '').slice(0, 20), src: String(x.src || '').slice(0, 120) })));
  if (Array.isArray(part.docs)) settingsSet('kb_docs', part.docs.filter(x => x && x.q).map(x => ({ q: String(x.q).slice(0, 60), a: String(x.a || '').slice(0, 1500) })));
  if (Array.isArray(part.faq)) settingsSet('kb_faq', part.faq.filter(x => x && x.q).map(x => ({ q: String(x.q).slice(0, 80), a: String(x.a || '').slice(0, 800) })));
  settingsSet('kb_updated_at', Date.now());
  return kbGet();
}

// ===== 员工 / RBAC-lite =====
// ===== RBAC：菜单(资源) / 角色 / 权限(角色×菜单) / 员工 四件套（拆为三个独立模块）=====
const ADMIN_MENUS = ['overview', 'funnel', 'tasks', 'users', 'orders', 'levels', 'prices', 'rules', 'qaLog', 'agentApps', 'roles', 'perms', 'menus'];
const MENU_DEFLABEL = { overview: '概览', funnel: '增长漏斗', tasks: '任务列表', users: '用户管理', orders: '充值单据', levels: '会员体系', prices: '计费配置', rules: '规则知识库', qaLog: '问答日志', agentApps: '智能体申请', roles: '角色管理', perms: '权限管理', menus: '菜单管理' };
const LOCKED_MENUS = ['overview', 'roles', 'perms', 'menus']; // 不可禁用，防把自己锁死
const DEFAULT_ROLES = [
  { key: 'admin', name: '超级管理员', menus: ADMIN_MENUS.slice() },
  { key: 'ops', name: '运营', menus: ['overview', 'funnel', 'tasks', 'users', 'orders', 'rules', 'qaLog', 'agentApps'] },
  { key: 'finance', name: '财务', menus: ['overview', 'orders', 'users'] },
  { key: 'support', name: '客服', menus: ['overview', 'users', 'qaLog', 'rules'] },
];
// —— 角色管理 ——
function rolesGet() { const r = settingsGet('rbac_roles', null); if (Array.isArray(r) && r.length) return r; return DEFAULT_ROLES.map(x => ({ ...x, menus: x.menus.slice() })); }
function rolesSet(arr) {
  let clean = (arr || []).filter(x => x && x.key && x.name).map(x => ({ key: String(x.key).slice(0, 20), name: String(x.name).slice(0, 20), menus: Array.isArray(x.menus) ? x.menus.filter(m => ADMIN_MENUS.includes(m)) : [] }));
  const a = clean.find(r => r.key === 'admin');
  if (a) a.menus = ADMIN_MENUS.slice(); else clean.unshift({ key: 'admin', name: '超级管理员', menus: ADMIN_MENUS.slice() }); // 超管始终存在且全权
  settingsSet('rbac_roles', clean); return clean;
}
// —— 菜单管理 ——
function menuCfgGet() { const ov = settingsGet('menu_cfg', {}) || {}; return ADMIN_MENUS.map(k => ({ key: k, label: (ov[k] && ov[k].label) || MENU_DEFLABEL[k] || k, enabled: LOCKED_MENUS.includes(k) ? true : (ov[k] ? ov[k].enabled !== false : true) })); }
function menuCfgSet(arr) { const ov = {}; (arr || []).forEach(x => { if (x && ADMIN_MENUS.includes(x.key)) ov[x.key] = { label: String(x.label || MENU_DEFLABEL[x.key] || x.key).slice(0, 16), enabled: LOCKED_MENUS.includes(x.key) ? true : x.enabled !== false }; }); settingsSet('menu_cfg', ov); return menuCfgGet(); }
function enabledMenuKeys() { return menuCfgGet().filter(m => m.enabled).map(m => m.key); }
// —— 员工管理（手机号 → 角色）——
function staffList() { const roles = rolesGet(); return db.prepare('SELECT phone, role, note, created_at FROM staff ORDER BY created_at DESC').all().map(s => ({ phone: s.phone, role: s.role, roleName: (roles.find(r => r.key === s.role) || {}).name || s.role, note: s.note, created_at: s.created_at })); }
function staffAdd(phone, role, note) {
  if (!/^1\d{10}$/.test(phone || '')) throw new Error('手机号格式不正确');
  const rk = rolesGet().find(r => r.key === role) ? role : 'ops';
  db.prepare('INSERT OR REPLACE INTO staff(phone,role,note,menus,created_at) VALUES(?,?,?,?,?)').run(phone, rk, (note || '').slice(0, 40), '[]', Date.now());
  return staffList();
}
function staffRemove(phone) { db.prepare('DELETE FROM staff WHERE phone=?').run(phone); return staffList(); }
function isStaffPhone(phone) { return !!db.prepare('SELECT 1 FROM staff WHERE phone=?').get(phone); }
// 该员工可见菜单 = 其角色的菜单 ∩ 已启用菜单；超管(admin 角色/非员工)= 全部已启用
function staffMenusOf(phone) {
  const en = enabledMenuKeys();
  const s = db.prepare('SELECT role FROM staff WHERE phone=?').get(phone);
  if (!s) return en.slice();
  if (s.role === 'admin') return en.slice();
  const role = rolesGet().find(r => r.key === s.role);
  const m = role ? role.menus : [];
  return en.filter(k => m.includes(k));
}

// ===== 新增智能体配额 / 申请 / 审批（普通 1 · 合伙人 3 · 管理员不限；超额→申请→后台审批 +1）=====
function agentBaseLimit(role) { return role === 'admin' ? 999 : (role === 'partner' ? 3 : 1); }
function agentList(uid) { return settingsGet('agents_' + uid, []); }
function agentUsed(uid) { return agentList(uid).length; }
function agentExtra(uid) { return parseInt(settingsGet('agent_extra_' + uid, 0), 10) || 0; }
function agentQuota(uid, role) { const base = agentBaseLimit(role); const extra = agentExtra(uid); const used = agentUsed(uid); return { base, extra, limit: base + extra, used, canAdd: used < base + extra }; }
function agentRegister(uid, role, name) {
  const q = agentQuota(uid, role); if (!q.canAdd) return { ok: false, needApply: true, ...q };
  const list = agentList(uid); if (!list.includes(name)) { list.push(name); settingsSet('agents_' + uid, list); }
  return { ok: true, ...agentQuota(uid, role) };
}
function agentUnregister(uid, name) { settingsSet('agents_' + uid, agentList(uid).filter(x => x !== name)); }
function agentApply(uid, phone, name, reason) {
  db.prepare('INSERT INTO agent_apps(user_id,phone,name,reason,status,created_at) VALUES(?,?,?,?,?,?)').run(uid, phone, (name || '').slice(0, 30), (reason || '').slice(0, 300), 'pending', Date.now());
  return { ok: true };
}
function agentAppsAll(status) { return status ? db.prepare('SELECT * FROM agent_apps WHERE status=? ORDER BY created_at DESC LIMIT 200').all(status) : db.prepare('SELECT * FROM agent_apps ORDER BY created_at DESC LIMIT 200').all(); }
function agentAppDecide(id, approve) {
  const a = db.prepare('SELECT * FROM agent_apps WHERE id=?').get(id); if (!a || a.status !== 'pending') return { ok: false, error: '申请不存在或已处理' };
  db.prepare('UPDATE agent_apps SET status=?,decided_at=? WHERE id=?').run(approve ? 'approved' : 'rejected', Date.now(), id);
  if (approve) settingsSet('agent_extra_' + a.user_id, agentExtra(a.user_id) + 1); // 批准 → 该用户配额 +1
  return { ok: true };
}

// ===== 合伙人：名下某成员的充值记录（只读；仅当该成员确为本人直邀）=====
function partnerMemberOrders(inviterId, inviteeId) {
  const inv = db.prepare('SELECT id, phone, invited_by FROM users WHERE id=?').get(inviteeId);
  if (!inv || inv.invited_by !== inviterId) return null; // 越权保护
  const orders = db.prepare("SELECT out_trade_no AS otn, pack_id, amount_cny, credits, status, paid_at, created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(inviteeId);
  return { phone: String(inv.phone || '').replace(/^(\d{3})\d{4}(\d+)$/, '$1****$2'), orders };
}
// ===== 规则查询 Agent：问答日志 + 高频问题（A9 管理端）=====
function qaLogAdd(uid, question, answer) {
  const q = String(question || '').trim().slice(0, 200); if (!q) return;
  db.prepare('INSERT INTO qa_log(user_id,question,answer,created_at) VALUES(?,?,?,?)').run(uid || null, q, String(answer || '').slice(0, 600), Date.now());
}
function qaLogList(limit) {
  return db.prepare("SELECT q.id, q.user_id, u.phone, q.question, q.answer, q.created_at FROM qa_log q LEFT JOIN users u ON u.id=q.user_id ORDER BY q.id DESC LIMIT ?").all(limit || 100);
}
function qaTopQuestions(limit) {
  return db.prepare("SELECT question, COUNT(*) AS cnt, MAX(created_at) AS last_at FROM qa_log GROUP BY question ORDER BY cnt DESC, last_at DESC LIMIT ?").all(limit || 20);
}
function qaStats() { const r = db.prepare('SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS users FROM qa_log').get(); return { total: r.total || 0, users: r.users || 0 }; }

// ===== 合伙人：积分转赠（用自己余额划拨给直邀成员；单级·仅积分·不可提现）=====
function partnerTransfer(inviterId, inviteeId, amount, note) {
  amount = parseInt(amount, 10);
  if (!amount || amount <= 0) return { ok: false, error: '转赠积分需为大于 0 的整数' };
  if (inviterId === inviteeId) return { ok: false, error: '不能给自己转赠' };
  const inv = db.prepare('SELECT id, phone, invited_by FROM users WHERE id=?').get(inviteeId);
  if (!inv || inv.invited_by !== inviterId) return { ok: false, error: '只能转赠给你直接邀请的成员' }; // 越权保护
  const fromBal = getBalance(inviterId);
  if (fromBal < amount) return { ok: false, error: `余额不足（当前 ${fromBal}，需 ${amount}）` };
  const mask = String(inv.phone || '').replace(/^(\d{3})\d{4}(\d+)$/, '$1****$2');
  const tail = note ? ('·' + String(note).slice(0, 40)) : '';
  return txn(() => {
    const fb = grantCore(inviterId, -amount, 'transfer_out', 'transfer', inviteeId, { reason: '转赠给成员 ' + mask + tail, to: inviteeId });
    const tb = grantCore(inviteeId, amount, 'transfer_in', 'transfer', inviterId, { reason: '合伙人转赠' + tail, from: inviterId });
    return { ok: true, fromBalance: fb, toBalance: tb, phone: mask, amount };
  });
}

// ===== 订单 / 充值 =====
// 某用户是否已成功购买过某 pack（用于「体验套餐·一人一次」）
function hasPaidPack(uid, packId) {
  const r = db.prepare("SELECT 1 FROM orders WHERE user_id=? AND pack_id=? AND status='paid' LIMIT 1").get(uid, packId);
  return !!r;
}
function createOrder(uid, pack) {
  if (pack.once && hasPaidPack(uid, pack.id)) { const e = new Error('体验套餐每人限购一次'); e.code = 'ONCE_ONLY'; throw e; }
  const otn = 'O' + Date.now() + Math.floor(Math.random() * 1000);
  db.prepare('INSERT INTO orders(out_trade_no,user_id,pack_id,amount_cny,credits,status,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(otn, uid, pack.id, pack.cny, pack.credits, 'pending', Date.now());
  return otn;
}
function getOrder(otn) { return db.prepare('SELECT * FROM orders WHERE out_trade_no=?').get(otn); }
function markPaid(otn, channel, txid) { // 幂等：只入账一次
  const o = getOrder(otn); if (!o || o.status === 'paid') return o || null;
  return txn(() => {
    db.prepare('UPDATE orders SET status=?,pay_channel=?,transaction_id=?,paid_at=? WHERE out_trade_no=?').run('paid', channel || null, txid || null, Date.now(), otn);
    grantCore(o.user_id, o.credits, 'recharge', 'order', otn, { pack: o.pack_id, cny: o.amount_cny });
    // 充值赠分：单笔满 ¥100 → 按"充值后累计额"对应等级的比例赠送积分（体验套餐 once 包不赠）
    if (!o.pack_id || o.pack_id !== 'exp') {
      if (o.amount_cny >= RECHARGE_BONUS_MIN) {
        const lv = levelFor(totalRechargeOf(o.user_id)); // 含本单
        const bonus = Math.round(o.credits * (lv.bonus || 0));
        if (bonus > 0) grantCore(o.user_id, bonus, 'grant', 'recharge_bonus', otn, { reason: '充值赠分 ' + Math.round(lv.bonus * 100) + '%（' + lv.name + '）', pct: lv.bonus });
      }
    }
    // 邀请返积分（仅被邀请人「首次」付费订单触发，单级，封顶）
    const buyer = getUser(o.user_id);
    if (buyer && buyer.invited_by) {
      const paidCount = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status='paid'").get(o.user_id);
      if (paidCount && paidCount.n === 1) {
        const want = Math.min(INVITE_RECHARGE_CAP, Math.round(o.credits * INVITE_RECHARGE_PCT));
        if (want > 0) grantInviteCapped(buyer.invited_by, want, 'invite_recharge', otn, { reason: '好友首充返积分 ' + Math.round(INVITE_RECHARGE_PCT * 100) + '%', invitee: o.user_id });
      }
    }
    return getOrder(otn);
  });
}
function recentLedger(uid, limit) { return db.prepare('SELECT type,amount,balance_after,meta,created_at FROM credit_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?').all(uid, limit || 20); }

// ===== 创作流水线历史 / 作品库（按账号存，跨设备）=====
// 从一篇作品的 data 里取「封面卡」缩略信息：长文笔记是纯 CSS 文字卡（无图 URL），
// 取首张 notePage 的底色/强调色/标题，供「我的作品」渲染彩色封面缩略图。
function coverCardOf(data) {
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : (data || {});
    const pages = Array.isArray(d.notePages) ? d.notePages : [];
    const p = pages[0]; if (!p) return null;
    const blocks = Array.isArray(p.blocks) ? p.blocks : [];
    const titleB = blocks.find(b => b && b.t === 'title') || blocks.find(b => b && b.text);
    const title = (titleB && titleB.text) || d.best || d.topic || '';
    return { bg: p.bg || '', accent: p.accent || '', hl: p.hl || '', dark: !!p.dark, title: String(title).slice(0, 40) };
  } catch { return null; }
}
function historyList(uid) {
  return db.prepare('SELECT run_id AS id, topic, track, done_keys, imgs, cover, data, updated_at AS ts FROM pipeline_history WHERE user_id=? ORDER BY updated_at DESC LIMIT 200').all(uid)
    .map(r => ({ id: r.id, topic: r.topic, track: r.track, imgs: r.imgs, cover: r.cover || '', coverCard: (r.cover ? null : coverCardOf(r.data)), ts: r.ts, doneKeys: r.done_keys ? JSON.parse(r.done_keys) : [] }));
}
function historyGet(uid, id) { const r = db.prepare('SELECT data FROM pipeline_history WHERE user_id=? AND run_id=?').get(uid, id); try { return r ? JSON.parse(r.data) : null; } catch { return null; } }
function historyUpsert(uid, rec) {
  let cover = ''; try { const d = rec.data || {}; const imgs = d.coverImages || (d.coverImage ? [d.coverImage] : []); cover = (Array.isArray(imgs) ? imgs.find(u => typeof u === 'string' && /^https?:\/\//.test(u)) : '') || ''; } catch {}
  db.prepare('INSERT OR REPLACE INTO pipeline_history(user_id,run_id,topic,track,done_keys,imgs,data,cover,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(uid, String(rec.id), rec.topic || '', rec.track || '', JSON.stringify(rec.doneKeys || []), rec.imgs || 0, JSON.stringify(rec.data || {}), cover, Date.now());
}
function historyRemove(uid, id) { db.prepare('DELETE FROM pipeline_history WHERE user_id=? AND run_id=?').run(uid, String(id)); }
// ===== 付费成品模板：购买 / 已购列表 =====
function templatePurchasedList(uid) { return db.prepare('SELECT tpl_id, run_id FROM template_purchases WHERE user_id=?').all(uid).map(r => ({ id: r.tpl_id, runId: r.run_id })); }
function templateBuy(uid, tpl) {
  if (!uid || !tpl || !tpl.id) return { ok: false, error: '参数错误' };
  const owned = db.prepare('SELECT run_id FROM template_purchases WHERE user_id=? AND tpl_id=?').get(uid, tpl.id);
  if (owned) return { ok: true, runId: owned.run_id, owned: true, balance: getBalance(uid) }; // 已购免费重看
  const bal = getBalance(uid);
  if (bal < TEMPLATE_PRICE) return { ok: false, error: '积分不足', need: TEMPLATE_PRICE, balance: bal };
  deduct(uid, TEMPLATE_PRICE, 'template_buy', tpl.id, { reason: '购买模板 ' + (tpl.name || tpl.id), tpl: tpl.id });
  const runId = 'tpl' + Date.now() + Math.random().toString(36).slice(2, 6);
  const data = Object.assign({}, tpl.data || {}, { _runId: runId, _fromTemplate: tpl.id });
  const imgs = (data.coverImages || []).length;
  historyUpsert(uid, { id: runId, topic: data.topic || tpl.name || '模板成稿', track: tpl.track || '', doneKeys: ['S2', 'S3', 'S4', 'S5'], imgs, data });
  try { db.prepare('INSERT OR REPLACE INTO template_purchases(user_id,tpl_id,run_id,created_at) VALUES(?,?,?,?)').run(uid, tpl.id, runId, Date.now()); } catch {}
  return { ok: true, runId, balance: getBalance(uid) };
}
// ===== 管理端：任务列表（全平台生成历史总览，只读）=====
function adminTasks(limit) {
  return db.prepare("SELECT h.user_id, u.phone, h.run_id, h.topic, h.track, h.done_keys, h.imgs, h.updated_at FROM pipeline_history h LEFT JOIN users u ON u.id=h.user_id ORDER BY h.updated_at DESC LIMIT ?").all(limit || 150)
    .map(r => ({ user_id: r.user_id, phone: r.phone, run_id: r.run_id, topic: r.topic, track: r.track, imgs: r.imgs || 0, updated_at: r.updated_at, steps: (() => { try { return (JSON.parse(r.done_keys || '[]') || []).length; } catch { return 0; } })() }));
}
function adminTaskStats() { const r = db.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(imgs),0) AS imgs FROM pipeline_history").get(); return { total: r.total || 0, users: r.users || 0, imgs: r.imgs || 0 }; }

// ===== 智能体配置（人设/KB/skills/配图风格，按账号存，跨设备）=====
function agentConfigAll(uid) {
  return db.prepare('SELECT track_id, config FROM agent_config WHERE user_id=?').all(uid).map(r => { let c = {}; try { c = JSON.parse(r.config); } catch {} return { trackId: r.track_id, config: c }; });
}
function agentConfigSave(uid, trackId, config) {
  db.prepare('INSERT OR REPLACE INTO agent_config(user_id,track_id,config,updated_at) VALUES(?,?,?,?)').run(uid, String(trackId), JSON.stringify(config || {}), Date.now());
}

priceMigrateV2(); // 一次性对齐 PRD §8 价格（幂等）
module.exports = {
  signSession, verifySession, setCode, checkCode,
  getOrCreateUser, getUser, getUserByPhone, setNickname, userStats, getBalance, getPrice,
  grant, deduct, adminAdjust, createOrder, getOrder, markPaid, recentLedger, SIGNUP_GRANT,
  historyList, historyGet, historyUpsert, historyRemove, adminTasks, adminTaskStats,
  templatePurchasedList, templateBuy, TEMPLATE_PRICE, funnelStats,
  agentConfigAll, agentConfigSave,
  ensureInviteCode, inviteStats,
  adminOrders, adminUsers, adminSummary,
  levelsGet, levelsSet, getAllPrices, setPrice,
  kbGet, kbSet, staffList, staffAdd, staffRemove, isStaffPhone, staffMenusOf, ADMIN_MENUS,
  rolesGet, rolesSet, menuCfgGet, menuCfgSet, enabledMenuKeys,
  partnerMemberOrders, partnerTransfer, hasPaidPack,
  qaLogAdd, qaLogList, qaTopQuestions, qaStats,
  agentQuota, agentRegister, agentUnregister, agentApply, agentAppsAll, agentAppDecide,
};

// ===== 管理后台：只读列表 / 概览 =====
function adminOrders(limit) {
  return db.prepare("SELECT o.out_trade_no AS otn, o.user_id, u.phone, o.pack_id, o.amount_cny, o.credits, o.status, o.created_at, o.paid_at FROM orders o LEFT JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT ?").all(limit || 80);
}
function adminUsers(limit) {
  const rows = db.prepare("SELECT u.id, u.phone, u.nickname, u.created_at, u.invited_by, (SELECT COALESCE(SUM(amount_cny),0) FROM orders WHERE user_id=u.id AND status='paid') AS recharge_cny, (SELECT balance FROM wallets WHERE user_id=u.id) AS balance FROM users u ORDER BY u.created_at DESC LIMIT ?").all(limit || 150);
  return rows.map(r => { const lv = levelFor(r.recharge_cny || 0); return { ...r, level: lv.name, levelKey: lv.key }; }); // 会员等级按累计充值算
}
// 增长漏斗：注册 → 激活(产出作品) → 完成(出图) → 邀请 → 付费（全部从现有库派生，无需额外埋点）
function funnelStats() {
  const q = (s, ...a) => { try { return db.prepare(s).get(...a); } catch { return {}; } };
  const registers = q('SELECT COUNT(*) AS n FROM users').n || 0;
  const activated = q('SELECT COUNT(DISTINCT user_id) AS n FROM pipeline_history').n || 0;
  const finished = q('SELECT COUNT(DISTINCT user_id) AS n FROM pipeline_history WHERE imgs>0').n || 0;
  const invited = q('SELECT COUNT(*) AS n FROM users WHERE invited_by IS NOT NULL').n || 0;
  const paidUsers = q("SELECT COUNT(DISTINCT user_id) AS n FROM orders WHERE status='paid'").n || 0;
  const revenueCny = q("SELECT COALESCE(SUM(amount_cny),0) AS s FROM orders WHERE status='paid'").s || 0;
  const templateBuys = q('SELECT COUNT(*) AS n FROM template_purchases').n || 0;
  const d7 = Date.now() - 7 * 864e5;
  const reg7 = q('SELECT COUNT(*) AS n FROM users WHERE created_at>=?', d7).n || 0;
  const act7 = q('SELECT COUNT(DISTINCT user_id) AS n FROM pipeline_history WHERE updated_at>=?', d7).n || 0;
  const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0;
  return {
    registers, activated, finished, invited, paidUsers, revenueCny, templateBuys, reg7, act7,
    rate: { activate: pct(activated, registers), finish: pct(finished, registers), invite: pct(invited, registers), pay: pct(paidUsers, registers) },
    inviteShare: pct(invited, registers)
  };
}
function adminSummary() {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const paid = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cny),0) AS s FROM orders WHERE status='paid'").get();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const newToday = db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at>=?').get(today.getTime()).n;
  return { users, newToday, paidOrders: paid.n, revenueCny: paid.s };
}
