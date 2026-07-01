/* ===== 美术考研操盘台 · 共享前端逻辑 ===== */
window.$  = (s, r = document) => r.querySelector(s);
window.$$ = (s, r = document) => [...r.querySelectorAll(s)];

/* 自清理：早期/旧服务器可能残留的 Service Worker 会拦截请求长期返回旧版页面，
   且拖慢每次点击的响应（fetch 都要先过一遍 SW），这里强制注销+清空缓存。 */
(function () {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    }
    if (window.caches && caches.keys) {
      caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
    }
  } catch (e) {}
})();

/* 全站 fetch 兜底超时：很多页面各自手写 fetch('/api/...') 没加超时，弱网下请求挂住不返回，
   按钮/页面就会卡死在「加载中」且永不恢复（如手机端登录卡在「登录中…」）。这里统一拦截
   window.fetch，凡是调用方没自带 signal 的请求，超时还没结果就主动 abort，让上层 catch/then
   走到失败分支而不是无限等待。
   ⚠ 兜底超时必须设得足够长（120s）：抓取真实对标(/api/xhs-search 50~55s)、AI 出图/成稿等都是
   合理的慢操作，超时太短会把它们误判成失败（如对标「没抓到」）。需要快超时的页面（登录/充值/
   账户/管理 等）各自传了显式 signal，会走上面的分支、不受这里影响。 */
(function () {
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (init && init.signal) return _fetch(input, init); // 调用方已自带 signal，不重复包一层
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 120000);
    return _fetch(input, { ...(init || {}), signal: ctl.signal }).finally(() => clearTimeout(to));
  };
})();

/* 小红书对标采集插件桥接（复用「朱砂·小红书发布助手」插件）：
   装了插件 + 在浏览器登录小红书后，抓对标走「用户自己的账号 + 住宅 IP」，不限次、不被机房 IP 风控。
   插件 bridge.js 会向页面 postMessage 一个 {__zhusha_ext:'ready'}，据此判断可用；搜索请求走 postMessage 中转。 */
(function () {
  window.xhsExt = {
    available: false, _pend: {}, _seq: 0,
    search(keyword, sort, type) {
      return new Promise((resolve) => {
        const reqId = 'xs' + (++this._seq) + '_' + Date.now();
        this._pend[reqId] = resolve;
        window.postMessage({ type: 'ZHUSHA_XHS_SEARCH', keyword, sort, searchType: type, reqId }, '*'); // 注意：搜索筛选类型用 searchType，不能叫 type，否则会覆盖消息本身的 type 字段
        setTimeout(() => { if (this._pend[reqId]) { const f = this._pend[reqId]; delete this._pend[reqId]; f({ ok: false, error: '插件无响应（请确认已在浏览器登录小红书）' }); } }, 70000);
      });
    },
    // 用本机登录会话抓单篇笔记正文（不走服务器，绕开机房IP反爬/token失效）
    fetchNote(url) {
      return new Promise((resolve) => {
        const reqId = 'xn' + (++this._seq) + '_' + Date.now();
        this._pend[reqId] = resolve;
        window.postMessage({ type: 'ZHUSHA_XHS_FETCH_NOTE', url, reqId }, '*');
        setTimeout(() => { if (this._pend[reqId]) { const f = this._pend[reqId]; delete this._pend[reqId]; f({ ok: false, error: '插件无响应（请确认已在浏览器登录小红书）' }); } }, 70000);
      });
    },
    // 用本机登录会话抓某博主主页的粉丝数（只显示用）；profileUrl=博主主页链接
    fetchFans(profileUrl) {
      return new Promise((resolve) => {
        const reqId = 'xf' + (++this._seq) + '_' + Date.now();
        this._pend[reqId] = resolve;
        window.postMessage({ type: 'ZHUSHA_XHS_FETCH_FANS', url: profileUrl, reqId }, '*');
        setTimeout(() => { if (this._pend[reqId]) { const f = this._pend[reqId]; delete this._pend[reqId]; f({ ok: false, error: '插件无响应' }); } }, 40000);
      });
    }
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__zhusha_ext === 'ready') { window.xhsExt.available = true; window.dispatchEvent(new Event('xhsext-ready')); }
    if ((e.data.type === 'ZHUSHA_XHS_SEARCH_ACK' || e.data.type === 'ZHUSHA_XHS_FETCH_NOTE_ACK' || e.data.type === 'ZHUSHA_XHS_FETCH_FANS_ACK') && e.data.reqId && window.xhsExt._pend[e.data.reqId]) {
      const f = window.xhsExt._pend[e.data.reqId]; delete window.xhsExt._pend[e.data.reqId];
      f(e.data.result || { ok: false, error: '空响应' });
    }
  });
  setTimeout(() => window.postMessage({ type: 'ZHUSHA_EXT_PING' }, '*'), 300); // 插件可能晚于本脚本注入，主动探一次
})();

/* 站内导航预热：多页应用每次点链接都是整页重新加载（重下 HTML/CSS/JS），在高延迟网络下
   「返回工作台/账号矩阵」这类跳转会感觉很卡。鼠标悬停/触屏按下时就提前用 <link rel=prefetch>
   把目标页面预取进浏览器缓存，真正点击时往往已经命中缓存，体感秒开。 */
(function () {
  const done = new Set();
  function warm(href) {
    if (!href || done.has(href)) return; done.add(href);
    const l = document.createElement('link'); l.rel = 'prefetch'; l.href = href; document.head.appendChild(l);
  }
  function onIntent(e) {
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('//') || a.target === '_blank') return;
    warm(href);
  }
  document.addEventListener('mouseover', onIntent, { passive: true });
  document.addEventListener('touchstart', onIntent, { passive: true });
})();

/* 全站共享的 /api/auth/me 请求：同一次页面加载内，登录守卫/顶栏/Cloud 各自都要查登录态，
   不去重会变成 3 个并发请求打到同一个接口，在高延迟网络下白白多等几百 ms 到几秒。
   force=true 用于登录/退出/充值后需要拿最新余额的场景。*/
window.meFetch = function (force) {
  if (force || !window.__mePromise) {
    window.__mePromise = fetch('/api/auth/me').then(r => r.json()).catch(() => ({ ok: false }));
  }
  return window.__mePromise;
};

/* ===== 移动端守卫：核心创作页（大屏工具）在手机/微信内置浏览器上 → 引导去电脑端 =====
   轻页（账户/充值/邀请有礼/帮助/登录/落地）仍可手机使用。*/
(function () {
  try {
    if (!/Android|iPhone|iPod|iPad|Mobile|MicroMessenger/i.test(navigator.userAgent)) return;
    const heavy = ['home', 'pipeline', 'preview', 'compliance', 'agent', 'admin'];
    const page = (document.body && document.body.getAttribute('data-page')) || '';
    if (heavy.includes(page)) { location.replace('/请用电脑.html'); }
  } catch (e) {}
})();

/* ===== 全站登录守卫：未登录 → 跳登录页（带 next 回跳）=====
   公开放行：登录页本身、管理后台（独立令牌）、嵌入态（?embed=1，如流水线里的选题 iframe）。
   登录前先隐藏页面，避免受保护内容闪现；登录确认或放行后再显示。*/
(function () {
  try {
    const path = location.pathname;
    const file = decodeURIComponent(path.split('/').pop() || '');
    const params = new URLSearchParams(location.search);
    const isPublic = path === '/登录.html' || file === '登录.html' || file === '管理.html' || params.get('embed') === '1';
    if (isPublic) return;
    const goLogin = () => { try { sessionStorage.removeItem('zs_auth_ok'); } catch {} location.replace('/登录.html?next=' + encodeURIComponent(location.pathname + location.search)); };
    const de = document.documentElement;
    // 本会话已确认登录 → 立即显示页面，不再为 /api/auth/me 白屏等待（切页瞬开）；后台静默校验
    let cached = false; try { cached = sessionStorage.getItem('zs_auth_ok') === '1'; } catch {}
    if (!cached) de.style.visibility = 'hidden';
    const reveal = () => { de.style.visibility = ''; };
    const safety = setTimeout(reveal, 4000); // 兜底：异常时不至于白屏
    window.meFetch().then(j => {
      clearTimeout(safety);
      if (j && j.ok) { try { sessionStorage.setItem('zs_auth_ok', '1'); } catch {} reveal(); }
      else goLogin(); // 后台校验失败（含已缓存场景）→ 跳登录
    }).catch(() => { clearTimeout(safety); if (cached) reveal(); else goLogin(); }); // 缓存态下网络抖动不误踢
  } catch (e) {}
})();

