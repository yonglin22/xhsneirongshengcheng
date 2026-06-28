// 注入 creator.xiaohongshu.com：拿后台暂存的内容，自动填进图文发布页并存草稿
(function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log('[朱砂助手]', ...a);

  const norm = (s) => (s || '').replace(/\s+/g, '');
  function visible(e) { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }
  // RPA 真点击：派发完整指针+鼠标事件序列（React/小红书按钮普通 .click() 常失效）
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    try { el.scrollIntoView({ block: 'center' }); } catch {}
    ['pointerover', 'pointerenter', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      try { el.dispatchEvent(t.startsWith('pointer') ? new PointerEvent(t, o) : new MouseEvent(t, o)); } catch { try { el.dispatchEvent(new MouseEvent(t.replace('pointer', 'mouse'), o)); } catch {} }
    });
  }
  // 在全页面找按钮：先精确等于，再包含；可见优先。labels 顺序=优先级
  // 穿透 shadow DOM 收集元素（小红书创作页底部「暂存离开/发布」常在 web component 的 shadowRoot 里）
  function deepEls(sel, root, out, depth) {
    out = out || []; root = root || document; depth = depth || 0;
    if (depth > 8) return out;
    try { root.querySelectorAll(sel).forEach(e => out.push(e)); } catch (e) {}
    let all = []; try { all = root.querySelectorAll('*'); } catch (e) {}
    for (const el of all) { if (el.shadowRoot) deepEls(sel, el.shadowRoot, out, depth + 1); }
    return out;
  }
  function findBtn(labels) {
    const els = deepEls('button,[role=button],a,div,span');
    for (const lab of labels) {
      let el = els.find(e => norm(e.textContent) === lab && visible(e));
      if (!el) el = els.find(e => { const tx = norm(e.textContent); return tx && tx.length <= lab.length + 4 && tx.includes(lab) && visible(e); });
      if (el) return el.closest('button,[role=button]') || el;
    }
    return null;
  }
  function clickByText(texts) {
    const el = findBtn(Array.isArray(texts) ? texts : [texts]);
    if (el) { realClick(el); return true; }
    return false;
  }
  // 持续监视直到出现目标按钮（RPA 等待），最长 timeoutMs；出现即真点击
  function waitAndClick(labels, timeoutMs, onProgress) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let done = false;
      const finish = (ok) => { if (done) return; done = true; try { obs.disconnect(); } catch {} clearInterval(iv); resolve(ok); };
      const tryOnce = () => {
        const el = findBtn(labels);
        if (el) { realClick(el); setTimeout(() => realClick(el), 250); finish(true); return true; }
        return false;
      };
      const obs = new MutationObserver(() => tryOnce());
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const iv = setInterval(() => {
        if (tryOnce()) return;
        const s = Math.round((Date.now() - t0) / 1000);
        if (onProgress) onProgress(s);
        if (Date.now() - t0 > timeoutMs) finish(false);
      }, 700);
      tryOnce();
    });
  }
  function setNativeValue(el, val) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // 小红书图文最多 18 张。data: 直接转 blob；http(s) 先直连，失败再用朱砂 img-proxy 兜底
  // （AI 出图的签名链常带防盗链/CORS，从小红书域名直连会失败被丢图 → 必须代理回源）
  async function fetchBlob(u) {
    try { const r = await fetch(u); if (r.ok) return await r.blob(); } catch (e) {}
    if (/^https?:\/\//.test(u)) {
      try { const r = await fetch('https://yonglin.chat/api/img-proxy?u=' + encodeURIComponent(u)); if (r.ok) return await r.blob(); } catch (e) {}
    }
    return null;
  }
  async function urlsToFiles(urls) {
    const files = [];
    for (let i = 0; i < (urls || []).length && i < 18; i++) {
      const u = urls[i]; if (!u) continue;
      const blob = await fetchBlob(u);
      if (!blob) { log('图片下载失败（已尝试代理兜底）', u); continue; }
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      files.push(new File([blob], `img_${i + 1}.${ext}`, { type: blob.type || 'image/jpeg' }));
    }
    return files;
  }
  function setFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function dispatchKey(el, type, key) {
    el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }));
  }
  // 正文末尾逐个插入「#标签」：小红书编辑器会弹出话题联想下拉，回车选中第一项生成话题 chip；
  // 没匹配到联想词时回车也会把纯文字提交为话题，不会卡住。
  async function insertTags(ed, tags) {
    for (const raw of (tags || [])) {
      const tag = String(raw || '').trim().replace(/^#/, '');
      if (!tag) continue;
      ed.focus();
      document.execCommand('insertText', false, ' #' + tag);
      await sleep(900);
      dispatchKey(ed, 'keydown', 'Enter'); dispatchKey(ed, 'keyup', 'Enter');
      await sleep(500);
    }
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
      const want = (payload.images || []).filter(Boolean).length;
      const files = await urlsToFiles(payload.images);
      const input = document.querySelector('input[type=file]');
      if (input && files.length) { setFiles(input, files); say('已上传 ' + files.length + ' / ' + want + ' 张图' + (files.length < want ? '（部分图下载失败已跳过）' : '') + '，等待处理…'); }
      else { say('⚠ 没找到图片或上传框，请手动传图'); }
      await sleep(7000);
      // 标题
      const ti = document.querySelector('input[placeholder*="标题"]');
      if (ti) setNativeValue(ti, (payload.title || '').slice(0, 20));
      // 正文（contenteditable）
      const ed = document.querySelector('[contenteditable="true"]');
      if (ed) { ed.focus(); document.execCommand('insertText', false, (payload.body || '').slice(0, 980)); }
      await sleep(1500);
      // 话题标签：逐个插完正文末尾的 #标签
      if (ed && payload.tags && payload.tags.length) {
        say('正在插入话题标签…');
        await insertTags(ed, payload.tags);
      }
      await sleep(500);
      // 等图片上传完成：底部操作栏（暂存离开/发布）通常在图片处理完后才出现
      say('等待图片上传完成…');
      for (let i = 0; i < 40; i++) {
        const t = document.body.innerText || '';
        const uploading = /上传中|处理中|\d+%/.test(t);
        if (!uploading && (findBtn(['暂存离开', '暂存', '存草稿']) || findBtn(['发布']))) break;
        await sleep(1000);
      }
      // 存草稿：RPA 持续监视，最长 90 秒，出现「暂存离开」立即真点击；绝不点「发布」
      say('正在自动识别「暂存离开」（最长90秒）…');
      const saved = await waitAndClick(['暂存离开', '存草稿', '保存草稿', '存为草稿', '暂存'], 90000, (s) => say('正在自动识别「暂存离开」… ' + s + 's'));
      if (saved) {
        say('✓ 已点「暂存离开」，存入草稿箱。去小红书 App / 创作中心「草稿箱」确认');
        if (payload._contentDispatchId) { try { chrome.runtime.sendMessage({ type: 'contentDispatchDone', dispatchId: payload._contentDispatchId, result: '✓ 已存草稿箱' }); } catch (e) {} }
      } else {
        if (payload._contentDispatchId) { try { chrome.runtime.sendMessage({ type: 'contentDispatchDone', dispatchId: payload._contentDispatchId, result: '⚠ 已填好内容，需手动点暂存离开' }); } catch (e) {} }
        const btns = deepEls('button,[role=button],div,span')
          .map(e => (e.textContent || '').trim())
          .filter(t => t && t.length >= 2 && t.length <= 8 && /[一-龥]/.test(t) && /存|草稿|发布|保存|离开|确定|完成/.test(t));
        const uniq = [...new Set(btns)].slice(0, 12);
        say('⚠ 90秒内仍未出现「暂存离开」，请手动点一下。检测到：' + (uniq.join(' / ') || '无'));
        console.log('[朱砂助手] 候选按钮文字：', uniq);
      }
      setTimeout(() => status.remove(), 18000);
    } catch (e) {
      say('出错：' + (e.message || e) + '（可手动完成）');
      setTimeout(() => status.remove(), 12000);
    }
  }

  chrome.runtime.sendMessage({ type: 'getPayload' }, (resp) => {
    if (resp && resp.payload) run(resp.payload);
  });
})();
