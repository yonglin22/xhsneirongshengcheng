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

// 下载图片到临时文件（小红书上传需本地文件）
async function dlImages(images) {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const out = [];
  for (let i = 0; i < Math.min((images || []).length, 9); i++) {
    const u = images[i]; if (!u || !/^https?:\/\//.test(u)) continue;
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': UA, referer: 'https://www.xiaohongshu.com/' } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = (r.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
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
function _qrGc() { const now = Date.now(); for (const [k, s] of _qr) { if (now - s.ts > 240000) { try { s.browser.close(); } catch {} _qr.delete(k); } } }

async function startQrLogin() {
  _qrGc();
  const b = await launch();
  try {
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
    const p = await ctx.newPage();
    await p.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 40000 });
    await p.waitForTimeout(2600);
    const bodyTxt = await p.evaluate(() => (document.body && document.body.innerText || '').slice(0, 1200));
    if (/环境异常|安全验证|滑动验证|拼图验证/.test(bodyTxt)) { await b.close(); return { ok: false, reason: '小红书风控验证页（VPS IP），扫码登录暂不可用，请反馈我配住宅代理' }; }
    // 触发登录弹窗（点右上「登录」）
    try { const lb = p.locator('text=登录').first(); if (await lb.count()) { await lb.click({ timeout: 4000 }); await p.waitForTimeout(2000); } } catch {}
    // 二维码 = <img class="qrcode-img" src="data:..."> → 直接读 data URL 最准
    let qr = '';
    try { const el = p.locator('img.qrcode-img').first(); await el.waitFor({ state: 'visible', timeout: 9000 }); const src = await el.getAttribute('src'); if (src && src.startsWith('data:')) qr = src; } catch {}
    if (!qr) { // 兜底：截 .qrcode 容器
      for (const sel of ['.qrcode img', '.qrcode', 'img.qrcode-img']) {
        try { const el = p.locator(sel).first(); if (await el.count()) { const buf = await el.screenshot({ timeout: 4000 }); if (buf && buf.length > 800) { qr = 'data:image/png;base64,' + buf.toString('base64'); break; } } } catch {}
      }
    }
    if (!qr) { await b.close(); return { ok: false, reason: '没抓到登录二维码（小红书改版或风控），可暂用 cookie 粘贴' }; }
    const token = 'qr' + Date.now() + Math.random().toString(36).slice(2, 7);
    _qr.set(token, { browser: b, ctx, page: p, ts: Date.now() });
    return { ok: true, token, qr };
  } catch (e) {
    try { await b.close(); } catch {}
    return { ok: false, reason: '扫码登录启动失败：' + (e.message || String(e)).slice(0, 140) };
  }
}

async function _grabIfLoggedIn(s) {
  const p = s.page;
  if (!s.checking) {
    s.checking = true;
    try { await p.goto('https://creator.xiaohongshu.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); await p.waitForTimeout(2800); } catch {}
    s.checking = false;
  }
  if (/\/login/i.test(p.url())) return null;
  const cks = await s.ctx.cookies();
  const xhs = cks.filter(c => /xiaohongshu/.test(c.domain || ''));
  if (!xhs.length) return null;
  return xhs.map(c => c.name + '=' + c.value).join('; ');
}
// 检测短信验证 UI（扫码后风控触发）
async function _detectVerify(p) {
  return await p.evaluate(() => {
    const t = (document.body && document.body.innerText) || '';
    const codeInput = !!document.querySelector('input[placeholder*="验证码"],input[placeholder*="短信"]');
    const need = codeInput || /短信验证|安全验证|验证手机|身份验证|登录验证|新设备|输入验证码/.test(t);
    const phoneInput = !!document.querySelector('input[placeholder*="手机"],input[type="tel"]');
    const btns = [...document.querySelectorAll('button,[role=button],span,a')].map(e => (e.textContent || '').trim()).filter(x => x && x.length <= 10 && /验证|登录|获取|发送|确认/.test(x)).slice(0, 8);
    return { need, codeInput, phoneInput, btns, snippet: t.replace(/\s+/g, ' ').slice(0, 160) };
  });
}
async function pollQrLogin(token) {
  const s = _qr.get(token);
  if (!s) return { ok: false, expired: true, reason: '二维码会话已过期，请重新获取' };
  try {
    const p = s.page;
    if ((await p.locator('img.qrcode-img').count()) > 0) return { ok: false, pending: true }; // 还没扫/确认
    // 扫码确认后：先看是否要短信验证（风控）
    const ver = await _detectVerify(p);
    if (ver.need) return { ok: false, needSms: true, info: ver };
    // 无验证 → 创作中心确认 + 取 cookie
    const cookie = await _grabIfLoggedIn(s);
    if (!cookie) return { ok: false, pending: true };
    try { await s.browser.close(); } catch {} _qr.delete(token);
    return { ok: true, cookie };
  } catch (e) { return { ok: false, pending: true }; }
}
// 触发发送验证码（必要时先填手机号）
async function qrSendSms(token, phone) {
  const s = _qr.get(token); if (!s) return { ok: false, reason: '会话已过期，请重新生成二维码' };
  try {
    const p = s.page;
    if (phone) { try { const pi = p.locator('input[placeholder*="手机"],input[type="tel"]').first(); if (await pi.count()) { await pi.fill(String(phone).trim()); await p.waitForTimeout(400); } } catch {} }
    for (const sel of ['text=获取验证码', 'text=发送验证码', 'text=获取短信验证码', 'text=重新获取']) {
      try { const b = p.locator(sel).first(); if (await b.count()) { await b.click({ timeout: 4000 }); return { ok: true }; } } catch {}
    }
    return { ok: false, reason: '没找到「获取验证码」按钮', info: await _detectVerify(p) };
  } catch (e) { return { ok: false, reason: (e.message || '').slice(0, 100) }; }
}
// 提交验证码完成登录
async function qrSubmitSms(token, code) {
  const s = _qr.get(token); if (!s) return { ok: false, reason: '会话已过期' };
  try {
    const p = s.page;
    try { const ci = p.locator('input[placeholder*="验证码"],input[placeholder*="短信"]').first(); if (await ci.count()) { await ci.fill(String(code).trim()); await p.waitForTimeout(400); } } catch {}
    for (const sel of ['text=登录', 'text=验证并登录', 'text=确认登录', 'text=确认', 'text=验证']) {
      try { const b = p.locator(sel).first(); if (await b.count()) { await b.click({ timeout: 4000 }); break; } } catch {}
    }
    await p.waitForTimeout(3500);
    const cookie = await _grabIfLoggedIn(s);
    if (!cookie) { const ver = await _detectVerify(p); return { ok: false, reason: '验证码提交后仍未登录（码错/过期？）', info: ver }; }
    try { await s.browser.close(); } catch {} _qr.delete(token);
    return { ok: true, cookie };
  } catch (e) { return { ok: false, reason: (e.message || '').slice(0, 100) }; }
}

module.exports = { verifyLogin, publishDraft, parseCookie, startQrLogin, pollQrLogin, qrSendSms, qrSubmitSms };