/* ---- 当前赛道（= 智能体）。配置在 tracks.js ----
   选择优先级：①用户显式选过的 ag_track；②用户自己创建的第一个自定义智能体；③第一个公共赛道。
   （美术考研/职场求职属「平台公共赛道」，不应在用户已有自有智能体时还占据「我的智能体」）*/
window.getTrack = () => {
  if (!window.TRACKS) return null;
  const saved = localStorage.getItem('ag_track');
  if (saved && TRACKS[saved]) return TRACKS[saved];
  const firstCustom = (window.TRACK_ORDER || []).find(id => window.isCustomTrack && window.isCustomTrack(id) && TRACKS[id]);
  if (firstCustom) return TRACKS[firstCustom];
  return TRACKS[(window.TRACK_ORDER || [])[0]] || null;
};
/* 用户是否「拥有/选过」自己的智能体：显式选过 ag_track（含从公共赛道选用），或建过自定义赛道。
   未拥有时顶栏「我的智能体」显示「＋创建」引导，不把公共赛道默认当成用户的智能体。*/
window.hasOwnAgent = () => {
  try { const t = localStorage.getItem('ag_track'); if (t && window.TRACKS && window.TRACKS[t]) return true; } catch {}
  return (window.TRACK_ORDER || []).some(id => window.isCustomTrack && window.isCustomTrack(id) && window.TRACKS && window.TRACKS[id]);
};
/* 切换赛道：清空上一篇所有生成数据（智能体不串味）*/
window.setTrack = id => {
  if (!(window.TRACKS && TRACKS[id])) return;
  const prev = localStorage.getItem('ag_track');
  localStorage.setItem('ag_track', id);
  if (prev && prev !== id) {
    try { localStorage.removeItem('ag_draft'); } catch {}
    ['ag_topic', 'ag_persona', 'ag_direction'].forEach(k => localStorage.removeItem(k));
  }
};

/* ---- 智能体自定义配置（人设覆盖 + 知识库），按赛道存，跟着智能体走 ---- */
window.getAgentConfig = id => { try { return JSON.parse(localStorage.getItem('ag_cfg_' + id) || '{}'); } catch { return {}; } };
window.setAgentConfig = (id, cfg) => localStorage.setItem('ag_cfg_' + id, JSON.stringify(cfg || {}));

/* 生效人设 = 自定义人设(或赛道默认) + 注入的知识库 */
window.effectivePersona = () => {
  const t = getTrack();
  const base = t ? t.persona : '你是资深小红书内容操盘手，第一人称真人感、绝不AI腔；原创不洗稿、不绝对化、不做效果保证、不站外导流、不确定标「需核实」。';
  if (!t) return base;
  const c = getAgentConfig(t.id);
  let p = (c.persona && c.persona.trim()) || base;
  const kbText = key => {
    const parts = [];
    if (c[key] && c[key].trim()) parts.push(c[key].trim());
    const fs = c[key + '_files'];
    if (Array.isArray(fs)) fs.forEach(f => { if (f && f.text) parts.push('（文件：' + (f.name || '') + '）\n' + f.text); });
    return parts.join('\n\n');
  };
  const kb = [];
  let v;
  if ((v = kbText('kb1'))) kb.push('【账号人设资料】\n' + v);
  if ((v = kbText('kb3'))) kb.push('【行业知识 / 事实信息】\n' + v);
  if ((v = kbText('kb2'))) kb.push('【本人爆文风格样本（学语气，绝不照抄）】\n' + v);
  if ((v = kbText('kb4'))) kb.push('【额外违禁 / 红线】\n' + v);
  if (kb.length) p += '\n\n=== 知识库（务必参考，但不得照抄原文、不得据此编造事实）===\n' + kb.join('\n\n');
  // A1③ 防幻觉边界约束：结构化「禁区/必守事实/统一口径」，强制生效于所有下游生成
  const b = c.boundary;
  if (b && (b.forbidden || b.facts || b.tone)) {
    p += '\n\n=== ⛔ 边界约束（最高优先级，必须严格遵守，违反即重写）===';
    if (b.forbidden && b.forbidden.trim()) p += '\n【禁区·绝不出现】' + b.forbidden.trim();
    if (b.facts && b.facts.trim()) p += '\n【必守事实·只能这样说】' + b.facts.trim();
    if (b.tone && b.tone.trim()) p += '\n【统一口径·术语与说法一致】' + b.tone.trim();
    p += '\n以上为硬约束：与之冲突的内容一律不得生成；不确定的信息标「需核实」，不得编造。';
  }
  // 反思机制：累积的「创作偏好」（用户反复修改后沉淀），按此产出减少返工
  if (c.prefs && c.prefs.trim()) p += '\n\n=== 📌 我的创作偏好（请遵循，减少返工）===\n' + c.prefs.trim();
  return p;
};

/* ---- 系统人设：随当前赛道 + 自定义配置切换（所有生成调用默认带上）---- */
Object.defineProperty(window, 'PERSONA', { configurable: true, get() { return effectivePersona(); } });

/* 全局图片灯箱：点任意 img.zoomable 放大查看，点背景/ESC 关闭 */
window.showLightbox = function (src) {
  let lb = document.getElementById('__lightbox');
  if (!lb) {
    lb = document.createElement('div'); lb.id = '__lightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.82);display:none;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
    lb.innerHTML = '<img alt="放大图" style="max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.55)"/>';
    document.body.appendChild(lb);
    lb.addEventListener('click', () => { lb.style.display = 'none'; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.style.display = 'none'; });
  }
  lb.innerHTML = '<img alt="放大图" style="max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.55)"/>';
  lb.querySelector('img').src = src; lb.style.display = 'flex';
};
// 放大「带叠字的封面卡」：显示合成后的整张卡（底图 + CSS 叠字），而不是裸底图（否则放大看不到标题）
window.showLightboxNode = function (frameEl) {
  let lb = document.getElementById('__lightbox');
  if (!lb) { window.showLightbox(''); lb = document.getElementById('__lightbox'); lb.style.display = 'none'; }
  const ar = (getComputedStyle(frameEl).aspectRatio || '').replace(/\s/g, '') || '3/4';
  const clone = frameEl.cloneNode(true);
  clone.style.cssText = 'width:min(90vw,64vh);aspect-ratio:' + ar + ';container-type:inline-size;border-radius:12px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.55);cursor:zoom-out';
  lb.innerHTML = ''; lb.appendChild(clone); lb.style.display = 'flex';
};
document.addEventListener('click', e => {
  const img = e.target && e.target.closest && e.target.closest('img.zoomable');
  if (!img) return;
  const frame = img.closest('.cv-frame');
  const overlay = frame && frame.querySelector('.cv-card, .cv-coverx, .cv-poster');
  if (frame && overlay) { e.stopPropagation(); window.showLightboxNode(frame); return; } // 有叠字 → 放大合成卡
  if (img.src) { e.stopPropagation(); window.showLightbox(img.src); }
});

/* 配图视觉风格（智能体页设置，S6 配图统一画风）。留空＝跟对标图走 */
window.agentImgStyle = () => { const t = getTrack(); if (!t) return ''; return (((getAgentConfig(t.id).imgStyle) || t.defaultImgStyle || '')).trim(); };
/* 配图风格库（上传的参考图）：没有对标垫图时，用第1张当垫图统一调性 */
window.agentStyleRefs = () => { const t = getTrack(); if (!t) return []; const r = getAgentConfig(t.id).styleRefs; return Array.isArray(r) ? r.map(x => typeof x === 'string' ? x : (x && x.url)).filter(Boolean) : []; };
/* 风格库每张图的「提示词模板」（与 agentStyleRefs 同序）；没有则空串 */
window.agentStyleRefPrompts = () => { const t = getTrack(); if (!t) return []; const r = getAgentConfig(t.id).styleRefs; if (!Array.isArray(r)) return []; return r.filter(x => typeof x === 'string' ? x : (x && x.url)).map(x => (x && typeof x === 'object' && x.prompt) ? x.prompt : ''); };

