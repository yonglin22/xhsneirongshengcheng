// 后台中转：朱砂页面 → 小红书创作页
let pending = null; // { title, body, images }

// ===== 抓对标：用用户自己登录的小红书，在后台开搜索页抓真实笔记（不限次、不被机房IP风控）=====
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function _waitTabComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(to); try { chrome.tabs.onUpdated.removeListener(fn); } catch {} resolve(v); } };
    const to = setTimeout(() => fin(false), timeout || 20000);
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') fin(true); };
    chrome.tabs.onUpdated.addListener(fn);
    chrome.tabs.get(tabId, t => { if (t && t.status === 'complete') fin(true); });
  });
}
// 运行在小红书页面「主世界」里：能读 window.__INITIAL_STATE__ 和 DOM，提取真实笔记
function _pageExtract() {
  const notes = [], seen = new Set();
  try {
    (function walk(o, inheritTok) {
      if (!o || typeof o !== 'object' || notes.length >= 24) return;
      // 沿途记住最近见到的 xsec_token：小红书把它放在 feed 条目的不同层级，固定 key 常对不上，往下继承最稳
      const tok = (typeof o.xsecToken === 'string' && o.xsecToken) || (typeof o.xsec_token === 'string' && o.xsec_token) || inheritTok || '';
      if (Array.isArray(o)) { for (const x of o) walk(x, tok); return; }
      const nc = o.noteCard || o.note_card;
      if (nc && (o.id || nc.noteId || nc.note_id)) {
        const id = o.id || nc.noteId || nc.note_id;
        if (!seen.has(id)) {
          seen.add(id);
          const ii = nc.interactInfo || nc.interact_info || {}, u = nc.user || {};
          const token = nc.xsecToken || nc.xsec_token || o.xsecToken || o.xsec_token || tok || '';
          // 发布时间：搜索页常没有；有才取（毫秒时间戳/字符串），转 YYYY-MM-DD 供前端时间窗筛选/按最新排序，绝不编造
          const ts = nc.time || nc.publishTime || nc.publish_time || o.time || 0;
          let date = '';
          try { if (ts) { const d = new Date(typeof ts === 'number' ? ts : (Number(ts) || ts)); if (!isNaN(d.getTime())) date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); } } catch {}
          notes.push({
            id, token, date,
            title: nc.displayTitle || nc.display_title || nc.title || '',
            cover: (nc.cover && (nc.cover.urlDefault || nc.cover.url_default || nc.cover.url)) || '',
            author: u.nickname || u.nickName || '', userId: u.userId || u.user_id || '',
            likes: ii.likedCount || ii.liked_count || '', collects: ii.collectedCount || ii.collected_count || '', comments: ii.commentCount || ii.comment_count || '',
            link: 'https://www.xiaohongshu.com/explore/' + id + (token ? ('?xsec_token=' + token + '&xsec_source=pc_search') : ''),
            authorLink: (u.userId || u.user_id) ? ('https://www.xiaohongshu.com/user/profile/' + (u.userId || u.user_id)) : '',
          });
        }
        return;
      }
      for (const k in o) walk(o[k], tok);
    })(window.__INITIAL_STATE__, '');
  } catch (e) {}
  if (!notes.length) { // 兜底：直接扒 DOM 里的笔记卡片
    try {
      for (const a of document.querySelectorAll('a[href*="/explore/"],a[href*="/search_result/"],a[href*="/discovery/item/"]')) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/(?:explore|search_result|discovery\/item)\/([0-9a-zA-Z]+)/); if (!m) continue;
        const id = m[1]; if (seen.has(id)) continue; seen.add(id);
        const card = a.closest('section,.note-item,[class*="note"]') || a;
        const img = card.querySelector('img'); const titleEl = card.querySelector('[class*="title"],.title');
        const nameEl = card.querySelector('[class*="name"],[class*="author"]'); const cntEl = card.querySelector('[class*="count"],[class*="like"]');
        const tm = href.match(/xsec_token=([^&]+)/);
        // 关键补：从卡片里的「博主主页链接」扒出 userId（搜索卡的作者名是 <a href="/user/profile/XXX">），否则前端没法查粉丝
        let userId = '', authorLink = '';
        const au = card.querySelector('a[href*="/user/profile/"]');
        if (au) { const um = (au.getAttribute('href') || '').match(/\/user\/profile\/([0-9a-zA-Z]+)/); if (um) { userId = um[1]; authorLink = 'https://www.xiaohongshu.com/user/profile/' + userId; } }
        // 日期：搜索卡常把发布日期（MM-DD / X天前 / 今天）粘在作者名块里 → 先从作者文本里抠出来单独存进 date，供时间窗筛选/达标判断
        const rawAuthorText = ((nameEl && nameEl.textContent) || '').trim();
        const dm = rawAuthorText.match(/(\d{1,2}-\d{1,2})\s*$/) || rawAuthorText.match(/(今天|昨天|前天|\d+\s*天前)\s*$/);
        const date = dm ? dm[1].replace(/\s/g, '') : '';
        // 作者名优先取主页链接里的干净文本；再把可能粘着的日期/空白去掉
        let author = ((au && au.textContent) || rawAuthorText || '').trim().replace(/\s*\d{1,2}-\d{1,2}$/, '').replace(/\s*(?:今天|昨天|前天|\d+\s*天前)$/, '').trim();
        notes.push({
          id, token: tm ? decodeURIComponent(tm[1]) : '', date,
          title: (titleEl ? titleEl.textContent : '').trim().slice(0, 80),
          cover: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '',
          author, userId,
          likes: (cntEl ? cntEl.textContent : '').trim(), collects: '', comments: '',
          link: href.startsWith('http') ? href : ('https://www.xiaohongshu.com' + (href.startsWith('/') ? href : '/' + href)),
          authorLink,
        });
        if (notes.length >= 24) break;
      }
    } catch (e) {}
  }
  // 关键：小红书搜索页的 __INITIAL_STATE__ 常常不含 xsec_token，但页面上每个笔记卡片的 <a href> 里带着真 token。
  // 这里按笔记 id 从 DOM 链接补 token，并重建带 token 的 link —— 否则点进去会"当前笔记暂时无法浏览"。
  try {
    const tokById = {};
    for (const a of document.querySelectorAll('a[href*="/explore/"],a[href*="/search_result/"],a[href*="/discovery/item/"]')) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:explore|search_result|discovery\/item)\/([0-9a-zA-Z]+)/); if (!m) continue;
      const tm = href.match(/xsec_token=([^&"]+)/); if (!tm) continue;
      if (!tokById[m[1]]) tokById[m[1]] = decodeURIComponent(tm[1]);
    }
    for (const n of notes) {
      if (!n.token && tokById[n.id]) {
        n.token = tokById[n.id];
        n.link = 'https://www.xiaohongshu.com/explore/' + n.id + '?xsec_token=' + n.token + '&xsec_source=pc_search';
      }
    }
  } catch (e) {}
  let needLogin = false;
  try { const t = (document.body && document.body.innerText || '').slice(0, 800); if (notes.length === 0 && /(扫码登录|手机号登录|登录后查看|新用户登录|立即登录)/.test(t)) needLogin = true; } catch {}
  return { notes: notes.slice(0, 20), needLogin };
}
// 运行在小红书笔记详情页「主世界」：读 window.__INITIAL_STATE__ 的 noteDetailMap 取单篇正文/图/标签
function _noteExtract() {
  let out = null;
  try {
    const st = window.__INITIAL_STATE__ || {};
    let map = null;
    (function find(o, depth) {
      if (out || !o || typeof o !== 'object' || depth > 8) return;
      if (o.noteDetailMap || o.note_detail_map) { map = o.noteDetailMap || o.note_detail_map; }
      if (map) {
        for (const k in map) {
          const nd = map[k] && (map[k].note || map[k]); if (!nd) continue;
          if (nd.title != null || nd.desc != null) {
            const ii = nd.interactInfo || nd.interact_info || {}, u = nd.user || {};
            const imgs = (nd.imageList || nd.image_list || []).map(im => (im && (im.urlDefault || im.url_default || im.url || (im.infoList && im.infoList[0] && im.infoList[0].url))) || '').filter(Boolean);
            const tags = (nd.tagList || nd.tag_list || []).map(t => (t && (t.name || t.text)) || '').filter(Boolean);
            out = {
              title: nd.title || '', content: nd.desc || '', images: imgs, tags,
              author: u.nickname || u.nickName || '',
              likes: ii.likedCount || ii.liked_count || '', collects: ii.collectedCount || ii.collected_count || '', comments: ii.commentCount || ii.comment_count || '',
            };
            return;
          }
        }
      }
      for (const k in o) find(o[k], depth + 1);
    })(st, 0);
  } catch (e) {}
  if (!out) { // 兜底：扒 DOM
    try {
      const t = document.querySelector('#detail-title, [class*="title"]');
      const d = document.querySelector('#detail-desc, [class*="desc"], .note-content');
      const imgs = [...document.querySelectorAll('.note-slider img, [class*="swiper"] img, .media-container img')].map(i => i.getAttribute('src') || '').filter(Boolean);
      const tags = [...document.querySelectorAll('a[href*="search_result"] , [class*="tag"]')].map(e => (e.textContent || '').trim()).filter(s => s && s.length < 20);
      const title = t ? (t.textContent || '').trim() : '', content = d ? (d.textContent || '').trim() : '';
      if (title || content || imgs.length) out = { title, content, images: imgs.slice(0, 18), tags: [...new Set(tags)].slice(0, 12), author: '', likes: '', collects: '', comments: '' };
    } catch (e) {}
  }
  let needLogin = false;
  try { const tx = (document.body && document.body.innerText || '').slice(0, 800); if (!out && /(扫码登录|手机号登录|登录后查看|新用户登录|立即登录)/.test(tx)) needLogin = true; } catch {}
  // 识别小红书拦截/失效页：标题或正文命中这些提示，说明链接过期/笔记被删/需登录，不能当正文用
  let blocked = false;
  try {
    const blockRe = /(你访问的页面不见了|页面不见了|当前笔记暂时无法浏览|笔记不存在|内容不存在|访问异常|前往登录|请登录后查看|出错啦)/;
    if (out && (blockRe.test(out.title || '') || blockRe.test(out.content || ''))) { blocked = true; out = null; }
  } catch {}
  return { note: out, needLogin, blocked };
}
async function xhsFetchNote(url) {
  const L = (...a) => { try { console.log('[朱砂单篇]', ...a); } catch {} };
  L('收到单篇抓取 url=', url);
  if (!url) return { ok: false, error: '缺少链接' };
  _keepAliveStart();
  let tabId = null, prevActiveTab = null;
  try {
    try { const [cur] = await chrome.tabs.query({ active: true, currentWindow: true }); prevActiveTab = cur || null; } catch {}
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    await _waitTabComplete(tabId, 20000);
    let note = null, needLogin = false, blocked = false, lastErr = '';
    for (let i = 0; i < 16; i++) {
      await _sleep(1500);
      let res; try { res = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _noteExtract }); } catch (e) { lastErr = e.message || String(e); continue; }
      const o = res && res[0] && res[0].result;
      L('第', i + 1, '次解析：note=', o && o.note ? 'ok' : 'null', 'needLogin=', o ? o.needLogin : 'null', 'blocked=', o ? o.blocked : 'null');
      if (o) { if (o.needLogin) needLogin = true; if (o.blocked) blocked = true; if (o.note && (o.note.title || o.note.content || (o.note.images || []).length)) { note = o.note; break; } }
    }
    L('单篇抓取结束：', note ? '成功' : '失败');
    if (note) return { ok: true, ...note };
    if (blocked) return { ok: false, error: '该笔记已失效或被拦截/删除/设为私密（用你本机登录的会话打开也看不到正文）。请换一条新链接，或手动粘贴标题+正文。' };
    return { ok: false, needLogin, error: needLogin ? '未登录小红书' : (lastErr ? ('注入脚本被拒：' + lastErr) : '打开了笔记页但没解析到正文（可能链接失效/被风控/小红书改版）') };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch {} }
    if (prevActiveTab && prevActiveTab.id != null) { try { await chrome.tabs.update(prevActiveTab.id, { active: true }); } catch {} }
    _keepAliveStop();
  }
}
// 运行在小红书博主主页「主世界」：读 __INITIAL_STATE__ 取该博主的粉丝数（只显示用，不做筛选）
function _fansExtract() {
  let fans = '';
  try {
    const st = window.__INITIAL_STATE__ || {};
    // 主页数据：user.userPageData.interactions = [{type:'fans',count},...]；不同版本字段不一，深搜兜底
    (function find(o, depth) {
      if (fans !== '' || !o || typeof o !== 'object' || depth > 9) return;
      if (Array.isArray(o.interactions)) {
        const f = o.interactions.find(x => x && /fans|粉丝/i.test(x.type || x.name || ''));
        if (f && (f.count != null || f.value != null)) { fans = String(f.count != null ? f.count : f.value); return; }
      }
      if (o.fansCount != null) { fans = String(o.fansCount); return; }
      if (o.fans != null && typeof o.fans !== 'object') { fans = String(o.fans); return; }
      for (const k in o) find(o[k], depth + 1);
    })(st, 0);
  } catch (e) {}
  if (fans === '') { // 兜底：扒 DOM —— 找到"粉丝"字样的元素，再就近取数字（同元素/兄弟/父级）
    try {
      const all = [...document.querySelectorAll('span,div,em,b')];
      for (const el of all) {
        const t = (el.textContent || '').trim();
        if (t.length > 12 || !/粉丝/.test(t)) continue;
        // 1) 同元素里就有数字（如"粉丝 1.2万"）
        let m = t.match(/([\d.]+\s*[万千wWkK]?)/);
        if (m && /\d/.test(m[1])) { fans = m[1].replace(/\s/g, ''); break; }
        // 2) "粉丝"是 label，数字在它的前一个/后一个兄弟，或同父级另一个子节点
        const cands = [el.previousElementSibling, el.nextElementSibling].concat(el.parentElement ? [...el.parentElement.children] : []);
        for (const c of cands) { if (!c || c === el) continue; const ct = (c.textContent || '').trim(); const mm = ct.match(/^([\d.]+\s*[万千wWkK]?)$/); if (mm) { fans = mm[1].replace(/\s/g, ''); break; } }
        if (fans !== '') break;
      }
    } catch (e) {}
  }
  let needLogin = false;
  try { const tx = (document.body && document.body.innerText || '').slice(0, 600); if (fans === '' && /(扫码登录|手机号登录|登录后查看|立即登录)/.test(tx)) needLogin = true; } catch {}
  return { fans, needLogin };
}
async function xhsFetchFans(url) {
  if (!url) return { ok: false, error: '缺少主页链接' };
  _keepAliveStart();
  let tabId = null, prevActiveTab = null;
  try {
    try { const [cur] = await chrome.tabs.query({ active: true, currentWindow: true }); prevActiveTab = cur || null; } catch {}
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    await _waitTabComplete(tabId, 18000);
    let fans = '', needLogin = false;
    for (let i = 0; i < 8; i++) {
      await _sleep(1200);
      let res; try { res = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _fansExtract }); } catch (e) { continue; }
      const o = res && res[0] && res[0].result;
      if (o) { if (o.needLogin) needLogin = true; if (o.fans !== '') { fans = o.fans; break; } }
    }
    if (fans !== '') return { ok: true, fans };
    return { ok: false, needLogin, error: needLogin ? '未登录小红书' : '没解析到粉丝数' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch {} }
    if (prevActiveTab && prevActiveTab.id != null) { try { await chrome.tabs.update(prevActiveTab.id, { active: true }); } catch {} }
    _keepAliveStop();
  }
}
// 心跳：抓取要 40+ 秒，但 MV3 后台进程闲置 ~30s 就会被 Chrome 杀掉（控制台开着时不会，所以手测能成、关了就废）。
// 抓取期间每 20s 调一次 chrome API，把后台进程一直“续命”，直到抓完。
let _keepAliveTimer = null, _keepAliveRef = 0;
function _keepAliveStart() { _keepAliveRef++; if (_keepAliveTimer) return; _keepAliveTimer = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError); } catch {} }, 20000); }
function _keepAliveStop() { _keepAliveRef = Math.max(0, _keepAliveRef - 1); if (_keepAliveRef === 0 && _keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; } }

