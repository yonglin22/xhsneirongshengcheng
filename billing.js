// 积分计费核心：账号 + 钱包 + 流水 + 订单 + 定价。用 Node 内置 node:sqlite（需 Node ≥ 22）。
// 单进程同步执行，天然无并发竞争；事务用 BEGIN/COMMIT 保证原子与回滚。
// 用 Turso 官方 libsql 驱动：同步 API、与 better-sqlite3 兼容，原 75 处 db.prepare/exec 调用一行不用改。
const Database = require('libsql');
const crypto = require('crypto');
const path = require('path');

// 配了 TURSO_DATABASE_URL/TOKEN → 走 Turso 云端「嵌入式副本」：本地 DB_PATH 做缓存、与云端双向同步，
// 容器重部署清空本地也能从云端拉回，数据永不丢；没配 TURSO 时退回纯本地文件（开发/自托管）。
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'billing.db');
const TURSO_URL = (process.env.TURSO_DATABASE_URL || '').trim();
const TURSO_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();
const USE_TURSO = /^libsql:|^https?:/.test(TURSO_URL);

let db;
if (USE_TURSO) {
  db = new Database(DB_PATH, { syncUrl: TURSO_URL, authToken: TURSO_TOKEN });
  try { db.sync(); console.log('  [billing] Turso 已同步 ←', TURSO_URL.replace(/\?.*$/, '')); }
  catch (e) { console.error('  [billing] Turso 首次同步失败（暂用本地副本）:', e.message); }
} else {
  db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
}
console.log('  [billing] 数据库:', DB_PATH, USE_TURSO ? '(Turso 嵌入式副本)' : '(本地文件)');