/* ---- 云端历史/作品库（登录后按账号存，跨设备）。未登录则各页回退 localStorage ---- */
window.Cloud = {
  _logged: null,
  async loggedIn() { if (this._logged !== null) return this._logged; try { const j = await window.meFetch(); this._logged = !!(j && j.ok); } catch { this._logged = false; } return this._logged; },
  async list() { try { const j = await (await fetch('/api/history')).json(); return j.ok ? j.list : []; } catch { return []; } },
  async get(id) { try { const j = await (await fetch('/api/history/get?id=' + encodeURIComponent(id))).json(); return j.ok ? j.data : null; } catch { return null; } },
  async save(rec) { try { await fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }); } catch {} },
  async del(id) { try { await fetch('/api/history/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); } catch {} },
};

/* 智能体配置云端（人设/KB/skills/配图风格，按账号跨设备）*/
window.CloudAgent = {
  async all() { try { const j = await (await fetch('/api/agent-config/all')).json(); return j.ok ? j.list : []; } catch { return []; } },
  async save(trackId, config) { try { await fetch('/api/agent-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trackId, config }) }); } catch {} },
};
// 登录后把云端智能体配置同步进 localStorage（供 effectivePersona 同步读取）。返回是否同步过。
window.syncAgentConfigsDown = async () => {
  if (!(await Cloud.loggedIn())) return false;
  const list = await CloudAgent.all();
  list.forEach(x => { if (x.trackId) localStorage.setItem('ag_cfg_' + x.trackId, JSON.stringify(x.config || {})); });
  return true;
};

/* ---- 深色模式 ---- */
(function theme() {
  const root = document.documentElement;
  function apply(t) { root.setAttribute('data-theme', t); document.querySelectorAll('#themeToggle, .theme-toggle').forEach(b => b.textContent = (t === 'dark' ? '☀️' : '🌙')); }
  apply(localStorage.getItem('ag_theme') || 'light');
  document.addEventListener('click', e => {
    if (e.target.closest('#themeToggle') || e.target.closest('.theme-toggle')) {
      const t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      apply(t); localStorage.setItem('ag_theme', t);
    }
  });
})();

/* 各动作积分单价（与服务端 price_rules 一致，用于「执行前」预检提示；服务端 402 仍是最终闸） */
window.ACTION_COST = { text: 3, topic: 5, skeleton: 5, frame: 5, copy: 10, cover: 0, rule_query: 5, imgplan: 0, compliance: 0 };
window.__balance = null; // 当前余额（accountNav 拉 me 时写入，每次扣费后刷新）
/* 积分不足全局弹框：直接引导去充值（任何页面通用，内联样式不依赖额外 CSS）*/
window.creditModal = function (need, bal) {
  if (document.getElementById('agCreditMask')) return;
  const m = document.createElement('div'); m.id = 'agCreditMask';
  m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(17,19,24,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px';
  m.innerHTML = '<div style="background:var(--paper,#fff);border-radius:18px;width:min(360px,92vw);padding:24px 22px;box-shadow:0 30px 70px -20px rgba(0,0,0,.5);text-align:center">'
    + '<div style="font-size:34px">💎</div>'
    + '<div style="font-size:17px;font-weight:800;margin-top:6px;color:var(--ink,#222)">积分不足</div>'
    + '<div style="font-size:13px;color:var(--ink-soft,#9499a0);line-height:1.7;margin-top:8px">本次约需 <b style="color:var(--cinnabar,#ff2442)">' + (need ?? '') + '</b> 积分，当前余额 <b>' + (bal ?? 0) + '</b>。<br>充值后即可继续生成。</div>'
    + '<div style="display:flex;gap:10px;margin-top:18px">'
    + '<button id="agCreditCancel" style="flex:1;height:42px;border-radius:999px;border:1px solid var(--line,#eee);background:var(--paper,#fff);color:#555;font-size:14px;cursor:pointer">再想想</button>'
    + '<a href="/充值.html" style="flex:1;height:42px;border-radius:999px;background:var(--cinnabar,#ff2442);color:#fff;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;text-decoration:none">去充值 →</a>'
    + '</div></div>';
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', e => { if (e.target === m || e.target.id === 'agCreditCancel') close(); });
};
/* ---- 调用 Claude（经本地代理 /api/claude，key 在服务端）---- */
window.callClaude = async function ({ system, prompt, model, max_tokens = 2000, json = false, action }) {
  // A1/B1：执行「前」预检余额，不足直接提示充值、不发起请求（避免执行中才弹）
  const cost = (action && window.ACTION_COST[action] != null) ? window.ACTION_COST[action] : window.ACTION_COST.text;
  if (cost > 0 && window.__balance != null && window.__balance < cost) {
    try { window.creditModal(cost, window.__balance); } catch {}
    throw new Error('积分不足：本次约需 ' + cost + ' 积分，当前余额 ' + window.__balance + '。请先充值后再生成。');
  }
  let res, text;
  // 上游网关瞬时错误(502/503/504)/超时/网络抖动 → 自动重试，最多 3 次，避免一次抖动就中断整条流水线
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch('/api/claude', {
        method: 'POST',
        signal: AbortSignal.timeout(90000), // 90s 超时，避免上游卡住时"一直加载不出来"
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model || localStorage.getItem('ag_model') || 'claude-opus-4-8',
          max_tokens,
          system: system || PERSONA,
          messages: [{ role: 'user', content: prompt }],
          json,
          action: action || 'text',
        }),
      });
    } catch (e) {
      const transient = e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /Failed to fetch|NetworkError|network/i.test(String((e && e.message) || e)));
      if (transient && attempt < 3) { await new Promise(r => setTimeout(r, attempt * 1500)); continue; }
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error('生成超时（90 秒无响应），请重试');
      throw new Error('连不上服务，请重试');
    }
    text = await res.text();
    if ([502, 503, 504].includes(res.status) && attempt < 3) { await new Promise(r => setTimeout(r, attempt * 1500)); continue; } // 网关瞬时错误重试
    break;
  }
  if (!res.ok) {
    let parsed = null; try { parsed = JSON.parse(text); } catch {}
    let msg = parsed?.error?.message || parsed?.error || text;
    const code = parsed?.code;
    if (res.status === 401 && code === 'NEED_LOGIN') msg = '请先到「账户」页登录再生成';
    else if (res.status === 402) { try { window.creditModal(parsed?.need, parsed?.balance); } catch {} msg = `积分不足，请去充值（本次需 ${parsed?.need ?? ''}，余额 ${parsed?.balance ?? ''}）`; }
    else if (res.status === 401 || res.status === 403) msg = '上游模型拒绝请求（API key 失效 / 欠费 / 被风控）。请在 .env 换一把有效的 ANTHROPIC_API_KEY 或更换模型后重启服务。原始：' + String(msg).slice(0, 80);
    else if (res.status === 0 || /Failed to fetch/.test(msg)) msg = '连不上本地服务，请先运行 node server.js';
    throw new Error('HTTP ' + res.status + ' · ' + String(msg).slice(0, 200));
  }
  const data = JSON.parse(text);
  if (typeof data.balance === 'number') window.__balance = data.balance; // 扣费后同步余额，供下次预检
  return (data.content || []).map(b => b.text || '').join('').trim();
};

/* 修复模型常吐的非法 JSON：转义字符串内的裸换行/制表符 + 在缺逗号处补逗号（状态机，逐字符判断） */
window.repairJSON = function (s) {
  let out = '', inStr = false, esc = false, prev = '';
  // 下一个非空白字符（用于判断引号是否真的在结束字符串）
  const nextSig = (i) => { for (let j = i + 1; j < s.length; j++) { if (!/\s/.test(s[j])) return s[j]; } return ''; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') {
        // 只有当后面紧跟 , } ] : 或到结尾时，这个引号才是真的「字符串结束」；
        // 否则是值里没转义的内层引号（AI 常见错误，如 …"美术考研红黑榜"…）→ 自动转义，继续留在字符串里
        const nx = nextSig(i);
        if (nx === ',' || nx === '}' || nx === ']' || nx === ':' || nx === '') { inStr = false; out += c; prev = '"'; continue; }
        out += '\\"'; continue;
      }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      out += c; continue;
    }
    if (/\s/.test(c)) { out += c; continue; }
    // 上一个有意义字符是“值的结尾”("/}/]/数字/字母)，又冒出新的 " 或 { 或 [ → 中间漏了逗号，补上
    if ((c === '"' || c === '{' || c === '[') && /["}\]\w]/.test(prev)) out += ',';
    if (c === '"') inStr = true;
    out += c; prev = c;
  }
  return out;
};
/* 从模型回复里抠出第一个 JSON 对象/数组；解析失败时自动修复后重试 */
window.extractJSON = function (txt) {
  let s = (txt || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = s.search(/[\[{]/);
  const b = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  const noTrail = x => x.replace(/,\s*([}\]])/g, '$1'); // 去掉尾逗号
  try { return JSON.parse(noTrail(s)); }
  catch (e) {
    try { return JSON.parse(noTrail(window.repairJSON(s))); } // 修复后再试
    catch { throw e; } // 仍失败 → 抛原始错误
  }
};

/* 文本安全 + **加粗** + 高亮「需核实」。容错：非字符串（数组/对象/数字）一律转成字符串，避免 .replace 崩 */
window.mark = function (t) {
  if (t == null) t = '';
  else if (typeof t !== 'string') { if (Array.isArray(t)) t = t.join(' '); else if (typeof t === 'object') t = (t.text || t.title || t.content || JSON.stringify(t)); else t = String(t); }
  // AI 有时不用 ==高亮== 而误吐 <hl>/<mark> 标签 → 先归一成 ==…==，并清掉落单标签
  let raw = String(t)
    .replace(/<\s*(hl|mark)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, '==$2==')
    .replace(/<\s*\/?\s*(hl|mark)\s*>/gi, '');
  let s = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/@@(.+?)@@/g, '<span class="hl-circle">$1</span>'); // 红圈强调（手帐封面卡片里显示为手画红圈）
  s = s.replace(/==(.+?)==/g, '<span class="hl">$1</span>'); // 橙色高亮强调
  s = s.replace(/={2,}/g, '').replace(/@@/g, '').replace(/\*\*/g, ''); // 清掉 AI 截断/落单的标记残留（如末尾 ====、孤立 @@/**）
  return s.replace(/需核实/g, '<span class="needverify">需核实</span>');
};

/* ---- 跨页草稿（流水线 → 成稿/合规 互通）---- */
window.Draft = {
  // 配额安全：localStorage 上限约 5MB，data: 图（base64）很容易撑爆 → setItem 抛 QuotaExceeded 会中断生成流程。
  // 这里捕获后逐步剔除最重的 data: 图片再存（只影响"持久化"，内存里的 state 不动，本次会话照常用），绝不抛错。
  save(obj) {
    const cur = this.load();
    const full = { ...cur, ...obj, _ts: Date.now() };
    const setit = o => localStorage.setItem('ag_draft', JSON.stringify(o));
    try { setit(full); return; } catch (e) {}
    const slim = (() => { try { return JSON.parse(JSON.stringify(full)); } catch { return full; } })();
    const stripData = a => Array.isArray(a) ? a.map(u => (typeof u === 'string' && u.startsWith('data:')) ? '' : u) : a;
    // 1) 剔除封面里的 data: 大图（保留 note:// / ctpl:// / 普通链接 与全部文字排版）
    try { slim.coverImages = stripData(slim.coverImages); if (typeof slim.coverImage === 'string' && slim.coverImage.startsWith('data:')) slim.coverImage = ''; setit(slim); return; } catch (e) {}
    // 2) 再剔除对标图 data:
    try { slim.refImages = stripData(slim.refImages); setit(slim); return; } catch (e) {}
    // 3) 实在存不下 → 丢弃图片字段只保文字（不抛错，避免中断生成）
    try { delete slim.coverImages; delete slim.coverImage; delete slim.refImages; setit(slim); return; } catch (e) {}
    // 4) 仍存不下（多为其它 key 占满 localStorage）→ 兜底只存「下游导入必需」的文字核心，
    //    保证合规自检/成稿预览能拿到这篇内容，绝不出现「跳转后为空」。
    try {
      const core = { _ts: Date.now(), topic: full.topic, platform: full.platform,
        title: full.title, best: full.best, titles: full.titles, body: full.body, tags: full.tags,
        cover: full.cover, cover_lines: full.cover_lines, frame: full.frame, summary: full.summary,
        imgRatio: full.imgRatio, notePages: full.notePages };
      setit(core); return;
    } catch (e) {}
    // 5) 连文字核心都存不下（localStorage 几乎被别的 key 塞满）→ 先腾出历史记录再存一次
    try { localStorage.removeItem('ag_pl_history'); const core = { _ts: Date.now(), topic: full.topic, platform: full.platform, title: full.title, best: full.best, titles: full.titles, body: full.body, tags: full.tags, cover: full.cover, cover_lines: full.cover_lines, frame: full.frame, summary: full.summary, imgRatio: full.imgRatio }; setit(core); return; } catch (e) {}
    try { console.warn('Draft.save: storage quota exceeded, persist skipped'); } catch {}
  },
  load() { try { return JSON.parse(localStorage.getItem('ag_draft') || '{}'); } catch { return {}; } },
  clear() { localStorage.removeItem('ag_draft'); },
};

/* ---- 健康检查：把 #healthDot / #healthTxt 点亮 ---- */
window.checkHealth = async function () {
  const dot = $('#healthDot'), txt = $('#healthTxt');
  try {
    const r = await fetch('/api/health'); const j = await r.json();
    if (j.keyPresent) { dot && (dot.className = 'dot ok'); txt && (txt.textContent = '服务已就绪'); }
    else { dot && (dot.className = 'dot err'); txt && (txt.textContent = '服务未就绪'); }
    return j;
  } catch {
    dot && (dot.className = 'dot err'); txt && (txt.textContent = '未连接服务');
    return { ok: false };
  }
};

/* ===== 全局外壳：左侧品牌边栏 + 顶部操作栏（参考工作台范式 · 朱砂红）===== */
const PAGE_TITLES = { home: '工作台', topic: '第一步 · 选题', pipeline: '创作流水线', preview: '成稿预览', compliance: '合规自检', agent: '智能体设置', account: '我的账户', recharge: '充值积分', help: '联系客服', admin: '管理后台', matrix: '账号矩阵' };
function escN(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* 注入外壳骨架（只建一次）：边栏 + 顶栏 */
window.buildShell = function () {
  const body = document.body;
  if (document.getElementById('agSide')) return;
  body.classList.add('ag-shelled');
  const cur = body.getAttribute('data-page');
  const side = document.createElement('aside'); side.id = 'agSide'; side.className = 'ag-side';
  side.innerHTML =
    `<a href="/" class="ag-brand"><img src="/assets/logo-mark.svg" alt="朱砂"/><div><div class="bn">朱砂 · 操盘台</div><div class="bs">VERTICAL AGENT STUDIO</div></div></a>
     <a href="/流水线.html?new=1" class="ag-create">✍️ 开始创作笔记</a>
     <a href="/账号矩阵.html" class="ag-growth-cta">🎯 获客 · 账号矩阵</a>
     <div class="ag-side-hint">选题 → 对标拆解 → 框架 → 正文 → 标题 → 封面 → 标签 → 合规自检，一条流水线出一篇可发笔记。</div>
     <div class="ag-grow"></div>
     <div class="ag-usage" id="agUsage"></div>`;
  const top = document.createElement('div'); top.className = 'ag-top'; top.id = 'agTop';
  const backBtn = (cur && cur !== 'home') ? `<button class="ag-tbtn ag-back" id="agBack" title="返回上一页">← 返回</button>` : '';
  top.innerHTML =
    `<div class="ag-top-l"><button class="ag-burger" id="agBurger" aria-label="菜单">☰</button>${backBtn}<span class="ag-title" id="agTitle">${PAGE_TITLES[cur] || '工作台'}</span><div class="ag-tracks" id="agTracks"></div></div>
     <div class="ag-top-r" id="agTopR"></div>`;
  body.insertBefore(side, body.firstChild);
  side.after(top);
  document.getElementById('agBurger')?.addEventListener('click', () => body.classList.toggle('ag-side-open'));
  body.addEventListener('click', e => { if (body.classList.contains('ag-side-open') && !e.target.closest('#agSide') && !e.target.closest('#agBurger')) body.classList.remove('ag-side-open'); });
};
/* 智能返回：同源且非登录页来路 → 后退一页（最流畅）；否则回工作台首页。
   兜底：history.back() 若 250ms 内没真正离开本页（同源同址/缓存项→点了没反应），强制回工作台。 */
window.agSmartBack = function () {
  try {
    const here = location.href;
    const ref = document.referrer;
    if (ref && new URL(ref).origin === location.origin && new URL(ref).href !== here && !/\/(登录|login)\.html/.test(ref) && history.length > 1) {
      let left = false;
      window.addEventListener('pagehide', () => { left = true; }, { once: true });
      history.back();
      setTimeout(() => { if (!left && location.href === here) location.href = '/'; }, 250);
      return;
    }
  } catch {}
  location.href = '/';
};
/* 顶栏「← 返回」用事件委托绑定，避免 shell 重建后丢监听导致点了没反应 */
document.addEventListener('click', e => { if (e.target.closest('#agBack')) { e.preventDefault(); window.agSmartBack(); } });

/* 顶栏赛道选择 chips（= 我的智能体 / 平台公共赛道 切换；赛道变更/账号切换后重建）。
   点 chip → 切换当前赛道并进入该智能体；✕ 删自定义赛道；＋新增 → 首页新建流程。*/
window.buildMyAgentNav = function () {
  const el = document.getElementById('agTracks'); if (!el) return;
  const order = window.TRACK_ORDER || [];
  const isHome = document.body.getAttribute('data-page') === 'home';
  const tk = (typeof getTrack === 'function') ? getTrack() : null;
  const curId = tk ? tk.id : null;
  const curName = tk ? tk.name : '智能体';
  const trackItems = order.map(id => {
    const t = window.TRACKS && window.TRACKS[id]; if (!t) return '';
    const isC = window.isCustomTrack && window.isCustomTrack(id);
    return `<div class="ag-dd-item ${id === curId ? 'on' : ''}" data-id="${id}"><span>${t.emoji || '🧩'} ${escN(t.name)}${isC ? ' <i class="trk-mine">我的</i>' : ''}</span>${isC ? `<span class="ag-dd-x" data-del="${id}" title="删除赛道">✕</span>` : ''}</div>`;
  }).join('');
  // 顶栏合并为两个下拉：内容生成 Agent（赛道+新增+设置）/ 获客 Agent（矩阵+养号+发布）
  el.innerHTML = `
    <div class="ag-dd">
      <button class="ag-dd-btn on" type="button">✍️ 内容生成 · ${escN(curName)} <i>▾</i></button>
      <div class="ag-dd-menu">
        <div class="ag-dd-h">切换赛道智能体</div>
        ${trackItems}
        <a href="/?create=1" class="ag-dd-item add">＋ 新增赛道</a>
        <div class="ag-dd-sep"></div>
        <a href="/智能体.html" class="ag-dd-item">⚙ 智能体设置 · ${escN(curName)}</a>
      </div>
    </div>
    <div class="ag-dd">
      <button class="ag-dd-btn" type="button">🎯 获客 Agent <i>▾</i></button>
      <div class="ag-dd-menu">
        <a href="/设备看板.html" class="ag-dd-item">📡 设备看板（投屏）</a>
        <a href="/账号矩阵.html" class="ag-dd-item">🗂 账号矩阵</a>
        <a href="/获客计划.html" class="ag-dd-item">🌱 养号 / 截流计划</a>
        <a href="/话术库.html" class="ag-dd-item">💬 话术库</a>
        <a href="/评论收集.html" class="ag-dd-item">👥 评论收集（潜客）</a>
        <a href="/数据复盘.html" class="ag-dd-item">📈 数据复盘（红线）</a>
        <a href="/一键发布.html" class="ag-dd-item">🚀 一键发布</a>
      </div>
    </div>`;
  el.querySelectorAll('.ag-dd-btn').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); const dd = b.parentElement; const wasOpen = dd.classList.contains('open');
    el.querySelectorAll('.ag-dd').forEach(x => x.classList.remove('open'));
    if (!wasOpen) dd.classList.add('open');
  }));
  if (!window.__ddCloseBound) { window.__ddCloseBound = 1; document.addEventListener('click', () => document.querySelectorAll('.ag-dd.open').forEach(x => x.classList.remove('open'))); }
  el.querySelectorAll('.ag-dd-item[data-id]').forEach(b => b.addEventListener('click', e => {
    const del = e.target && e.target.dataset && e.target.dataset.del;
    if (del) {
      e.stopPropagation();
      const nm = (window.TRACKS[del] && window.TRACKS[del].name) || del;
      if (!confirm('删除赛道「' + nm + '」？该智能体的配置也会一并移除。')) return;
      try { if (localStorage.getItem('ag_track') === del) localStorage.removeItem('ag_track'); } catch {}
      try { localStorage.removeItem('ag_cfg_' + del); } catch {}
      if (window.removeCustomTrack) window.removeCustomTrack(del);
      location.href = isHome ? '/' : '/流水线.html'; return;
    }
    if (typeof setTrack === 'function') setTrack(b.dataset.id);
    location.href = isHome ? '/' : '/流水线.html';
  }));
};

