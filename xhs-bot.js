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

module.exports = { verifyLogin, parseCookie };
