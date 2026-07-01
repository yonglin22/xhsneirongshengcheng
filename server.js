// 美术考研小红书笔记智能体 · 本地后端代理
// 零依赖（Node 18+ 自带 fetch）。作用：
//   1) 托管静态页面（同源，消除浏览器 CORS）
//   2) /api/claude 把请求转发给 Anthropic，API Key 只存在服务端环境变量里，永不进浏览器
//
// 运行：  ANTHROPIC_API_KEY=sk-ant-xxx node server.js
//   或：  把 key 写进 .env，然后 node server.js
//   然后浏览器打开  http://localhost:8787

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// ===== 纯 Node 打 ZIP（不依赖系统 zip 命令）：用于 /api/ext-download 打包插件目录 =====
const _ZIP_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function _crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = _ZIP_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }
function makeZip(files) {
  const chunks = [], central = []; let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = _crc32(f.data);
    const comp = zlib.deflateRawSync(f.data);
    const useStore = comp.length >= f.data.length; // 压不动就直接存
    const body = useStore ? f.data : comp; const method = useStore ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); // UTF-8 标志
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central); const centralOff = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(centralOff, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

// ===== 可灵 Kling：JWT 鉴权 + 异步出图（提交 → 轮询）=====
function b64url(x) { return Buffer.from(x).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function klingToken() {
  const ak = process.env.KLING_ACCESS_KEY, sk = process.env.KLING_SECRET_KEY;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 }));
  const sig = b64url(crypto.createHmac('sha256', sk).update(header + '.' + payload).digest());
  return header + '.' + payload + '.' + sig;
}
async function klingGenerate(prompt, aspect) {
  if (!process.env.KLING_ACCESS_KEY || !process.env.KLING_SECRET_KEY) throw new Error('未配置 KLING_ACCESS_KEY/SECRET_KEY');
  const base = (process.env.KLING_BASE_URL || 'https://api-beijing.klingai.com').replace(/\/+$/, '');
  const model = process.env.KLING_MODEL || 'kling-v1';
  prompt = String(prompt || '').slice(0, 2480); // 可灵 prompt 硬上限 2500 字，截断防 "size must be between 0 and 2500"
  const sub = await fetch(base + '/v1/images/generations', {
    method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + klingToken() },
    body: JSON.stringify({ model_name: model, prompt, n: 1, aspect_ratio: aspect || '3:4' }),
  });
  const sj = await sub.json().catch(() => ({}));
  if (sj.code !== 0 || !(sj.data && sj.data.task_id)) throw new Error('可灵提交失败：' + (sj.message || JSON.stringify(sj).slice(0, 160)));
  const taskId = sj.data.task_id;
  for (let i = 0; i < 30; i++) { // 最多约 75s
    await new Promise(r => setTimeout(r, 2500));
    const q = await fetch(base + '/v1/images/generations/' + taskId, { headers: { 'authorization': 'Bearer ' + klingToken() } });
    const qj = await q.json().catch(() => ({}));
    const st = qj.data && qj.data.task_status;
    if (st === 'succeed') { const imgs = qj.data.task_result && qj.data.task_result.images; if (imgs && imgs[0] && imgs[0].url) return imgs[0].url; throw new Error('可灵成功但无图 URL'); }
    if (st === 'failed') throw new Error('可灵出图失败：' + (qj.data.task_status_msg || ''));
  }
  throw new Error('可灵出图超时');
}

// ---- 极简 .env 读取（KEY=VALUE，每行一条；# 注释）----
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i < 0) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      // .env 是本应用唯一可信配置源：始终覆盖外部预置的同名变量。
      // 关键：很多机器的 shell 里残留着 Claude Code 的 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY，
      // 若不强制覆盖，请求会被发到 api.anthropic.com（带 DeepSeek key）→ 403 "Request not allowed"。
      process.env[k] = v;
    }
  } catch { /* 没有 .env 就跳过 */ }
})();

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
// 转发地址：默认 Anthropic 官方；用第三方中转时在 .env 里改 ANTHROPIC_BASE_URL
const API_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
// 鉴权头风格：x-api-key（默认，Anthropic）或 bearer（部分中转用 Authorization: Bearer）
const AUTH_STYLE = (process.env.ANTHROPIC_AUTH_STYLE || 'x-api-key').toLowerCase();
// API 格式：anthropic（默认，/v1/messages）或 openai（/chat/completions，用于 DeepSeek/智谱/Kimi 等国产兼容模型）
const API_FORMAT = (process.env.API_FORMAT || 'anthropic').toLowerCase();
// 模型覆盖：设了就忽略前端下拉、强制用它（国产模型必须设，如 deepseek-chat / glm-4-flash / moonshot-v1-8k）
const FORCE_MODEL = process.env.MODEL || '';