/* 账号隔离：检测到登录账号变化（含首次登录 / 切号 / 登出），清掉上一个账号残留的
   「当前赛道选择 + 草稿」，并按新账号重载该账号自己的自定义赛道（不串味）。
   返回 true 表示发生了切换（需要重建「我的智能体」导航）。*/
window.syncAccountScope = function (me) {
  const who = (me && me.ok && me.phone) ? String(me.phone) : '';
  let prev = null; try { prev = localStorage.getItem('ag_acct'); } catch {}
  if (prev === who) return false;            // 账号未变（同号刷新 / 都未登录）
  const firstEver = (prev === null);
  try { localStorage.setItem('ag_acct', who); } catch {}
  if (firstEver && who === '') return false; // 首访且未登录：仅记录，不算切换
  // 账号变化 → 清残留选择 + 按新账号重载自定义赛道
  try {
    localStorage.removeItem('ag_track');
    ['ag_draft', 'ag_topic', 'ag_persona', 'ag_direction'].forEach(k => localStorage.removeItem(k));
  } catch {}
  if (typeof window.reloadCustomTracks === 'function') window.reloadCustomTracks();
  return true;
};

/* 退出登录：清会话 → 回登录页（全站需登录，退出即回登录）*/
window.doLogout = async function () {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  try { if (window.Cloud) Cloud._logged = false; } catch {}
  location.href = '/登录.html';
};

