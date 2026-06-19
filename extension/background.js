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
});