// Turso 写后同步：拦截写操作打脏标记 → 定时 flush + 退出时 flush，把本地写入推送到云端（无需改 75 个调用点）
if (USE_TURSO) {
  let _dirty = false;
  const flush = () => { if (!_dirty) return; try { db.sync(); _dirty = false; } catch (e) { console.error('  [billing] Turso sync:', e.message); } };
  const _prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const st = _prepare(sql);
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) { const _run = st.run.bind(st); st.run = (...a) => { const r = _run(...a); _dirty = true; return r; }; }
    return st;
  };
  const _exec = db.exec.bind(db);
  db.exec = (sql) => { const r = _exec(sql); if (/INSERT|UPDATE|DELETE|REPLACE|COMMIT|CREATE|ALTER|DROP/i.test(sql)) _dirty = true; return r; };
  const t = setInterval(flush, 1500); if (t.unref) t.unref();
  process.on('SIGTERM', () => { flush(); process.exit(0); });
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('beforeExit', flush);
}

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
// v3 价目（用户拍板）：图生图 100/张、生卡片图 30/张、自检自查免费、账号矩阵免费，其余步骤默认 50。执行一次后后台改价不再被重置。
function priceMigrateV3() {
  if (settingsGet('pricing_v3')) return;
  [
    ['image_i2i', 100],   // 图生图（垫参考图重出）
    ['image_card', 30],   // 生卡片图（文生图/封面配图）
    ['image_std', 30], ['image_hd', 30], ['image_premium', 30], // 旧图像键统一对齐生卡片图价
    ['compliance', 0], ['vision', 0], ['imgplan', 0], // 自检自查/视觉解析/配图规划：免费
    ['account_matrix', 0], // 账号矩阵：免费
    // 内容创作/获客其余步骤：默认 50
    ['text', 50], ['topic', 50], ['skeleton', 50], ['frame', 50], ['copy', 50], ['cover', 50], ['rule_query', 50], ['comment', 50],
  ].forEach(([k, c]) => setPrice(k, c));
  settingsSet('pricing_v3', 1);
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
// 获客 Agent · 社媒账号矩阵（小红书/公众号…）。auth_blob=加密登录态/授权(敏感,不外发)
try { db.exec("CREATE TABLE IF NOT EXISTS social_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, platform TEXT, nickname TEXT, grp TEXT, status TEXT DEFAULT 'pending', auth_blob TEXT, note TEXT, health TEXT, created_at INTEGER, updated_at INTEGER, last_active_at INTEGER)"); } catch {}
function accountsList(uid){ return db.prepare("SELECT id,platform,nickname,grp,status,note,health,created_at,updated_at,last_active_at,(auth_blob IS NOT NULL AND auth_blob<>'') AS has_auth FROM social_accounts WHERE user_id=? ORDER BY id DESC").all(uid); }
function accountAdd(uid, a){ const now=Date.now(); const r=db.prepare('INSERT INTO social_accounts(user_id,platform,nickname,grp,status,auth_blob,note,health,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(uid, a.platform||'xhs', String(a.nickname||'').slice(0,60), String(a.grp||'').slice(0,40), a.status||'pending', String(a.auth_blob||''), String(a.note||'').slice(0,200), '', now, now); return r.lastInsertRowid; }
function accountUpdate(uid, id, p){ const cur=db.prepare('SELECT * FROM social_accounts WHERE id=? AND user_id=?').get(id,uid); if(!cur) return false; const f=(k,max)=>{ let v=p[k]!==undefined?p[k]:cur[k]; if(typeof v==='string'&&max) v=v.slice(0,max); return v; }; db.prepare('UPDATE social_accounts SET nickname=?,grp=?,status=?,auth_blob=?,note=?,health=?,updated_at=? WHERE id=? AND user_id=?').run(f('nickname',60),f('grp',40),f('status'),f('auth_blob'),f('note',200),f('health'),Date.now(),id,uid); return true; }
function accountRemove(uid, id){ db.prepare('DELETE FROM social_accounts WHERE id=? AND user_id=?').run(id,uid); return true; }
function accountAuthBlob(uid, id){ const r=db.prepare('SELECT auth_blob,platform,nickname FROM social_accounts WHERE id=? AND user_id=?').get(id,uid); return r||null; } // 服务端取登录态(敏感,仅本人)
// 一次性清理：把「扫码/扫码+短信」接入的号(via=qr/qr-sms)重置为待接入并清空假登录态。
// 修复前访客 web_session 误判已登录都来自这条路径；手动粘贴 cookie 的号(无 via)保持不动。
function accountsResetQrAuth(uid){ const rows=db.prepare("SELECT id,auth_blob FROM social_accounts WHERE user_id=?").all(uid); let n=0; for(const r of rows){ let via=''; try{ via=(JSON.parse(r.auth_blob||'{}').via)||''; }catch{} if(via==='qr'||via==='qr-sms'){ db.prepare("UPDATE social_accounts SET status='pending', auth_blob='', health='', updated_at=? WHERE id=? AND user_id=?").run(Date.now(), r.id, uid); n++; } } return n; }
// 保活任务用：全量取已登录且有 cookie 的小红书账号（含 user_id），及按 id 回写 cookie/状态。
function accountsActiveXhs(){ return db.prepare("SELECT id,user_id,nickname,auth_blob,last_active_at FROM social_accounts WHERE platform='xhs' AND status='active' AND auth_blob IS NOT NULL AND auth_blob<>''").all(); }
function accountSetAuthById(id, authBlob, status, health){ db.prepare('UPDATE social_accounts SET auth_blob=?,status=?,health=?,updated_at=?,last_active_at=? WHERE id=?').run(String(authBlob||''), status||'active', String(health||''), Date.now(), Date.now(), id); return true; }
function accountSetStatusById(id, status, health){ db.prepare('UPDATE social_accounts SET status=?,health=?,updated_at=? WHERE id=?').run(status||'expired', String(health||''), Date.now(), id); return true; }
// #2 住宅IP登录：住宅 IP 的插件/设备把本机已登录小红书的 cookie 回传，落到某账号→active，绕过机房 headless 风控
// id 优先；无 id 时按 nickname 模糊匹配该用户的 pending/expired 账号；都没有则新建一个
function accountSubmitCookie(uid, opt){
  opt=opt||{}; const cookie=String(opt.cookie||'').trim();
  if(!/web_session=/.test(cookie)) return { ok:false, error:'cookie 里没有 web_session，请确认是已登录小红书的完整 cookie' };
  const blob=JSON.stringify({ cookie, via:'device-cookie', ts:Date.now() });
  let id=parseInt(opt.id)||0; let row=null;
  if(id) row=db.prepare('SELECT id FROM social_accounts WHERE id=? AND user_id=?').get(id,uid);
  if(!row && opt.nickname){ row=db.prepare("SELECT id FROM social_accounts WHERE user_id=? AND platform='xhs' AND nickname=? ORDER BY id DESC LIMIT 1").get(uid, String(opt.nickname).slice(0,60)); }
  if(row){ db.prepare("UPDATE social_accounts SET auth_blob=?, status='active', health='✓ 设备回传登录', updated_at=?, last_active_at=? WHERE id=? AND user_id=?").run(blob, Date.now(), Date.now(), row.id, uid); return { ok:true, id:row.id }; }
  const nid=accountAdd(uid,{ platform:'xhs', nickname:String(opt.nickname||'设备回传账号').slice(0,60), grp:String(opt.grp||'').slice(0,40), status:'active', auth_blob:blob });
  db.prepare("UPDATE social_accounts SET health='✓ 设备回传登录', last_active_at=? WHERE id=?").run(Date.now(), nid);
  return { ok:true, id:nid, created:true };
}
// 获客 Agent · 养号/截流计划
try { db.exec("CREATE TABLE IF NOT EXISTS growth_plans(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, ptype TEXT, platform TEXT, config TEXT, status TEXT DEFAULT 'draft', created_at INTEGER, updated_at INTEGER)"); } catch {}
// 对齐原型「任务列表」统计列：累计收集潜客/已回复/已私信 + 最近执行时间（执行端跑完上报）
try { db.exec("ALTER TABLE growth_plans ADD COLUMN stat_collected INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE growth_plans ADD COLUMN stat_replied INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE growth_plans ADD COLUMN stat_dmed INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE growth_plans ADD COLUMN last_run_at INTEGER"); } catch {}
function plansList(uid){ return db.prepare('SELECT id,name,ptype,platform,config,status,stat_collected,stat_replied,stat_dmed,last_run_at,created_at,updated_at FROM growth_plans WHERE user_id=? ORDER BY id DESC').all(uid).map(r=>{ let c={}; try{c=JSON.parse(r.config||'{}');}catch{} return {...r, config:c, stats:{ collected:r.stat_collected||0, replied:r.stat_replied||0, dmed:r.stat_dmed||0, lastRunAt:r.last_run_at||0 } }; }); }
// 本机直接「▶执行」的运行记录（非多设备下发），用于在「任务执行情况」里也能看到本机跑的每一轮
try { db.exec("CREATE TABLE IF NOT EXISTS growth_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plan_id INTEGER, device TEXT, opened INTEGER, liked INTEGER, faved INTEGER, followed INTEGER, commented INTEGER, collected INTEGER, replied INTEGER, dmed INTEGER, created_at INTEGER)"); } catch {}
// 执行端跑完一轮，累加统计（delta，可为 0）；同时记一条本机运行明细
function planStat(uid, id, d){ const cur=db.prepare('SELECT id FROM growth_plans WHERE id=? AND user_id=?').get(id,uid); if(!cur) return false; d=d||{}; const n=(k)=>Math.max(0,parseInt(d[k])||0);
  db.prepare('UPDATE growth_plans SET stat_collected=COALESCE(stat_collected,0)+?, stat_replied=COALESCE(stat_replied,0)+?, stat_dmed=COALESCE(stat_dmed,0)+?, last_run_at=? WHERE id=? AND user_id=?').run(n('collected'), n('replied'), n('dmed'), Date.now(), id, uid);
  try { db.prepare('INSERT INTO growth_runs(user_id,plan_id,device,opened,liked,faved,followed,commented,collected,replied,dmed,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(uid, id, String(d.device||'本机').slice(0,40), n('opened'), n('liked'), n('faved'), n('followed'), n('commented'), n('collected'), n('replied'), n('dmed'), Date.now()); } catch {}
  return true; }
function planRuns(uid, planId){ return db.prepare('SELECT id,device,opened,liked,faved,followed,commented,collected,replied,dmed,created_at FROM growth_runs WHERE user_id=? AND plan_id=? ORDER BY id DESC LIMIT 30').all(uid, planId); }
function planRunsAll(uid){ return db.prepare('SELECT id,plan_id,device,opened,liked,faved,followed,commented,collected,replied,dmed,created_at FROM growth_runs WHERE user_id=? ORDER BY id DESC LIMIT 300').all(uid); }
function planAdd(uid, p){ const now=Date.now(); const r=db.prepare('INSERT INTO growth_plans(user_id,name,ptype,platform,config,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(uid, String(p.name||'').slice(0,80), p.ptype||'', p.platform||'xhs', JSON.stringify(p.config||{}), p.status||'draft', now, now); return r.lastInsertRowid; }
function planUpdate(uid, id, p){ const cur=db.prepare('SELECT * FROM growth_plans WHERE id=? AND user_id=?').get(id,uid); if(!cur) return false; db.prepare('UPDATE growth_plans SET name=?,ptype=?,platform=?,config=?,status=?,updated_at=? WHERE id=? AND user_id=?').run(p.name!==undefined?String(p.name).slice(0,80):cur.name, p.ptype||cur.ptype, p.platform||cur.platform, p.config!==undefined?JSON.stringify(p.config):cur.config, p.status||cur.status, Date.now(), id, uid); return true; }
function planRemove(uid, id){ db.prepare('DELETE FROM growth_plans WHERE id=? AND user_id=?').run(id,uid); return true; }

// ===== 获客 Agent · 话术库（问答库：标题 + 问题/回答话术，单库≤1000 条，供养号/截流评论回复取词）=====
try { db.exec("CREATE TABLE IF NOT EXISTS script_libs(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, items TEXT, created_at INTEGER, updated_at INTEGER)"); } catch {}
// 对齐原型「话术题库」：type=话术类型(comment评论话术/reply回复话术/intercept截流话术)、descr=话术描述。老库无此列→ALTER 补，已存在则忽略。
try { db.exec("ALTER TABLE script_libs ADD COLUMN type TEXT DEFAULT 'comment'"); } catch {}
try { db.exec("ALTER TABLE script_libs ADD COLUMN descr TEXT DEFAULT ''"); } catch {}
const _SCRIPT_TYPES = ['comment', 'reply', 'intercept'];
function _normScriptType(t){ return _SCRIPT_TYPES.includes(t) ? t : 'comment'; }
function _normScriptItems(items){ return (Array.isArray(items)?items:[]).map(x=>({ q:String((x&&x.q)||'').slice(0,200).trim(), a:String((x&&x.a)||'').slice(0,1000).trim() })).filter(x=>x.q||x.a).slice(0,1000); }
function scriptLibsList(uid){ return db.prepare('SELECT id,title,type,descr,items,created_at,updated_at FROM script_libs WHERE user_id=? ORDER BY id DESC').all(uid).map(r=>{ let it=[]; try{it=JSON.parse(r.items||'[]');}catch{} return { id:r.id, title:r.title, type:r.type||'comment', descr:r.descr||'', items:Array.isArray(it)?it:[], count:(Array.isArray(it)?it:[]).length, created_at:r.created_at, updated_at:r.updated_at }; }); }
function scriptLibAdd(uid, lib){ const now=Date.now(); const r=db.prepare('INSERT INTO script_libs(user_id,title,type,descr,items,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(uid, String(lib.title||'').slice(0,60).trim()||'未命名话术库', _normScriptType(lib.type), String(lib.descr||'').slice(0,300), JSON.stringify(_normScriptItems(lib.items)), now, now); return r.lastInsertRowid; }
function scriptLibUpdate(uid, id, lib){ const cur=db.prepare('SELECT * FROM script_libs WHERE id=? AND user_id=?').get(id,uid); if(!cur) return false; db.prepare('UPDATE script_libs SET title=?,type=?,descr=?,items=?,updated_at=? WHERE id=? AND user_id=?').run(lib.title!==undefined?(String(lib.title).slice(0,60).trim()||'未命名话术库'):cur.title, lib.type!==undefined?_normScriptType(lib.type):(cur.type||'comment'), lib.descr!==undefined?String(lib.descr).slice(0,300):(cur.descr||''), lib.items!==undefined?JSON.stringify(_normScriptItems(lib.items)):cur.items, Date.now(), id, uid); return true; }
function scriptLibRemove(uid, id){ db.prepare('DELETE FROM script_libs WHERE id=? AND user_id=?').run(id,uid); return true; }

// ===== 获客 Agent · 评论收集（潜客列表）：截流时收集到的评论区用户，存为系统列表，供人工跟进 =====
try { db.exec("CREATE TABLE IF NOT EXISTS collected_leads(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, platform TEXT, note_title TEXT, note_url TEXT, lead_user TEXT, lead_text TEXT, lead_link TEXT, status TEXT DEFAULT 'new', dkey TEXT, created_at INTEGER)"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_uniq ON collected_leads(user_id, dkey)"); } catch {}
// 潜客归属计划：便于「任务列表」按计划统计/「评论收集」按计划筛选
try { db.exec("ALTER TABLE collected_leads ADD COLUMN plan_id INTEGER"); } catch {}
function leadsList(uid, opt){ opt=opt||{}; const lim=Math.min(500,Math.max(1,parseInt(opt.limit)||200)); const off=Math.max(0,parseInt(opt.offset)||0); const planId=parseInt(opt.planId)||0; const where=planId?' AND plan_id=?':''; const args=planId?[uid,planId]:[uid]; const total=db.prepare('SELECT COUNT(*) n FROM collected_leads WHERE user_id=?'+where).get(...args).n; const list=db.prepare('SELECT id,platform,note_title,note_url,lead_user,lead_text,lead_link,status,plan_id,created_at FROM collected_leads WHERE user_id=?'+where+' ORDER BY id DESC LIMIT ? OFFSET ?').all(...args,lim,off); return { list, total }; }
function leadsAdd(uid, batch){ const items=(Array.isArray(batch)?batch:[]).slice(0,200); if(!items.length) return { added:0 }; const now=Date.now(); const ins=db.prepare("INSERT OR IGNORE INTO collected_leads(user_id,platform,note_title,note_url,lead_user,lead_text,lead_link,status,dkey,plan_id,created_at) VALUES(?,?,?,?,?,?,?,'new',?,?,?)"); let added=0; const run=()=>{ for(const it of items){ const lead_user=String((it&&it.lead_user)||'').slice(0,80).trim(); const lead_text=String((it&&it.lead_text)||'').slice(0,500).trim(); const lead_link=String((it&&it.lead_link)||'').slice(0,300).trim(); if(!lead_text&&!lead_user) continue; const dkey=(lead_link||(lead_user+'|'+lead_text)).slice(0,300); const pid=parseInt(it&&it.plan_id)||null; const r=ins.run(uid, String((it&&it.platform)||'xhs').slice(0,16), String((it&&it.note_title)||'').slice(0,120), String((it&&it.note_url)||'').slice(0,300), lead_user, lead_text, lead_link, dkey, pid, now); if(r.changes) added++; } }; try{ txn(run); }catch{ run(); } return { added }; }
function leadRemove(uid, id){ db.prepare('DELETE FROM collected_leads WHERE id=? AND user_id=?').run(id,uid); return true; }
function leadsClear(uid){ db.prepare('DELETE FROM collected_leads WHERE user_id=?').run(uid); return true; }
function leadStatus(uid, id, status){ db.prepare('UPDATE collected_leads SET status=? WHERE id=? AND user_id=?').run(String(status||'new').slice(0,16), id, uid); return true; }

// ===== 内容数据回流：执行端发布后抓回笔记真实数据（小眼睛/赞/藏/评论），按 note_url 去重 upsert，供数据红线复盘 =====
try { db.exec("CREATE TABLE IF NOT EXISTS note_stats(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, account_id INTEGER, account_name TEXT, platform TEXT, note_title TEXT, note_url TEXT, views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, favs INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, published_at INTEGER, collected_at INTEGER, nkey TEXT)"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_note_uniq ON note_stats(user_id, nkey)"); } catch {}
function noteStatPut(uid, d){
  d=d||{}; const now=Date.now();
  const note_url=String(d.note_url||'').slice(0,300).trim();
  const title=String(d.note_title||'').slice(0,120).trim();
  const nkey=(note_url||title).slice(0,300); if(!nkey) return { ok:false, error:'缺少 note_url 或标题' };
  const n=k=>Math.max(0,parseInt(d[k])||0);
  const cur=db.prepare('SELECT id FROM note_stats WHERE user_id=? AND nkey=?').get(uid,nkey);
  if(cur){ db.prepare('UPDATE note_stats SET account_id=?,account_name=?,platform=?,note_title=?,note_url=?,views=?,likes=?,favs=?,comments=?,published_at=COALESCE(?,published_at),collected_at=? WHERE id=?')
    .run(parseInt(d.account_id)||null,String(d.account_name||'').slice(0,80),String(d.platform||'xhs').slice(0,16),title,note_url,n('views'),n('likes'),n('favs'),n('comments'),parseInt(d.published_at)||null,now,cur.id); }
  else { db.prepare('INSERT INTO note_stats(user_id,account_id,account_name,platform,note_title,note_url,views,likes,favs,comments,published_at,collected_at,nkey) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid,parseInt(d.account_id)||null,String(d.account_name||'').slice(0,80),String(d.platform||'xhs').slice(0,16),title,note_url,n('views'),n('likes'),n('favs'),n('comments'),parseInt(d.published_at)||now,now,nkey); }
  return { ok:true };
}
function noteStatsList(uid){ return db.prepare('SELECT id,account_id,account_name,platform,note_title,note_url,views,likes,favs,comments,published_at,collected_at FROM note_stats WHERE user_id=? ORDER BY collected_at DESC LIMIT 500').all(uid); }
function noteStatRemove(uid, id){ if(id==='all'){ db.prepare('DELETE FROM note_stats WHERE user_id=?').run(uid); return true; } db.prepare('DELETE FROM note_stats WHERE id=? AND user_id=?').run(id,uid); return true; }
// 手动改账号名（插件没抓到昵称时补录）；id='all' 或传 ids 数组可批量置为同一账号
function noteStatSetAccount(uid, id, name){ const nm=String(name||'').slice(0,80);
  if(Array.isArray(id)){ const st=db.prepare('UPDATE note_stats SET account_name=? WHERE id=? AND user_id=?'); id.forEach(x=>st.run(nm,parseInt(x)||0,uid)); return true; }
  if(id==='all'){ db.prepare('UPDATE note_stats SET account_name=? WHERE user_id=?').run(nm,uid); return true; }
  db.prepare('UPDATE note_stats SET account_name=? WHERE id=? AND user_id=?').run(nm,parseInt(id)||0,uid); return true; }

// ===== 获客 Agent · 多设备/多账号任务下发队列 =====
// 把一个计划下发给多个账号，生成待领取任务；任一登录了同一朱砂账号的设备(插件)可拉取并执行，跑完回报。
try { db.exec("CREATE TABLE IF NOT EXISTS plan_dispatch(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, plan_id INTEGER, account_id INTEGER, account_name TEXT, device TEXT, status TEXT DEFAULT 'pending', result TEXT, created_at INTEGER, picked_at INTEGER, done_at INTEGER)"); } catch {}
// 执行端结构化回报：进度/数据(浏览·赞·藏·评论)/风控信号,供「执行情况」展示与数据红线回流
try { db.exec("ALTER TABLE plan_dispatch ADD COLUMN progress INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE plan_dispatch ADD COLUMN data TEXT"); } catch {}
try { db.exec("ALTER TABLE plan_dispatch ADD COLUMN reported_at INTEGER"); } catch {}
const _DISPATCH_TTL = 1000*60*30; // 领取后 30 分钟没回报，视为可重新领取（设备掉线兜底）
function dispatchAdd(uid, planId, accounts){
  const plan=db.prepare('SELECT id,name FROM growth_plans WHERE id=? AND user_id=?').get(planId,uid); if(!plan) return { ok:false, error:'计划不存在' };
  const list=(Array.isArray(accounts)?accounts:[]).slice(0,50); const now=Date.now();
  const ins=db.prepare("INSERT INTO plan_dispatch(user_id,plan_id,account_id,account_name,status,created_at) VALUES(?,?,?,?,'pending',?)");
  let n=0; const run=()=>{ for(const a of list){ ins.run(uid, planId, parseInt(a&&a.id)||null, String((a&&a.name)||'').slice(0,80), now); n++; } };
  try{ txn(run); }catch{ run(); }
  return { ok:true, created:n };
}
function dispatchList(uid, planId){ const where=planId?' AND d.plan_id=?':''; const args=planId?[uid,parseInt(planId)]:[uid]; return db.prepare('SELECT d.id,d.plan_id,d.account_id,d.account_name,d.device,d.status,d.result,d.progress,d.data,d.reported_at,d.created_at,d.picked_at,d.done_at,(SELECT name FROM growth_plans WHERE id=d.plan_id) AS plan_name FROM plan_dispatch d WHERE d.user_id=?'+where+' ORDER BY d.id DESC LIMIT 200').all(...args).map(r=>{ let data=null; try{ data=r.data?JSON.parse(r.data):null; }catch{} return {...r, data}; }); }
// 设备拉取一条待执行任务（claim：pending→running，附带计划完整配置）。也回收超时 running。
function dispatchPull(uid, device){
  const now=Date.now();
  db.prepare("UPDATE plan_dispatch SET status='pending', device=NULL WHERE user_id=? AND status='running' AND picked_at IS NOT NULL AND picked_at < ?").run(uid, now-_DISPATCH_TTL);
  const row=db.prepare("SELECT * FROM plan_dispatch WHERE user_id=? AND status='pending' ORDER BY id ASC LIMIT 1").get(uid);
  if(!row) return { ok:true, task:null };
  db.prepare("UPDATE plan_dispatch SET status='running', device=?, picked_at=? WHERE id=? AND status='pending'").run(String(device||'').slice(0,60), now, row.id);
  const plan=db.prepare('SELECT id,name,ptype,platform,config FROM growth_plans WHERE id=? AND user_id=?').get(row.plan_id,uid);
  if(!plan){ db.prepare("UPDATE plan_dispatch SET status='done', result='计划已删除', done_at=? WHERE id=?").run(now,row.id); return { ok:true, task:null }; }
  let cfg={}; try{ cfg=JSON.parse(plan.config||'{}'); }catch{}
  return { ok:true, task:{ dispatchId:row.id, accountId:row.account_id, accountName:row.account_name, plan:{ id:plan.id, name:plan.name, ptype:plan.ptype, platform:plan.platform, config:cfg } } };
}
// 执行端完成回报：ok=false → 标记 failed（含风控熔断）；可带结构化 data（浏览/赞/藏/评论 + 风控）
// 风控熔断：失败且 data.risk 命中（验证码/限流等）→ 暂停同账号其余 pending/running 任务，避免继续触发风控被封
function dispatchDone(uid, id, result, opts){
  opts=opts||{}; const st=(opts.ok===false||opts.failed)?'failed':'done'; const now=Date.now();
  let dataStr=null; const risk=opts.data&&typeof opts.data==='object'?opts.data.risk:null;
  if(opts.data&&typeof opts.data==='object'){ try{ dataStr=JSON.stringify(opts.data).slice(0,2000); }catch{} }
  const cur=db.prepare('SELECT account_id FROM plan_dispatch WHERE id=? AND user_id=?').get(id,uid);
  const r=db.prepare("UPDATE plan_dispatch SET status=?, result=?, data=COALESCE(?,data), reported_at=?, done_at=? WHERE id=? AND user_id=?").run(st, String(result||'').slice(0,300), dataStr, now, now, id, uid);
  let breaker=0;
  if(st==='failed' && risk && cur && cur.account_id){
    const br=db.prepare("UPDATE plan_dispatch SET status='failed', result='风控熔断·已暂停（'||?||'）', done_at=? WHERE user_id=? AND account_id=? AND status IN('pending','running') AND id<>?")
      .run(String(risk).slice(0,40), now, uid, cur.account_id, id);
    breaker=br.changes||0;
  }
  return r.changes>0;
}
// 执行端进度回报（不结束任务）：更新 progress(0-100) / 结构化 data / 中途结果
function dispatchReport(uid, id, b){
  b=b||{}; const sets=['reported_at=?']; const args=[Date.now()];
  if(b.progress!=null){ sets.push('progress=?'); args.push(Math.max(0,Math.min(100,parseInt(b.progress)||0))); }
  if(b.result!=null){ sets.push('result=?'); args.push(String(b.result).slice(0,300)); }
  if(b.data&&typeof b.data==='object'){ try{ sets.push('data=?'); args.push(JSON.stringify(b.data).slice(0,2000)); }catch{} }
  args.push(id, uid);
  const r=db.prepare("UPDATE plan_dispatch SET "+sets.join(',')+" WHERE id=? AND user_id=? AND status='running'").run(...args);
  return r.changes>0;
}
// 网页端手动闭环：把某条任务设为完成/失败/重新排队（解决「执行中」永久卡死）
function dispatchSet(uid, id, status){
  const now=Date.now();
  if(status==='requeue'){ const r=db.prepare("UPDATE plan_dispatch SET status='pending', device=NULL, picked_at=NULL, done_at=NULL WHERE id=? AND user_id=?").run(id,uid); return r.changes>0; }
  if(status==='done'||status==='failed'){ const r=db.prepare("UPDATE plan_dispatch SET status=?, done_at=?, result=COALESCE(NULLIF(result,''),'手动标记"+(status==='done'?'完成':'失败')+"') WHERE id=? AND user_id=?").run(status,now,id,uid); return r.changes>0; }
  return false;
}
function dispatchCancel(uid, id){ if(id==='all'||id===0){ db.prepare("DELETE FROM plan_dispatch WHERE user_id=? AND status IN('pending','done')").run(uid); return true; } db.prepare("DELETE FROM plan_dispatch WHERE id=? AND user_id=?").run(id,uid); return true; }

// ===== 内容矩阵分发：一稿多发到各账号草稿箱（B方案=走各设备本机已登录小红书，避开机房IP风控）=====
// payload 只存「标题/正文/图片URL/标签」（图片先传 /api/media-put 转短链，避免大体积）。
try { db.exec("CREATE TABLE IF NOT EXISTS content_dispatch(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, account_id INTEGER, account_name TEXT, device TEXT, title TEXT, payload TEXT, status TEXT DEFAULT 'pending', result TEXT, created_at INTEGER, picked_at INTEGER, done_at INTEGER)"); } catch {}
const _CD_TTL = 1000*60*10; // 领取 10 分钟没回报→可重新领取
function cdispAdd(uid, accounts, payload){
  const list=(Array.isArray(accounts)?accounts:[]).slice(0,50); if(!list.length) return { ok:false, error:'未选择账号' };
  const pl=JSON.stringify(payload||{}); const title=String((payload&&payload.title)||'').slice(0,80); const now=Date.now();
  const ins=db.prepare("INSERT INTO content_dispatch(user_id,account_id,account_name,title,payload,status,created_at) VALUES(?,?,?,?,?,'pending',?)");
  let n=0; const run=()=>{ for(const a of list){ ins.run(uid, parseInt(a&&a.id)||null, String((a&&a.name)||'').slice(0,80), title, pl, now); n++; } };
  try{ txn(run); }catch{ run(); }
  return { ok:true, created:n };
}
function cdispList(uid){ return db.prepare('SELECT id,account_id,account_name,device,title,status,result,created_at,picked_at,done_at FROM content_dispatch WHERE user_id=? ORDER BY id DESC LIMIT 200').all(uid); }
function cdispPull(uid, device){
  const now=Date.now();
  db.prepare("UPDATE content_dispatch SET status='pending', device=NULL WHERE user_id=? AND status='running' AND picked_at IS NOT NULL AND picked_at < ?").run(uid, now-_CD_TTL);
  const row=db.prepare("SELECT * FROM content_dispatch WHERE user_id=? AND status='pending' ORDER BY id ASC LIMIT 1").get(uid);
  if(!row) return { ok:true, task:null };
  db.prepare("UPDATE content_dispatch SET status='running', device=?, picked_at=? WHERE id=? AND status='pending'").run(String(device||'').slice(0,60), now, row.id);
  let payload={}; try{ payload=JSON.parse(row.payload||'{}'); }catch{}
  return { ok:true, task:{ dispatchId:row.id, accountId:row.account_id, accountName:row.account_name, payload } };
}
function cdispDone(uid, id, result){ const r=db.prepare("UPDATE content_dispatch SET status='done', result=?, done_at=? WHERE id=? AND user_id=?").run(String(result||'').slice(0,300), Date.now(), id, uid); return r.changes>0; }
function cdispCancel(uid, id){ if(id==='all'||id===0){ db.prepare("DELETE FROM content_dispatch WHERE user_id=? AND status IN('pending','done')").run(uid); return true; } db.prepare("DELETE FROM content_dispatch WHERE id=? AND user_id=?").run(id,uid); return true; }

// ===== 设备看板（agent 工作室）：装了插件的设备心跳上报，网页可视化网格 + 改名 + 下发指令 =====
try { db.exec("CREATE TABLE IF NOT EXISTS devices(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, device_key TEXT, name TEXT, status TEXT DEFAULT 'idle', cmd TEXT, last_seen INTEGER, created_at INTEGER)"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_uk ON devices(user_id, device_key)"); } catch {}
// 心跳：upsert 设备，更新状态/last_seen，并返回一次性待执行指令（如 stop）
function deviceHeartbeat(uid, key, info){
  key=String(key||'').slice(0,60); if(!key) return { ok:false }; info=info||{}; const now=Date.now();
  const cur=db.prepare('SELECT * FROM devices WHERE user_id=? AND device_key=?').get(uid,key);
  const status=String(info.status||'idle').slice(0,16);
  if(!cur){ db.prepare("INSERT INTO devices(user_id,device_key,name,status,last_seen,created_at) VALUES(?,?,?,?,?,?)").run(uid,key,String(info.name||key).slice(0,40),status,now,now); return { ok:true, cmd:'' }; }
  db.prepare('UPDATE devices SET status=?, last_seen=? WHERE id=?').run(status, now, cur.id);
  let cmd=cur.cmd||''; if(cmd) db.prepare("UPDATE devices SET cmd='' WHERE id=?").run(cur.id);
  return { ok:true, cmd };
}
function devicesList(uid){ const now=Date.now(); return db.prepare('SELECT id,device_key,name,status,last_seen,created_at FROM devices WHERE user_id=? ORDER BY id ASC').all(uid).map(d=>({ id:d.id, device_key:d.device_key, name:d.name, status:d.status, last_seen:d.last_seen, online:(now-(d.last_seen||0) < 90000) })); }
function deviceRename(uid,id,name){ db.prepare('UPDATE devices SET name=? WHERE id=? AND user_id=?').run(String(name||'').slice(0,40), id, uid); return true; }
function deviceCmd(uid,id,cmd){ db.prepare('UPDATE devices SET cmd=? WHERE id=? AND user_id=?').run(String(cmd||'').slice(0,40), id, uid); return true; }
function deviceRemove(uid,id){ db.prepare('DELETE FROM devices WHERE id=? AND user_id=?').run(id,uid); return true; }

// ===== 执行端 token 鉴权：真机/外部脚本无浏览器 cookie，用一次签发的设备 token 接入 =====
try { db.exec("ALTER TABLE devices ADD COLUMN token TEXT"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_dev_token ON devices(token)"); } catch {}
// 网页端为某设备签发/取回 token（绑定 uid+device_key）。真机把它存起来,后续 pull/done/heartbeat 带上。
function deviceTokenIssue(uid, key, name){
  key=String(key||'').slice(0,60); if(!key) return { ok:false, error:'缺少设备标识' };
  const now=Date.now(); let cur=db.prepare('SELECT * FROM devices WHERE user_id=? AND device_key=?').get(uid,key);
  if(!cur){ db.prepare("INSERT INTO devices(user_id,device_key,name,status,last_seen,created_at) VALUES(?,?,?,?,?,?)").run(uid,key,String(name||key).slice(0,40),'idle',now,now); cur=db.prepare('SELECT * FROM devices WHERE user_id=? AND device_key=?').get(uid,key); }
  let tok=cur.token;
  if(!tok){ tok='zd_'+crypto.randomBytes(24).toString('base64url'); db.prepare('UPDATE devices SET token=? WHERE id=?').run(tok,cur.id); }
  return { ok:true, token:tok, deviceId:cur.id, deviceKey:key };
}
function deviceTokenReset(uid, id){ const tok='zd_'+crypto.randomBytes(24).toString('base64url'); const r=db.prepare('UPDATE devices SET token=? WHERE id=? AND user_id=?').run(tok,id,uid); return r.changes>0?{ ok:true, token:tok }:{ ok:false }; }
// 校验设备 token → 返回 {uid, deviceId, deviceKey, name}；删除设备即吊销
function verifyDeviceToken(token){
  token=String(token||'').trim(); if(!token||token.indexOf('zd_')!==0) return null;
  const d=db.prepare('SELECT id,user_id,device_key,name FROM devices WHERE token=?').get(token);
  return d?{ uid:d.user_id, deviceId:d.id, deviceKey:d.device_key, name:d.name }:null;
}

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
// 公共赛道名称/图标覆盖（超级管理员改，全平台共用）
function trackOverridesGet() { const o = settingsGet('track_overrides', {}); return (o && typeof o === 'object') ? o : {}; }
function trackOverrideSet(trackId, name, emoji) {
  const id = String(trackId || '').trim(); if (!id) return { ok: false, error: '缺少 trackId' };
  const ov = trackOverridesGet(); const cur = ov[id] || {};
  if (name != null && String(name).trim()) cur.name = String(name).trim().slice(0, 20);
  if (emoji != null && String(emoji).trim()) cur.emoji = String(emoji).trim().slice(0, 4);
  ov[id] = cur; settingsSet('track_overrides', ov);
  return { ok: true, overrides: ov };
}

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
    .map(r => {
      const doneKeys = r.done_keys ? JSON.parse(r.done_keys) : [];
      let d = {}; try { d = JSON.parse(r.data || '{}'); } catch {}
      // 已到达步骤号：已完成步骤最大号；对标素材(图/正文)就绪但还没出骨架 → 至少第2步「拆解中」
      let stepNo = doneKeys.map(k => parseInt(String(k).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0);
      if (stepNo < 1 && (r.topic || '').trim()) stepNo = 1;
      if (stepNo < 2 && ((d.refImages || []).length || (d.ref || '').trim())) stepNo = 2;
      return { id: r.id, topic: r.topic, track: r.track, imgs: r.imgs, cover: r.cover || '', coverCard: (r.cover ? null : coverCardOf(r.data)), ts: r.ts, doneKeys, stepNo, platform: (d.platform === 'gzh' ? 'gzh' : 'xhs') };
    });
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
// 删除某用户某赛道智能体的云端配置（用于删除自定义赛道，避免登录后又被同步回灌导致「删不掉」）
function agentConfigDelete(uid, trackId) {
  db.prepare('DELETE FROM agent_config WHERE user_id=? AND track_id=?').run(uid, String(trackId));
}
// 管理排查：按手机号查该用户在服务端存的全部智能体(赛道)配置，含赛道定义(_track)与人设/知识库概览，供核对/导出/恢复
function adminUserAgents(phone) {
  const u = getUserByPhone(String(phone || '').trim());
  if (!u) return { ok: false, error: '用户不存在' };
  const rows = db.prepare('SELECT track_id, config, updated_at FROM agent_config WHERE user_id=? ORDER BY updated_at DESC').all(u.id);
  const agents = rows.map(r => {
    let c = {}; try { c = JSON.parse(r.config); } catch {}
    const t = c._track || null;
    const persona = c.persona || (t && t.persona) || '';
    const kbChars = ['kb1', 'kb2', 'kb3', 'kb4'].reduce((n, k) => n + String(c[k] || '').length, 0);
    return {
      trackId: r.track_id,
      name: (t && t.name) || (/^custom-/.test(r.track_id) ? '(未命名·仅人设/知识库)' : r.track_id),
      emoji: (t && t.emoji) || '',
      isCustom: /^custom-/.test(r.track_id),
      hasTrackDef: !!t,
      personaLen: persona.length,
      kbChars,
      skills: Array.isArray(c.skills) ? c.skills.length : 0,
      updatedAt: r.updated_at,
      config: c, // 完整配置，供导出/恢复
    };
  });
  return { ok: true, user: { id: u.id, phone: u.phone, nickname: u.nickname || '', level: u.level || '' }, agents };
}
// 管理清理：删除某手机号用户在服务端的智能体配置。trackId 传具体值=删单个；传 '*' 或空=清空该用户全部
function adminDeleteUserAgents(phone, trackId) {
  const u = getUserByPhone(String(phone || '').trim());
  if (!u) return { ok: false, error: '用户不存在' };
  let removed;
  if (!trackId || trackId === '*') {
    removed = db.prepare('DELETE FROM agent_config WHERE user_id=?').run(u.id).changes;
  } else {
    removed = db.prepare('DELETE FROM agent_config WHERE user_id=? AND track_id=?').run(u.id, String(trackId)).changes;
  }
  return { ok: true, removed };
}

priceMigrateV2(); // 一次性对齐 PRD §8 价格（幂等）
priceMigrateV3(); // 一次性对齐 v3 价目（图生图100/卡片图30/自检免费/矩阵免费/其余50）（幂等）
module.exports = {
  signSession, verifySession, setCode, checkCode,
  getOrCreateUser, getUser, getUserByPhone, setNickname, userStats, getBalance, getPrice,
  grant, deduct, adminAdjust, createOrder, getOrder, markPaid, recentLedger, SIGNUP_GRANT,
  historyList, historyGet, historyUpsert, historyRemove, adminTasks, adminTaskStats,
  templatePurchasedList, templateBuy, TEMPLATE_PRICE, funnelStats,
  agentConfigAll, agentConfigSave, agentConfigDelete, adminUserAgents, adminDeleteUserAgents,
  trackOverridesGet, trackOverrideSet,
  ensureInviteCode, inviteStats,
  adminOrders, adminUsers, adminSummary,
  levelsGet, levelsSet, getAllPrices, setPrice,
  kbGet, kbSet, staffList, staffAdd, staffRemove, isStaffPhone, staffMenusOf, ADMIN_MENUS,
  rolesGet, rolesSet, menuCfgGet, menuCfgSet, enabledMenuKeys,
  partnerMemberOrders, partnerTransfer, hasPaidPack,
  qaLogAdd, qaLogList, qaTopQuestions, qaStats,
  accountsList, accountAdd, accountUpdate, accountRemove, accountAuthBlob, accountsResetQrAuth, accountSubmitCookie,
  accountsActiveXhs, accountSetAuthById, accountSetStatusById,
  plansList, planAdd, planUpdate, planRemove, planStat, planRuns, planRunsAll,
  scriptLibsList, scriptLibAdd, scriptLibUpdate, scriptLibRemove,
  leadsList, leadsAdd, leadRemove, leadsClear, leadStatus,
  dispatchAdd, dispatchList, dispatchPull, dispatchDone, dispatchCancel, dispatchReport, dispatchSet,
  noteStatPut, noteStatsList, noteStatRemove, noteStatSetAccount,
  cdispAdd, cdispList, cdispPull, cdispDone, cdispCancel,
  deviceHeartbeat, devicesList, deviceRename, deviceCmd, deviceRemove, deviceTokenIssue, deviceTokenReset, verifyDeviceToken,
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