async function xhsSearch(keyword, sort, type) {
  const L = (...a) => { try { console.log('[朱砂抓取]', ...a); } catch {} };
  L('收到抓取请求 keyword=', keyword, 'sort=', sort, 'type=', type);
  if (!keyword) return { ok: false, error: '缺少关键词' };
  _keepAliveStart();
  const url = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword)
    + (type === 'video' ? '&type=video' : type === 'image' ? '&type=image' : '');
  let tabId = null;
  let prevActiveTab = null;
  try {
    // 注意：后台标签页(active:false)会被 Chrome 限流（定时器/渲染大幅变慢甚至暂停），
    // 导致下面"几秒就该出结果"的轮询实际上卡住不动、感觉像"一直加载中"。
    // 这里必须用 active:true 打开（短暂闪一下新标签页），抓完立刻关掉并切回原标签页。
    try { const [cur] = await chrome.tabs.query({ active: true, currentWindow: true }); prevActiveTab = cur || null; } catch {}
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    L('已打开搜索标签页 tabId=', tabId, 'url=', url);
    const loaded = await _waitTabComplete(tabId, 20000);
    L('标签页加载', loaded ? '完成' : '超时(20s未complete，继续尝试解析)');
    let notes = [], needLogin = false, lastErr = '';
    for (let i = 0; i < 18; i++) { // SPA 异步出结果（长尾词更慢），轮询最多 ~27s
      await _sleep(1500);
      // 下滑触发懒加载：很多搜索结果是滚动到视口才渲染，不滚就一直 0 篇
      try { await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => { try { window.scrollTo(0, document.body.scrollHeight); } catch {} } }); } catch {}
      let res; try { res = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: _pageExtract }); } catch (e) { lastErr = e.message || String(e); L('第', i + 1, '次注入脚本失败：', lastErr); continue; }
      const out = res && res[0] && res[0].result;
      L('第', i + 1, '次解析：notes=', out ? (out.notes || []).length : 'null', 'needLogin=', out ? out.needLogin : 'null');
      if (out) { if (out.needLogin) needLogin = true; if (out.notes && out.notes.length) { notes = out.notes; break; } }
    }
    L('抓取结束：共', notes.length, '篇，needLogin=', needLogin, lastErr ? ('，注入错误=' + lastErr) : '');
    return { ok: notes.length > 0, notes, needLogin, error: notes.length ? '' : (needLogin ? '未登录小红书' : (lastErr ? ('注入脚本被拒：' + lastErr) : '页面已开但没解析到笔记（可能小红书改版/需下拉加载/被风控）')) };
  } catch (e) {
    L('抓取异常：', e.message || e);
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (tabId != null) { try { await chrome.tabs.remove(tabId); } catch {} }
    if (prevActiveTab && prevActiveTab.id != null) { try { await chrome.tabs.update(prevActiveTab.id, { active: true }); } catch {} }
    _keepAliveStop();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'publish') {
    pending = msg.payload || null;
    chrome.tabs.create({ url: 'https://creator.xiaohongshu.com/publish/publish?source=official', active: true });
    sendResponse({ ok: true, msg: '已打开小红书创作页，正在自动填充…完成后请在该页确认存草稿' });
    return true;
  }
  if (msg && msg.type === 'getPayload') {
    sendResponse({ payload: pending });
    pending = null; // 取走即清，避免误填
    return true;
  }
  if (msg && msg.type === 'nurturePlan') {
    const plan = msg.plan || {};
    const isSearch = /^search_/.test(plan.ptype || '');
    const kw = ((plan.config || {}).keywords || [])[0] || '';
    const url = (isSearch && kw)
      ? ('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw))
      : 'https://www.xiaohongshu.com/explore';
    chrome.storage.local.set({ nurturePlan: plan }, () => {
      chrome.tabs.create({ url, active: true });
      sendResponse({ ok: true, msg: '已打开小红书，开始执行养号计划' });
    });
    return true;
  }
  if (msg && msg.type === 'xhsSearch') {
    // 立刻回执（不让发起方的长连接挂 40+ 秒、避免端口被回收），抓完后用 tabs.sendMessage 把结果“推”回发起页。
    const reqId = msg.reqId, tabId = sender && sender.tab && sender.tab.id;
    const push = (result) => { if (tabId != null) { try { chrome.tabs.sendMessage(tabId, { type: 'xhsSearchResult', reqId, result }, () => void chrome.runtime.lastError); } catch {} } };
    xhsSearch(msg.keyword, msg.sort, msg.searchType).then(push).catch(e => push({ ok: false, error: e.message || String(e) }));
    try { sendResponse({ ok: true, started: true }); } catch {}
    return true;
  }
  if (msg && msg.type === 'xhsFetchNote') {
    const reqId = msg.reqId, tabId = sender && sender.tab && sender.tab.id;
    const push = (result) => { if (tabId != null) { try { chrome.tabs.sendMessage(tabId, { type: 'xhsFetchNoteResult', reqId, result }, () => void chrome.runtime.lastError); } catch {} } };
    xhsFetchNote(msg.url).then(push).catch(e => push({ ok: false, error: e.message || String(e) }));
    try { sendResponse({ ok: true, started: true }); } catch {}
    return true;
  }
  if (msg && msg.type === 'xhsFetchFans') {
    const reqId = msg.reqId, tabId = sender && sender.tab && sender.tab.id;
    const push = (result) => { if (tabId != null) { try { chrome.tabs.sendMessage(tabId, { type: 'xhsFetchFansResult', reqId, result }, () => void chrome.runtime.lastError); } catch {} } };
    xhsFetchFans(msg.url).then(push).catch(e => push({ ok: false, error: e.message || String(e) }));
    try { sendResponse({ ok: true, started: true }); } catch {}
    return true;
  }
  if (msg && msg.type === 'ping') { sendResponse({ ok: true }); return true; }
  // 网页端(yonglin.chat)同步过来的当前智能体人设，供插件弹窗直接执行计划时使用
  if (msg && msg.type === 'syncPersona') {
    chrome.storage.local.set({ zsPersona: msg.persona || '' });
    return true;
  }
  // AI 引流回复/私信话术生成：转发到朱砂服务端 /api/claude（带上用户在 yonglin.chat 的登录 cookie 计费）
  if (msg && msg.type === 'aiReply') {
    (async () => {
      try {
        const r = await fetch('https://yonglin.chat/api/claude', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 300, system: msg.system || '', messages: [{ role: 'user', content: msg.prompt || '' }], action: 'growth_reply' }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) { sendResponse({ ok: false, error: (j && (j.error?.message || j.error)) || ('HTTP ' + r.status) }); return; }
        const text = ((j && j.content) || []).map(b => b.text || '').join('').trim();
        sendResponse({ ok: true, text });
      } catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  // 拉取本账号话术库（供截流/养号「话术来源=话术库」取词，带 yonglin.chat 登录 cookie）
  if (msg && msg.type === 'getScriptLibs') {
    (async () => {
      try {
        const r = await fetch('https://yonglin.chat/api/script-libs', { credentials: 'include' });
        const j = await r.json().catch(() => null);
        sendResponse({ ok: !!(j && j.ok), list: (j && j.list) || [] });
      } catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  // 收集到的评论区潜客 → 上报到朱砂服务端「评论收集」列表（带 yonglin.chat 登录 cookie）
  if (msg && msg.type === 'reportLeads') {
    (async () => {
      try {
        const r = await fetch('https://yonglin.chat/api/collected-leads', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: msg.items || [] }),
        });
        const j = await r.json().catch(() => null);
        sendResponse({ ok: !!(j && j.ok), added: j && j.added });
      } catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  // 跑完一轮上报统计（收集/回复/私信增量）→ 任务列表统计列
  if (msg && msg.type === 'reportStat') {
    (async () => {
      try {
        const r = await fetch('https://yonglin.chat/api/growth-plans/stat', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: msg.planId, collected: msg.collected || 0, replied: msg.replied || 0, dmed: msg.dmed || 0 }),
        });
        const j = await r.json().catch(() => null);
        sendResponse({ ok: !!(j && j.ok) });
      } catch (e) { sendResponse({ ok: false, error: e.message || String(e) }); }
    })();
    return true;
  }
  // 待发私信草稿入库（人工确认发送，不自动发，降低高风险灰色操作的封号风险）
  if (msg && msg.type === 'queueDM') {
    chrome.storage.local.get(['zsPendingDM'], st => {
      const list = (st.zsPendingDM || []).concat([{ ...msg.item, ts: Date.now() }]).slice(-200);
      chrome.storage.local.set({ zsPendingDM: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});

// ===== 自动检查更新：定时拉服务器最新版本号，比自己 manifest 新就提醒（角标 NEW + 通知 + 弹窗横幅）=====
// （开发者模式「加载已解压」装的扩展不会被 Chrome 自动更新，这里至少做到「有新版主动提醒、一键下载」）
const ZS_VERSION_URL = 'https://yonglin.chat/api/ext-version';
function zsCmpVer(a, b) { // a>b →1, a<b →-1, 相等→0
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
async function zsCheckUpdate() {
  try {
    const local = chrome.runtime.getManifest().version;
    const r = await fetch(ZS_VERSION_URL, { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.version) return;
    if (zsCmpVer(j.version, local) > 0) {
      // 有新版
      const download = j.download || 'https://yonglin.chat/api/ext-download';
      chrome.storage.local.set({ zsUpdate: { latest: j.version, current: local, download, ts: Date.now() } });
      try { chrome.action.setBadgeText({ text: 'NEW' }); chrome.action.setBadgeBackgroundColor({ color: '#ff2442' }); } catch {}
      // 仅在「这个新版本号」第一次发现时弹一次系统通知，避免反复打扰
      chrome.storage.local.get(['zsNotifiedVer'], (st) => {
        if (st.zsNotifiedVer === j.version) return;
        chrome.storage.local.set({ zsNotifiedVer: j.version });
        try {
          chrome.notifications.create('zsUpdate', {
            type: 'basic', iconUrl: 'icon128.png',
            title: '朱砂助手有新版 ' + j.version,
            message: '点此下载最新版（解压后到 chrome://extensions 重新加载即可更新）',
            priority: 2,
          }, () => void chrome.runtime.lastError);
        } catch {}
      });
    } else {
      // 已是最新：清掉角标和待更新标记
      chrome.storage.local.remove('zsUpdate');
      try { chrome.action.setBadgeText({ text: '' }); } catch {}
    }
  } catch (e) {}
}
// 点系统通知 → 打开下载
chrome.notifications && chrome.notifications.onClicked.addListener((id) => {
  if (id !== 'zsUpdate') return;
  chrome.storage.local.get(['zsUpdate'], (st) => {
    const url = (st.zsUpdate && st.zsUpdate.download) || 'https://yonglin.chat/api/ext-download';
    chrome.tabs.create({ url });
    chrome.notifications.clear('zsUpdate');
  });
});
// 安装/启动时查一次 + 每 6 小时查一次
chrome.runtime.onInstalled.addListener(() => zsCheckUpdate());
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => zsCheckUpdate());
chrome.alarms && chrome.alarms.create('zsUpdateCheck', { periodInMinutes: 360 });
chrome.alarms && chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === 'zsUpdateCheck') zsCheckUpdate(); });
// 弹窗打开时催一次检查
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => { if (msg && msg.type === 'zsCheckUpdate') { zsCheckUpdate(); try { sendResponse({ ok: true }); } catch {} } });
zsCheckUpdate();

// ===== 多设备/多账号任务下发：本设备插件每分钟轮询服务端待领取任务，领到就打开小红书自动执行 =====
const ZS_DISPATCH_BASE = 'https://yonglin.chat';
async function _zsDeviceId() {
  return new Promise(resolve => {
    chrome.storage.local.get(['zsDeviceId', 'zsDispatchEnabled'], st => {
      let id = st.zsDeviceId;
      if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 8); chrome.storage.local.set({ zsDeviceId: id }); }
      resolve({ id, enabled: st.zsDispatchEnabled !== false });
    });
  });
}
let _zsDispatchBusy = false;
async function zsPollDispatch() {
  if (_zsDispatchBusy) return;
  const { id, enabled } = await _zsDeviceId();
  if (!enabled) return;
  let task = null;
  try {
    const r = await fetch(ZS_DISPATCH_BASE + '/api/dispatch/pull', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: id }) });
    const j = await r.json().catch(() => null);
    task = j && j.task;
  } catch (e) { return; } // 未登录/网络问题：静默跳过，下次再试
  if (!task || !task.plan) return;
  _zsDispatchBusy = true;
  try {
    const p = task.plan; const cfg = p.config || {};
    const mins = Math.max(5, Math.min(40, Math.round(((cfg.nurture || {}).daily || 8) * 1.5)));
    const plan = { ptype: p.ptype, config: cfg, _minutes: mins, _planId: p.id, _dispatchId: task.dispatchId };
    const kw = (cfg.keywords || [])[0] || '';
    const url = /^search_/.test(p.ptype || '') && kw
      ? ('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw))
      : 'https://www.xiaohongshu.com/explore';
    await new Promise(res => chrome.storage.local.set({ nurturePlan: plan }, res));
    chrome.tabs.create({ url, active: false }); // 后台标签执行，nurture.js 载入后自动从 storage 取计划运行
    // 兜底：6 分钟内没收到 dispatchDone 就解锁，避免卡死（任务实际跑完会更早解锁）
    setTimeout(() => { _zsDispatchBusy = false; }, 6 * 60000);
  } catch (e) { _zsDispatchBusy = false; }
}
chrome.alarms && chrome.alarms.create('zsDispatchPoll', { periodInMinutes: 1 });
chrome.alarms && chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'zsDispatchPoll') zsPollDispatch(); });
// nurture.js 跑完下发任务后回报 → 标记服务端完成 + 解锁本设备
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'dispatchDone') {
    _zsDispatchBusy = false;
    (async () => {
      try {
        await fetch(ZS_DISPATCH_BASE + '/api/dispatch/done', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: msg.dispatchId, result: msg.result || '' }) });
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false }); }
    })();
    return true;
  }
});
setTimeout(zsPollDispatch, 8000); // 启动后先探一次

