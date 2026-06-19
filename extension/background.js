// 后台中转：朱砂页面 → 小红书创作页
let pending = null; // { title, body, images }

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
  if (msg && msg.type === 'nurture') {
    chrome.storage.local.set({ nurtureRun: true, nurtureCfg: msg.cfg || { notes: 6, minutes: 8 } }, () => {
      chrome.tabs.create({ url: 'https://www.xiaohongshu.com/explore', active: true });
      sendResponse({ ok: true, msg: '已打开小红书，开始养号' });
    });
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
  if (msg && msg.type === 'ping') { sendResponse({ ok: true }); return true; }
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
  // 待发私信草稿入库（人工确认发送，不自动发，降低高风险灰色操作的封号风险）
  if (msg && msg.type === 'queueDM') {
    chrome.storage.local.get(['zsPendingDM'], st => {
      const list = (st.zsPendingDM || []).concat([{ ...msg.item, ts: Date.now() }]).slice(-200);
      chrome.storage.local.set({ zsPendingDM: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});
