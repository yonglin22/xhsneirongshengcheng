'use strict';
/* 小红书自动化（Playwright 无头浏览器）。用账号登录态(cookie) 做：
   - verifyLogin：校验 cookie 是否真有效登录（同时探测 VPS IP 是否被风控）
   - publishDraft：把内容存进创作平台「草稿箱」（建设中，需对着线上创作页迭代）
   懒加载 playwright：未安装时不影响主服务启动。*/
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseCookie(str) {
  return String(str || '').split(/;\s*/).map(kv => {
    const i = kv.indexOf('='); if (i < 0) return null;
    const name = kv.slice(0, i).trim(); const value = kv.slice(i + 1).trim();
    if (!name) return null;
    return { name, value, domain: '.xiaohongshu.com', path: '/' };
  }).filter(Boolean);
}

async function launch() {
  const { chromium } = require('playwright'); // 懒加载
  return chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
}

// 校验登录态：返回 { ok, nickname, reason }
async function verifyLogin(cookieStr) {
  const cookies = parseCookie(cookieStr);
  if (!cookies.length) return { ok: false, reason: 'cookie 为空或格式不对' };
  let b;
  try {
    b = await launch();
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    // 创作中心：未登录必跳 /login，是可靠的登录信号（也正是发草稿要用的站点）
    await p.goto('https://creator.xiaohongshu.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(3500);
    const url = p.url();
    const info = await p.evaluate(() => {
      const t = (document.body && document.body.innerText) || '';
      return {
        risk: /环境异常|安全验证|滑动验证|拼图验证|验证后继续/.test(t) && t.length < 1800,
        loginUI: /扫码登录|手机号登录|登录后即可|登录创作|二维码登录/.test(t),
        nick: ((document.querySelector('[class*=nickname],[class*=name],.user-info .name') || {}).textContent || '').trim(),
        len: t.length
      };
    });
    if (info.risk) return { ok: false, reason: '小红书风控验证页（VPS 机房 IP 触发）。建议：用本机刚登录导出的新鲜 cookie，或给服务端配住宅代理' };
    if (/\/login/i.test(url) || info.loginUI) return { ok: false, reason: 'cookie 已失效/未登录，请在电脑重新登录小红书后导出新 cookie' };
    return { ok: true, nickname: (info.nick || '').slice(0, 30) };
  } catch (e) {
    return { ok: false, reason: '检测失败：' + (e.message || String(e)).slice(0, 160) };
  } finally { try { if (b) await b.close(); } catch {} }
}

// 会话保活：用现有 cookie 静默访问小红书，保持会话活跃，并把轮换后的最新 cookie 回传（小红书会定期换 cookie，不回写=过期）。
// 返回 { ok, cookie?(轮换后), nickname?, reason? }
async function refreshSession(cookieStr) {
  const cookies = parseCookie(cookieStr);
  if (!cookies.length) return { ok: false, reason: 'cookie 为空' };
  let b;
  try {
    b = await launch();
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    // 访问已登录页（www 个人主页 + 创作中心），触发服务端续期/换 cookie
    try { await p.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 30000 }); await p.waitForTimeout(2500); } catch {}
    try { await p.goto('https://creator.xiaohongshu.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); await p.waitForTimeout(2500); } catch {}
    const url = p.url();
    const info = await p.evaluate(() => {
      const t = (document.body && document.body.innerText) || '';
      return { loginUI: /扫码登录|手机号登录|登录后即可|登录创作|二维码登录/.test(t),
               nick: ((document.querySelector('[class*=nickname],[class*=name],.user-info .name') || {}).textContent || '').trim() };
    });
    if (/\/login/i.test(url) || info.loginUI) return { ok: false, reason: '会话已失效' };
    const fresh = await ctx.cookies();
    const xhs = fresh.filter(c => /xiaohongshu/.test(c.domain || ''));
    const sess = xhs.find(c => c.name === 'web_session' && c.value && c.value.length > 8);
    if (!sess) return { ok: false, reason: '未取到登录 cookie' };
    return { ok: true, cookie: xhs.map(c => c.name + '=' + c.value).join('; '), nickname: (info.nick || '').slice(0, 30) };
  } catch (e) {
    return { ok: false, reason: '保活失败：' + (e.message || String(e)).slice(0, 120) };
  } finally { try { if (b) await b.close(); } catch {} }
}

// 下载图片到临时文件（小红书上传需本地文件）
async function dlImages(images) {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const out = [];
  for (let i = 0; i < Math.min((images || []).length, 9); i++) {
    const u = images[i]; if (!u) continue;
    try {
      let buf, ext = 'png';
      if (/^data:image\//i.test(u)) { // 前端 html2canvas 渲染的 PNG（CSS 卡转图）
        const m = u.match(/^data:image\/(\w+);base64,(.*)$/i); if (!m) continue;
        ext = m[1] === 'jpeg' ? 'jpg' : m[1]; buf = Buffer.from(m[2], 'base64');
      } else if (/^https?:\/\//.test(u)) {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': UA, referer: 'https://www.xiaohongshu.com/' } });
        if (!r.ok) continue;
        buf = Buffer.from(await r.arrayBuffer());
        ext = (r.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
      } else continue;
      const fp = path.join(os.tmpdir(), 'xhs_' + Date.now() + '_' + i + '.' + ext);
      fs.writeFileSync(fp, buf); out.push(fp);
    } catch {}
  }
  return out;
}

// 发布到草稿箱（图文）：driver 创作中心。best-effort，选择器随小红书改版需迭代。
async function publishDraft(cookieStr, content) {
  const cookies = parseCookie(cookieStr);
  if (!cookies.length) return { ok: false, msg: 'cookie 无效' };
  const { title = '', body = '', images = [] } = content || {};
  const files = await dlImages(images);
  if (!files.length) return { ok: false, msg: '没有可上传的图片（小红书图文至少 1 张）。请先在成稿里出图/上传真实图。' };
  let b;
  try {
    b = await launch();
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    await p.goto('https://creator.xiaohongshu.com/publish/publish?source=official', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await p.waitForTimeout(3500);
    if (/\/login/i.test(p.url())) { return { ok: false, msg: '登录态失效，请重新接入 cookie' }; }
    // 切到「上传图文」标签
    try { const tab = p.locator('text=上传图文').first(); if (await tab.count()) { await tab.click({ timeout: 4000 }); await p.waitForTimeout(1200); } } catch {}
    // 上传图片
    const fileInput = p.locator('input[type=file]').first();
    await fileInput.setInputFiles(files, { timeout: 15000 });
    await p.waitForTimeout(6000); // 等上传
    // 填标题
    try { const ti = p.locator('input[placeholder*="标题"]').first(); if (await ti.count()) { await ti.fill(title.slice(0, 20)); } } catch {}
    // 填正文（contenteditable）
    try { const ed = p.locator('[contenteditable="true"]').first(); if (await ed.count()) { await ed.click(); await p.keyboard.type(String(body).slice(0, 980)); } } catch {}
    await p.waitForTimeout(1500);
    // 存草稿：「暂存离开」/「存草稿」
    let saved = false;
    for (const sel of ['text=暂存离开', 'text=存草稿', 'text=保存草稿']) {
      try { const btn = p.locator(sel).first(); if (await btn.count()) { await btn.click({ timeout: 4000 }); saved = true; break; } } catch {}
    }
    await p.waitForTimeout(2500);
    return saved ? { ok: true, msg: '已尝试存入草稿箱，请到小红书 App / 创作中心「草稿箱」确认' } : { ok: false, msg: '已填好内容但没找到「暂存离开/存草稿」按钮（小红书改版）——请到创作中心手动存，或反馈我调选择器' };
  } catch (e) {
    return { ok: false, msg: '发布失败：' + (e.message || String(e)).slice(0, 160) };
  } finally {
    try { if (b) await b.close(); } catch {}
    try { const fs = require('fs'); files.forEach(f => { try { fs.unlinkSync(f); } catch {} }); } catch {}
  }
}

// ===== 扫码登录：在 VPS 本地打开小红书登录页出二维码，手机扫码后取登录态（同 IP，不会失效）=====
const _qr = new Map(); // token -> { browser, ctx, page, ts }
function _qrGc() { const now = Date.now(); for (const [k, s] of _qr) { if (now - s.ts > 600000) { try { s.browser.close(); } catch {} _qr.delete(k); } } } // 10 分钟，给扫码+短信留足时间

async function startQrLogin() {
  _qrGc();
  const b = await launch();
  try {
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
    const p = await ctx.newPage();
    await p.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await p.waitForTimeout(2600);
    const bodyTxt = await p.evaluate(() => (document.body && document.body.innerText || '').slice(0, 1200));
    if (/环境异常|安全验证|滑动验证|拼图验证/.test(bodyTxt)) { await b.close(); return { ok: false, reason: '小红书风控验证页（VPS IP），扫码登录暂不可用，可改用 Cookie 粘贴' }; }
    try { const lb = p.locator('text=登录').first(); if (await lb.count()) { await lb.click({ timeout: 4000 }); await p.waitForTimeout(2000); } } catch {}
    let qr = '';
    try { const el = p.locator('img.qrcode-img').first(); await el.waitFor({ state: 'visible', timeout: 9000 }); const src = await el.getAttribute('src'); if (src && src.startsWith('data:')) qr = src; } catch {}
    if (!qr) {
      for (const sel of ['.qrcode img', '.qrcode', 'img.qrcode-img']) {
        try { const el = p.locator(sel).first(); if (await el.count()) { const buf = await el.screenshot({ timeout: 4000 }); if (buf && buf.length > 800) { qr = 'data:image/png;base64,' + buf.toString('base64'); break; } } } catch {}
      }
    }
    if (!qr) { await b.close(); return { ok: false, reason: '没抓到登录二维码（小红书改版或风控），可用 Cookie 粘贴' }; }
    const token = 'qr' + Date.now() + Math.random().toString(36).slice(2, 7);
    _qr.set(token, { browser: b, ctx, page: p, ts: Date.now() });
    return { ok: true, token, qr };
  } catch (e) {
    try { await b.close(); } catch {}
    return { ok: false, reason: '扫码登录启动失败：' + (e.message || String(e)).slice(0, 140) };
  }
}

// 登录判定：扫码确认后 www 上下文会写入 web_session（域 .xiaohongshu.com，对 creator 子域同样有效）。
// ===== 扫码登录 · 一套统一逻辑 =====
// 核心判据 _scan：在「同一个二维码页」上读取页面状态 + cookie，区分四种状态：
//   loggedIn  —— 登录弹窗(二维码/登录入口/短信表单)全消失 且 有 web_session → 真登录(含无短信直接登录)
//   sms       —— 出现短信/安全验证表单 → 需要填手机号取验证码
//   scanned   —— 已扫码、等手机端确认(二维码还在但有"扫码成功"等字样)
//   waiting   —— 还在显示二维码、未扫
// 访客态虽也有 web_session，但登录弹窗一直在 → 不会判成 loggedIn，杜绝"没扫就成功"。
async function _scan(s) {
  const p = s.page;
  if (!p || p.isClosed()) return { dead: true };
  const r = await p.evaluate(() => {
    const t = (document.body && document.body.innerText) || '';
    const hasQr = !!document.querySelector('img.qrcode-img');
    const smsForm = !!document.querySelector('input[placeholder*="验证码"],input[placeholder*="短信"]') || /短信验证|安全验证|验证手机|输入验证码|绑定手机|新设备|身份验证/.test(t);
    const loginEntry = hasQr || /扫码登录|手机号登录|二维码登录|新用户注册/.test(t);
    const scanned = /扫码成功|扫描成功|已扫描|请在手机|手机端确认|确认登录|登录中|授权/.test(t);
    const btns = [...document.querySelectorAll('button,[role=button],span,a')].map(e => (e.textContent || '').trim()).filter(x => x && x.length <= 12 && /验证|登录|获取|发送|确认/.test(x)).slice(0, 8);
    return { hasQr, smsForm, loginEntry, scanned, btns, snippet: t.replace(/\s+/g, ' ').slice(0, 160) };
  });
  const cks = await s.ctx.cookies();
  const xhs = cks.filter(c => /xiaohongshu/.test(c.domain || ''));
  const ws = xhs.find(c => c.name === 'web_session' && c.value && c.value.length > 8);
  const cookie = ws ? xhs.map(c => c.name + '=' + c.value).join('; ') : '';
  // 登录弹窗(二维码/登录入口/短信表单)全没了 且 有 web_session → 真登录
  const loggedIn = cookie && !r.hasQr && !r.loginEntry && !r.smsForm;
  return { ...r, ws: !!ws, cookie, loggedIn };
}
async function pollQrLogin(token) {
  const s = _qr.get(token);
  if (!s) return { ok: false, expired: true, reason: '二维码会话已过期，请重新获取' };
  try {
    const st = await _scan(s);
    if (st.dead) return { ok: false, expired: true, reason: '二维码会话已结束，请重新生成' };
    if (st.loggedIn) { try { await s.browser.close(); } catch {} _qr.delete(token); return { ok: true, cookie: st.cookie }; } // 无短信直接登录 → 自动成功
    if (st.smsForm) return { ok: false, scanned: true, sms: true, msg: '✓ 已扫码 · 请填手机号取验证码，再点「完成登录」', info: { btns: st.btns, snippet: st.snippet } };
    if (st.scanned) return { ok: false, scanned: true, msg: '✓ 已扫码 · 请在手机确认；要短信就填验证码后点「完成登录」' };
    return { ok: false, pending: true };
  } catch (e) { return { ok: false, pending: true }; }
}
// 发送验证码：填手机号 → 点页面上文字含「验证码」的获取/发送按钮（直接遍历元素点，比固定选择器稳）
async function qrSendSms(token, phone) {
  const s = _qr.get(token); if (!s) return { ok: false, reason: '会话已过期，请重新生成二维码' };
  try {
    const p = s.page;
    if (!p || p.isClosed()) return { ok: false, reason: '登录会话已结束，请重新生成二维码' };
    if (phone) { try { const pi = p.locator('input[placeholder*="手机"],input[type="tel"],input[type="number"]').first(); if (await pi.count()) { await pi.fill(String(phone).trim()); await p.waitForTimeout(400); } } catch {} }
    let clicked = '';
    try {
      clicked = await p.evaluate(() => {
        const els = [...document.querySelectorAll('button,[role=button],a,span,div')];
        for (const e of els) { const t = (e.textContent || '').replace(/\s/g, ''); if (t.length <= 12 && /验证码/.test(t) && /获取|发送|重新/.test(t)) { e.click(); return (e.textContent || '').trim().slice(0, 12); } }
        return '';
      });
    } catch {}
    await p.waitForTimeout(900);
    // 抓页面真实信息供校准：有没有手机输入框、所有可点按钮、页面文字
    let probe = {};
    try { probe = await p.evaluate(() => ({
      phoneInput: !!document.querySelector('input[placeholder*="手机"],input[type="tel"]'),
      codeInput: !!document.querySelector('input[placeholder*="验证码"],input[placeholder*="短信"]'),
      btns: [...document.querySelectorAll('button,[role=button],a,span')].map(e => (e.textContent || '').trim()).filter(x => x && x.length <= 14 && /验证|登录|获取|发送|确认|短信|绑定|安全/.test(x)).slice(0, 12),
      snippet: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 220)
    })); } catch {}
    const info = probe;
    if (clicked) return { ok: true, clicked, info };
    return { ok: false, reason: '没找到「获取验证码」按钮（多半还没扫码，或本次不需要短信——直接点「完成登录」即可）', info };
  } catch (e) { return { ok: false, reason: (e.message || '').slice(0, 100) }; }
}
// 完成登录：填验证码(若有)→点登录→轮询当前页 ≤10 秒，登录弹窗消失+有 web_session 即成功。
async function qrSubmitSms(token, code) {
  const s = _qr.get(token); if (!s) return { ok: false, reason: '会话已过期，请重新生成二维码' };
  try {
    const p = s.page;
    if (!p || p.isClosed()) return { ok: false, reason: '登录会话已结束，请重新生成二维码' };
    if (code) {
      try { const ci = p.locator('input[placeholder*="验证码"],input[placeholder*="短信"]').first(); if (await ci.count()) { await ci.fill(String(code).trim()); await p.waitForTimeout(300); } } catch {}
      try { await p.evaluate(() => { const els = [...document.querySelectorAll('button,[role=button],a,span')]; for (const e of els) { const t = (e.textContent || '').replace(/\s/g, ''); if (t.length <= 8 && /^(登录|验证并登录|确认登录|确认|验证)$/.test(t)) { e.click(); return; } } }); } catch {}
    }
    for (let i = 0; i < 10; i++) {
      const st = await _scan(s);
      if (st.dead) return { ok: false, reason: '登录会话已结束，请重新生成二维码' };
      if (st.loggedIn) { try { await s.browser.close(); } catch {} _qr.delete(token); return { ok: true, cookie: st.cookie }; }
      await new Promise(r => setTimeout(r, 1000));
    }
    const st = await _scan(s);
    return { ok: false, reason: st.smsForm ? '验证码可能不对/已过期，请重新获取再试' : '还没完成登录，请先扫码（需要短信就填验证码）', info: { btns: st.btns, snippet: st.snippet } };
  } catch (e) { return { ok: false, reason: (e.message || '').slice(0, 100) }; }
}

module.exports = { verifyLogin, refreshSession, publishDraft, parseCookie, startQrLogin, pollQrLogin, qrSendSms, qrSubmitSms };
