document.getElementById('nzBtn').addEventListener('click', () => {
  const notes = Math.max(2, Math.min(15, parseInt(document.getElementById('nzNotes').value) || 6));
  const minutes = Math.max(3, Math.min(30, parseInt(document.getElementById('nzMin').value) || 8));
  const msg = document.getElementById('nzMsg');
  msg.textContent = '正在打开小红书…';
  chrome.runtime.sendMessage({ type: 'nurture', cfg: { notes, minutes } }, (resp) => {
    msg.textContent = (resp && resp.ok) ? '✓ 已开始，去新开的小红书标签看进度' : '启动失败';
    setTimeout(() => window.close(), 900);
  });
});

// 待发私信草稿：列出 + 复制话术 + 去对方主页（人工确认发送，插件不自动私信）
function escH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderDM() {
  chrome.storage.local.get(['zsPendingDM'], st => {
    const list = (st.zsPendingDM || []).slice().reverse();
    const box = document.getElementById('dmList');
    if (!list.length) { box.innerHTML = '<div style="font-size:11px;color:#aaa">暂无草稿</div>'; return; }
    box.innerHTML = list.map((it, i) => `
      <div style="border:1px solid #eee;border-radius:8px;padding:8px;margin-bottom:6px;font-size:11.5px">
        <div style="color:#888;margin-bottom:3px">致 ${escH(it.user || '该用户')}</div>
        <div style="margin-bottom:5px">${escH(it.draft)}</div>
        <div style="display:flex;gap:6px">
          <button data-copy="${i}" style="flex:1;background:#f5f5f5;border:1px solid #ddd;border-radius:6px;padding:4px;cursor:pointer">复制话术</button>
          ${it.link ? `<a href="${escH(it.link)}" target="_blank" style="flex:1;text-align:center;background:#fff0f1;border:1px solid #ffd2d8;border-radius:6px;padding:4px;color:#ff2442;text-decoration:none">去主页发</a>` : ''}
          <button data-del="${i}" style="background:#fff;border:1px solid #eee;border-radius:6px;padding:4px 8px;cursor:pointer;color:#999">×</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
      navigator.clipboard.writeText(list[+b.dataset.copy].draft || '');
      b.textContent = '已复制 ✓'; setTimeout(() => b.textContent = '复制话术', 1200);
    }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const idx = list.length - 1 - (+b.dataset.del); // 还原成正序下标（store 是正序，渲染时 reverse 了）
      chrome.storage.local.get(['zsPendingDM'], st2 => {
        const arr = (st2.zsPendingDM || []); arr.splice(idx, 1);
        chrome.storage.local.set({ zsPendingDM: arr }, renderDM);
      });
    }));
  });
}
renderDM();
