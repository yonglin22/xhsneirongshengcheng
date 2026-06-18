// 注入 creator.xiaohongshu.com：拿后台暂存的内容，自动填进图文发布页并存草稿
(function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log('[朱砂助手]', ...a);

  function clickByText(texts) {
    const arr = Array.isArray(texts) ? texts : [texts];
    const els = [...document.querySelectorAll('button,div,span,a,[role=button]')];
    for (const t of arr) {
      const el = els.find(e => {
        const tx = (e.textContent || '').trim();
        return tx === t || (tx.length <= t.length + 4 && tx.includes(t));
      });
      if (el) { el.click(); return true; }
    }
    return false;
  }
  function setNativeValue(el, val) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function urlsToFiles(urls) {
    const files = [];
    for (let i = 0; i < (urls || []).length && i < 9; i++) {
      const u = urls[i]; if (!u) continue;
      try {
        const resp = await fetch(u);
        const blob = await resp.blob();
        const ext = blob.type.includes('png') ? 'png' : 'jpg';
        files.push(new File([blob], `img_${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
      } catch (e) { log('图片下载失败', u, e); }
    }
    return files;
  }
  function setFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function run(payload) {
    const status = document.createElement('div');
    status.style.cssText = 'position:fixed;top:14px;right:14px;z-index:999999;background:#16181d;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:320px;line-height:1.5';
    status.textContent = '朱砂助手：正在自动填充…';
    document.body.appendChild(status);
    const say = (t) => { status.textContent = '朱砂助手：' + t; log(t); };
    try {
      await sleep(3500);
      // 切到「上传图文」
      clickByText(['上传图文', '写图文', '图文']);
      await sleep(1200);
      // 上传图片
      const files = await urlsToFiles(payload.images);
      const input = document.querySelector('input[type=file]');
      if (input && files.length) { setFiles(input, files); say('已上传 ' + files.length + ' 张图，等待处理…'); }
      else { say('⚠ 没找到图片或上传框，请手动传图'); }
      await sleep(7000);
      // 标题
      const ti = document.querySelector('input[placeholder*="标题"]');
      if (ti) setNativeValue(ti, (payload.title || '').slice(0, 20));
      // 正文（contenteditable）
      const ed = document.querySelector('[contenteditable="true"]');
      if (ed) { ed.focus(); document.execCommand('insertText', false, (payload.body || '').slice(0, 980)); }
      await sleep(1500);
      // 存草稿
      const saved = clickByText(['暂存离开', '存草稿', '保存草稿']);
      say(saved ? '✓ 已点存草稿，请在「草稿箱」确认终审发布' : '内容已填好，请手动点「暂存离开/存草稿」');
      setTimeout(() => status.remove(), 9000);
    } catch (e) {
      say('出错：' + (e.message || e) + '（可手动完成）');
      setTimeout(() => status.remove(), 12000);
    }
  }

  chrome.runtime.sendMessage({ type: 'getPayload' }, (resp) => {
    if (resp && resp.payload) run(resp.payload);
  });
})();
