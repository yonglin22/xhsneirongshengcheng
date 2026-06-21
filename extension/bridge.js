// 注入到朱砂(yonglin.chat)：把"插件已安装"告诉页面，并把页面的发布请求转给后台
(function () {
  // 告知页面插件就绪（页面据此显示「插件发布」按钮可用）
  const announce = () => window.postMessage({ __zhusha_ext: 'ready', v: '0.1.0' }, '*');
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
    if (e.data.type === 'ZHUSHA_PUBLISH') {
      const payload = e.data.payload || {};
      chrome.runtime.sendMessage({ type: 'publish', payload }, (resp) => {
        window.postMessage({ type: 'ZHUSHA_PUBLISH_ACK', ok: !!(resp && resp.ok), msg: (resp && resp.msg) || (chrome.runtime.lastError ? chrome.runtime.lastError.message : '') }, '*');
      });
    }
    if (e.data.type === 'ZHUSHA_XHS_SEARCH') {
      const { keyword, sort, type, reqId } = e.data;
      chrome.runtime.sendMessage({ type: 'xhsSearch', keyword, sort, type }, (resp) => {
        window.postMessage({ type: 'ZHUSHA_XHS_SEARCH_ACK', reqId, result: resp || { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '插件无响应' } }, '*');
      });
    }
    if (e.data.type === 'ZHUSHA_NURTURE_PLAN') {
      const plan = e.data.plan || {};
      chrome.runtime.sendMessage({ type: 'nurturePlan', plan }, (resp) => {
        window.postMessage({ type: 'ZHUSHA_NURTURE_ACK', ok: !!(resp && resp.ok), msg: (resp && resp.msg) || '' }, '*');
      });
    }
  });
})();