// ---- 计费模块（node:sqlite 需 Node ≥ 22；加载失败则整体降级为「无计费」，老功能照常）----
let billing = null;
try { billing = require('./billing'); }
catch (e) { console.warn('  [计费] 未加载：' + (e.message || e) + '（需 Node ≥ 22；当前免登录免计费）'); }
// 总开关：默认关（本地裸用不受影响）。要收费时在 .env 设 BILLING_ENABLED=true
const BILLING_ENABLED = !!billing && /^(1|true|on|yes)$/i.test(process.env.BILLING_ENABLED || '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// 付费成品模板目录（启动读一次，可热改：删缓存重读）
let TEMPLATES_CACHE = null;
function loadTemplates() {
  if (TEMPLATES_CACHE) return TEMPLATES_CACHE;
  try { TEMPLATES_CACHE = JSON.parse(fs.readFileSync(path.join(__dirname, '模板库.json'), 'utf8')); }
  catch { TEMPLATES_CACHE = { price: 120, templates: [] }; }
  return TEMPLATES_CACHE;
}
const ADMIN_PHONES = new Set((process.env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean));

// ===== 验证码频率限制（进程内存；多实例部署需换 Redis）=====
const _smsPhone = new Map(), _smsIp = new Map();
function smsRateLimit(phone, ip) {
  const now = Date.now();
  if (now - (_smsPhone.get(phone) || 0) < 60000) return { ok: false, msg: '操作过于频繁，请 60 秒后再试' };
  const rec = _smsIp.get(ip) || { c: 0, t: now };
  if (now - rec.t > 3600000) { rec.c = 0; rec.t = now; }
  if (rec.c >= 10) return { ok: false, msg: '发送过于频繁，请稍后再试' };
  _smsPhone.set(phone, now); rec.c++; _smsIp.set(ip, rec);
  return { ok: true };
}
// 短信发送钩子：① SMS_PROVIDER=tencent → 腾讯云 SendSms；② 或配 SMS_WEBHOOK_URL 走自建中转。
// 未配 SMS_PROVIDER 时不会调用（走 dev 回显）。
async function sendSms(phone, code) {
  const p = (process.env.SMS_PROVIDER || '').toLowerCase();
  if (p === 'tencent') return sendSmsTencent(phone, code);
  if (p === 'aliyun') return sendSmsAliyun(phone, code);
  if (process.env.SMS_WEBHOOK_URL) {
    const r = await fetch(process.env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, code, sign: process.env.SMS_SIGN || '', template: process.env.SMS_TEMPLATE || '' }) });
    if (!r.ok) throw new Error('SMS webhook ' + r.status);
    return;
  }
  throw new Error('SMS_PROVIDER=' + p + ' 未接入：设 SMS_PROVIDER=tencent（配腾讯云参数）或 SMS_WEBHOOK_URL');
}
// 阿里云短信 SendSms（RPC 风格 HMAC-SHA1 签名，零依赖）
// 到阿里云的常驻热连接：避免每次冷连接(香港→杭州 TCP connect 5~7s)，让验证码发送瞬时
const _https = require('node:https');
const _smsAgent = new _https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 4 });
function smsHttpGetJSON(u) {
  return new Promise((resolve, reject) => {
    const req = _https.get(u, { agent: _smsAgent, timeout: 9000 }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
// 每 25s 保活一次，让 TLS 连接常驻（keepAliveMsecs 30s 内复用），真实发送时秒达
if ((process.env.SMS_PROVIDER || '').toLowerCase() === 'aliyun') {
  const warm = () => { try { const r = _https.get('https://dysmsapi.aliyuncs.com/', { agent: _smsAgent, timeout: 8000 }, res => res.resume()); r.on('error', () => {}); r.on('timeout', () => r.destroy()); } catch {} };
  setTimeout(warm, 2000); const _wt = setInterval(warm, 25000); if (_wt.unref) _wt.unref();
}
async function sendSmsAliyun(phone, code) {
  const _t0 = Date.now();
  const KID = process.env.ALIYUN_ACCESS_KEY_ID, KSEC = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const SIGN = process.env.ALIYUN_SMS_SIGN, TPL = process.env.ALIYUN_SMS_TEMPLATE;
  const paramKey = process.env.ALIYUN_SMS_PARAM_KEY || 'code'; // 模板变量名，默认 ${code}
  if (!KID || !KSEC || !SIGN || !TPL) throw new Error('阿里云短信参数不全（需 ALIYUN_ACCESS_KEY_ID/SECRET、ALIYUN_SMS_SIGN/TEMPLATE）');
  const enc = s => encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~');
  const params = {
    AccessKeyId: KID, Action: 'SendSms', Format: 'JSON', PhoneNumbers: String(phone),
    RegionId: 'cn-hangzhou', SignName: SIGN, SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(), SignatureVersion: '1.0', TemplateCode: TPL,
    TemplateParam: JSON.stringify({ [paramKey]: String(code) }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Version: '2017-05-25'
  };
  const canon = Object.keys(params).sort().map(k => enc(k) + '=' + enc(params[k])).join('&');
  const stringToSign = 'GET&' + enc('/') + '&' + enc(canon);
  const sig = crypto.createHmac('sha1', KSEC + '&').update(stringToSign).digest('base64');
  const url = 'https://dysmsapi.aliyuncs.com/?Signature=' + enc(sig) + '&' + canon;
  // 走常驻热连接发送；偶发失败重试 3 次（同一签名 URL 在有效期内可重发）
  let j, lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { j = await smsHttpGetJSON(url); break; } catch (e) { lastErr = e; await new Promise(s => setTimeout(s, 400)); }
  }
  if (!j) throw new Error('阿里云短信网络失败（重试3次）：' + ((lastErr && lastErr.message) || 'timeout'));
  if (j.Code !== 'OK') throw new Error('阿里云 ' + (j.Code || '') + '：' + (j.Message || '发送失败'));
  console.log('[SMS] aliyun 提交成功 ' + ((Date.now() - _t0) / 1000).toFixed(2) + 's → ' + phone + ' (BizId:' + (j.BizId || '') + ')');
  return true;
}
// 腾讯云短信 SendSms（API v3，TC3-HMAC-SHA256 签名，零依赖）
async function sendSmsTencent(phone, code) {
  const SID = process.env.TENCENT_SECRET_ID, SKEY = process.env.TENCENT_SECRET_KEY;
  const APPID = process.env.TENCENT_SMS_SDK_APPID, SIGN = process.env.TENCENT_SMS_SIGN, TPL = process.env.TENCENT_SMS_TEMPLATE;
  const REGION = process.env.TENCENT_SMS_REGION || 'ap-guangzhou';
  if (!SID || !SKEY || !APPID || !SIGN || !TPL) throw new Error('腾讯云短信参数不全（需 TENCENT_SECRET_ID/SECRET_KEY/SMS_SDK_APPID/SMS_SIGN/SMS_TEMPLATE）');
  const host = 'sms.tencentcloudapi.com', service = 'sms', action = 'SendSms', version = '2021-01-11', ct = 'application/json; charset=utf-8';
  // 模板参数：默认 [验证码]；若模板含「{2}分钟有效」则设 TENCENT_SMS_MINUTES 追加
  const tplParams = [String(code)];
  if (process.env.TENCENT_SMS_MINUTES) tplParams.push(String(process.env.TENCENT_SMS_MINUTES));
  const payload = JSON.stringify({ PhoneNumberSet: ['+86' + phone], SmsSdkAppId: APPID, SignName: SIGN, TemplateId: TPL, TemplateParamSet: tplParams });
  const ts = Math.floor(Date.now() / 1000), date = new Date(ts * 1000).toISOString().slice(0, 10);
  const sha256hex = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();
  const canonicalHeaders = `content-type:${ct}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)].join('\n');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', ts, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac('TC3' + SKEY, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${SID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const r = await fetch('https://' + host, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': ct, Host: host, 'X-TC-Action': action, 'X-TC-Timestamp': String(ts), 'X-TC-Version': version, 'X-TC-Region': REGION }, body: payload });
  const j = await r.json().catch(() => ({}));
  const resp = j && j.Response;
  if (!resp) throw new Error('腾讯云无响应');
  if (resp.Error) throw new Error('腾讯云 ' + resp.Error.Code + '：' + resp.Error.Message);
  const st = (resp.SendStatusSet || [])[0];
  if (!st || st.Code !== 'Ok') throw new Error('短信失败 ' + (st ? st.Code + ' ' + st.Message : '未知'));
  return true;
}
function clientIp(req) { return (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || ''; }
// 抓取日限：每用户每天最多 N 次（保护全平台共用的小红书账号不被少数人刷爆触发风控）。内存计数、按本地日期，重启清零。
const XHS_DAILY_LIMIT = parseInt(process.env.XHS_DAILY_LIMIT || '20', 10);
const _xhsCounts = new Map(); // key(u<uid>/ip<ip>) -> { day:'YYYY-MM-DD', n }
function xhsDailyCheck(key) {
  const day = new Date().toISOString().slice(0, 10);
  let r = _xhsCounts.get(key);
  if (!r || r.day !== day) { r = { day, n: 0 }; _xhsCounts.set(key, r); }
  if (r.n >= XHS_DAILY_LIMIT) return { ok: false, used: r.n, limit: XHS_DAILY_LIMIT };
  return { ok: true, used: r.n, limit: XHS_DAILY_LIMIT, inc() { r.n++; } };
}
// 充值套餐（cny 单位：分）。前端只传 pack_id，金额/积分由服务端定，杜绝篡改。
const PACKS = {
  exp: { id: 'exp', cny: 150, credits: 150, name: '体验套餐', desc: '¥1.5 体验一次完整流程（含 ≤4 张配图），每人限一次', once: true },
  trial: { id: 'trial', cny: 980, credits: 1100, name: '体验包', desc: '送 120，约 15 篇' },
  value: { id: 'value', cny: 1980, credits: 2400, name: '超值包', desc: '送 420，约 34 篇' },
  basic: { id: 'basic', cny: 3000, credits: 4200, name: '基础包', desc: '送 1200，约 58 篇' },
  pro: { id: 'pro', cny: 9800, credits: 14000, name: '进阶包', desc: '约 195 篇' },
  studio: { id: 'studio', cny: 29800, credits: 45000, name: '工作室包', desc: '约 625 篇' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function readBodyBuffer(req, max = 25e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on('data', c => { len += c.length; if (len > max) { req.destroy(); reject(new Error('文件过大（上限 25MB）')); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj, headers = {}) { send(res, code, JSON.stringify(obj), { 'content-type': 'application/json', ...headers }); }
function parseCookies(req) { const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function authUid(req) { if (!billing) return null; const t = parseCookies(req).sid; return t ? billing.verifySession(t) : null; }
// 执行端鉴权：Authorization: Bearer zd_xxx 或 x-device-token 头 → 返回设备信息（真机/脚本用）
function authDevice(req) { if (!billing) return null; const h = req.headers['authorization'] || ''; const m = /^Bearer\s+(\S+)/i.exec(h); const t = (m && m[1]) || req.headers['x-device-token'] || ''; return t ? billing.verifyDeviceToken(t) : null; }
// 是否管理员：① 运维令牌 x-admin-token，或 ② 登录用户手机号在白名单
function isAdminReq(req) {
  if (ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN) return true;
  if (billing) { const uid = authUid(req); const u = uid && billing.getUser(uid); if (u && (ADMIN_PHONES.has(u.phone) || billing.isStaffPhone(u.phone))) return true; }
  return false;
}
function roleOfUid(uid) {
  if (!billing || !uid) return 'user';
  const u = billing.getUser(uid); if (!u) return 'user';
  if (ADMIN_PHONES.has(u.phone) || billing.isStaffPhone(u.phone)) return 'admin';
  return billing.userStats(uid).levelKey === '合伙人' ? 'partner' : 'user';
}
const COOKIE_SECURE = /^(1|true|on|yes)$/i.test(process.env.COOKIE_SECURE || '');
function setSidCookie(uid) { return 'sid=' + billing.signSession(uid) + '; Path=/; HttpOnly; SameSite=Lax; ' + (COOKIE_SECURE ? 'Secure; ' : '') + 'Max-Age=' + (30 * 86400); }
// 后扣计费 gate：未开计费→放行(cost0)；未登录→401；余额不足→402。否则返回 {uid,cost}。
function billingGate(req, res, actionKey, defCredits, mult) {
  if (!BILLING_ENABLED) return { uid: null, cost: 0 };
  const uid = authUid(req);
  if (!uid) { sendJSON(res, 401, { error: '请先登录', code: 'NEED_LOGIN' }); return null; }
  const cost = billing.getPrice(actionKey, defCredits) * (mult || 1);
  const bal = billing.getBalance(uid);
  if (bal < cost) { sendJSON(res, 402, { error: '积分不足，请充值', code: 'INSUFFICIENT', need: cost, balance: bal }); return null; }
  return { uid, cost };
}

// 从 docx/pptx（本质是 zip）里取出内嵌图片（word/media、ppt/media、xl/media）。零依赖：读中央目录 + zlib inflate。
function unzipMedia(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/(word|ppt|xl)\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(name)) continue;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) continue;
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(ds, ds + compSize);
    let data = null; try { data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null; } catch {}
    if (data && data.length > 3000) out.push({ name, data, ext: (name.split('.').pop() || 'png').toLowerCase() }); // 滤掉 <3KB 的图标/装饰
  }
  return out;
}
// 调智谱 GLM-4V 看一张图（data URL），返回中文描述
async function glmVision(dataUrl, prompt) {
  const zkey = process.env.ZHIPU_API_KEY || ''; if (!zkey) return '';
  try {
    const up = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + zkey },
      body: JSON.stringify({ model: process.env.ZHIPU_VISION_MODEL || 'glm-4v-flash', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }] }),
    });
    if (!up.ok) return '';
    const j = await up.json();
    return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  } catch { return ''; }
}

// 极简 RSS 解析（无依赖）：取 item 的 title/link，供对接自建 RSSHub 的艺术资讯路由
async function fetchRss(url, max = 6) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', 'accept': 'application/rss+xml,application/xml,text/xml,*/*' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    const blocks = xml.split(/<item[\s>]/i).slice(1);
    for (const b of blocks.slice(0, max)) {
      const pick = re => { const m = b.match(re); return m ? m[1] : ''; };
      let title = pick(/<title>([\s\S]*?)<\/title>/i).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const link = pick(/<link>([\s\S]*?)<\/link>/i).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      if (title) out.push({ word: title, link });
    }
    return out;
  } catch { return []; }
}

// 直连艺术资讯（不依赖 Docker/RSSHub）：澎湃搜索 API 搜美术/展览类，返回真实艺术文章
async function fetchPaperArt() {
  const out = [], seen = new Set();
  for (const kw of ['美术展', '画展', '美术馆', '博物馆展', '艺术展']) {
    try {
      const r = await fetch('https://api.thepaper.cn/search/web/news', {
        method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0', 'referer': 'https://www.thepaper.cn/' },
        body: JSON.stringify({ word: kw, pageNum: 1, pageSize: 5 }),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const list = (j.data && (j.data.list || j.data.newsList)) || [];
      for (const x of list) {
        const name = (x.name || x.title || '').replace(/<[^>]+>/g, '').trim();
        if (name && !seen.has(name)) { seen.add(name); out.push({ word: name, hot: '', source: '澎湃·艺术', art: true, link: x.contId ? ('https://www.thepaper.cn/newsDetail_forward_' + x.contId) : '' }); }
      }
    } catch {}
  }
  return out;
}

// ===== 小红书登录态：状态查询 + 后台自助扫码续期（纯新增，绝不改 /api/xhs-search 抓取逻辑）=====
// 续期原理：小红书 cookie 由小红书服务端控制，约数天~两周过期；这里让管理员在「管理后台」
// 一键发起 xhs login --qrcode，把虚拟屏(:99)里浏览器渲染出的二维码截图、解码、用 qrencode 重画成
// 清晰二维码回传前端，管理员手机扫一下即可恢复抓取——无需 SSH、无需敲命令。
const { execFile: _execFile, spawn: _spawn } = require('child_process');
const XHS_DISPLAY = process.env.XHS_DISPLAY || ':99';
const XHS_HOME = process.env.HOME || '/home/app';
const XHS_USER = process.env.XHS_USER || 'app';
function xhsEnv() { return { ...process.env, HOME: XHS_HOME, DISPLAY: XHS_DISPLAY }; }
function runCmd(cmd, args, timeout = 20000) {
  return new Promise(resolve => {
    _execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: xhsEnv() }, (err, so, se) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: (so || '').toString(), stderr: (se || '').toString(), err });
    });
  });
}
// 查询登录态：优先 xhs status --json，解析失败再退回纯文本 status 兜底识别
async function xhsStatus() {
  const rj = await runCmd('xhs', ['status', '--json'], 20000);
  let info = null; try { info = JSON.parse(rj.stdout); } catch {}
  if (info && info.data) {
    const u = info.data.user || {};
    return { loggedIn: !!info.data.authenticated, nickname: u.nickname || u.name || '', redId: u.red_id || u.username || '', raw: (rj.stdout || '').slice(0, 300) };
  }
  const rt = await runCmd('xhs', ['status'], 20000);
  const out = (rt.stdout + '\n' + rt.stderr);
  const expired = /expired|未登录|not logged|Session expired/i.test(out);
  const ok = /Logged in|authenticated[:：]\s*true|已登录/i.test(out) && !expired;
  const m = out.match(/昵称[:：]\s*(.+)/) || out.match(/nickname[:：]\s*'?([^'\n]+)/i);
  const rid = out.match(/小红书号[:：]\s*(\S+)/) || out.match(/red_id[:：]\s*'?([^'\n]+)/i);
  return { loggedIn: ok, nickname: m ? m[1].trim() : '', redId: rid ? rid[1].trim() : '', raw: out.slice(0, 300) };
}
// 确保虚拟屏 :99 在跑（纯命令行 VPS 无图形界面，扫码登录的浏览器需要一个 DISPLAY）
function ensureXvfb() {
  return new Promise(resolve => {
    _execFile('pgrep', ['-f', 'Xvfb ' + XHS_DISPLAY], (err, so) => {
      if (!err && (so || '').trim()) return resolve(true);
      try { const p = _spawn('Xvfb', [XHS_DISPLAY, '-screen', '0', '1360x900x24', '-ac'], { detached: true, stdio: 'ignore', env: xhsEnv() }); p.unref(); } catch {}
      setTimeout(() => resolve(true), 1800);
    });
  });
}
// 整个流程（拉起浏览器等渲染+截图+解码+重画）耗时可达 30~60 秒，远超普通接口超时；
// 因此改成后台异步跑，前端先收到「已开始」，再轮询 /api/admin/xhs-relogin-qr 拿结果，避免 fetch 超时误报失败。
// 实测 xhs 自身"等浏览器完成扫码"有内部超时（不到一两分钟就会判定超时退出），管理员从看到二维码到
// 拿起手机扫完往往就会超过这个窗口——所以这里不是"生成一次二维码就完事"，而是持续循环：旧的一轮超时/
// 失败就自动重新拉起一轮新的登录、生成新二维码（gen 自增），前端据此自动刷新画面，直到登录成功或总时长到上限。
let xhsReloginState = { status: 'idle', img: '', qr: '', error: '', gen: 0, startedAt: 0 };
async function xhsCaptureOneQr(pngPath, cleanPath) {
  let qr = '';
  for (let i = 0; i < 12; i++) { // 最多尝试 ~3s+12*1.5s ≈ 21s
    await runCmd('import', ['-window', 'root', pngPath], 6000);
    const z = await runCmd('zbarimg', ['--raw', '-q', pngPath], 6000);
    if (z.code === 0) { const v = (z.stdout || '').trim().split('\n')[0] || ''; if (v) { qr = v; break; } }
    await new Promise(r => setTimeout(r, 1500));
  }
  let img = '';
  if (qr) { // 用 qrencode 把解码出的登录链接重画成清晰二维码（比直接发桌面截图更易扫）
    const qe = await runCmd('qrencode', ['-o', cleanPath, '-s', '8', '-m', '2', qr], 8000);
    if (qe.code === 0) { try { img = 'data:image/png;base64,' + fs.readFileSync(cleanPath).toString('base64'); } catch {} }
  }
  if (!img) { try { img = 'data:image/png;base64,' + fs.readFileSync(pngPath).toString('base64'); } catch {} } // 兜底：发原始截图
  return { qr, img };
}
// 发起一轮扫码登录：后台拉起 xhs login（持续等扫码），截虚拟屏→解码二维码→qrencode 重画清晰码回传；
// 若这一轮在仍未登录成功的情况下结束（xhs 自身超时退出/进程已不在），自动重开下一轮，直到登录成功或总超时。
async function xhsReloginRun() {
  await ensureXvfb();
  const logPath = path.join(XHS_HOME, 'xhslogin.log');
  const pngPath = path.join(XHS_HOME, 'qr_raw.png');
  const cleanPath = path.join(XHS_HOME, 'qr_clean.png');
  const deadline = Date.now() + 4 * 60 * 1000; // 总共最多循环刷新 4 分钟
  while (Date.now() < deadline) {
    try {
      await runCmd('pkill', ['-u', XHS_USER, '-f', 'xhs login'], 5000);
      await runCmd('pkill', ['-u', XHS_USER, '-f', 'camoufox'], 5000);
      await new Promise(r => setTimeout(r, 800));
      let proc;
      try {
        const out = fs.openSync(logPath, 'w');
        proc = _spawn('xhs', ['login', '--qrcode'], { detached: true, stdio: ['ignore', out, out], env: xhsEnv(), cwd: XHS_HOME });
        proc.unref();
      } catch (e) { xhsReloginState = { ...xhsReloginState, status: 'error', error: '启动登录进程失败：' + (e.message || e) }; return; }
      await new Promise(r => setTimeout(r, 3000)); // 给浏览器留最短的渲染时间
      const { qr, img } = await xhsCaptureOneQr(pngPath, cleanPath);
      if (!qr || !img) { xhsReloginState = { ...xhsReloginState, status: 'error', error: '未能识别到二维码（虚拟屏/截图/解码工具异常，请确认已装 xvfb imagemagick zbar-tools qrencode）' }; return; }
      xhsReloginState = { status: 'ready', img, qr, error: '', gen: xhsReloginState.gen + 1, startedAt: xhsReloginState.startedAt };
      // 这一轮二维码已展示给前端；接下来等它被扫完(登录成功) 或 这一轮login进程退出(xhs内部超时)再决定是否重开一轮
      const roundDeadline = Date.now() + 50000;
      while (Date.now() < roundDeadline && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 4000));
        const st = await xhsStatus();
        if (st.loggedIn) return; // 登录成功，结束整个循环（前端的登录态轮询会检测到并提示）
        const alive = await runCmd('pgrep', ['-u', XHS_USER, '-f', 'xhs login']);
        if (alive.code !== 0 || !(alive.stdout || '').trim()) break; // 这一轮进程已退出（多半是内部超时）→ 跳出去重开一轮
      }
    } catch (e) {
      xhsReloginState = { ...xhsReloginState, status: 'error', error: '生成二维码异常：' + (e.message || e) };
      return;
    }
  }
  if (xhsReloginState.status !== 'ready') return;
  // 4分钟内一直没登录成功：保留最后一张二维码，前端的登录态轮询超时后会提示重新点击
}
function xhsReloginStart() {
  if (xhsReloginState.status === 'running') return { ok: true, status: 'running' };
  xhsReloginState = { status: 'running', img: '', qr: '', error: '', gen: 0, startedAt: Date.now() };
  xhsReloginRun(); // 不 await，立即返回
  return { ok: true, status: 'running' };
}

const server = http.createServer(async (req, res) => {
 try {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // ---- 健康检查：前端用来判断代理是否就绪、key 是否配置 ----
  if (pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, keyPresent: !!API_KEY, imagePresent: !!process.env.ZHIPU_API_KEY, version: API_VERSION, billing: BILLING_ENABLED, baseUrl: process.env.PUBLIC_BASE_URL || '', icp: process.env.ICP_BEIAN || '', police: process.env.POLICE_BEIAN || '' }),
      { 'content-type': 'application/json' });
  }

  // ---- 临时诊断：核对磁盘上实际文件内容与部署提交，排查"部署成功但内容未更新"问题 ----
  if (pathname === '/api/_debug-deploy') {
    try {
      const fp = path.join(__dirname, '获客计划.html');
      const html = await fsp.readFile(fp, 'utf8');
      const appJsVer = (html.match(/app\.js\?v=(\d+)/) || [])[1] || null;
      const cssVer = (html.match(/atelier\.css\?v=(\d+)/) || [])[1] || null;
      const hasInterceptRegex = /_\(nurture\|intercept\)\$/.test(html);
      // 抓取链路诊断：用什么方式抓、配没配，便于排查「没抓到」到底是部署没上 还是 VPS 抓取登录态问题
      const collector = (process.env.COLLECTOR_URL || '').trim();
      let xhsCliFound = false;
      try { require('child_process').execFileSync('xhs', ['--version'], { timeout: 4000, stdio: 'ignore' }); xhsCliFound = true; } catch {}
      return sendJSON(res, 200, {
        ok: true,
        commit: process.env.RENDER_GIT_COMMIT || null,
        fileMtime: (await fsp.stat(fp)).mtime,
        appJsVer, cssVer, hasInterceptRegex,
        scrape: {
          mode: collector ? 'collector' : (xhsCliFound ? 'local-xhs-cli' : 'none'),
          collectorConfigured: !!collector,
          xhsCliFound,
          xhsCookieConfigured: !!(process.env.XHS_COOKIE || '').trim(),
          dailyLimit: XHS_DAILY_LIMIT,
        },
      });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: String(e) });
    }
  }

  // ---- 临时诊断：真实跑一次抓取，直接看 VPS 抓取登录态是否有效（排查「没抓到」根因）----
  // 用法：浏览器打开 /api/_debug-scrape?kw=美术考研  （会真实抓一次，约 10~55 秒）
  if (pathname === '/api/_debug-scrape') {
    const kw = (url.searchParams.get('kw') || '测试').slice(0, 40);
    const collector = (process.env.COLLECTOR_URL || '').trim().replace(/\/+$/, '');
    try {
      if (collector) {
        const cr = await fetch(collector + '/collect', {
          method: 'POST', signal: AbortSignal.timeout(58000),
          headers: { 'content-type': 'application/json', 'x-collector-token': process.env.COLLECTOR_TOKEN || '' },
          body: JSON.stringify({ keyword: kw, sort: 'popular', type: 'all', page: 1 }),
        });
        const txt = await cr.text();
        let parsed = null; try { parsed = JSON.parse(txt); } catch {}
        return sendJSON(res, 200, { ok: true, via: 'collector', httpStatus: cr.status, noteCount: parsed && parsed.notes ? parsed.notes.length : 0, sample: txt.slice(0, 400) });
      }
      const { execFile } = require('child_process');
      const env = { ...process.env, PATH: (process.env.PATH || '') + ':' + (process.env.HOME || '') + '/.local/bin:/usr/local/bin' };
      const out = await new Promise((resolve) => {
        execFile('xhs', ['search', kw, '--sort', 'popular', '--type', 'all', '--page', '1', '--json'], { timeout: 55000, maxBuffer: 12 * 1024 * 1024, env }, (err, so, se) => {
          resolve({ err: err ? (se || err.message || '').toString() : '', so: so || '' });
        });
      });
      let parsed = null; try { parsed = JSON.parse(out.so); } catch {}
      const items = parsed ? ((parsed.data && parsed.data.items) || parsed.items || []) : [];
      return sendJSON(res, 200, { ok: true, via: 'local-xhs-cli', noteCount: items.length, errTail: out.err.slice(0, 400), sample: out.so.slice(0, 300) });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, via: collector ? 'collector' : 'local-xhs-cli', error: String(e).slice(0, 400) });
    }
  }

  // ---- 帮助/规则知识库（公开读；后台维护后这里返回最新，前端无覆盖则用静态 help-kb.js）----
  if (pathname === '/api/help-kb' && req.method === 'GET') {
    const kb = billing ? billing.kbGet() : {};
    return sendJSON(res, 200, { ok: true, rules: kb.rules || null, docs: kb.docs || null, faq: kb.faq || null, updated_at: kb.updated_at || 0 });
  }

  // ---- 图片代理：把第三方图床的图变成同源（解决跨域显示 + 导出 PNG）----
  if (pathname === '/api/img-proxy' && req.method === 'GET') {
    const u = url.searchParams.get('u');
    if (!u || !/^https?:\/\//i.test(u)) return send(res, 400, 'missing or bad url');
    try {
      const up = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
      if (!up.ok) return send(res, 502, 'proxy failed: upstream ' + up.status);
      const buf = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'image/png', 'cache-control': 'public, max-age=3600' });
      res.end(buf);
    } catch (err) { send(res, 502, 'proxy failed: ' + (err.message || String(err))); }
    return;
  }

  // ---- 获客 Agent · 脚本（朱砂助手插件）下载：把 extension 目录现打成 zip 给已登录客户下载 ----
  // 插件查最新版本号（公开，无需登录）：插件后台定时拉这个跟自己 manifest 版本比，有新版就提醒
  if (pathname === '/api/ext-version' && req.method === 'GET') {
    let version = '', name = '';
    try { const mf = JSON.parse(fs.readFileSync(path.join(__dirname, 'extension', 'manifest.json'), 'utf8')); version = mf.version || ''; name = mf.name || ''; } catch {}
    return sendJSON(res, 200, { ok: true, version, name, download: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') + '/api/ext-download' });
  }
  if (pathname === '/api/ext-download' && req.method === 'GET') {
    if (!authUid(req)) return send(res, 401, '请先登录', { 'content-type': 'text/plain; charset=utf-8' });
    const extDir = path.join(__dirname, 'extension');
    try {
      // 纯 Node 打 zip（不依赖系统 zip 命令）：递归收集 extension/ 下所有文件 → deflate → 拼 ZIP
      const files = [];
      (function walk(dir, rel) {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name), r = rel ? rel + '/' + name : name;
          const stt = fs.statSync(full);
          if (stt.isDirectory()) walk(full, r);
          else files.push({ name: r, data: fs.readFileSync(full) });
        }
      })(extDir, '');
      const buf = makeZip(files);
      res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="zhusha-helper-extension.zip"', 'content-length': buf.length });
      return res.end(buf);
    } catch (err) {
      return send(res, 500, '打包失败：' + (err.message || String(err)), { 'content-type': 'text/plain; charset=utf-8' });
    }
  }

  // ---- 图像生成：多家适配（封面=Seedream/ark，内页=可灵/kling，其余=CogView/SiliconFlow/OpenAI）----
  if (pathname === '/api/image' && req.method === 'POST') {
    try {
      const reqBody = JSON.parse((await readBody(req)) || '{}');
      let { prompt, size } = reqBody;
      if (!prompt) return send(res, 400, JSON.stringify({ error: '缺少 prompt' }), { 'content-type': 'application/json' });
      prompt = String(prompt).slice(0, 2400); // 统一上限：图像提示词不必超长，且可灵硬上限 2500，防 "size must be between 0 and 2500"
      // 供应商：前端可按图指定（封面 gptimage、内页 kling），否则用 .env 默认
      const provider = (reqBody.provider || process.env.IMAGE_PROVIDER || 'zhipu').toLowerCase();
      let ikey, model;
      if (provider === 'ark') { ikey = process.env.SEEDREAM_API_KEY || ''; model = reqBody.model || process.env.SEEDREAM_MODEL || 'doubao-seedream-3-0-t2i-250415'; }
      else if (provider === 'gptimage') { ikey = process.env.GPT_IMAGE_API_KEY || ''; model = reqBody.model || process.env.GPT_IMAGE_MODEL || 'gpt-image-1'; }
      else if (provider === 'kling') { ikey = 'jwt'; model = process.env.KLING_MODEL || 'kling-v1'; }
      else { ikey = process.env.IMAGE_API_KEY || process.env.ZHIPU_API_KEY || ''; model = reqBody.model || process.env.IMAGE_MODEL || process.env.ZHIPU_IMAGE_MODEL || 'cogview-3-flash'; }
      if (provider === 'kling' && (!process.env.KLING_ACCESS_KEY || !process.env.KLING_SECRET_KEY)) return send(res, 500, JSON.stringify({ error: '未配置 KLING_ACCESS_KEY/SECRET_KEY' }), { 'content-type': 'application/json' });
      if (provider !== 'kling' && !ikey) return send(res, 500, JSON.stringify({ error: '未配置该图像供应商的 key（provider=' + provider + '）' }), { 'content-type': 'application/json' });
      if (provider !== 'kling' && !/^[\x20-\x7E]+$/.test(ikey)) return send(res, 500, JSON.stringify({ error: 'GPT_IMAGE_API_KEY 包含非法字符，请检查 .env 文件——填的是中文占位符而非真实 key，请用 sudo nano /opt/zhusha/.env 改成真实 key 后重启服务。' }), { 'content-type': 'application/json' });

      // 三档计价：premium（Seedream/顶级）> hd（可灵/cogview-4/FLUX/Kolors）> std（flash）
      const isPremium = provider === 'ark' || provider === 'gptimage' || /gpt-image|dall-?e|imagen|seedream|flux\.1-pro|midjourney/i.test(model) || reqBody.tier === 'premium';
      const isHd = !isPremium && (provider === 'kling' || /cogview-4|flux\.1-dev|kolors/i.test(model) || reqBody.hd === true);
      const imgKey = isPremium ? 'image_premium' : isHd ? 'image_hd' : 'image_std';
      const imgDef = isPremium ? 30 : isHd ? 12 : 5;
      const gate = billingGate(req, res, imgKey, imgDef, 1);
      if (!gate) return;

      let outUrl = '';
      if (provider === 'kling') {
        // 可灵：异步出图（JWT + 轮询）
        try { outUrl = await klingGenerate(prompt, '3:4'); }
        catch (e) { return send(res, 502, JSON.stringify({ error: '可灵出图失败：' + (e.message || String(e)) }), { 'content-type': 'application/json' }); }
      } else if (provider === 'gptimage') {
        // OpenAI gpt-image-1：有参考图(init_image/ref_image) → /images/edits 真·图生图，否则 /images/generations 文生图
        const base = process.env.GPT_IMAGE_BASE_URL || 'https://api.openai.com/v1';
        const allowedSizes = ['1024x1024', '1024x1536', '1536x1024'];
        const gptSize = allowedSizes.includes(size) ? size : (process.env.GPT_IMAGE_SIZE && allowedSizes.includes(process.env.GPT_IMAGE_SIZE) ? process.env.GPT_IMAGE_SIZE : '1024x1536');
        let refImg = reqBody.init_image || reqBody.ref_image || '';
        if (refImg && /^https?:\/\//i.test(refImg)) {
          try {
            const ir = await fetch(refImg, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0', 'referer': 'https://www.xiaohongshu.com/' } });
            if (ir.ok) { const ct = ir.headers.get('content-type') || 'image/jpeg'; refImg = 'data:' + ct + ';base64,' + Buffer.from(await ir.arrayBuffer()).toString('base64'); }
            else refImg = '';
          } catch { refImg = ''; }
        }
        let up, text;
        const m = refImg && /^data:(.+?);base64,(.*)$/.exec(refImg);
        if (m) {
          const fd = new FormData();
          fd.append('model', model);
          fd.append('prompt', prompt);
          fd.append('size', gptSize);
          fd.append('image', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] || 'image/png' }), 'ref.png');
          up = await fetch(base + '/images/edits', { signal: AbortSignal.timeout(150000), method: 'POST', headers: { authorization: 'Bearer ' + ikey }, body: fd });
        } else {
          up = await fetch(base + '/images/generations', { signal: AbortSignal.timeout(150000), method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ikey }, body: JSON.stringify({ model, prompt, size: gptSize, n: 1 }) });
        }
        text = await up.text();
        if (!up.ok) return send(res, up.status, text, { 'content-type': 'application/json' });
        try {
          const j = JSON.parse(text);
          const d = j.data && j.data[0];
          if (d && d.url) outUrl = d.url;
          else if (d && d.b64_json) {
            // gpt-image 多返回 b64（无 url）。整段 base64 塞进前端 localStorage 草稿(ag_draft)会超 ~5MB 配额报错，
            // 因此服务端把它落地成静态文件、只回短链 /gen/xxx.png，前端只存链接，彻底避开配额问题。
            try {
              const genDir = path.join(__dirname, 'gen');
              if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
              const fn = 'img' + Date.now() + Math.random().toString(36).slice(2, 8) + '.png';
              fs.writeFileSync(path.join(genDir, fn), Buffer.from(d.b64_json, 'base64'));
              // 返回绝对地址（PUBLIC_BASE_URL）→ 一键发布(发给插件)、合规自检(img-proxy 只认 http)、导出 都能正确取到；没配则退回相对路径
              const pubBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
              outUrl = pubBase + '/gen/' + fn;
            } catch (e) { outUrl = 'data:image/png;base64,' + d.b64_json; } // 落地失败兜底，仍可显示
          }
        } catch {}
        if (!outUrl) return send(res, 502, JSON.stringify({ error: '上游未返回图片：' + text.slice(0, 200) }), { 'content-type': 'application/json' });
      } else {
        // 统一竖版 3:4（各家合法尺寸不同）
        const RATIO_3x4 = { siliconflow: '768x1024', openai: '1024x1024', zhipu: '864x1152', ark: '864x1152' };
        const sz = size || process.env.IMAGE_SIZE || RATIO_3x4[provider] || '864x1152';
        let url, body;
        if (provider === 'ark') { // 火山方舟 Seedream（注意：自定义尺寸需 ≥3.6M 像素，用 SEEDREAM_SIZE 的 3:4 大图）
          url = (process.env.SEEDREAM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3') + '/images/generations';
          let refImg = reqBody.init_image || reqBody.ref_image || ''; // 参考图（URL 或 data:base64）→ 走 SeedEdit 真·图生图
          // 是 http(s) 链接（如对标原图走小红书 CDN，有防盗链）→ 服务端带 referer 抓下来转 base64，更稳；取不到就退回文生图
          if (refImg && /^https?:\/\//i.test(refImg)) {
            try {
              const ir = await fetch(refImg, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Mozilla/5.0', 'referer': 'https://www.xiaohongshu.com/' } });
              if (ir.ok) { const ct = ir.headers.get('content-type') || 'image/jpeg'; refImg = 'data:' + ct + ';base64,' + Buffer.from(await ir.arrayBuffer()).toString('base64'); }
              else refImg = '';
            } catch { refImg = ''; }
          }
          if (refImg) {
            // 真·图生图：优先用单独配的 SeedEdit 模型；未配则复用现有 Seedream 模型（5.0+ 支持传 image 做 i2i）
            const editModel = reqBody.editModel || process.env.SEEDEDIT_MODEL || process.env.SEEDREAM_MODEL || model;
            body = { model: editModel, prompt, image: refImg, response_format: 'url', size: size || process.env.SEEDREAM_SIZE || '2k', watermark: false };
          } else {
            body = { model, prompt, size: size || process.env.SEEDREAM_SIZE || '1728x2304', sequential_image_generation: 'disabled', response_format: 'url', stream: false, watermark: false };
          }
        } else if (provider === 'siliconflow') {
          url = (process.env.IMAGE_BASE_URL || 'https://api.siliconflow.cn/v1') + '/images/generations';
          body = { model, prompt, image_size: sz, batch_size: 1 };
        } else if (provider === 'openai') {
          url = (process.env.IMAGE_BASE_URL || 'https://api.openai.com/v1') + '/images/generations';
          body = { model, prompt, size: sz, n: 1 };
        } else { // zhipu CogView
          url = (process.env.IMAGE_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4') + '/images/generations';
          body = { model, prompt, size: sz };
        }
        let up = await fetch(url, { signal: AbortSignal.timeout(90000), method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + ikey }, body: JSON.stringify(body) });
        let text = await up.text();
        // ark 图生图(i2i)失败（如 SeedEdit 模型未开通/不支持 image 入参）→ 自动退回文生图，保证能出图
        if (!up.ok && provider === 'ark' && (reqBody.init_image || reqBody.ref_image)) {
          const t2iBody = { model, prompt, size: size || process.env.SEEDREAM_SIZE || '1728x2304', sequential_image_generation: 'disabled', response_format: 'url', stream: false, watermark: false };
          up = await fetch(url, { signal: AbortSignal.timeout(90000), method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + ikey }, body: JSON.stringify(t2iBody) });
          text = await up.text();
        }
        if (!up.ok) return send(res, up.status, text, { 'content-type': 'application/json' });
        try {
          const j = JSON.parse(text);
          outUrl = (j.data && j.data[0] && (j.data[0].url || j.data[0].b64_json && ('data:image/png;base64,' + j.data[0].b64_json)))
            || (j.images && j.images[0] && (j.images[0].url || j.images[0])) || '';
        } catch {}
        if (!outUrl) return send(res, 502, JSON.stringify({ error: '上游未返回图片 URL：' + text.slice(0, 200) }), { 'content-type': 'application/json' });
      }
      // 出图成功才扣（失败已 return）
      if (gate.uid && gate.cost) billing.deduct(gate.uid, gate.cost, 'usage', null, { action: imgKey, model, provider }, reqBody.request_id);
      return send(res, 200, JSON.stringify({ data: [{ url: outUrl }], balance: gate.uid ? billing.getBalance(gate.uid) : undefined }), { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 502, JSON.stringify({ error: '图像生成失败：' + (err.message || String(err)) }), { 'content-type': 'application/json' });
    }
  }

  // ---- 视觉解析：用智谱 GLM-4V 看图，返回中文描述（对标封面/配图）----
  if (pathname === '/api/vision' && req.method === 'POST') {
    const zkey = process.env.ZHIPU_API_KEY || '';
    if (!zkey) return send(res, 200, JSON.stringify({ ok: false, error: '未配置 ZHIPU_API_KEY（视觉解析用智谱）' }), { 'content-type': 'application/json' });
    try {
      const { imageUrl, prompt } = JSON.parse((await readBody(req)) || '{}');
      if (!imageUrl) return send(res, 400, JSON.stringify({ ok: false, error: '缺少 imageUrl' }), { 'content-type': 'application/json' });
      let dataUrl;
      if (/^data:image\//i.test(imageUrl)) {
        // 前端上传的对标图（base64）：直接用，不再取图（最稳，避开防盗链/403）
        if (imageUrl.length > 9 * 1024 * 1024) return send(res, 200, JSON.stringify({ ok: false, error: '图片过大，请压缩后再传' }), { 'content-type': 'application/json' });
        dataUrl = imageUrl;
      } else {
        // 远程图：服务端取图转 base64（避免图床防盗链 / 智谱取不到）
        const ir = await fetch(imageUrl, { headers: { 'user-agent': 'Mozilla/5.0', 'referer': 'https://www.xiaohongshu.com/' } });
        if (!ir.ok) return send(res, 200, JSON.stringify({ ok: false, error: '取图失败 HTTP ' + ir.status }), { 'content-type': 'application/json' });
        const ab = await ir.arrayBuffer();
        if (ab.byteLength > 6 * 1024 * 1024) return send(res, 200, JSON.stringify({ ok: false, error: '图片过大，跳过视觉解析' }), { 'content-type': 'application/json' });
        const ct = ir.headers.get('content-type') || 'image/jpeg';
        dataUrl = `data:${ct};base64,${Buffer.from(ab).toString('base64')}`;
      }
      const up = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + zkey },
        body: JSON.stringify({
          model: process.env.ZHIPU_VISION_MODEL || 'glm-4v-flash',
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt || '用中文简洁描述这张小红书封面/配图：主体内容、画面元素、文字排版与主标题、风格与配色、构图特点。120字内。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] }],
        }),
      });
      const text = await up.text();
      if (!up.ok) return send(res, 200, JSON.stringify({ ok: false, error: '视觉模型报错：' + text.slice(0, 160) }), { 'content-type': 'application/json' });
      let desc = ''; try { const j = JSON.parse(text); desc = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || ''; } catch {}
      return send(res, 200, JSON.stringify({ ok: !!desc, desc }), { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 200, JSON.stringify({ ok: false, error: '视觉解析失败：' + (err.message || String(err)) }), { 'content-type': 'application/json' });
    }
  }

  // ---- 代理：转发到 Anthropic ----
  if (pathname === '/api/claude' && req.method === 'POST') {
    if (!API_KEY) {
      return send(res, 500, JSON.stringify({ error: '服务端未配置 ANTHROPIC_API_KEY。请在 .env 写入后重启。' }),
        { 'content-type': 'application/json' });
    }
    // 先解析 body 拿 action，再按动作分步计价（选题/拆解/框架/正文/规则/质检… 各不同价）
    let payload; try { payload = JSON.parse((await readBody(req)) || '{}'); } catch { payload = {}; }
    const action = (typeof payload.action === 'string' && payload.action) ? payload.action : 'text';
    const gate = billingGate(req, res, action, 4, 1);
    if (!gate) return;
    // A9 问答日志：规则查询 Agent 的提问留痕（管理端「问答日志/高频问题」）
    const qaQuestion = action === 'rule_query'
      ? String(((payload.messages || []).filter(m => m && m.role === 'user').pop() || {}).content || '').slice(0, 200)
      : null;
    try {
      const model = FORCE_MODEL || payload.model || (API_FORMAT === 'openai' ? 'deepseek-chat' : 'claude-opus-4-8');
      let upUrl, headers, body;

      if (API_FORMAT === 'openai') {
        // OpenAI 兼容：system 拼进 messages 首条，调用 /chat/completions
        upUrl = `${API_BASE}/chat/completions`;
        headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + API_KEY };
        body = {
          model, max_tokens: payload.max_tokens || 2000,
          messages: [
            ...(payload.system ? [{ role: 'system', content: payload.system }] : []),
            ...(payload.messages || []),
          ],
        };
        // 强制合法 JSON 输出（DeepSeek/智谱等 OpenAI 兼容支持），避免长文本里未转义引号导致解析失败
        if (payload.json) body.response_format = { type: 'json_object' };
      } else {
        // Anthropic 原生：/v1/messages
        upUrl = `${API_BASE}/v1/messages`;
        headers = { 'content-type': 'application/json', 'anthropic-version': API_VERSION };
        if (AUTH_STYLE === 'bearer') headers['authorization'] = 'Bearer ' + API_KEY;
        else headers['x-api-key'] = API_KEY;
        body = { model, max_tokens: payload.max_tokens || 2000, system: payload.system || '', messages: payload.messages || [] };
      }

      const up = await fetch(upUrl, { method: 'POST', headers, body: JSON.stringify(body) });
      const text = await up.text();

      if (API_FORMAT === 'openai') {
        // 把 OpenAI 响应映射成前端期望的 Anthropic 形状 {content:[{text}]}
        if (!up.ok) return send(res, up.status, text, { 'content-type': 'application/json' });
        try {
          const j = JSON.parse(text);
          const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
          if (gate.uid && gate.cost) billing.deduct(gate.uid, gate.cost, 'usage', null, { action, model }, payload.request_id);
          if (qaQuestion) try { billing.qaLogAdd(gate.uid, qaQuestion, String(content)); } catch {}
          return send(res, 200, JSON.stringify({ content: [{ type: 'text', text: content }], model: j.model, balance: gate.uid ? billing.getBalance(gate.uid) : undefined }), { 'content-type': 'application/json' });
        } catch {
          return send(res, 502, JSON.stringify({ error: '上游返回非 JSON：' + text.slice(0, 200) }), { 'content-type': 'application/json' });
        }
      }
      if (up.ok && gate.uid && gate.cost) billing.deduct(gate.uid, gate.cost, 'usage', null, { action, model }, payload.request_id);
      if (up.ok && qaQuestion) { let a = ''; try { a = (JSON.parse(text).content || []).map(b => b.text || '').join(''); } catch {} try { billing.qaLogAdd(gate.uid, qaQuestion, a); } catch {} }
      return send(res, up.status, text, { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 502, JSON.stringify({ error: '代理转发失败：' + (err.message || String(err)) }),
        { 'content-type': 'application/json' });
    }
  }

  // 复用上游模型调用（system + 单轮 user），返回纯文本；供拟人评论生成等内部用途
  async function llmComplete(system, user, maxTokens) {
    if (!API_KEY) throw new Error('未配置 ANTHROPIC_API_KEY');
    const model = FORCE_MODEL || (API_FORMAT === 'openai' ? 'deepseek-chat' : 'claude-opus-4-8');
    let upUrl, headers, body;
    if (API_FORMAT === 'openai') {
      upUrl = `${API_BASE}/chat/completions`;
      headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + API_KEY };
      body = { model, max_tokens: maxTokens || 200, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }] };
    } else {
      upUrl = `${API_BASE}/v1/messages`;
      headers = { 'content-type': 'application/json', 'anthropic-version': API_VERSION };
      if (AUTH_STYLE === 'bearer') headers['authorization'] = 'Bearer ' + API_KEY; else headers['x-api-key'] = API_KEY;
      body = { model, max_tokens: maxTokens || 200, system: system || '', messages: [{ role: 'user', content: user }] };
    }
    const up = await fetch(upUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await up.text();
    if (!up.ok) throw new Error('上游 ' + up.status + '：' + text.slice(0, 160));
    const j = JSON.parse(text);
    if (API_FORMAT === 'openai') return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return (j.content || []).map(b => b.text || '').join('').trim();
  }

  // 拟人评论生成：按智能体人设 + 笔记/评论上下文，生成自然、合规的引流回复/评论（执行端 token 或 cookie 均可调）
  if (pathname === '/api/gen-comment' && req.method === 'POST') {
    const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req);
    if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
    if (!API_KEY) return sendJSON(res, 500, { error: '服务端未配置 ANTHROPIC_API_KEY' });
    const b = JSON.parse((await readBody(req)) || '{}');
    const persona = String(b.persona || '一个真诚分享的小红书博主').slice(0, 1200);
    const scene = b.scene === 'reply' ? '回复评论区某用户的评论' : (b.scene === 'intercept' ? '在同行笔记评论区发一条自然的引流评论' : '在自己笔记下回复读者');
    const noteTitle = String(b.noteTitle || '').slice(0, 120);
    const noteText = String(b.noteText || '').slice(0, 800);
    const userComment = String(b.userComment || '').slice(0, 300);
    const system = `你是${persona}。任务：${scene}。要求：像真人随手打的，口语化、20字以内最佳，最多40字；不硬广、不留微信/QQ/电话/链接、不出现"加我/私我"等违规词；可用1个自然的emoji或不用；只输出评论正文，不要引号、不要解释。`;
    const user = `笔记标题：${noteTitle || '(无)'}\n笔记内容：${noteText || '(无)'}\n${userComment ? '对方评论：' + userComment + '\n' : ''}请直接给出这条评论：`;
    try {
      // 计费按解析出的 uid（cookie 或设备 token 都能扣到本人账户）
      const cost = BILLING_ENABLED ? billing.getPrice('comment', 1) : 0;
      if (BILLING_ENABLED && billing.getBalance(uid) < cost) return sendJSON(res, 402, { error: '积分不足，请充值', code: 'INSUFFICIENT', need: cost });
      let out = (await llmComplete(system, user, 120)).replace(/^["「『]|["」』]$/g, '').trim();
      // 合规兜底：剔除明显违规联系方式
      out = out.replace(/(微信|VX|vx|weixin|加我|私我|电话|手机号|\+?\d{6,})/g, '').trim();
      if (BILLING_ENABLED && cost) billing.deduct(uid, cost, 'usage', null, { action: 'comment' });
      return sendJSON(res, 200, { ok: true, comment: out || '写得真好，学到了～', balance: BILLING_ENABLED ? billing.getBalance(uid) : undefined });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, error: '生成失败：' + (e.message || '').slice(0, 120) });
    }
  }

  // ---- 知识库文件解析：Word/Excel/PPT/PDF/CSV/MD → 纯文本 ----
  if (pathname === '/api/extract' && req.method === 'POST') {
    const MAX_UPLOAD = 60 * 1024 * 1024; // 60MB
    const clen = parseInt(req.headers['content-length'] || '0', 10);
    if (clen && clen > MAX_UPLOAD) {
      return send(res, 200, JSON.stringify({ ok: false, error: '文件过大（约 ' + Math.round(clen / 1048576) + 'MB，上限 60MB）。请压缩、删图或拆分后再传。' }), { 'content-type': 'application/json' });
    }
    try {
      const buf = await readBodyBuffer(req, MAX_UPLOAD);
      const name = decodeURIComponent((req.headers['x-filename'] || 'file').toString());
      const ext = (name.split('.').pop() || '').toLowerCase();
      let text = '';
      let imageCount = 0;
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
        // 图片：直接用 GLM-4V 把图里的文字/信息识别成知识库文本
        if (!process.env.ZHIPU_API_KEY) return send(res, 200, JSON.stringify({ ok: false, error: '未配置 ZHIPU_API_KEY，无法识别图片文字' }), { 'content-type': 'application/json' });
        if (buf.length > 6 * 1024 * 1024) return send(res, 200, JSON.stringify({ ok: false, error: '图片过大（上限 6MB），请压缩后再传' }), { 'content-type': 'application/json' });
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        const dataUrl = `data:image/${mime};base64,${buf.toString('base64')}`;
        const d = await glmVision(dataUrl, '识别这张图片，用于建知识库：① 图中所有文字逐字照抄（标题/表格/标注/数字/对话；没有文字写「无文字」）；② 图表/示意/流程/截图的内容与关键信息。中文，尽量完整。');
        text = d || '';
        if (!text) return send(res, 200, JSON.stringify({ ok: false, error: '图片未识别出内容，换一张更清晰的试试' }), { 'content-type': 'application/json' });
        imageCount = 1;
        return send(res, 200, JSON.stringify({ ok: true, name, ext, chars: text.length, imageCount, text: text.slice(0, 60000) }), { 'content-type': 'application/json' });
      } else if (['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'log'].includes(ext)) {
        text = buf.toString('utf8');
      } else if (['ppt', 'doc', 'xls'].includes(ext)) {
        return send(res, 200, JSON.stringify({ ok: false, error: '旧版 .' + ext + ' 暂不支持解析。请用 PowerPoint / Word / Excel 或 WPS 打开后「另存为」新版 .' + ext + 'x 再上传。' }), { 'content-type': 'application/json' });
      } else if (['docx', 'xlsx', 'pptx', 'pdf', 'odt', 'odp', 'ods'].includes(ext)) {
        let officeParser;
        try { officeParser = require('officeparser'); }
        catch { return send(res, 200, JSON.stringify({ ok: false, error: '服务端未安装 officeparser，无法解析 .' + ext + '。请在项目目录运行 npm install 后重启，或改用 md/csv/txt。' }), { 'content-type': 'application/json' }); }
        text = await officeParser.parseOfficeAsync(buf);
      } else {
        text = buf.toString('utf8'); // 兜底当文本
      }
      text = (text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

      // docx/pptx 内嵌图片：officeparser 只取文字、丢图。这里把图抠出来用 GLM-4V 识别 → 并入知识库文本
      if (['docx', 'pptx'].includes(ext) && process.env.ZHIPU_API_KEY) {
        try {
          const media = unzipMedia(buf).slice(0, 8); // 最多识别前 8 张，控耗时
          const descs = [];
          for (let i = 0; i < media.length; i++) {
            const m = media[i];
            if (m.data.length > 6 * 1024 * 1024) continue;
            const mime = m.ext === 'jpg' ? 'jpeg' : m.ext;
            const dataUrl = `data:image/${mime};base64,${m.data.toString('base64')}`;
            const d = await glmVision(dataUrl, '识别这张文档插图，用于建知识库：① 图中所有文字逐字照抄（标题/表格/标注/数字；没有文字写「无文字」）；② 图表/示意/流程的内容与关键信息。中文，150字内。');
            if (d) { descs.push(`【图${descs.length + 1}】${d}`); imageCount++; }
          }
          if (descs.length) text += '\n\n—— 文档内嵌图片（AI 视觉识别，已并入知识库）——\n' + descs.join('\n');
        } catch { /* 图片识别失败不影响正文 */ }
      }
      return send(res, 200, JSON.stringify({ ok: true, name, ext, chars: text.length, imageCount, text: text.slice(0, 60000) }), { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 200, JSON.stringify({ ok: false, error: '解析失败：' + (err.message || String(err)) }), { 'content-type': 'application/json' });
    }
  }

  // ---- 真实艺术热点：从公开热榜聚合接口取回，过滤出与艺术/美术相关的（尽力而为，绝不编造）----
  if (pathname === '/api/hot-art' && req.method === 'GET') {
    const wantArt = /^(1|true|yes)$/i.test(url.searchParams.get('art') || ''); // 仅美术考研赛道传 art=1
    // —— 通用平台热点（所有赛道）：微博直连 + vvhan（知乎/B站/抖音/百度）——
    const general = [];
    try {
      const r = await fetch('https://weibo.com/ajax/side/hotSearch', { headers: { 'user-agent': 'Mozilla/5.0', 'referer': 'https://weibo.com/', 'accept': 'application/json' } });
      if (r.ok) { const j = await r.json(); ((j.data && j.data.realtime) || []).forEach(x => general.push({ word: (x.word || x.note || '').trim(), hot: x.num || '', source: '微博' })); }
    } catch {}
    for (const s of [{ n: '知乎', u: 'https://api.vvhan.com/api/hotlist/zhihuHot' }, { n: 'B站', u: 'https://api.vvhan.com/api/hotlist/biliHot' }, { n: '抖音', u: 'https://api.vvhan.com/api/hotlist/douyinHot' }, { n: '百度', u: 'https://api.vvhan.com/api/hotlist/baiduRD' }]) {
      try { const r = await fetch(s.u, { headers: { 'user-agent': 'Mozilla/5.0' } }); if (!r.ok) continue; const j = await r.json(); (j.data || j.list || []).slice(0, 6).forEach(x => general.push({ word: (x.title || x.word || x.name || '').trim(), hot: x.hot || x.heat || '', source: s.n })); } catch {}
    }
    const seen = new Set(), gen = [];
    for (const x of general) { if (!x.word || seen.has(x.word)) continue; seen.add(x.word); gen.push({ word: x.word, hot: x.hot, source: x.source, art: false }); }

    if (!wantArt) { // 非美术考研赛道：只给通用平台热点
      return sendJSON(res, 200, { ok: gen.length > 0, mode: 'general', total: gen.length, hots: gen.slice(0, 10), note: gen.length ? '' : '热榜源暂时取不到，请稍后重试或手动填热点' }, { 'content-type': 'application/json' });
    }

    // —— 美术考研赛道：前 5 通用热点 + 其余艺术资讯 ——
    const artNews = [];
    if (!/^(0|false|off|no)$/i.test(process.env.ART_DIRECT || '1')) { try { (await fetchPaperArt()).forEach(x => artNews.push(x)); } catch {} }
    const RSSHUB = (process.env.RSSHUB_BASE || '').replace(/\/+$/, '');
    const FEEDS = (process.env.RSSHUB_ART_FEEDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (RSSHUB && FEEDS.length) { for (const p of FEEDS) { try { (await fetchRss(RSSHUB + (p.startsWith('/') ? p : '/' + p), 5)).forEach(x => artNews.push({ word: x.word, hot: '', source: '展讯', art: true, link: x.link || '' })); } catch {} } }
    const arts = [];
    for (const x of artNews) { if (!x.word || seen.has(x.word)) continue; seen.add(x.word); arts.push({ ...x, art: true }); }
    const hots = [...gen.slice(0, 5), ...arts]; // 前 5 通用 + 其余艺术
    return sendJSON(res, 200, { ok: (gen.length + arts.length) > 0, mode: 'art', total: gen.length, artCount: arts.length, hots, note: (gen.length + arts.length) ? '' : '源暂时取不到，请稍后重试或手动填热点' }, { 'content-type': 'application/json' });
  }

  // ---- 小红书搜索：抓搜索页，解析若干笔记（尽力而为，受反爬/登录墙限制）----
  if (pathname === '/api/search' && req.method === 'POST') {
    try {
      const { keyword } = JSON.parse((await readBody(req)) || '{}');
      if (!keyword) return send(res, 400, JSON.stringify({ ok: false, error: '缺少 keyword' }), { 'content-type': 'application/json' });
      const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword);
      // 线上(Render/容器)没有 xhs CLI 的登录态，直连搜索页会被登录墙挡住 → 注入小红书网页 Cookie 即可过墙。
      // 在 Render 环境变量里填 XHS_COOKIE（整段 document.cookie，含 web_session=…）。本地有 CLI 不依赖它。
      const xhsCookie = (process.env.XHS_COOKIE || '').trim();
      const hdr = {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9',
      };
      if (xhsCookie) hdr.cookie = xhsCookie;
      const r = await fetch(searchUrl, { redirect: 'follow', headers: hdr });
      const html = await r.text();
      let notes = [];
      const sIdx = html.indexOf('__INITIAL_STATE__');
      if (sIdx >= 0) {
        try {
          let js = html.slice(html.indexOf('=', sIdx) + 1);
          js = js.slice(0, js.indexOf('</script>')).trim().replace(/;\s*$/, '').replace(/:\s*undefined/g, ':null');
          const state = JSON.parse(js);
          const out = []; const seenIds = new Set();
          (function walk(o) {
            if (!o || typeof o !== 'object' || out.length >= 24) return;
            if (Array.isArray(o)) { for (const x of o) walk(x); return; }
            const nc = o.noteCard || o.note_card;
            if (nc && (o.id || nc.noteId || nc.note_id)) {
              const id = o.id || nc.noteId || nc.note_id;
              if (!seenIds.has(id)) {
                seenIds.add(id);
                const ii = nc.interactInfo || nc.interact_info || {};
                const u = nc.user || {};
                // 发布时间：搜索页通常没有；有才取（毫秒时间戳或字符串），绝不编造
                const ts = nc.time || nc.publishTime || nc.publish_time || o.time || 0;
                out.push({
                  id,
                  title: nc.displayTitle || nc.display_title || nc.title || '',
                  cover: (nc.cover && (nc.cover.urlDefault || nc.cover.url_default || nc.cover.url)) || '',
                  type: nc.type || '',
                  author: u.nickname || u.nickName || u.name || '',
                  userId: u.userId || u.userid || u.user_id || u.id || '',
                  avatar: u.avatar || u.images || '',
                  likes: ii.likedCount || ii.liked_count || '',
                  collects: ii.collectedCount || ii.collected_count || '',
                  comments: ii.commentCount || ii.comment_count || '',
                  shares: ii.sharedCount || ii.shared_count || '',
                  time: ts ? (typeof ts === 'number' ? ts : (Number(ts) || ts)) : '',
                  token: nc.xsecToken || o.xsecToken || nc.xsec_token || '',
                });
              }
              return;
            }
            for (const k in o) walk(o[k]);
          })(state);
          notes = out.slice(0, 20).map(n => ({
            ...n,
            link: 'https://www.xiaohongshu.com/explore/' + n.id + (n.token ? ('?xsec_token=' + n.token + '&xsec_source=pc_search') : ''),
            authorLink: n.userId ? ('https://www.xiaohongshu.com/user/profile/' + n.userId) : '',
          }));
        } catch (e) { /* 解析失败 */ }
      }
      return send(res, 200, JSON.stringify({ ok: notes.length > 0, notes, searchUrl }), { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 200, JSON.stringify({ ok: false, error: '搜索失败：' + (err.message || String(err)) }), { 'content-type': 'application/json' });
    }
  }

  // ---- 小红书搜索（走 agent-reach 的 xhs CLI，已登录，命中率高、字段全：点赞/收藏/评论/发布日期/博主主页）----
  if (pathname === '/api/xhs-search' && req.method === 'POST') {
    try {
      const { keyword, sort, type, page } = JSON.parse((await readBody(req)) || '{}');
      if (!keyword) return send(res, 400, JSON.stringify({ ok: false, error: '缺少 keyword' }), { 'content-type': 'application/json' });
      // 每用户每天抓取上限（保护共用小红书账号）。管理员/运营白名单免限额（自己测试不卡）
      const _uid = authUid(req);
      const _isAdmin = isAdminReq(req);
      if (!_isAdmin) {
        const _rl = xhsDailyCheck(_uid ? ('u' + _uid) : ('ip' + clientIp(req)));
        if (!_rl.ok) return send(res, 200, JSON.stringify({ ok: false, limited: true, error: `今日抓取已达上限（每天 ${_rl.limit} 次），明天再来～可先用已抓到的对标，或手动粘贴对标链接/上传对标图。` }), { 'content-type': 'application/json' });
        _rl.inc();
      }
      const sortOpt = ['general', 'popular', 'latest'].includes(sort) ? sort : 'popular';
      const typeOpt = ['all', 'video', 'image'].includes(type) ? type : 'all';
      const pageNum = Math.max(1, parseInt(page, 10) || 1);

      // 优先走「采集服务」：常开主机(VPS/本机)上跑 xhs CLI(扫码登录)，对外开 /collect。线上 Render 没装 CLI → 配 COLLECTOR_URL 即用它。
      const collector = (process.env.COLLECTOR_URL || '').trim().replace(/\/+$/, '');
      if (collector) {
        try {
          const cr = await fetch(collector + '/collect', {
            method: 'POST', signal: AbortSignal.timeout(55000),
            headers: { 'content-type': 'application/json', 'x-collector-token': process.env.COLLECTOR_TOKEN || '' },
            body: JSON.stringify({ keyword: String(keyword), sort: sortOpt, type: typeOpt, page: pageNum }),
          });
          const txt = await cr.text();
          if (!cr.ok) return send(res, 200, JSON.stringify({ ok: false, error: '采集服务 ' + cr.status + '：' + txt.slice(0, 200) }), { 'content-type': 'application/json' });
          return send(res, 200, txt, { 'content-type': 'application/json' }); // collector 直接返回 {ok,notes}
        } catch (e) {
          return send(res, 200, JSON.stringify({ ok: false, error: '采集服务不可达：' + (e.message || e) }), { 'content-type': 'application/json' });
        }
      }

      // 本地/自托管：直接调本机 xhs CLI
      const { execFile } = require('child_process');
      const env = { ...process.env, PATH: (process.env.PATH || '') + ':' + (process.env.HOME || '') + '/.local/bin:/usr/local/bin' };
      const stdout = await new Promise((resolve, reject) => {
        execFile('xhs', ['search', String(keyword), '--sort', sortOpt, '--type', typeOpt, '--page', String(pageNum), '--json'], { timeout: 50000, maxBuffer: 12 * 1024 * 1024, env }, (err, so, se) => {
          if (err && !so) return reject(new Error((se || err.message || '').toString().slice(0, 300)));
          resolve(so);
        });
      });
      let j; try { j = JSON.parse(stdout); } catch { return send(res, 200, JSON.stringify({ ok: false, error: 'xhs 返回非 JSON（可能未登录，请在终端跑 xhs login）' }), { 'content-type': 'application/json' }); }
      const items = (j.data && j.data.items) || j.items || [];
      const notes = items.filter(it => it && it.note_card).slice(0, 20).map(it => {
        const nc = it.note_card, u = nc.user || {}, ii = nc.interact_info || {};
        const pt = (nc.corner_tag_info || []).find(c => c.type === 'publish_time');
        return {
          id: it.id || '', token: it.xsec_token || '',
          title: nc.display_title || nc.title || '',
          cover: (nc.cover && (nc.cover.url_default || nc.cover.urlDefault || nc.cover.url)) || '',
          author: u.nickname || u.nick_name || '', userId: u.user_id || '', avatar: u.avatar || '',
          likes: ii.liked_count || '', collects: ii.collected_count || '', comments: ii.comment_count || '',
          date: pt ? pt.text : '',
          link: 'https://www.xiaohongshu.com/explore/' + (it.id || '') + (it.xsec_token ? ('?xsec_token=' + it.xsec_token + '&xsec_source=pc_search') : ''),
          authorLink: u.user_id ? ('https://www.xiaohongshu.com/user/profile/' + u.user_id) : '',
        };
      });
      return send(res, 200, JSON.stringify({ ok: notes.length > 0, notes }), { 'content-type': 'application/json' });
    } catch (err) {
      const m = (err.message || String(err));
      return send(res, 200, JSON.stringify({ ok: false, error: /ENOENT/.test(m) ? '未找到 xhs 命令（agent-reach 的小红书 CLI），请确认已安装' : ('xhs 搜索失败：' + m) }), { 'content-type': 'application/json' });
    }
  }

  // ---- 通用网页搜索（Exa）：实时检索小红书平台运营/商品/类目规则等。需 .env 填 EXA_API_KEY ----
  if (pathname === '/api/web-search' && req.method === 'POST') {
    const key = process.env.EXA_API_KEY || '';
    let body = {}; try { body = JSON.parse((await readBody(req)) || '{}'); } catch {}
    const q = String(body.q || '').slice(0, 200);
    if (!key) return send(res, 200, JSON.stringify({ ok: false, configured: false, error: '未配置 EXA_API_KEY（.env 填写后重启即可启用网页搜索）' }), { 'content-type': 'application/json' });
    if (!q) return send(res, 400, JSON.stringify({ ok: false, error: '缺少 q' }), { 'content-type': 'application/json' });
    try {
      const up = await fetch('https://api.exa.ai/search', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ query: q, numResults: 6, type: 'auto', contents: { text: { maxCharacters: 700 } } }),
      });
      const text = await up.text(); let j = {}; try { j = JSON.parse(text); } catch {}
      if (!up.ok) return send(res, 200, JSON.stringify({ ok: false, configured: true, error: 'Exa ' + up.status + '：' + String((j && j.error) || text).slice(0, 160) }), { 'content-type': 'application/json' });
      const results = (j.results || []).map(x => ({ title: x.title || '', url: x.url || '', snippet: String(x.text || '').replace(/\s+/g, ' ').trim().slice(0, 420), date: x.publishedDate || '' }));
      return send(res, 200, JSON.stringify({ ok: results.length > 0, configured: true, results }), { 'content-type': 'application/json' });
    } catch (e) { return send(res, 200, JSON.stringify({ ok: false, configured: true, error: '网页搜索失败：' + (e.message || e) }), { 'content-type': 'application/json' }); }
  }

  // ---- 抓取网页/GitHub 文本（供自定义 skill 引用）----
  if (pathname === '/api/fetch-url' && req.method === 'POST') {
    try {
      let { url } = JSON.parse((await readBody(req)) || '{}');
      if (!url || !/^https?:\/\//i.test(url)) return send(res, 400, JSON.stringify({ ok: false, error: '请提供有效链接（http/https）' }), { 'content-type': 'application/json' });
      // github 文件页 → raw；github 仓库根 → 取 README
      url = url.replace(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i, 'https://raw.githubusercontent.com/$1/$2/$3');
      const mRepo = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i);
      if (mRepo) url = `https://raw.githubusercontent.com/${mRepo[1]}/${mRepo[2]}/HEAD/README.md`;
      const r = await fetch(url, { redirect: 'follow', headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,*/*', 'accept-language': 'zh-CN,zh;q=0.9' } });
      let text = (await r.text()).replace(/\r\n/g, '\n');
      // 微信公众号文章：抽标题 + 正文区 → 纯文本。先删 script/style，再取 rich_media_content（取最靠后的真实容器）到底部标记
      if (/mp\.weixin\.qq\.com/i.test(url)) {
        // 公众号反爬：返回「环境异常/完成验证」页 → 抓取被拦
        if (/环境异常|完成验证后即可|访问过于频繁|去验证/.test(text) && !/rich_media_content|js_content/i.test(text)) {
          return send(res, 200, JSON.stringify({ ok: false, error: '公众号反爬拦截了本次抓取（环境异常验证页）。请在浏览器打开文章、复制正文文字粘贴到对标框。' }), { 'content-type': 'application/json' });
        }
        const title = ((text.match(/<h1[^>]*rich_media_title[^>]*>([\s\S]*?)<\/h1>/i) || text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
        const h = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
        let region = h;
        const ms = [...h.matchAll(/<div[^>]*(?:id="js_content"|class="[^"]*rich_media_content)[^>]*>/gi)];
        if (ms.length) region = h.slice(ms[ms.length - 1].index);
        region = region.split(/js_temp_bottom_area|rich_media_area_extra|rich_media_tool|js_profile_qrcode/i)[0];
        let body = region.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|section|div|h[1-6]|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
                   .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&#\d+;/g, '')
                   .replace(/预览时标签不可点/g, '').replace(/^.*微信扫一扫.*$/gm, '')
                   .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (body.length >= 60) {
          const clean = ((title ? title + '\n\n' : '') + body).trim();
          return send(res, 200, JSON.stringify({ ok: true, url, chars: clean.length, text: clean.slice(0, 20000) }), { 'content-type': 'application/json' });
        }
        return send(res, 200, JSON.stringify({ ok: false, error: '这篇公众号文章正文以图片为主（文字在图里），抓不到文字。请在浏览器打开文章、复制正文文字，粘贴到下面的对标框。' }), { 'content-type': 'application/json' });
      }
      // 普通网页(HTML) → 去 script/style/标签转纯文本，绝不把页面源码/JS 回吐；正文太少视为抓不到（如小红书等 JS 动态页）
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') || /^\s*<(?:!doctype|html)/i.test(text)) {
        let t = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
                    .replace(/<\/(p|div|section|article|li|h\d|br)>/gi, '\n').replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#\d+;/g, '')
                    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (t.length < 120) return send(res, 200, JSON.stringify({ ok: false, error: '这个页面是动态加载/无正文，抓不到文字（如小红书）。请直接复制文章正文粘贴。' }), { 'content-type': 'application/json' });
        return send(res, 200, JSON.stringify({ ok: true, url, chars: t.length, text: t.slice(0, 20000) }), { 'content-type': 'application/json' });
      }
      return send(res, 200, JSON.stringify({ ok: r.ok, url, chars: text.length, text: text.slice(0, 40000) }), { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 200, JSON.stringify({ ok: false, error: '抓取失败：' + (err.message || String(err)) }), { 'content-type': 'application/json' });
    }
  }

  // ---- 抓取小红书笔记正文（尽力而为：og 标签 / title）----
  if (pathname === '/api/fetch-note' && req.method === 'POST') {
    try {
      const { url } = JSON.parse((await readBody(req)) || '{}');
      if (!url || !/^https?:\/\//i.test(url)) {
        return send(res, 400, JSON.stringify({ ok: false, error: '请提供有效链接（http/https）' }), { 'content-type': 'application/json' });
      }
      const fnCookie = (process.env.XHS_COOKIE || '').trim(); // 线上带登录 Cookie，部分笔记详情页需要登录态才出正文/多图
      const fnHdr = {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9',
      };
      if (fnCookie) fnHdr.cookie = fnCookie;
      const r = await fetch(url, { redirect: 'follow', headers: fnHdr });
      const html = await r.text();
      const finalUrl = r.url || url;
      const pick = re => { const m = html.match(re); return m ? m[1] : ''; };
      const decode = s => (s || '')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

      let title = '', content = '', images = [], tags = [];

      // 1) 优先解析页面内嵌 __INITIAL_STATE__（含正文 / 多图 / 话题标签）
      const sIdx = html.indexOf('__INITIAL_STATE__');
      if (sIdx >= 0) {
        try {
          let js = html.slice(html.indexOf('=', sIdx) + 1);
          js = js.slice(0, js.indexOf('</script>')).trim().replace(/;\s*$/, '');
          js = js.replace(/:\s*undefined/g, ':null'); // 小红书会塞 undefined，先净化成合法 JSON
          const state = JSON.parse(js);
          const nd = state.note && state.note.noteDetailMap;
          const fid = state.note && (state.note.firstNoteId || (nd && Object.keys(nd)[0]));
          const note = nd && fid && nd[fid] && nd[fid].note;
          if (note) {
            title = (note.title || '').trim();
            content = (note.desc || '').trim();
            images = (note.imageList || []).map(im => im.urlDefault || im.urlPre || (im.infoList && im.infoList[0] && im.infoList[0].url) || '').filter(Boolean);
            tags = (note.tagList || []).map(t => t.name).filter(Boolean);
          }
        } catch (e) { /* 解析失败走 meta 兜底 */ }
      }

      // 2) 兜底：og / meta 标签
      if (!title) title = decode(pick(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i)
        || pick(/<title[^>]*>([^<]*)<\/title>/i)).replace(/\s*[-_|·]\s*小红书.*$/, '').trim();
      if (!content) content = decode(pick(/<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']*)["']/i)
        || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)).trim();
      if (!images.length) {
        const cover = pick(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']*)["']/i);
        if (cover) images = [decode(cover)];
      }
      if (!tags.length && content) { // 从正文里抠 #话题#
        const m = content.match(/#[^#\s\n]+/g);
        if (m) tags = m.map(x => x.replace(/^#/, '').trim()).filter(Boolean);
      }

      // 识别小红书拦截/失效页：标题或正文命中这些提示，说明链接过期(xsec_token失效)/需登录/被反爬，meta 兜底拿到的是错误页
      const blockRe = /(你访问的页面不见了|页面不见了|当前笔记暂时无法浏览|笔记不存在|内容不存在|访问异常|前往登录|请登录后查看|出错啦)/;
      if (blockRe.test(title) || blockRe.test(content) || (!content && /你访问的页面不见了|页面不见了/.test(title))) {
        return send(res, 200, JSON.stringify({ ok: false, finalUrl, error: '链接已失效或被拦截（小红书的 xsec_token 有效期很短/需登录）。请重新从 App「分享→复制链接」拿一条新链接，或直接把那篇笔记的「标题+正文」手动粘贴到下方框里。' }), { 'content-type': 'application/json' });
      }
      if (!title && !content && !images.length) {
        return send(res, 200, JSON.stringify({ ok: false, finalUrl, error: '未能从该链接抓到内容（小红书常需登录/有反爬，或为短链拦截页）。请改为手动粘贴。' }), { 'content-type': 'application/json' });
      }
      // 只抓到一张占位图、无正文无标签 → 多半也是拦截页，视为失败
      if (!content && tags.length === 0 && images.length <= 1 && /小红书/.test(title)) {
        return send(res, 200, JSON.stringify({ ok: false, finalUrl, error: '只抓到封面、拿不到正文（链接多半已失效或需登录）。请换一条新分享链接，或手动粘贴标题+正文。' }), { 'content-type': 'application/json' });
      }
      return send(res, 200, JSON.stringify({ ok: true, finalUrl, title, content, images: images.slice(0, 12), tags: tags.slice(0, 20) }), { 'content-type': 'application/json' });
    } catch (err) {
      return send(res, 200, JSON.stringify({ ok: false, error: '抓取失败：' + (err.message || String(err)) + '（可手动粘贴正文）' }), { 'content-type': 'application/json' });
    }
  }

  // 付费成品模板目录（公开：预览免登录、免计费；购买/已购走下方计费块）
  if (pathname === '/api/templates' && req.method === 'GET') {
    const cat = loadTemplates();
    return sendJSON(res, 200, { ok: true, price: cat.price || 120, templates: cat.templates || [] });
  }

  // ============ 账号 / 钱包 / 订单 / 支付 / 管理（计费）============
  if (pathname.startsWith('/api/auth/') || pathname === '/api/wallet' || pathname === '/api/price'
    || pathname.startsWith('/api/order') || pathname.startsWith('/api/pay/') || pathname.startsWith('/api/admin/')
    || pathname.startsWith('/api/history') || pathname.startsWith('/api/agent-config') || pathname === '/api/invite' || pathname.startsWith('/api/partner') || pathname.startsWith('/api/agent/') || pathname.startsWith('/api/template/') || pathname.startsWith('/api/accounts') || pathname.startsWith('/api/growth-plans') || pathname.startsWith('/api/script-libs') || pathname.startsWith('/api/collected-leads') || pathname.startsWith('/api/dispatch') || pathname.startsWith('/api/content-dispatch') || pathname === '/api/media-put' || pathname.startsWith('/api/devices') || pathname.startsWith('/api/note-stats')) {
    if (!billing) return sendJSON(res, 503, { error: '计费模块未启用（需 Node ≥ 22 的内置 node:sqlite）' });

    // 智能体配置（人设/KB/skills/配图风格，按账号存，跨设备）
    if (pathname === '/api/agent-config/all' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.agentConfigAll(uid) });
    }
    if (pathname === '/api/agent-config' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { trackId, config } = JSON.parse((await readBody(req)) || '{}');
      if (!trackId) return sendJSON(res, 400, { error: '缺少 trackId' });
      billing.agentConfigSave(uid, trackId, config || {});
      return sendJSON(res, 200, { ok: true });
    }

    // 获客 Agent · 社媒账号矩阵（按用户存）
    if (pathname === '/api/accounts' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.accountsList(uid) });
    }
    if (pathname === '/api/accounts' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const a = JSON.parse((await readBody(req)) || '{}');
      const id = billing.accountAdd(uid, a);
      return sendJSON(res, 200, { ok: true, id });
    }
    if (pathname === '/api/accounts/update' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id, patch } = JSON.parse((await readBody(req)) || '{}');
      if (!id) return sendJSON(res, 400, { error: '缺少 id' });
      return sendJSON(res, 200, { ok: billing.accountUpdate(uid, id, patch || {}) });
    }
    if (pathname === '/api/accounts/delete' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id } = JSON.parse((await readBody(req)) || '{}');
      if (!id) return sendJSON(res, 400, { error: '缺少 id' });
      return sendJSON(res, 200, { ok: billing.accountRemove(uid, id) });
    }
    // 检测小红书登录态（Playwright 用账号 cookie 访问小红书，验真伪 + 探测风控）
    if (pathname === '/api/accounts/reset-qr' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const n = billing.accountsResetQrAuth(uid);
      return sendJSON(res, 200, { ok: true, reset: n });
    }
    if (pathname === '/api/accounts/verify' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id } = JSON.parse((await readBody(req)) || '{}');
      const rec = id && billing.accountAuthBlob(uid, id);
      if (!rec) return sendJSON(res, 404, { error: '账号不存在' });
      let cookie = ''; try { const j = JSON.parse(rec.auth_blob || '{}'); cookie = j.cookie || ''; } catch { cookie = rec.auth_blob || ''; }
      if (!cookie) return sendJSON(res, 200, { ok: false, reason: '该账号还没接入登录态（先点「接入登录态」粘贴 cookie）' });
      let bot; try { bot = require('./xhs-bot'); } catch (e) { return sendJSON(res, 200, { ok: false, reason: '服务端未装 Playwright：' + (e.message || '').slice(0, 80) }); }
      const r = await bot.verifyLogin(cookie);
      // 只有「明确失效(invalid)」才标 expired；风控/超时/网络(uncertain) 一律不改状态，避免误杀好登录态。
      if (r.ok) billing.accountUpdate(uid, id, { status: 'active', health: '✓ ' + (r.nickname || '已登录') });
      else if (r.invalid) billing.accountUpdate(uid, id, { status: 'expired', health: r.reason || '失效' });
      // uncertain：保持原状态不动
      return sendJSON(res, 200, r);
    }
    // 扫码登录：出二维码（登录态在 VPS 本地生成，规避 cookie 跨 IP 失效）
    if (pathname === '/api/accounts/qr-start' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      let bot; try { bot = require('./xhs-bot'); } catch (e) { return sendJSON(res, 200, { ok: false, reason: '服务端未装 Playwright' }); }
      const r = await bot.startQrLogin();
      return sendJSON(res, 200, r);
    }
    if (pathname === '/api/accounts/qr-poll' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { token, id } = JSON.parse((await readBody(req)) || '{}');
      let bot; try { bot = require('./xhs-bot'); } catch (e) { return sendJSON(res, 200, { ok: false, reason: '未装 Playwright' }); }
      const r = await bot.pollQrLogin(token);
      if (r.ok && r.cookie && id) { billing.accountUpdate(uid, id, { auth_blob: JSON.stringify({ cookie: r.cookie, via: 'qr', ts: Date.now() }), status: 'active', health: '✓ 扫码登录' }); }
      return sendJSON(res, 200, r);
    }
    if (pathname === '/api/accounts/qr-sms-send' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { token, phone } = JSON.parse((await readBody(req)) || '{}');
      let bot; try { bot = require('./xhs-bot'); } catch (e) { return sendJSON(res, 200, { ok: false, reason: '未装 Playwright' }); }
      return sendJSON(res, 200, await bot.qrSendSms(token, phone || ''));
    }
    if (pathname === '/api/accounts/qr-sms-submit' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { token, code, id } = JSON.parse((await readBody(req)) || '{}');
      let bot; try { bot = require('./xhs-bot'); } catch (e) { return sendJSON(res, 200, { ok: false, reason: '未装 Playwright' }); }
      const r = await bot.qrSubmitSms(token, code);
      if (r.ok && r.cookie && id) { billing.accountUpdate(uid, id, { auth_blob: JSON.stringify({ cookie: r.cookie, via: 'qr-sms', ts: Date.now() }), status: 'active', health: '✓ 扫码+验证登录' }); }
      return sendJSON(res, 200, r);
    }
    // #2 住宅IP登录：插件/设备把本机已登录小红书的 cookie 回传，绕过机房 headless 风控（token 或 cookie 鉴权）
    if (pathname === '/api/accounts/submit-cookie' && req.method === 'POST') {
      const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.accountSubmitCookie(uid, b));
    }
    // 一键发布到小红书草稿箱（Playwright 驱动创作中心）
    if (pathname === '/api/accounts/publish' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id, content } = JSON.parse((await readBody(req)) || '{}');
      const rec = id && billing.accountAuthBlob(uid, id);
      if (!rec) return sendJSON(res, 404, { error: '账号不存在' });
      if (rec.platform !== 'xhs') return sendJSON(res, 200, { ok: false, msg: '目前仅支持小红书账号发布' });
      let cookie = ''; try { const j = JSON.parse(rec.auth_blob || '{}'); cookie = j.cookie || ''; } catch { cookie = rec.auth_blob || ''; }
      if (!cookie) return sendJSON(res, 200, { ok: false, msg: '该账号未接入登录态' });
      let bot; try { bot = require('./xhs-bot'); } catch (e) { return sendJSON(res, 200, { ok: false, msg: '服务端未装 Playwright' }); }
      const r = await bot.publishDraft(cookie, content || {});
      return sendJSON(res, 200, r);
    }

    // 获客 Agent · 养号/截流计划
    if (pathname === '/api/growth-plans' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.plansList(uid) });
    }
    if (pathname === '/api/growth-plans' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const p = JSON.parse((await readBody(req)) || '{}');
      if (p.id) { billing.planUpdate(uid, p.id, p); return sendJSON(res, 200, { ok: true, id: p.id }); }
      return sendJSON(res, 200, { ok: true, id: billing.planAdd(uid, p) });
    }
    if (pathname === '/api/growth-plans/delete' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id } = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.planRemove(uid, id) });
    }
    // 执行端跑完一轮上报统计（收集/回复/私信增量），用于任务列表统计列
    if (pathname === '/api/growth-plans/stat' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.planStat(uid, b.id || b.planId, b) });
    }
    // 多设备/多账号任务下发队列
    if (pathname === '/api/dispatch' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.dispatchList(uid, url.searchParams.get('plan')) });
    }
    if (pathname === '/api/dispatch' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.dispatchAdd(uid, b.planId, b.accounts || []));
    }
    if (pathname === '/api/dispatch/pull' && req.method === 'POST') {
      const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.dispatchPull(uid, b.device || (dev && (dev.name || dev.deviceKey))));
    }
    if (pathname === '/api/dispatch/done' && req.method === 'POST') {
      const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.dispatchDone(uid, b.id, b.result, { ok: b.ok, failed: b.failed, data: b.data }) });
    }
    // 执行端中途进度/数据回报（不结束任务）：progress / 结构化 data（浏览·赞·藏·评论·风控）
    if (pathname === '/api/dispatch/report' && req.method === 'POST') {
      const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.dispatchReport(uid, b.id, b) });
    }
    // 网页端手动闭环：done / failed / requeue（解决执行中永久卡死）
    if (pathname === '/api/dispatch/set' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.dispatchSet(uid, b.id, b.status) });
    }
    if (pathname === '/api/dispatch/cancel' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.dispatchCancel(uid, b.id) });
    }
    // 内容数据回流：执行端发布后抓回笔记真实数据（token 或 cookie），按 note_url 去重 upsert
    if (pathname === '/api/note-stats' && req.method === 'POST') {
      const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      const items = Array.isArray(b.list) ? b.list : [b];
      let n = 0; for (const it of items.slice(0, 100)) { if (billing.noteStatPut(uid, it).ok) n++; }
      return sendJSON(res, 200, { ok: true, saved: n });
    }
    if (pathname === '/api/note-stats' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.noteStatsList(uid) });
    }
    if (pathname === '/api/note-stats/remove' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.noteStatRemove(uid, b.id) });
    }

    // 内容分发：把一张 PNG(data URL) 落地成短链（复用 gen/ 静态目录），供分发任务存 URL 而非大体积 base64
    if (pathname === '/api/media-put' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      const m = String(b.png || '').match(/^data:image\/(\w+);base64,(.+)$/);
      if (!m) return sendJSON(res, 200, { ok: false, error: '需要 data:image/png;base64 数据' });
      try {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 4.5 * 1024 * 1024) return sendJSON(res, 200, { ok: false, error: '单图过大（上限 4.5MB）' });
        const genDir = path.join(__dirname, 'gen');
        if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const fn = 'cd' + Date.now() + Math.random().toString(36).slice(2, 8) + '.' + ext;
        fs.writeFileSync(path.join(genDir, fn), buf);
        const pubBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || ('https://' + (req.headers.host || 'yonglin.chat'));
        return sendJSON(res, 200, { ok: true, url: pubBase + '/gen/' + fn });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: '落地失败：' + (e.message || '').slice(0, 80) }); }
    }
    // 内容矩阵分发队列（一稿多发到各账号草稿箱）
    if (pathname === '/api/content-dispatch' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.cdispList(uid) });
    }
    if (pathname === '/api/content-dispatch' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.cdispAdd(uid, b.accounts || [], b.payload || {}));
    }
    if (pathname === '/api/content-dispatch/pull' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.cdispPull(uid, b.device));
    }
    if (pathname === '/api/content-dispatch/done' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.cdispDone(uid, b.id, b.result) });
    }
    if (pathname === '/api/content-dispatch/cancel' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.cdispCancel(uid, b.id) });
    }

    // 设备看板（agent 工作室）：心跳/列表/改名/指令/移除
    if (pathname === '/api/devices' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.devicesList(uid) });
    }
    if (pathname === '/api/devices/heartbeat' && req.method === 'POST') {
      const dev = authDevice(req); const uid = dev ? dev.uid : authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录或提供有效设备 token' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.deviceHeartbeat(uid, b.key || (dev && dev.deviceKey), { status: b.status, name: b.name || (dev && dev.name) }));
    }
    // 网页端为设备签发执行 token（真机/外部脚本拿去接入 pull/done/report/heartbeat）
    if (pathname === '/api/devices/token' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.deviceTokenIssue(uid, b.key, b.name));
    }
    if (pathname === '/api/devices/token/reset' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, billing.deviceTokenReset(uid, b.id));
    }
    if (pathname === '/api/devices/rename' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.deviceRename(uid, b.id, b.name) });
    }
    if (pathname === '/api/devices/cmd' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.deviceCmd(uid, b.id, b.cmd) });
    }
    if (pathname === '/api/devices/remove' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.deviceRemove(uid, b.id) });
    }

    // 获客 Agent · 话术库（问答库：标题 + 问答，单库≤1000 条）
    if (pathname === '/api/script-libs' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.scriptLibsList(uid) });
    }
    if (pathname === '/api/script-libs' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const p = JSON.parse((await readBody(req)) || '{}');
      if (p.id) { const ok = billing.scriptLibUpdate(uid, p.id, p); return sendJSON(res, 200, { ok, id: p.id }); }
      return sendJSON(res, 200, { ok: true, id: billing.scriptLibAdd(uid, p) });
    }
    if (pathname === '/api/script-libs/delete' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id } = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.scriptLibRemove(uid, id) });
    }

    // 获客 Agent · 评论收集（潜客列表）：GET 查看 / POST 由执行端(插件)上报收集到的评论用户 / 删除 / 改状态
    if (pathname === '/api/collected-leads' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, ...billing.leadsList(uid, { limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset'), planId: url.searchParams.get('plan') }) });
    }
    if (pathname === '/api/collected-leads' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const b = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: true, ...billing.leadsAdd(uid, b.items || b.leads || []) });
    }
    if (pathname === '/api/collected-leads/delete' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id, all } = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: all ? billing.leadsClear(uid) : billing.leadRemove(uid, id) });
    }
    if (pathname === '/api/collected-leads/status' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id, status } = JSON.parse((await readBody(req)) || '{}');
      return sendJSON(res, 200, { ok: billing.leadStatus(uid, id, status) });
    }

    // 创作流水线历史 / 作品库（按账号存，跨设备）
    if (pathname === '/api/history' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.historyList(uid) });
    }
    if (pathname === '/api/history/get' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const data = billing.historyGet(uid, url.searchParams.get('id') || '');
      // light=1：发布场景只需正文/标题/封面，剥离对标图等大字段(base64)，传输更快
      if (data && url.searchParams.get('light') === '1') {
        ['refImages', 'refVisions', 'refVision', 'ref'].forEach(k => { try { delete data[k]; } catch {} });
      }
      return sendJSON(res, 200, { ok: !!data, data });
    }
    if (pathname === '/api/history' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const rec = JSON.parse((await readBody(req)) || '{}');
      if (!rec.id) return sendJSON(res, 400, { error: '缺少 id' });
      billing.historyUpsert(uid, rec);
      return sendJSON(res, 200, { ok: true });
    }
    if (pathname === '/api/history/delete' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id } = JSON.parse((await readBody(req)) || '{}');
      billing.historyRemove(uid, id);
      return sendJSON(res, 200, { ok: true });
    }

    // 发验证码（dev：无短信网关时直接回传，便于联调；接入 SMS_PROVIDER 后改为只发不回传）
    if (pathname === '/api/auth/send-code' && req.method === 'POST') {
      const { phone } = JSON.parse((await readBody(req)) || '{}');
      if (!/^1\d{10}$/.test(phone || '')) return sendJSON(res, 400, { error: '手机号格式不正确' });
      const rl = smsRateLimit(phone, clientIp(req));
      if (!rl.ok) return sendJSON(res, 429, { error: rl.msg });
      const code = billing.setCode(phone);
      const dev = !process.env.SMS_PROVIDER;
      if (dev) { console.log(`  [验证码] ${phone} → ${code}`); return sendJSON(res, 200, { ok: true, dev: true, code }); }
      // 立即响应、后台异步发短信：不让前端等跨境 API 往返，按钮秒回，短信由运营商投递（约几秒~十几秒）
      sendSms(phone, code).catch(e => console.error('[SMS] 发送失败:', e.message));
      return sendJSON(res, 200, { ok: true, dev: false });
    }
    // 登录：验证码核对 → 建/取用户（新用户送积分）→ 下发 httpOnly Cookie
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { phone, code, invite_code } = JSON.parse((await readBody(req)) || '{}');
      if (!billing.checkCode(phone, code)) return sendJSON(res, 400, { error: '验证码错误或已过期' });
      const { user, isNew } = billing.getOrCreateUser(phone, invite_code);
      return sendJSON(res, 200, { ok: true, isNew, phone: user.phone, balance: billing.getBalance(user.id), grant: isNew ? billing.SIGNUP_GRANT : 0 }, { 'set-cookie': setSidCookie(user.id) });
    }
    // 邀请：我的邀请码 + 邀请记录 + 返积分（合伙人端「我的团队」只读用同一接口）
    if (pathname === '/api/invite' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, ...billing.inviteStats(uid) });
    }
    // 付费模板：已购列表
    if (pathname === '/api/template/purchased' && req.method === 'GET') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, list: billing.templatePurchasedList(uid) });
    }
    // 付费模板：购买（扣 120 积分 → 复制成「我的作品」可编辑；已购免费重看）
    if (pathname === '/api/template/buy' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { id } = JSON.parse((await readBody(req)) || '{}');
      const tpl = (loadTemplates().templates || []).find(t => t.id === id);
      if (!tpl) return sendJSON(res, 404, { error: '模板不存在' });
      const r = billing.templateBuy(uid, tpl);
      return sendJSON(res, r.ok ? 200 : 402, r);
    }
    // 退出
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      return sendJSON(res, 200, { ok: true }, { 'set-cookie': 'sid=; Path=/; HttpOnly; Max-Age=0' });
    }
    // 当前登录态（含昵称 + 等级/权益）
    if (pathname === '/api/auth/me') {
      const uid = authUid(req); const u = uid && billing.getUser(uid);
      if (!u) return sendJSON(res, 200, { ok: false });
      const stats = billing.userStats(uid);
      // 角色：管理员/员工 → admin；累计充值达「合伙人」等级 → partner；否则 user（对应 PRD §3 三端角色）
      const isAdmin = ADMIN_PHONES.has(u.phone) || billing.isStaffPhone(u.phone);
      const isPartner = stats.levelKey === '合伙人';
      const role = isAdmin ? 'admin' : (isPartner ? 'partner' : 'user');
      const roleLabel = isAdmin ? '管理员' : (isPartner ? '合伙人' : '普通用户');
      return sendJSON(res, 200, { ok: true, phone: u.phone, nickname: u.nickname || '', role, roleLabel, isAdmin, isPartner, ...stats });
    }
    // 设置昵称
    if (pathname === '/api/auth/profile' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { nickname } = JSON.parse((await readBody(req)) || '{}');
      const u = billing.setNickname(uid, nickname);
      return sendJSON(res, 200, { ok: true, nickname: u.nickname || '' });
    }
    // 计价规则 + 套餐（前端展示「约扣 X 积分」与充值面板）
    if (pathname === '/api/price') {
      const priceUid = authUid(req); // 登录则标记 once 包是否已购（前端置灰）
      const packs = Object.values(PACKS).map(p => (p.once && priceUid && billing.hasPaidPack(priceUid, p.id)) ? { ...p, used: true } : p);
      return sendJSON(res, 200, { ok: true, rules: { text: billing.getPrice('text', 3), image_std: billing.getPrice('image_std', 5), image_hd: billing.getPrice('image_hd', 12), image_premium: billing.getPrice('image_premium', 30), compliance: billing.getPrice('compliance', 5), vision: 0 }, packs });
    }
    // 钱包：余额 + 近期流水
    if (pathname === '/api/wallet') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, balance: billing.getBalance(uid), ledger: billing.recentLedger(uid, 30) });
    }
    // 下单：建 pending 订单（金额/积分由服务端 PACKS 定）
    if (pathname === '/api/order/create' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { pack_id } = JSON.parse((await readBody(req)) || '{}');
      const pack = PACKS[pack_id]; if (!pack) return sendJSON(res, 400, { error: '套餐不存在' });
      let otn; try { otn = billing.createOrder(uid, pack); }
      catch (e) { return sendJSON(res, 400, { error: e.code === 'ONCE_ONLY' ? '体验套餐每人限购一次，已用过啦～' : ('下单失败：' + (e.message || e)), code: e.code }); }
      // 微信 Native v3：配齐 WXPAY_* 后在此「统一下单」拿 code_url 生成二维码；当前返回占位
      const wxReady = !!(process.env.WXPAY_MCHID && process.env.WXPAY_APIV3_KEY);
      return sendJSON(res, 200, { ok: true, out_trade_no: otn, amount_cny: pack.cny, credits: pack.credits, name: pack.name, code_url: '', wxReady });
    }
    // 订单状态轮询（兜底，防回调丢失）
    if (pathname === '/api/order/status') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const o = billing.getOrder(url.searchParams.get('out_trade_no') || '');
      if (!o || o.user_id !== uid) return sendJSON(res, 404, { error: '订单不存在' });
      return sendJSON(res, 200, { ok: true, status: o.status, credits: o.credits, balance: billing.getBalance(uid) });
    }
    // 支付方式信息（一期：扫码加微信 + 后台人工开通；接了微信支付则走 Native）+ 客服联系方式
    if (pathname === '/api/pay/info') {
      const wxReady = !!(process.env.WXPAY_MCHID && process.env.WXPAY_APIV3_KEY);
      return sendJSON(res, 200, {
        ok: true, mode: wxReady ? 'wxnative' : 'manual',
        // 默认指向仓库内已提交的二维码图，无需配 env 也能显示；配了 env 则覆盖
        wechatQr: process.env.PAY_WECHAT_QR || '/assets/pay-qr.png', wechatId: process.env.PAY_WECHAT_ID || '',
        supportQr: process.env.SUPPORT_WECHAT_QR || process.env.PAY_WECHAT_QR || '/assets/support-qr.png',
        supportId: process.env.SUPPORT_WECHAT_ID || process.env.PAY_WECHAT_ID || 'Syl18268346784',
        note: process.env.PAY_NOTE || '付款后把「订单号 + 手机号」发客服，管理员后台为你开通积分（通常几分钟内到账）。',
        devPay: process.env.NODE_ENV !== 'production',
      });
    }
    // 管理员手动确认到账（一期人工开户/充值核心）：把 pending 订单标记已付并入账（含充值赠分）
    if (pathname === '/api/admin/order-confirm' && req.method === 'POST') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' });
      const { out_trade_no } = JSON.parse((await readBody(req)) || '{}');
      const o = billing.getOrder(out_trade_no); if (!o) return sendJSON(res, 404, { error: '订单不存在' });
      const paid = billing.markPaid(out_trade_no, 'manual', 'ADMIN' + Date.now());
      return sendJSON(res, 200, { ok: true, status: paid ? paid.status : 'paid' });
    }
    // dev：模拟支付成功（仅联调；真实入账只在 /api/pay/notify 验签回调里）
    if (pathname === '/api/pay/dev-confirm' && req.method === 'POST') {
      if (process.env.NODE_ENV === 'production') return sendJSON(res, 403, { error: '生产环境禁用' });
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { out_trade_no } = JSON.parse((await readBody(req)) || '{}');
      const o = billing.getOrder(out_trade_no);
      if (!o || o.user_id !== uid) return sendJSON(res, 404, { error: '订单不存在' });
      const paid = billing.markPaid(out_trade_no, 'dev', 'DEV' + Date.now());
      return sendJSON(res, 200, { ok: true, status: paid.status, balance: billing.getBalance(uid) });
    }
    // 微信支付回调（真实入账唯一入口：验签 → markPaid 幂等入账）。当前为骨架占位。
    if (pathname === '/api/pay/notify' && req.method === 'POST') {
      await readBody(req);
      // TODO 微信 v3：用 WechatPay-Signature/Timestamp/Nonce/Serial 验签 → 解密 resource → 取 out_trade_no → billing.markPaid(otn,'wxpay',transaction_id)
      console.warn('  [pay/notify] 收到回调（验签未实现，已忽略）');
      return sendJSON(res, 200, { code: 'FAIL', message: 'verify not implemented' });
    }
    // 管理员手动充/扣积分（不走支付）。需请求头 x-admin-token = ADMIN_TOKEN。
    if (pathname === '/api/admin/adjust' && req.method === 'POST') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限（需管理员账号或正确的 x-admin-token）' });
      const { phone, delta, reason } = JSON.parse((await readBody(req)) || '{}');
      const u = billing.getUserByPhone(phone); if (!u) return sendJSON(res, 404, { error: '用户不存在' });
      const d = parseInt(delta, 10); if (!d) return sendJSON(res, 400, { error: 'delta 必须为非零整数（正充负扣）' });
      const nb = billing.adminAdjust(u.id, d, reason);
      console.log(`  [admin] ${phone} ${d >= 0 ? '+' : ''}${d} → 余额 ${nb}（${reason || ''}）`);
      return sendJSON(res, 200, { ok: true, phone, delta: d, balance: nb });
    }
    // 管理员查用户（余额 + 流水）
    if (pathname === '/api/admin/user') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' });
      const u = billing.getUserByPhone(url.searchParams.get('phone') || ''); if (!u) return sendJSON(res, 404, { error: '用户不存在' });
      return sendJSON(res, 200, { ok: true, id: u.id, phone: u.phone, balance: billing.getBalance(u.id), ledger: billing.recentLedger(u.id, 30) });
    }
    // 管理后台：概览 / 充值单据 / 用户列表 / 会员体系（只读）
    if (pathname === '/api/admin/summary') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, ...billing.adminSummary() }); }
    if (pathname === '/api/admin/funnel') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, ...billing.funnelStats() }); }
    if (pathname === '/api/admin/orders') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, orders: billing.adminOrders(80) }); }
    if (pathname === '/api/admin/users') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, users: billing.adminUsers(150) }); }
    if (pathname === '/api/admin/levels' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, levels: billing.levelsGet() }); }
    if (pathname === '/api/admin/levels' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const { levels } = JSON.parse((await readBody(req)) || '{}'); return sendJSON(res, 200, { ok: true, levels: billing.levelsSet(levels || []) }); }
    if (pathname === '/api/admin/prices' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, prices: billing.getAllPrices() }); }
    if (pathname === '/api/admin/price' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const { action_key, credits } = JSON.parse((await readBody(req)) || '{}'); if (!action_key) return sendJSON(res, 400, { error: '缺少 action_key' }); return sendJSON(res, 200, { ok: true, prices: billing.setPrice(action_key, credits) }); }
    if (pathname === '/api/admin/kb' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, ...billing.kbGet() }); }
    if (pathname === '/api/admin/kb' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const part = JSON.parse((await readBody(req)) || '{}'); return sendJSON(res, 200, { ok: true, ...billing.kbSet(part) }); }
    if (pathname === '/api/admin/staff' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, staff: billing.staffList(), roles: billing.rolesGet() }); }
    if (pathname === '/api/admin/staff' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const { phone, role, note, remove } = JSON.parse((await readBody(req)) || '{}'); try { return sendJSON(res, 200, { ok: true, staff: remove ? billing.staffRemove(phone) : billing.staffAdd(phone, role, note) }); } catch (e) { return sendJSON(res, 400, { error: e.message || String(e) }); } }
    // RBAC：角色管理 / 权限管理(角色×菜单矩阵，复用 roles) / 菜单管理
    if (pathname === '/api/admin/roles' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, roles: billing.rolesGet(), menus: billing.menuCfgGet(), staff: billing.staffList() }); }
    if (pathname === '/api/admin/roles' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const { roles } = JSON.parse((await readBody(req)) || '{}'); return sendJSON(res, 200, { ok: true, roles: billing.rolesSet(roles || []) }); }
    if (pathname === '/api/admin/menus' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, menus: billing.menuCfgGet() }); }
    if (pathname === '/api/admin/menus' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const { menus } = JSON.parse((await readBody(req)) || '{}'); return sendJSON(res, 200, { ok: true, menus: billing.menuCfgSet(menus || []) }); }
    // ===== 小红书采集登录态：状态 + 后台自助扫码续期（纯新增，不改 /api/xhs-search 抓取逻辑）=====
    if (pathname === '/api/admin/xhs-login-status') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' });
      try { return sendJSON(res, 200, { ok: true, ...(await xhsStatus()) }); }
      catch (e) { return sendJSON(res, 200, { ok: false, error: '查询失败：' + (e.message || e) }); }
    }
    if (pathname === '/api/admin/xhs-relogin' && req.method === 'POST') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' });
      try { return sendJSON(res, 200, xhsReloginStart()); }
      catch (e) { return sendJSON(res, 200, { ok: false, error: '发起登录失败：' + (e.message || e) }); }
    }
    if (pathname === '/api/admin/xhs-relogin-qr') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' });
      return sendJSON(res, 200, { ok: true, ...xhsReloginState });
    }
    // 当前管理员可见菜单（超管=全部；员工=分配的菜单）
    if (pathname === '/api/admin/my-menus') {
      if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' });
      const u = (() => { const uid = authUid(req); return uid && billing.getUser(uid); })();
      const superAdmin = (ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN) || (u && ADMIN_PHONES.has(u.phone));
      const menus = superAdmin ? billing.enabledMenuKeys() : (u ? billing.staffMenusOf(u.phone) : billing.enabledMenuKeys());
      return sendJSON(res, 200, { ok: true, menus, superAdmin: !!superAdmin, menuCfg: billing.menuCfgGet() });
    }
    // 新增智能体配额 / 注册 / 申请（普通1·合伙人3·管理员不限；超额→申请→后台审批）
    if (pathname === '/api/agent/quota') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      return sendJSON(res, 200, { ok: true, role: roleOfUid(uid), ...billing.agentQuota(uid, roleOfUid(uid)) });
    }
    if (pathname === '/api/agent/register' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { name } = JSON.parse((await readBody(req)) || '{}'); if (!name) return sendJSON(res, 400, { error: '缺少名称' });
      const r = billing.agentRegister(uid, roleOfUid(uid), name);
      return sendJSON(res, r.ok ? 200 : 403, r);
    }
    if (pathname === '/api/agent/apply' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { name, reason } = JSON.parse((await readBody(req)) || '{}'); const u = billing.getUser(uid);
      return sendJSON(res, 200, billing.agentApply(uid, u ? u.phone : '', name, reason));
    }
    if (pathname === '/api/admin/qa-log') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, stats: billing.qaStats(), top: billing.qaTopQuestions(20), log: billing.qaLogList(100) }); }
    if (pathname === '/api/admin/tasks') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, stats: billing.adminTaskStats(), tasks: billing.adminTasks(150) }); }
    if (pathname === '/api/admin/agent-apps' && req.method === 'GET') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); return sendJSON(res, 200, { ok: true, apps: billing.agentAppsAll() }); }
    if (pathname === '/api/admin/agent-apps' && req.method === 'POST') { if (!isAdminReq(req)) return sendJSON(res, 403, { error: '无权限' }); const { id, approve } = JSON.parse((await readBody(req)) || '{}'); return sendJSON(res, 200, billing.agentAppDecide(parseInt(id, 10), !!approve)); }
    // 合伙人：名下成员的充值记录（只读，越权返回 404）
    if (pathname === '/api/partner/member') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const r = billing.partnerMemberOrders(uid, parseInt(url.searchParams.get('invitee_id'), 10));
      if (!r) return sendJSON(res, 404, { error: '无该成员或无权查看' });
      return sendJSON(res, 200, { ok: true, ...r });
    }
    // 合伙人：积分转赠给直邀成员（从自己余额划拨；越权/余额不足报错）
    if (pathname === '/api/partner/transfer' && req.method === 'POST') {
      const uid = authUid(req); if (!uid) return sendJSON(res, 401, { error: '请先登录' });
      const { invitee_id, amount, note } = JSON.parse((await readBody(req)) || '{}');
      const r = billing.partnerTransfer(uid, parseInt(invitee_id, 10), amount, note);
      return sendJSON(res, r.ok ? 200 : 400, r);
    }
    return sendJSON(res, 404, { error: '未知计费接口' });
  }

  // ---- 静态文件 ----
  // 根目录：未登录访客看官网(land.html)，已登录看工作台(index.html)
  let rel = pathname === '/' ? (authUid(req) ? '/index.html' : '/land.html') : pathname;
  const filePath = path.join(__dirname, path.normalize(rel));
  if (!filePath.startsWith(__dirname)) return send(res, 403, 'Forbidden'); // 防目录穿越
  // 禁止访问敏感文件：dotfiles(.env/.git…)、后端源码与依赖清单
  const base = path.basename(filePath);
  const BLOCK = new Set(['server.js', 'package.json', 'package-lock.json', 'node_modules']);
  if (base.startsWith('.') || BLOCK.has(base) || rel.includes('/node_modules/')) {
    return send(res, 404, '404 Not Found');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, '404 Not Found: ' + rel);
    const ext = path.extname(filePath);
    // 静态资源（css/js/字体/图片/svg）带 ?v= 做缓存失效 → 长缓存，避免每次切页重下；
    // HTML 用 no-cache（每次回源校验，内容仍即时更新）而不是 no-store——no-store 会禁用浏览器
    // 前进/后退的 bfcache，导致每次点「返回」都整页重载、切页很卡；no-cache 保留 bfcache，返回秒开。
    const cacheable = ['.css', '.js', '.woff2', '.png', '.jpg', '.svg', '.ico'].includes(ext);
    const cc = cacheable ? 'public, max-age=86400' : 'no-cache';
    send(res, 200, data, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cc });
  });
 } catch (err) {
   // 任何未捕获异常（如畸形 JSON body）都返回 500，绝不让进程崩溃
   try { if (!res.headersSent) send(res, 500, JSON.stringify({ error: '请求处理异常：' + (err && err.message || String(err)) }), { 'content-type': 'application/json' }); else res.end(); } catch {}
 }
});