/* 顶栏账户区 + 边栏用量卡（登录/退出/切号/充值后即时重建，无需刷新整页）*/
window.refreshTopNav = async function (force) {
  const topR = document.getElementById('agTopR'); const usage = document.getElementById('agUsage');
  if (!topR) return;
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let me = null; try { me = await window.meFetch(force); } catch {}
  // 账号隔离：账号变化 → 清残留赛道选择，并重建边栏导航
  if (typeof syncAccountScope === 'function' && syncAccountScope(me) && typeof buildMyAgentNav === 'function') buildMyAgentNav();
  window.__me = (me && me.ok) ? me : null;
  const darkIcon = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙');
  if (me && me.ok) {
    if (typeof me.balance === 'number') window.__balance = me.balance;
    const nick = me.nickname || ('用户' + (me.phone || '').slice(-4));
    const av = (nick[0] || '朱').toUpperCase();
    // 账户身份 / 积分 / 退出 已在左下角用量卡，顶栏不再放账户下拉。管理员显示「管理后台」直达。
    const adminBtn = me.isAdmin ? `<a href="/管理.html" class="ag-tbtn admin">🛠 管理后台</a>` : '';
    const themeLabel = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式');
    topR.innerHTML =
      `${adminBtn}
       <a href="/邀请有礼.html" class="ag-tbtn gift">🎁 邀请有礼</a>
       <a href="/充值.html" class="ag-tbtn primary">＋ 充值</a>
       <a href="/帮助.html" class="ag-tbtn">💬 联系客服</a>
       <div class="ag-drop" id="agSetDrop">
         <button class="ag-tbtn" id="agSetBtn" aria-label="设置" title="设置">⚙ 设置</button>
         <div class="ag-menu" id="agSetMenu">
           <a href="/智能体.html">⚙ 智能体设置</a>
           <a href="/账户.html">👤 个人中心 · 积分</a>
           <a id="agThemeItem">${themeLabel()}</a>
           <a id="agLogout" style="color:var(--cinnabar-deep)">🚪 退出登录</a>
         </div>
       </div>`;
    // 设置下拉：点击开合 + 外部点击关闭（监听绑一次到 document，避免 refreshTopNav 重复调用时叠加重复监听器）
    const drop = document.getElementById('agSetDrop');
    document.getElementById('agSetBtn')?.addEventListener('click', e => { e.stopPropagation(); drop?.classList.toggle('open'); });
    if (!window.__setDropCloseBound) {
      window.__setDropCloseBound = 1;
      document.addEventListener('click', e => { const d = document.getElementById('agSetDrop'); if (d && !e.target.closest('#agSetDrop')) d.classList.remove('open'); });
    }
    // 主题切换（菜单内，带文字标签，不复用 .theme-toggle 以免标签被覆盖）
    document.getElementById('agThemeItem')?.addEventListener('click', () => {
      const root = document.documentElement;
      const t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', t); localStorage.setItem('ag_theme', t);
      document.querySelectorAll('#themeToggle, .theme-toggle').forEach(b => b.textContent = (t === 'dark' ? '☀️' : '🌙'));
      const it = document.getElementById('agThemeItem'); if (it) it.textContent = (t === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式');
    });
    document.getElementById('agLogout')?.addEventListener('click', doLogout);
    if (usage) {
      usage.innerHTML =
        `<div class="uprofile"><div class="uava">${av}</div><div class="uinfo"><div class="unick">${esc(nick)}</div><div class="ulvl">${esc(me.level || '普通会员')}${me.isAdmin ? ' · 管理员' : (me.isPartner ? ' · 合伙人' : '')}</div></div></div>
         <div class="row"><span class="v">💎 ${me.balance}</span><span class="l">可用积分</span></div>
         <div class="uout-row"><button class="uout" id="agSideAcct">个人中心</button><button class="uout" id="agSideLogout">退出 →</button></div>`;
      document.getElementById('agSideAcct')?.addEventListener('click', () => location.href = '/账户.html');
      document.getElementById('agSideLogout')?.addEventListener('click', doLogout);
    }
  } else {
    topR.innerHTML =
      `<a href="/充值.html" class="ag-tbtn">＋ 充值</a>
       <a href="/帮助.html" class="ag-tbtn">💬 联系客服</a>
       <a href="/登录.html" class="ag-tbtn primary">登录 / 注册</a>
       <button class="theme-toggle" title="深色 / 浅色">${darkIcon()}</button>`;
    if (usage) { usage.innerHTML = `<button class="uout" id="agSideLogin">登录 / 注册 →</button>`; document.getElementById('agSideLogin')?.addEventListener('click', () => location.href = '/登录.html'); }
  }
};

/* 启动：建外壳 → 边栏导航 → 账户/用量 */
document.addEventListener('DOMContentLoaded', () => {
  buildShell();
  buildMyAgentNav();
  if (document.body.getAttribute('data-page') !== 'agent') { try { syncAgentConfigsDown(); } catch {} }
  refreshTopNav();
  if ($('#healthDot') || $('#healthTxt')) checkHealth();
});

/* ===== 全站悬浮「小红书助手」Agent 入口：默认首次打开，可直接问规则/用法 ===== */
(function xhsAssistant() {
  if (window.__xhsWidget) return; window.__xhsWidget = 1;
  const cin = 'var(--cinnabar,#ff2442)';
  let loaded = false, KB = '', DOCS = [], FAQ = [], RULES = [];
  function ensureHelpKB() { return new Promise(r => { if (window.HELP_DOCS) return r(); const s = document.createElement('script'); s.src = '/assets/help-kb.js?v=5'; s.onload = () => r(); s.onerror = () => r(); document.head.appendChild(s); }); }
  async function loadKB() {
    if (loaded) return; loaded = true;
    await ensureHelpKB();
    DOCS = window.HELP_DOCS || []; FAQ = window.HELP_FAQ || []; RULES = window.XHS_RULES || [];
    try { const k = await (await fetch('/api/help-kb')).json(); if (k && k.ok) { if (k.docs && k.docs.length) DOCS = k.docs; if (k.faq && k.faq.length) FAQ = k.faq; if (k.rules && k.rules.length) RULES = k.rules; } } catch {}
    const RM = window.XHS_RULES_META || { src: '', date: '' };
    KB = '【小红书/微信公众号规则要点（以官方为准；回答时请附带「出处/更新日期」）】\n' + RULES.map((x, i) => `[规则${i + 1}] ${x.t}：${x.d}（出处：${x.src || RM.src || '小红书官方'}｜更新：${x.date || RM.date || '需核实'}）`).join('\n')
      + '\n\n【本产品操作文档】\n' + DOCS.map((x, i) => `[文档${i + 1}] ${x.q}：${String(x.a).replace(/\*\*/g, '').slice(0, 240)}`).join('\n')
      + '\n\n【常见问题 FAQ】\n' + FAQ.map((x, i) => `[FAQ${i + 1}] ${x.q}：${String(x.a).replace(/\*\*/g, '').slice(0, 220)}`).join('\n');
  }
  function el(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function mk(t) { return window.mark ? window.mark(t) : String(t || ''); }
  // 悬浮按钮：左侧中部（避开右下角「一键对标生成」等按钮）
  const fab = el(`<button id="xhsFab" title="创作助手 · 帮助中心" style="position:fixed;right:22px;bottom:22px;z-index:130;width:54px;height:54px;border-radius:50%;border:none;cursor:pointer;background:${cin};color:#fff;font-size:24px;box-shadow:0 8px 24px -6px rgba(255,36,66,.5)">📕</button>`);
  const panel = el(`<div id="xhsPanel" style="position:fixed;right:22px;bottom:88px;z-index:131;width:min(380px,93vw);height:min(540px,82vh);background:var(--paper,#fff);color:var(--ink,#222);border:1px solid var(--line,#eee);border-radius:16px;box-shadow:0 18px 50px -12px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden">
    <div id="xhsHeader" style="background:${cin};color:#fff;padding:11px 14px;display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none">
      <div style="font-weight:700;font-size:14px">📕 创作助手 · 帮助中心（小红书+公众号） <span style="opacity:.7;font-weight:400;font-size:11px">⠿ 可拖动</span></div>
      <button id="xhsClose" title="收起" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1">×</button></div>
    <div style="display:flex;border-bottom:1px solid var(--line,#eee);font-size:12.5px">
      <button class="xhs-tab" data-t="doc" style="flex:1;border:none;background:none;padding:9px 0;cursor:pointer;font-weight:600">📘 操作文档</button>
      <button class="xhs-tab" data-t="faq" style="flex:1;border:none;background:none;padding:9px 0;cursor:pointer">❓ 常见问题</button>
      <button class="xhs-tab" data-t="chat" style="flex:1;border:none;background:none;padding:9px 0;cursor:pointer">💬 问助手</button>
    </div>
    <div id="xhsDoc" class="xhs-pane" style="flex:1;overflow-y:auto;padding:12px;font-size:13px;line-height:1.8;background:var(--paper-2,#f7f7f8)"></div>
    <div id="xhsFaq" class="xhs-pane" style="flex:1;overflow-y:auto;padding:12px;font-size:13px;line-height:1.8;background:var(--paper-2,#f7f7f8);display:none"></div>
    <div id="xhsChatPane" class="xhs-pane" style="flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--paper-2,#f7f7f8)">
      <div id="xhsBody" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.7"></div>
      <div style="display:flex;gap:6px;padding:10px;border-top:1px solid var(--line,#eee);background:var(--paper,#fff)">
        <input id="xhsInput" placeholder="问规则/用法，按回车" style="flex:1;border:1px solid var(--line,#eee);border-radius:10px;padding:8px 10px;font-size:13px;background:var(--paper-2,#f7f7f8);color:inherit"/>
        <button id="xhsSend" style="border:none;background:${cin};color:#fff;border-radius:10px;padding:0 14px;cursor:pointer;font-size:13px">发送</button></div>
    </div></div>`);
  function accHTML(list) {
    if (!list.length) return '<div style="color:var(--ink-soft,#999);font-size:12px">加载中…</div>';
    return list.map((x, i) => `<div class="xhs-acc" style="border:1px solid var(--line,#eee);border-radius:10px;background:var(--paper,#fff);margin-bottom:8px;overflow:hidden">
      <div class="xhs-acc-h" style="padding:10px 12px;cursor:pointer;font-weight:600;display:flex;justify-content:space-between;gap:8px">${x.q}<span style="color:var(--ink-soft,#999)">${i === 0 ? '▾' : '▸'}</span></div>
      <div class="xhs-acc-b" style="padding:0 12px 11px;color:var(--ink-soft,#666);white-space:pre-wrap;${i === 0 ? '' : 'display:none'}">${mk(x.a)}</div></div>`).join('');
  }
  function bindAcc(pane) { pane.querySelectorAll('.xhs-acc-h').forEach(h => h.addEventListener('click', () => { const b = h.nextElementSibling, open = b.style.display !== 'none'; b.style.display = open ? 'none' : 'block'; h.querySelector('span').textContent = open ? '▸' : '▾'; })); }
  function add(role, html) { const b = document.getElementById('xhsBody'); const m = document.createElement('div'); m.style.cssText = role === 'q' ? `align-self:flex-end;max-width:85%;background:${cin};color:#fff;border-radius:10px;padding:8px 11px` : 'align-self:flex-start;max-width:94%;background:var(--paper,#fff);border:1px solid var(--line,#eee);border-radius:10px;padding:8px 11px;white-space:pre-wrap'; m.innerHTML = html; b.appendChild(m); b.scrollTop = b.scrollHeight; return m; }
  async function ask() {
    const inp = document.getElementById('xhsInput'); const q = (inp.value || '').trim(); if (!q) return; inp.value = '';
    add('q', mk(q)); const wait = add('a', '查询中…'); await loadKB();
    try {
      const ans = await window.callClaude({ action: 'rule_query', max_tokens: 600, system: '你是「小红书+微信公众号 规则与本产品用法」助手。只依据下面知识库作答，不编造未收录规则；平台规则以各平台官方最新公告为准，不保证账号结果。回答前先判断用户问的是小红书还是公众号（或两者都答），不要用小红书的规则去回答公众号问题，反之亦然。判断式问题先给✅符合/⚠有风险/❌不建议结论再说原因。引用到具体规则时，在末尾用一行小字附上「出处+更新日期」，更新日期【只能取知识库里该条的“更新”值】，严禁使用你自己记忆里的日期/年份。若知识库未收录该主题，明确说「知识库暂未收录，请以对应平台官方最新公告为准」，不编造规则或日期。简洁可执行。\n\n' + KB, prompt: q });
      wait.innerHTML = mk(ans);
      // 实时联网：附「查小红书最新相关笔记」按钮（真实笔记链接，规则以官方为准）
      const live = document.createElement('div'); live.style.cssText = 'margin-top:8px';
      const lb = document.createElement('button'); lb.textContent = '🔄 查小红书最新相关笔记';
      lb.style.cssText = 'border:1px dashed var(--cinnabar,#ff2442);background:transparent;color:var(--cinnabar,#ff2442);border-radius:999px;padding:3px 11px;font-size:11.5px;cursor:pointer';
      lb.onclick = () => liveSearch(q, live, lb);
      live.appendChild(lb); wait.appendChild(live);
    } catch (e) { wait.textContent = '失败：' + (e.message || e); }
  }
  // 实时抓取：两条来源都启用。① Exa 网页检索（真·实时，含官方/媒体）先出；
  //   ② 小红书社区笔记 随后补充在下方。网页检索失败/未配/无结果 → 直接只走社区笔记。内容以官方最新为准。
  async function liveSearch(q, box, btn) {
    btn.disabled = true; btn.textContent = '🔄 实时检索中…';
    let webHtml = '', webOk = false;
    // 1) 网页检索（Exa）
    try {
      const w = await (await fetch('/api/web-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: '小红书 ' + q }) })).json();
      if (w.configured && w.ok && (w.results || []).length) {
        webOk = true;
        webHtml = '<div style="font-size:11px;color:var(--ink-soft,#999);margin:6px 0 4px">🌐 实时网页检索（含官方/媒体·点开看原文，以官方最新公告为准）：</div>'
          + w.results.slice(0, 6).map(r => `<a href="${r.url}" target="_blank" rel="noopener" style="display:block;border:1px solid var(--line,#eee);border-radius:9px;padding:7px 10px;margin-bottom:6px;text-decoration:none;color:inherit">
              <div style="font-size:12.5px;font-weight:600;line-height:1.4">${mk(r.title || r.url)}</div>
              ${r.snippet ? `<div style="font-size:10.5px;color:var(--ink-soft,#999);margin-top:3px;line-height:1.5">${mk(r.snippet.slice(0, 120))}…</div>` : ''}
              <div style="font-size:10px;color:var(--cinnabar,#ff2442);margin-top:3px">${(r.url || '').replace(/^https?:\/\//, '').split('/')[0]}${r.date ? ' · ' + String(r.date).slice(0, 10) : ''}</div></a>`).join('');
      }
    } catch {}
    // 先渲染网页结果（若有），社区笔记区占位 loading；网页失败则该区承载社区结果
    box.innerHTML = webHtml + '<div id="xhsLivePart" style="font-size:11px;color:var(--ink-soft,#999);margin:8px 0 4px">🔄 ' + (webOk ? '正在补充' : '正在查询') + '小红书社区笔记…（约 10–30 秒）</div>';
    btn.textContent = webOk ? '🔄 网页已出，社区笔记加载中…' : '🔄 查小红书相关笔记中…（约 10–30 秒）';
    // 2) 小红书社区笔记（始终补充；网页失败时作为唯一来源）
    try {
      // 社区笔记改用「朱砂助手」插件搜索 —— 用用户自己浏览器登录的小红书账号抓，不走服务器账号、不掉线
      let r;
      if (window.xhsExt && window.xhsExt.available) r = await window.xhsExt.search(q, 'popular');
      else r = { ok: false, _noext: true };
      const ns = (r.notes || []).slice(0, 6);
      const part = box.querySelector('#xhsLivePart');
      if (r._noext || (r && r.needLogin)) {
        if (part) part.outerHTML = '<div style="font-size:11px;color:var(--ink-soft,#999);margin:6px 0 4px">' + (r._noext ? '装「朱砂助手」插件并在浏览器登录小红书后，这里会用<b>你自己的账号</b>显示社区相关笔记。' : '请先在浏览器登录小红书后重试。') + '</div>';
      } else if (!r.ok || !ns.length) {
        if (part) part.outerHTML = webOk ? '' : '<div style="font-size:11px;color:var(--ink-soft,#999);margin:6px 0 4px">（暂未搜到相关内容，可换个关键词）</div>';
      } else {
        const html = '<div style="font-size:11px;color:var(--ink-soft,#999);margin:8px 0 4px">📌 小红书相关笔记（社区内容·点开看详情，规则以官方最新为准）：</div>'
          + ns.map(n => `<a href="${n.link}" target="_blank" rel="noopener" style="display:block;border:1px solid var(--line,#eee);border-radius:9px;padding:7px 10px;margin-bottom:6px;text-decoration:none;color:inherit">
              <div style="font-size:12.5px;font-weight:600;line-height:1.4">${mk(n.title || '（无标题）')}</div>
              <div style="font-size:10.5px;color:var(--ink-soft,#999);margin-top:3px">${n.author || ''}${n.date ? ' · ' + n.date : ''}${n.likes ? ' · ♥' + n.likes : ''}</div></a>`).join('');
        if (part) part.outerHTML = html;
      }
    } catch (e) {
      const part = box.querySelector('#xhsLivePart');
      if (part) part.outerHTML = webOk ? '' : '<div style="font-size:11px;color:var(--cinnabar-deep,#c0392b);margin:6px 0 4px">社区笔记抓取失败：' + mk(e.message || String(e)) + '</div>';
    }
    btn.disabled = false; btn.textContent = '🔄 重新实时检索';
  }
  let curTab = 'chat'; // 默认打开定位到「问助手」
  function showTab(t) {
    curTab = t;
    panel.querySelectorAll('.xhs-tab').forEach(b => { const on = b.dataset.t === t; b.style.color = on ? cin : 'var(--ink-soft,#999)'; b.style.fontWeight = on ? '700' : '500'; b.style.borderBottom = on ? '2px solid ' + cin : '2px solid transparent'; });
    document.getElementById('xhsDoc').style.display = t === 'doc' ? 'block' : 'none';
    document.getElementById('xhsFaq').style.display = t === 'faq' ? 'block' : 'none';
    document.getElementById('xhsChatPane').style.display = t === 'chat' ? 'flex' : 'none';
  }
  // 常见快捷问题题库（每次展示 6 个，「换一换」轮换下一组）
  const QUICK_POOL = [
    '标题怎么写不限流？', '哪些算违规导流？', '怎么用工具发一篇笔记？',
    '笔记被限流了怎么办？', '标签怎么加更容易上推荐？', '封面怎么做点击率更高？',
    '正文结构怎么排更易读？', '开头几句怎么写才抓人？', '发布时间几点更好？',
    '哪些违禁词要避开？', '怎么提高收藏和评论？', '新号怎么养更快起号？',
    '蹭热点要注意什么？', '图片尺寸用多少合适？', '被判搬运/重复怎么改？',
    '评论区怎么引导互动？', '同一篇可以多平台发吗？', '账号定位怎么做更垂直？',
    '电子资源类目怎么开通？', '开店要什么资质？', '怎么开通笔记带货权限？', '专业号怎么认证？',
    '公众号首图怎么生成？', '公众号导出的图文包是什么格式？', '公众号要怎么标广告？',
    '公众号认证有什么用？', '小红书和公众号能共用一套人设吗？',
  ];
  let quickIdx = 0;
  function renderChips() {
    const box = document.getElementById('xhsChips'); if (!box) return;
    box.innerHTML = ''; const n = 6;
    for (let i = 0; i < n; i++) {
      const q = QUICK_POOL[(quickIdx + i) % QUICK_POOL.length];
      const c = document.createElement('button'); c.textContent = q;
      c.style.cssText = 'border:1px solid var(--line,#eee);background:var(--paper,#fff);border-radius:999px;padding:3px 10px;font-size:11.5px;cursor:pointer';
      c.onclick = () => { document.getElementById('xhsInput').value = q; showTab('chat'); ask(); };
      box.appendChild(c);
    }
    const more = document.createElement('button'); more.textContent = '🔄 换一换';
    more.style.cssText = 'border:1px dashed var(--cinnabar,#ff2442);background:transparent;color:var(--cinnabar,#ff2442);border-radius:999px;padding:3px 10px;font-size:11.5px;cursor:pointer';
    more.onclick = () => { quickIdx = (quickIdx + n) % QUICK_POOL.length; renderChips(); };
    box.appendChild(more);
  }
  // 恢复上次拖动到的位置（持久化）
  function restorePos() {
    try {
      const p = JSON.parse(localStorage.getItem('ag_xhs_pos') || 'null');
      if (!p || !p.left) return;
      let nl = parseFloat(p.left), nt = parseFloat(p.top);
      if (!isFinite(nl) || !isFinite(nt)) return;
      nl = Math.max(4, Math.min(window.innerWidth - 80, nl));
      nt = Math.max(4, Math.min(window.innerHeight - 60, nt));
      panel.style.transform = 'none'; panel.style.left = nl + 'px'; panel.style.top = nt + 'px'; panel.style.bottom = 'auto';
    } catch {}
  }
  // 标题栏拖动浮窗到任意位置
  function makeDraggable() {
    const header = panel.querySelector('#xhsHeader'); if (!header) return;
    let sx, sy, sl, st, drag = false;
    header.addEventListener('mousedown', e => {
      if (e.target.id === 'xhsClose') return;
      const r = panel.getBoundingClientRect();
      panel.style.transform = 'none'; panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; panel.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top; drag = true; e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      let nl = sl + (e.clientX - sx), nt = st + (e.clientY - sy);
      nl = Math.max(4, Math.min(window.innerWidth - 80, nl)); nt = Math.max(4, Math.min(window.innerHeight - 60, nt));
      panel.style.left = nl + 'px'; panel.style.top = nt + 'px';
    });
    window.addEventListener('mouseup', () => { if (drag) { drag = false; try { localStorage.setItem('ag_xhs_pos', JSON.stringify({ left: panel.style.left, top: panel.style.top })); } catch {} } });
  }
  let inited = false;
  async function open() {
    panel.style.display = 'flex'; restorePos();
    if (!inited) {
      inited = true; await loadKB();
      document.getElementById('xhsDoc').innerHTML = accHTML(DOCS); bindAcc(document.getElementById('xhsDoc'));
      document.getElementById('xhsFaq').innerHTML = accHTML(FAQ); bindAcc(document.getElementById('xhsFaq'));
      add('a', '你好，我是创作助手 👋 覆盖小红书和公众号两个平台。上面「操作文档/常见问题」可直接翻看；有具体问题就在这问我（平台规则/限流避坑/工具用法）。');
      const w = document.createElement('div'); w.id = 'xhsChips'; w.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
      document.getElementById('xhsBody').appendChild(w); renderChips();
    }
    showTab(curTab);
  }
  function close() { panel.style.display = 'none'; }
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(fab); document.body.appendChild(panel);
    fab.addEventListener('click', () => panel.style.display === 'flex' ? close() : open());
    document.getElementById('xhsClose').addEventListener('click', close);
    document.getElementById('xhsSend').addEventListener('click', ask);
    document.getElementById('xhsInput').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
    panel.querySelectorAll('.xhs-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.t)));
    makeDraggable();
    // 仅首次访问自动弹一次，之后都不再自动打开（包括首页），用户点悬浮按钮才打开
    let seen = false; try { seen = localStorage.getItem('ag_xhs_widget_seen') === '1'; } catch {}
    if (!seen) { setTimeout(open, 1200); try { localStorage.setItem('ag_xhs_widget_seen', '1'); } catch {} }
  });
})();

/* ===== ICP / 公安 备案号页脚（合规）：服务端配了 ICP_BEIAN 才显示，链到工信部/公安部 ===== */
(function () {
  try {
    fetch('/api/health').then(r => r.json()).then(j => {
      if (!j || !j.icp) return;
      const host = document.querySelector('.ag-page') || document.querySelector('main') || document.body;
      const f = document.createElement('div');
      f.className = 'ag-beian';
      f.style.cssText = 'text-align:center;font-size:11px;color:var(--ink-soft,#9499a0);padding:20px 12px 28px;line-height:1.9';
      let html = '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + j.icp + '</a>';
      if (j.police) html += ' · <a href="https://beian.mps.gov.cn/" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">🛡 ' + j.police + '</a>';
      f.innerHTML = html;
      host.appendChild(f);
    }).catch(() => {});
  } catch {}
})();
