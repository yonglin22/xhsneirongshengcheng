// 注入到朱砂(yonglin.chat)：把"插件已安装"告诉页面，并把页面的发布请求转给后台
(function () {
  // 告知页面插件就绪（页面据此显示「插件发布」按钮可用）
  const announce = () => window.postMessage({ __zhusha_ext: 'ready', v: '0.9.1' }, '*');
  announce();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { announce(); syncPersona(); } });

  // 同步当前智能体人设到插件本地存储，供插件弹窗里直接执行计划时使用（无需打开网页）
  function syncPersona() {
    try {
      const tid = localStorage.getItem('ag_track');
      if (!tid) return;
      const c = JSON.parse(localStorage.getItem('ag_cfg_' + tid) || '{}');
      if (c.persona) chrome.runtime.sendMessage({ type: 'syncPersona', persona: c.persona, trackId: tid });
    } catch {}
  }
  syncPersona();

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'ZHUSHA_EXT_PING') { announce(); return; }
    if (e.data.type === 'ZHUSHA_PULL_CONTENT') { chrome.runtime.sendMessage({ type: 'pullContentNow' }, () => void chrome.runtime.lastError); return; }
    if (e.data.type === 'ZHUSHA_PUBLISH') {
      const payload = e.data.payload || {};
      chrome.runtime.sendMessage({ type: 'publish', payload }, (resp) => {
        window.postMessage({ type: 'ZHUSHA_PUBLISH_ACK', ok: !!(resp && resp.ok), msg: (resp && resp.msg) || (chrome.runtime.lastError ? chrome.runtime.lastError.message : '') }, '*');
      });
    }
    if (e.data.type === 'ZHUSHA_XHS_SEARCH') {
      const { keyword, sort, searchType, reqId } = e.data;
      // 抓取要 40+ 秒，旧写法靠 sendMessage 回调长挂着等结果，后台进程一被回收回调就丢、页面只能干等超时。
      // 改：把 reqId 一并发给后台，后台立刻回执、抓完后用 tabs.sendMessage 把结果“推”回来（见下方监听）。
      // 插件被重新加载后旧页面里本脚本连接会失效（Extension context invalidated），sendMessage 抛错 → 回 ACK 提示刷新。
      try {
        chrome.runtime.sendMessage({ type: 'xhsSearch', keyword, sort, searchType, reqId }, () => void chrome.runtime.lastError);
      } catch (err) {
        window.postMessage({ type: 'ZHUSHA_XHS_SEARCH_ACK', reqId, result: { ok: false, error: '插件连接已失效（请刷新本页面 ⌘R 后重试）：' + (err && err.message || err) } }, '*');
      }
    }
    if (e.data.type === 'ZHUSHA_XHS_FETCH_NOTE') {
      const { url, reqId } = e.data;
      try {
        chrome.runtime.sendMessage({ type: 'xhsFetchNote', url, reqId }, () => void chrome.runtime.lastError);
      } catch (err) {
        window.postMessage({ type: 'ZHUSHA_XHS_FETCH_NOTE_ACK', reqId, result: { ok: false, error: '插件连接已失效（请刷新本页面 ⌘R 后重试）：' + (err && err.message || err) } }, '*');
      }
    }
    if (e.data.type === 'ZHUSHA_XHS_FETCH_FANS') {
      const { url, reqId } = e.data;
      try {
        chrome.runtime.sendMessage({ type: 'xhsFetchFans', url, reqId }, () => void chrome.runtime.lastError);
      } catch (err) {
        window.postMessage({ type: 'ZHUSHA_XHS_FETCH_FANS_ACK', reqId, result: { ok: false, error: '插件连接已失效（请刷新本页面 ⌘R 后重试）：' + (err && err.message || err) } }, '*');
      }
    }
    if (e.data.type === 'ZHUSHA_NURTURE_PLAN') {
      const plan = e.data.plan || {};
      chrome.runtime.sendMessage({ type: 'nurturePlan', plan }, (resp) => {
        window.postMessage({ type: 'ZHUSHA_NURTURE_ACK', ok: !!(resp && resp.ok), msg: (resp && resp.msg) || '' }, '*');
      });
    }
    if (e.data.type === 'ZHUSHA_SUBMIT_COOKIE') {
      const { accountId, nickname } = e.data;
      try {
        chrome.runtime.sendMessage({ type: 'submitXhsCookie', accountId, nickname }, (resp) => {
          window.postMessage({ type: 'ZHUSHA_SUBMIT_COOKIE_ACK', ok: !!(resp && resp.ok), id: resp && resp.id, error: (resp && resp.error) || (chrome.runtime.lastError ? chrome.runtime.lastError.message : '') }, '*');
        });
      } catch (err) {
        window.postMessage({ type: 'ZHUSHA_SUBMIT_COOKIE_ACK', ok: false, error: '插件连接已失效（刷新本页后重试）：' + (err && err.message || err) }, '*');
      }
    }
  });

  // 后台抓完后把结果“推”回来（不依赖那条会被回收的长连接），转发给页面。
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'xhsSearchResult') {
      window.postMessage({ type: 'ZHUSHA_XHS_SEARCH_ACK', reqId: msg.reqId, result: msg.result || { ok: false, error: '空响应' } }, '*');
    }
    if (msg && msg.type === 'xhsFetchNoteResult') {
      window.postMessage({ type: 'ZHUSHA_XHS_FETCH_NOTE_ACK', reqId: msg.reqId, result: msg.result || { ok: false, error: '空响应' } }, '*');
    }
    if (msg && msg.type === 'xhsFetchFansResult') {
      window.postMessage({ type: 'ZHUSHA_XHS_FETCH_FANS_ACK', reqId: msg.reqId, result: msg.result || { ok: false, error: '空响应' } }, '*');
    }
  });
})();