// 进程级兜底：再有漏网的异步异常也只记录、不退出
process.on('unhandledRejection', e => console.error('  [unhandledRejection]', e && e.message || e));
process.on('uncaughtException', e => console.error('  [uncaughtException]', e && e.message || e));

server.listen(PORT, () => {
  console.log(`\n  美术考研笔记操盘台 · 本地服务已启动`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  格式: ${API_FORMAT}  · 转发: ${API_BASE}${API_FORMAT === 'openai' ? '/chat/completions' : '/v1/messages'}  · 鉴权: ${API_FORMAT === 'openai' ? 'bearer' : AUTH_STYLE}${FORCE_MODEL ? '  · 模型: ' + FORCE_MODEL : ''}`);
  console.log(`  API Key: ${API_KEY ? '已配置 ✓' : '未配置 ✗（请在 .env 写入 ANTHROPIC_API_KEY）'}\n`);
});

// 小红书登录态保活：每 6 小时轻量调一次 xhs status（CLI 每次调用会顺带刷新 cookie，能明显延长不过期时间）；
// 真过期时打一条日志提醒。设 XHS_KEEPALIVE=0 可关闭。本地没装 xhs 时调用失败也无害。
if (process.env.XHS_KEEPALIVE !== '0') {
  const ka = setInterval(async () => {
    try { const s = await xhsStatus(); if (!s.loggedIn) console.warn('  [xhs] 登录态已过期 → 请到「管理后台 · 采集登录」重新扫码续期'); }
    catch { /* 没装 xhs / 本地环境，忽略 */ }
  }, 6 * 3600 * 1000);
  if (ka.unref) ka.unref();
}

// 账号矩阵·小红书登录态保活：每 6 小时给每个「已登录」账号用其 cookie 静默访问一次小红书，
// 触发服务端续期并回写轮换后的新 cookie（不回写=cookie 老化失效），把时效拉到一周以上。
// 失效则标记 expired，前端「登录失效」提醒重扫。设 XHS_ACCT_KEEPALIVE=0 关闭。
async function keepAliveAccounts() {
  if (!billing) return;
  let bot; try { bot = require('./xhs-bot'); } catch { return; } // 没装 Playwright 直接跳过
  let accts = []; try { accts = billing.accountsActiveXhs() || []; } catch { return; }
  for (const a of accts) {
    let cookie = '';
    try { const blob = JSON.parse(a.auth_blob || '{}'); cookie = blob.cookie || ''; } catch { cookie = a.auth_blob || ''; }
    if (!cookie) continue;
    try {
      const r = await bot.refreshSession(cookie);
      if (r.ok && r.cookie) {
        billing.accountSetAuthById(a.id, JSON.stringify({ cookie: r.cookie, via: 'keepalive', ts: Date.now() }), 'active', '✓ 保活续期 ' + new Date().toLocaleString('zh-CN'));
      } else if (!r.ok && /失效|未取到|未登录/.test(r.reason || '')) {
        billing.accountSetStatusById(a.id, 'expired', '⚠ ' + (r.reason || '登录失效') + '，请重新扫码');
        console.warn('  [xhs-acct] #' + a.id + ' ' + (a.nickname || '') + ' 登录态失效');
      }
    } catch (e) { /* 单个账号失败不影响其他 */ }
    await new Promise(r => setTimeout(r, 4000)); // 错峰，避免同时开多个浏览器
  }
}
// 默认开启账号矩阵登录态保活：每 6 小时给「已登录」账号用 cookie 静默续期，把时效拉到一周以上。
// 这是 cookie 不几天就老化失效的关键。要关掉设 XHS_ACCT_KEEPALIVE=0。
if (process.env.XHS_ACCT_KEEPALIVE !== '0') {
  const ka2 = setInterval(keepAliveAccounts, 6 * 3600 * 1000);
  if (ka2.unref) ka2.unref();
  setTimeout(() => { try { keepAliveAccounts(); } catch {} }, 5 * 60 * 1000); // 启动 5 分钟后先续一次
}