// ===== 内容矩阵分发：轮询领取「一稿多发」任务，在本机已登录的小红书里存草稿箱 =====
let _zsContentBusy = false;
async function zsPollContentDispatch() {
  if (_zsContentBusy || _zsDispatchBusy) return; // 同一时刻只跑一个任务，避免多标签打架
  const { id, enabled } = await _zsDeviceId();
  if (!enabled) return;
  let task = null;
  try {
    const r = await fetch(ZS_DISPATCH_BASE + '/api/content-dispatch/pull', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: id }) });
    const j = await r.json().catch(() => null);
    task = j && j.task;
  } catch (e) { return; }
  if (!task || !task.payload) return;
  _zsContentBusy = true;
  try {
    pending = Object.assign({}, task.payload, { _contentDispatchId: task.dispatchId });
    chrome.tabs.create({ url: 'https://creator.xiaohongshu.com/publish/publish?source=official', active: false });
    setTimeout(() => { _zsContentBusy = false; }, 5 * 60000); // 兜底解锁
  } catch (e) { _zsContentBusy = false; }
}
chrome.alarms && chrome.alarms.create('zsContentPoll', { periodInMinutes: 1 });
chrome.alarms && chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'zsContentPoll') zsPollContentDispatch(); });
// xhs.js 存完草稿回报 → 标记完成 + 解锁
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'contentDispatchDone') {
    _zsContentBusy = false;
    (async () => {
      try {
        await fetch(ZS_DISPATCH_BASE + '/api/content-dispatch/done', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: msg.dispatchId, result: msg.result || '' }) });
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false }); }
    })();
    return true;
  }
});
setTimeout(zsPollContentDispatch, 12000);

// ===== 设备心跳：让本机出现在网页「设备看板」，上报在线/工作状态，并接收 stop 指令 =====
async function zsHeartbeat() {
  const { id } = await _zsDeviceId();
  const st = await chrome.storage.local.get(['zsDeviceName']);
  const status = (_zsDispatchBusy || _zsContentBusy) ? 'working' : 'idle';
  try {
    const r = await fetch(ZS_DISPATCH_BASE + '/api/devices/heartbeat', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: id, status, name: st.zsDeviceName || id }) });
    const j = await r.json().catch(() => null);
    if (j && j.cmd === 'stop') { _zsDispatchBusy = false; _zsContentBusy = false; } // 收到停止指令：解锁，不再领新任务（运行中的标签用户可自行关闭）
  } catch (e) {}
}
chrome.alarms && chrome.alarms.create('zsHeartbeat', { periodInMinutes: 1 });
chrome.alarms && chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'zsHeartbeat') zsHeartbeat(); });
setTimeout(zsHeartbeat, 5000);
