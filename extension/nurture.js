// 养号执行（计划驱动·保守拟真）：在 www.xiaohongshu.com 按计划 关键词/篇数/好感率/点赞·收藏% 跑
// 来源：① 获客计划页「▶ 执行」下发的 plan ② popup 简易养号(nurtureCfg)。出验证/异常立即停。
(function () {
  if (!/^https?:\/\/www\.xiaohongshu\.com/.test(location.href)) return;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const chance = (pct) => Math.random() * 100 < (pct || 0);
  const log = (...a) => console.log('[朱砂养号]', ...a);
  let stopFlag = false;

  chrome.storage.local.get(['nurtureRun', 'nurtureCfg', 'nurturePlan'], async (st) => {
    if (st.nurturePlan) { chrome.storage.local.set({ nurturePlan: null }); return runPlan(st.nurturePlan); }
    if (st.nurtureRun) { chrome.storage.local.set({ nurtureRun: false }); return runPlan(toPlan(st.nurtureCfg)); }
  });
  function toPlan(cfg) { cfg = cfg || {}; return { ptype: 'home_nurture', config: { keywords: [], nurture: { love: 100, like: 60, fav: 0, daily: cfg.notes || 6 } }, _minutes: cfg.minutes || 8 }; }

  function overlay() {
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:999999;background:#16181d;color:#fff;padding:12px 16px;border-radius:12px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:320px;line-height:1.6;font-family:-apple-system,sans-serif';
    o.innerHTML = '<b>🌱 朱砂养号中…</b><div id="nz-msg" style="margin-top:4px;color:#ddd"></div><button id="nz-stop" style="margin-top:8px;background:#ff2442;color:#fff;border:none;border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer">停止</button>';
    document.body.appendChild(o);
    o.querySelector('#nz-stop').onclick = () => { stopFlag = true; };
    return { say: t => { const m = o.querySelector('#nz-msg'); if (m) m.textContent = t; log(t); }, done: () => setTimeout(() => o.remove(), 7000) };
  }
  function riskHit() { const t = document.body.innerText || ''; return /环境异常|安全验证|滑动验证|拼图验证|完成验证/.test(t) && t.length < 2000; }
  function clickByText(arr) { const els = [...document.querySelectorAll('span,button,div,[role=button]')]; for (const t of arr) { const el = els.find(e => { const tx = (e.textContent || '').replace(/\s+/g, ''); return tx && tx.length <= t.length + 3 && tx.includes(t) && (e.offsetParent !== null); }); if (el) { (el.closest('button,[role=button]') || el).click(); return true; } } return false; }
  // 点赞/收藏：小红书笔记详情里图标，选择器多变 → 多策略尝试
  function doLike() { const el = document.querySelector('.like-wrapper, .like-active, [class*="like"] svg, .interact-container .like'); if (el) { (el.closest('[class*=like]') || el).click(); return true; } return clickByText(['赞']); }
  function doFav() { const el = document.querySelector('.collect-wrapper, [class*="collect"] svg, .interact-container .collect'); if (el) { (el.closest('[class*=collect]') || el).click(); return true; } return clickByText(['收藏']); }

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
  async function runIntercept(plan, ui) {
    const ic = ((plan.config || {}).intercept) || {};
    const persona = (plan.config && plan.config.persona) || '你是资深小红书内容操盘手，第一人称真人感、绝不AI腔；自然、不硬广、不站外导流。';
    if (!ic.collect && !ic.reply && !ic.dm) return;
    await sleep(rnd(1500, 2500));
    const ctx = noteContext();
    const comments = collectComments(10);
    if (!comments.length) return;
    let replied = 0, queued = 0;
    for (const c of comments) {
      if (stopFlag || riskHit()) { ui.say('⚠ 触发验证，截流已停止'); break; }
      if (ic.reply > 0 && replied < ic.reply) {
        const draft = await aiText(persona, `笔记内容：${ctx}\n\n这位用户的评论：「${c.text}」\n请生成一条自然、不硬广、不站外导流的引流回复（≤40字，像真人随手回复，不要出现"AI"字样）。`);
        if (draft && await postCommentReply(draft)) { replied++; ui.say(`引流回复 ${replied}/${ic.reply}`); await sleep(rnd(3000, 6000)); }
      }
      if (ic.dm > 0 && queued < ic.dm) {
        const draft = await aiText(persona, `这位潜在客户的评论：「${c.text}」\n请生成一条自然、不硬广的私信开场话术（≤50字），用于后续人工确认发送。`);
        if (draft) { chrome.runtime.sendMessage({ type: 'queueDM', item: { user: c.user, link: c.link, comment: c.text, draft, note: location.href } }); queued++; }
      }
      await sleep(rnd(1200, 2200));
    }
    if (replied || queued) ui.say(`截流：回复${replied}条 · 私信草稿待人工确认${queued}条`);
  }

  async function runPlan(plan) {
    const ui = overlay();
    const cfg = (plan && plan.config) || {};
    const nz = cfg.nurture || {};
    const cap = Math.max(1, Math.min(30, nz.daily || 6));
    const minutes = plan._minutes || 12;
    const deadline = Date.now() + minutes * 60000;
    const isSearch = /^search_/.test(plan.ptype || '');
    const kw = (cfg.keywords || [])[0] || '';
    let opened = 0, liked = 0, faved = 0;
    try {
      // 定位到目标列表
      if (isSearch && kw) {
        if (!/search_result/.test(location.href)) { location.href = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw); return; }
      } else if (!/\/explore/.test(location.href)) { location.href = 'https://www.xiaohongshu.com/explore'; return; }
      await sleep(rnd(2500, 4000));
      while (!stopFlag && Date.now() < deadline && opened < cap) {
        if (riskHit()) { ui.say('⚠ 触发验证，已停止'); break; }
        for (let s = 0; s < Math.round(rnd(2, 4)) && !stopFlag; s++) { window.scrollBy({ top: rnd(300, 700), behavior: 'smooth' }); await sleep(rnd(1500, 3200)); }
        const links = [...document.querySelectorAll('a[href*="/explore/"],a[href*="/search_result/"],a[href*="/discovery/item/"]')].filter(a => a.offsetParent);
        const link = links[Math.floor(rnd(0, Math.min(links.length, 10)))];
        if (!link) { ui.say('刷信息流中…'); await sleep(rnd(2000, 3500)); continue; }
        opened++; ui.say(`浏览 ${opened}/${cap} 篇 · 阅读中…`);
        link.click(); await sleep(rnd(6000, 13000));
        for (let s = 0; s < 2 && !stopFlag; s++) { window.scrollBy({ top: rnd(200, 500), behavior: 'smooth' }); await sleep(rnd(1500, 2800)); }
        if (riskHit()) { ui.say('⚠ 触发验证，已停止'); break; }
        // 好感率 → 是否互动；命中后按 点赞%/收藏% 操作
        if (chance(nz.love != null ? nz.love : 70)) {
          if (chance(nz.like || 0) && doLike()) { liked++; await sleep(rnd(800, 1600)); }
          if (chance(nz.fav || 0) && doFav()) { faved++; await sleep(rnd(800, 1600)); }
        }
        // 截流计划：评论区抓取 + AI 引流回复（自动，有上限）；私信只生成草稿，存库待人工确认发送
        if (/_intercept$/.test(plan.ptype || '') && !stopFlag) { try { await runIntercept(plan, ui); } catch (e) { ui.say('截流出错：' + (e.message || e)); } }
        history.back(); await sleep(rnd(2500, 4500));
      }
      ui.say(stopFlag ? `已停止 · 浏览${opened} 赞${liked} 藏${faved}` : `✓ 完成：浏览 ${opened} 篇 · 点赞 ${liked} · 收藏 ${faved}`);
    } catch (e) { ui.say('养号出错：' + (e.message || e)); }
    ui.done();
  }
})();
