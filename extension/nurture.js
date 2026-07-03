// 养号执行（计划驱动·保守拟真）：在 www.xiaohongshu.com 按获客计划(网页/插件弹窗下发)的 关键词/篇数/好感率/点赞·收藏·关注·评论% 跑
// 出验证/异常立即停。
(function () {
  if (!/^https?:\/\/www\.xiaohongshu\.com/.test(location.href)) return;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const chance = (pct) => Math.random() * 100 < (pct || 0);
  const log = (...a) => console.log('[朱砂养号]', ...a);
  let stopFlag = false;

  chrome.storage.local.get(['nurturePlan'], async (st) => {
    if (st.nurturePlan) { chrome.storage.local.set({ nurturePlan: null }); return runPlan(st.nurturePlan); }
  });

  function overlay() {
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:999999;background:#16181d;color:#fff;padding:12px 16px;border-radius:12px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:320px;line-height:1.6;font-family:-apple-system,sans-serif';
    o.innerHTML = '<b>🌱 朱砂养号中…</b><div id="nz-msg" style="margin-top:4px;color:#ddd"></div><button id="nz-stop" style="margin-top:8px;background:#ff2442;color:#fff;border:none;border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer">停止</button>';
    document.body.appendChild(o);
    o.querySelector('#nz-stop').onclick = () => { stopFlag = true; };
    return { say: t => { const m = o.querySelector('#nz-msg'); if (m) m.textContent = t; log(t); }, done: () => setTimeout(() => o.remove(), 7000) };
  }
  function riskHit() { const t = document.body.innerText || ''; return /环境异常|安全验证|滑动验证|拼图验证|完成验证/.test(t) && t.length < 2000; }

  // ===== 风控安全层：跨运行「日累计上限」+ 新号热身爬坡 + 高危动作强制间隔 =====
  // 风控看的是账号当天【总】动作量，不是单次运行。这里做全局持久预算，多次点「执行」也共享同一份额度。
  const DAY_CAP = { opened: 60, liked: 40, faved: 25, followed: 8, commented: 8, replied: 8, dmed: 20 };
  const today = () => new Date().toISOString().slice(0, 10);
  function loadBudget() {
    return new Promise(res => chrome.storage.local.get(['zsDayBudget'], st => {
      let b = st.zsDayBudget; const t = today();
      if (!b || b.date !== t) b = { date: t, firstDay: (b && b.firstDay) || t, opened: 0, liked: 0, faved: 0, followed: 0, commented: 0, replied: 0, dmed: 0 };
      if (!b.firstDay) b.firstDay = t;
      res(b);
    }));
  }
  function saveBudget(b) { try { chrome.storage.local.set({ zsDayBudget: b }); } catch (e) {} }
  // 新号热身：账号首次跑起 3 天内只用 40% 额度，4~7 天 70%，之后满额（拟真养号曲线，避免新号暴走被判机器）
  function warmupFactor(b) {
    const days = Math.floor((Date.parse(b.date) - Date.parse(b.firstDay)) / 86400000);
    if (days <= 2) return 0.4; if (days <= 6) return 0.7; return 1;
  }
  function capFor(b, key) { return Math.max(1, Math.round(DAY_CAP[key] * warmupFactor(b))); }
  function budgetLeft(b, key) { return capFor(b, key) - (b[key] || 0); }
  // 高危写操作（关注/评论/引流回复）之间强制拉开间隔，避免密集触发风控
  let _lastHiRisk = 0;
  async function hiRiskGate(ui, label) {
    const gap = rnd(40000, 90000); const wait = Math.max(0, gap - (Date.now() - _lastHiRisk));
    if (_lastHiRisk && wait > 0) { if (ui) ui.say(`${label} 前拟真间隔 ${Math.ceil(wait / 1000)}s…`); await sleep(wait); }
    _lastHiRisk = Date.now();
  }
  function clickByText(arr) { const els = [...document.querySelectorAll('span,button,div,[role=button]')]; for (const t of arr) { const el = els.find(e => { const tx = (e.textContent || '').replace(/\s+/g, ''); return tx && tx.length <= t.length + 3 && tx.includes(t) && (e.offsetParent !== null); }); if (el) { (el.closest('button,[role=button]') || el).click(); return true; } } return false; }
  // 点赞/收藏：小红书笔记详情里图标，选择器多变 → 多策略尝试
  function doLike() { const el = document.querySelector('.like-wrapper, .like-active, [class*="like"] svg, .interact-container .like'); if (el) { (el.closest('[class*=like]') || el).click(); return true; } return clickByText(['赞']); }
  function doFav() { const el = document.querySelector('.collect-wrapper, [class*="collect"] svg, .interact-container .collect'); if (el) { (el.closest('[class*=collect]') || el).click(); return true; } return clickByText(['收藏']); }
  function doFollow() { const el = document.querySelector('[class*="follow-btn"], [class*="followBtn"]'); if (el) { el.click(); return true; } return clickByText(['关注']); }
  // 计划页「搜索筛选」最佳猜测：落地搜索结果页后按文案点一次筛选 tab（平台改版需现场校准）
  function applySearchFilter(f) {
    if (!f) return;
    const sortMap = { latest: '最新', like: '最多点赞' };
    const ctypeMap = { note: '图文', video: '视频' };
    const ptimeMap = { d1: '一天内', w1: '一周内', m6: '半年内' };
    const scopeMap = { viewed: '已看过', unviewed: '未看过' };
    [sortMap[f.sort], ctypeMap[f.ctype], ptimeMap[f.ptime], scopeMap[f.scope]].filter(Boolean).forEach(t => clickByText([t]));
  }

  // ===== 截流：收集评论 + AI 引流回复（评论区自动回复，有上限+验证即停）=====
  // 选择器为最佳猜测（平台改版会变，需现场校准），与既有点赞/收藏逻辑同一容错风格。
  function noteContext() {
    const title = (document.querySelector('#detail-title, .note-content .title, [class*="title"]') || {}).textContent || '';
    const desc = (document.querySelector('#detail-desc, .note-content .desc, [class*="desc"]') || {}).textContent || '';
    return (title + '\n' + desc).trim().slice(0, 600);
  }
  function collectComments(max) {
    const nodes = [...document.querySelectorAll('[class*="comment-item"], [class*="parent-comment"]')].slice(0, max || 8);
    return nodes.map(n => {
      const user = (n.querySelector('[class*="name"], [class*="nickname"]') || {}).textContent || '';
      const text = (n.querySelector('[class*="content"], [class*="note-text"]') || {}).textContent || '';
      const link = (n.querySelector('a[href*="/user/profile/"]') || {}).href || '';
      return { user: user.trim(), text: text.trim(), link };
    }).filter(c => c.text);
  }
  async function aiText(system, prompt) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'aiReply', system, prompt }, resp => {
        resolve(resp && resp.ok ? resp.text : '');
      });
    });
  }
  // 话术库取词：拉一次本账号话术库（缓存），按 libId 找库，从其「回答」里随机取一条
  let _libsCache = null;
  function getLibs() {
    if (_libsCache) return Promise.resolve(_libsCache);
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'getScriptLibs' }, resp => { _libsCache = (resp && resp.ok && resp.list) || []; resolve(_libsCache); });
    });
  }
  async function libPick(libId) {
    if (!libId) return '';
    const libs = await getLibs();
    const lib = libs.find(l => String(l.id) === String(libId));
    const ans = ((lib && lib.items) || []).map(x => (x && x.a || '').trim()).filter(Boolean);
    return ans.length ? ans[Math.floor(Math.random() * ans.length)] : '';
  }
  // 关键词匹配校验（PRD：标题/描述命中关键词→直接感兴趣；不命中→按好感率）
  function kwMatch(text, kws) { if (!kws || !kws.length) return false; const t = (text || '').toLowerCase(); return kws.some(k => k && t.includes(String(k).toLowerCase())); }
  // 识别广告/直播（PRD：识别到直播/广告需尽快划走，不互动）
  function isAdOrLive() { const t = (document.body.innerText || '').slice(0, 800); return /直播中|正在直播|广告|赞助|品牌合作|领券|立即购买|下单/.test(t); }
  // 抓评论 + 点赞数（用于"复刻最高赞/重复评论"）
  function collectCommentsRich(max) {
    const nodes = [...document.querySelectorAll('[class*="comment-item"], [class*="parent-comment"]')].slice(0, max || 20);
    return nodes.map(n => {
      const text = ((n.querySelector('[class*="content"], [class*="note-text"]') || {}).textContent || '').trim();
      const likeTx = ((n.querySelector('[class*="like-count"], [class*="like"] [class*="count"]') || {}).textContent || '').trim();
      const likes = parseInt((likeTx.match(/\d+/) || [0])[0], 10) || 0;
      return { text, likes };
    }).filter(c => c.text && c.text.length <= 40);
  }
  // PRD 评论优先级：评论区重复出现(≥2)的评论 > 点赞最高的评论 → 取它当"参考范本"（再让 AI 仿写，避免照抄被判无效）
  function pickModelComment(comments) {
    if (!comments || !comments.length) return '';
    const norm = t => (t || '').replace(/\s+/g, '').toLowerCase();
    const cnt = {}; comments.forEach(c => { const k = norm(c.text); if (k.length >= 2 && k.length <= 18) cnt[k] = (cnt[k] || 0) + 1; });
    const dup = Object.entries(cnt).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1])[0];
    if (dup) { const c = comments.find(x => norm(x.text) === dup[0]); if (c) return c.text; }
    const top = [...comments].sort((a, b) => b.likes - a.likes)[0];
    return (top && top.likes > 0) ? top.text : '';
  }
  function findCommentInput() { return document.querySelector('[class*="comment"] textarea, [class*="comment-box"] [contenteditable="true"], #content-textarea'); }
  async function postCommentReply(text) {
    const box = findCommentInput(); if (!box || !text) return false;
    box.focus();
    if (box.tagName === 'TEXTAREA') { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); }
    else { box.textContent = text; box.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    await sleep(rnd(500, 1000));
    return clickByText(['发送', '发布']);
  }
  // 截流执行：评论区抓评论 → AI（按人设+笔记上下文+该评论）生成自然引流回复，命中上限就发；
  // 私信只生成草稿存库，由人在 popup 里人工确认发送——不自动私信，规避高风险灰色操作。
  async function runIntercept(plan, ui, stat, b) {
    stat = stat || {};
    const planId = plan._planId || null;
    const ic = ((plan.config || {}).intercept) || {};
    const persona = (plan.config && plan.config.persona) || '你是资深小红书内容操盘手，第一人称真人感、绝不AI腔；自然、不硬广、不站外导流。';
    if (!ic.collect && !ic.reply && !ic.dm) return;
    await sleep(rnd(1500, 2500));
    const ctx = noteContext();
    const comments = collectComments(10);
    if (!comments.length) return;
    // 收集评论 → 上报到系统「评论收集」潜客列表（纯新增：只上报，不改原有回复/私信逻辑）
    if (ic.collect) {
      try {
        const noteTitle = (ctx.split('\n')[0] || '').slice(0, 120);
        chrome.runtime.sendMessage({ type: 'reportLeads', items: comments.map(c => ({ platform: 'xhs', note_title: noteTitle, note_url: location.href, lead_user: c.user, lead_text: c.text, lead_link: c.link, plan_id: planId })) });
        stat.collected = (stat.collected || 0) + comments.length;
      } catch (e) {}
    }
    // isrc=预设/话术库 暂未接入素材库，目前只实现 AI 智能来源；非 AI 来源先跳过，避免话术与配置承诺不符
    const useAi = !ic.isrc || ic.isrc === 'ai';
    const useLib = ic.isrc === 'lib';
    // 间隔（分钟→毫秒），最小 1 分钟，避免高频触发风控
    const replyGap = Math.max(1, ic.replyInt || 1) * 60000;
    const dmGap = Math.max(1, ic.dmInt || 1) * 60000;
    let replied = 0, queued = 0, lastReplyAt = 0, lastDmAt = 0;
    for (const c of comments) {
      if (stopFlag || riskHit()) { ui.say('⚠ 触发验证，截流已停止'); break; }
      // 多模态识别开启时：用 AI 先判断是否高质量潜客，非潜客跳过
      if (ic.aiMatch !== false && (ic.reply > 0 || ic.dm > 0) && (useAi || useLib)) {
        const verdict = await aiText(persona, `笔记内容：${ctx}\n\n用户评论：「${c.text}」\n这条评论是否来自一个对该内容/产品有真实兴趣的潜在客户？只回答「是」或「否」。`);
        if (verdict && /否|no/i.test(verdict) && !/是/.test(verdict)) { await sleep(rnd(600, 1200)); continue; }
      }
      if ((useAi || useLib) && ic.reply > 0 && replied < ic.reply && (!b || budgetLeft(b, 'replied') > 0)) {
        const wait = lastReplyAt ? Math.max(0, replyGap - (Date.now() - lastReplyAt)) : 0;
        if (wait > 0) { ui.say(`引流回复间隔等待 ${Math.ceil(wait/60000)} 分钟…`); await sleep(wait); }
        if (stopFlag) break;
        const draft = useLib ? await libPick(ic.libId)
          : await aiText(persona, `笔记内容：${ctx}\n\n这位用户的评论：「${c.text}」\n请生成一条自然、不硬广、不站外导流的引流回复（≤40字，像真人随手回复，不要出现"AI"字样）。`);
        if (draft && await postCommentReply(draft)) { replied++; stat.replied = (stat.replied || 0) + 1; if (b) { b.replied++; saveBudget(b); } lastReplyAt = Date.now(); ui.say(`引流回复 ${replied}/${ic.reply}`); await sleep(rnd(3000, 6000)); }
      }
      if ((useAi || useLib) && ic.dm > 0 && queued < ic.dm && (!b || budgetLeft(b, 'dmed') > 0)) {
        const wait = lastDmAt ? Math.max(0, dmGap - (Date.now() - lastDmAt)) : 0;
        if (wait > 0) await sleep(wait);
        if (stopFlag) break;
        lastDmAt = Date.now();
        const draft = useLib ? await libPick(ic.libId)
          : await aiText(persona, `这位潜在客户的评论：「${c.text}」\n请生成一条自然、不硬广的私信开场话术（≤50字），用于后续人工确认发送。`);
        if (draft) { chrome.runtime.sendMessage({ type: 'queueDM', item: { user: c.user, link: c.link, comment: c.text, draft, note: location.href } }); queued++; stat.dmed = (stat.dmed || 0) + 1; if (b) { b.dmed++; saveBudget(b); } }
      }
      await sleep(rnd(1200, 2200));
    }
    if (replied || queued) ui.say(`截流：回复${replied}条 · 私信草稿待人工确认${queued}条`);
    else if (!useAi && !useLib) ui.say('话术来源「预设」尚未接入，请选「AI智能」或「话术库」');
    else if (useLib && !replied && !queued) ui.say('所选话术库为空或没取到回答，请去话术库补几条');
  }

  async function runPlan(plan) {
    const ui = overlay();
    const cfg = (plan && plan.config) || {};
    const nz = cfg.nurture || {};
    const b = await loadBudget();
    // 单次运行封顶 15 篇，再与用户设定/剩余日额度取小，防止一次暴走
    const cap = Math.max(1, Math.min(15, nz.daily || 6, budgetLeft(b, 'opened')));
    const minutes = plan._minutes || 12;
    const deadline = Date.now() + minutes * 60000;
    const isSearch = /^search_/.test(plan.ptype || '');
    const kw = (cfg.keywords || [])[0] || '';
    const persona = cfg.persona || '你是资深小红书内容操盘手，第一人称真人感、绝不AI腔；自然、不硬广、不站外导流。';
    let opened = 0, liked = 0, faved = 0, followed = 0, commented = 0;
    const stat = { collected: 0, replied: 0, dmed: 0 };
    let filtered = !(isSearch && cfg.filter);
    try {
      // 定位到目标列表
      if (isSearch && kw) {
        if (!/search_result/.test(location.href)) { location.href = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw); return; }
      } else if (!/\/explore/.test(location.href)) { location.href = 'https://www.xiaohongshu.com/explore'; return; }
      await sleep(rnd(2500, 4000));
      if (!filtered) { applySearchFilter(cfg.filter); filtered = true; await sleep(rnd(1200, 2000)); }
      if (cap < 1) { ui.say('今日额度已用尽，明天再跑（防风控）'); ui.done(); return; }
      while (!stopFlag && Date.now() < deadline && opened < cap) {
        if (riskHit()) { ui.say('⚠ 触发验证，已停止'); break; }
        for (let s = 0; s < Math.round(rnd(2, 4)) && !stopFlag; s++) { window.scrollBy({ top: rnd(300, 700), behavior: 'smooth' }); await sleep(rnd(1500, 3200)); }
        const links = [...document.querySelectorAll('a[href*="/explore/"],a[href*="/search_result/"],a[href*="/discovery/item/"]')].filter(a => a.offsetParent);
        const link = links[Math.floor(rnd(0, Math.min(links.length, 10)))];
        if (!link) { ui.say('刷信息流中…'); await sleep(rnd(2000, 3500)); continue; }
        opened++; b.opened++; saveBudget(b); ui.say(`浏览 ${opened}/${cap} 篇 · 阅读中…`);
        link.click(); await sleep(rnd(4000, 8000));
        // 广告/直播 → 不互动，尽快返回（PRD）
        if (isAdOrLive()) { ui.say('跳过 广告/直播'); await sleep(rnd(1500, 4000)); history.back(); await sleep(rnd(2000, 3500)); continue; }
        for (let s = 0; s < 2 && !stopFlag; s++) { window.scrollBy({ top: rnd(200, 500), behavior: 'smooth' }); await sleep(rnd(1500, 2800)); }
        if (riskHit()) { ui.say('⚠ 触发验证，已停止'); break; }
        // 关键词匹配 → 直接感兴趣；不匹配 → 按好感率（PRD）
        const ctxTxt = noteContext();
        const interested = kwMatch(ctxTxt, cfg.keywords) || chance(nz.love != null ? nz.love : 70);
        if (interested) {
          // 拟人多停留一会儿（PRD：感兴趣内容停留更久）
          await sleep(rnd(2000, 6000));
          if (budgetLeft(b, 'liked') > 0 && chance(nz.like || 0) && doLike()) { liked++; b.liked++; saveBudget(b); await sleep(rnd(800, 1600)); }
          if (budgetLeft(b, 'faved') > 0 && chance(nz.fav || 0) && doFav()) { faved++; b.faved++; saveBudget(b); await sleep(rnd(800, 1600)); }
          // 关注是最敏感动作：单独日上限 + 强制间隔
          if (budgetLeft(b, 'followed') > 0 && chance(nz.follow || 0)) { await hiRiskGate(ui, '关注'); if (!stopFlag && doFollow()) { followed++; b.followed++; saveBudget(b); await sleep(rnd(800, 1600)); } }
          if (budgetLeft(b, 'commented') > 0 && chance(nz.comment || 0)) {
            await hiRiskGate(ui, '评论');
            // PRD 评论优先级：复刻评论区重复/最高赞评论(AI 仿写) > 话术库 > AI 从笔记生成
            const model = pickModelComment(collectCommentsRich(20));
            const draft = model
              ? await aiText(persona, `评论区有一条受欢迎的评论：「${model}」。仿照它的角度和口吻，换个说法写一条自然的真人感评论（≤25字，别照抄、不硬广、不出现"AI"）。`)
              : nz.csrc === 'lib' ? await libPick(nz.libId)
              : await aiText(persona, `笔记内容：${ctxTxt}\n请生成一条自然的真人感评论（≤30字，不硬广，不出现"AI"字样）。`);
            if (draft && !stopFlag && await postCommentReply(draft)) { commented++; b.commented++; saveBudget(b); await sleep(rnd(2000, 4000)); }
          }
          // 随机访问博主主页后退出（拟人，PRD）
          if (chance(25)) { const a = document.querySelector('a[href*="/user/profile/"]'); if (a) { a.click(); await sleep(rnd(3000, 7000)); window.scrollBy({ top: rnd(300, 800), behavior: 'smooth' }); await sleep(rnd(1500, 3000)); history.back(); await sleep(rnd(1500, 2500)); } }
        }
        // 截流计划：评论区抓取 + AI 引流回复（自动，有上限）；私信只生成草稿，存库待人工确认发送
        if (/_intercept$/.test(plan.ptype || '') && !stopFlag) { try { await runIntercept(plan, ui, stat, b); } catch (e) { ui.say('截流出错：' + (e.message || e)); } }
        history.back(); await sleep(rnd(2500, 4500));
      }
      ui.say((stopFlag ? `已停止 · 浏览${opened} 赞${liked} 藏${faved} 关注${followed} 评论${commented}` : `✓ 完成：浏览 ${opened} 篇 · 点赞 ${liked} · 收藏 ${faved} · 关注 ${followed} · 评论 ${commented}`) + `　今日累计 关注${b.followed}/${capFor(b, 'followed')} 评论${b.commented}/${capFor(b, 'commented')}`);
    } catch (e) { ui.say('养号出错：' + (e.message || e)); }
    // 跑完上报本轮统计（收集/回复/私信）到任务列表
    try { if (plan._planId && (stat.collected || stat.replied || stat.dmed)) chrome.runtime.sendMessage({ type: 'reportStat', planId: plan._planId, collected: stat.collected, replied: stat.replied, dmed: stat.dmed }); } catch (e) {}
    // 若是「多设备下发」领取的任务 → 回报完成，让该设备解锁并领下一条
    try { if (plan._dispatchId) chrome.runtime.sendMessage({ type: 'dispatchDone', dispatchId: plan._dispatchId, result: `浏览${opened}·赞${liked}·藏${faved}·关注${followed}·评论${commented}` + (stat.collected ? `·收集${stat.collected}` : '') }); } catch (e) {}
    ui.done();
  }
})();
