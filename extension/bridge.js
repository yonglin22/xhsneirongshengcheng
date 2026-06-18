// 注入到朱砂(yonglin.chat)：把"插件已安装"告诉页面，并把页面的发布请求转给后台
(function () {
  // 告知页面插件就绪（页面据此显示「插件发布」按钮可用）
  const announce = () => window.postMessage({ __zhusha_ext: 'ready', v: '0.1.0' }, '*');
  announce();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) announce(); });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'ZHUSHA_EXT_PING') { announce(); return; }
    if (e.data.type === 'ZHUSHA_PUBLISH') {
      const payload = e.data.payload || {};
      chrome.runtime.sendMessage({ type: 'publish', payload }, (resp) => {
        window.postMessage({ type: 'ZHUSHA_PUBLISH_ACK', ok: !!(resp && resp.ok), msg: (resp && resp.msg) || (chrome.runtime.lastError ? chrome.runtime.lastError.message : '') }, '*');
      });
    }
  });
})();
