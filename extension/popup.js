// 安卓/移动端：提示开启「桌面版网站」，否则小红书创作中心是移动版页面、选择器对不上
try { if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { const mb = document.getElementById('mobileBar'); if (mb) mb.style.display = 'block'; } } catch (e) {}

// 获客计划：从 yonglin.chat 拉取已保存的养号/截流计划，直接在插件里执行（带完整配置，等同网页端「▶ 执行」）
document.getElementById('planNew').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://yonglin.chat/获客计划.html', active: true });
  window.close();
});
// 本机作为执行设备开关（控制 background 是否轮询领取「下发」任务）
(function () {
  const sw = document.getElementById('devSw'), knob = document.getElementById('devKnob'), meta = document.getElementById('devMeta');
  function paint(on, id) {
    sw.style.background = on ? '#00a152' : '#ccc';
    knob.style.left = on ? '20px' : '2px';
    meta.textContent = on ? ('本机已待命领取下发任务 · 设备号 ' + (id || '生成中…')) : '已关闭，本机不会自动领取下发任务。';
  }
  chrome.storage.local.get(['zsDispatchEnabled', 'zsDeviceId'], st => {
    let id = st.zsDeviceId;
    if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 8); chrome.storage.local.set({ zsDeviceId: id }); }
    paint(st.zsDispatchEnabled !== false, id);
    sw.addEventListener('click', () => {
      chrome.storage.local.get(['zsDispatchEnabled', 'zsDeviceId'], s2 => {
        const next = !(s2.zsDispatchEnabled !== false);
        chrome.storage.local.set({ zsDispatchEnabled: next }, () => paint(next, s2.zsDeviceId || id));
      });
    });
  });
})();
// 前台观看模式开关：养号标签前台打开，实时可见
(function () {
  const sw = document.getElementById('watchSw'), knob = document.getElementById('watchKnob');
  if (!sw) return;
  function paint(on) { sw.style.background = on ? '#00a152' : '#ccc'; knob.style.left = on ? '20px' : '2px'; }
  chrome.storage.local.get(['zsWatchMode'], st => {
    paint(!!(st && st.zsWatchMode));
    sw.addEventListener('click', () => {
      chrome.storage.local.get(['zsWatchMode'], s2 => {
        const next = !(s2 && s2.zsWatchMode);
        chrome.storage.local.set({ zsWatchMode: next }, () => paint(next));
      });
    });
  });
})();
const TYPE_NAME = { home_nurture: '首页养号', home_intercept: '首页截流', search_nurture: '搜索养号', search_intercept: '搜索截流' };
function escH2(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function fetchPlans() {
  const box = document.getElementById('planList');
  box.innerHTML = '<div style="font-size:11px;color:#aaa">加载中…</div>';
  try {
    const r = await fetch('https://yonglin.chat/api/growth-plans', { credentials: 'include' });
    const j = await r.json();
    if (!j || !j.ok) { box.innerHTML = '<div style="font-size:11px;color:#e0883a">需先在 Chrome 里登录 yonglin.chat</div>'; return; }
    const list = (j.list || []).filter(p => /_(nurture|intercept)$/.test(p.ptype || ''));
    if (!list.length) { box.innerHTML = '<div style="font-size:11px;color:#aaa">暂无养号/截流计划，去网页端「获客计划」新建一个</div>'; return; }
    box.innerHTML = list.map((p, i) => `
      <div style="border:1px solid #eee;border-radius:8px;padding:8px;margin-bottom:6px;font-size:11.5px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>${escH2(p.name)}</b>
          <span style="font-size:10px;color:#fff;background:#ff2442;border-radius:5px;padding:1px 6px">${TYPE_NAME[p.ptype] || p.ptype}</span>
        </div>
        <div style="color:#888;margin:3px 0">${escH2((p.config && p.config.keywords || []).slice(0, 3).join('、'))}</div>
        <button data-run="${i}" style="width:100%;background:var(--cinnabar,#ff2442);background:#ff2442;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer">▶ 执行</button>
      </div>`).join('');
    box.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', () => runPlanFromPopup(list[+b.dataset.run], b)));
  } catch (e) { box.innerHTML = '<div style="font-size:11px;color:#e0883a">加载失败：' + (e.message || e) + '</div>'; }
}
async function runPlanFromPopup(p, btn) {
  const isIntercept = /_intercept$/.test(p.ptype || '');
  const mins = Math.max(5, Math.min(40, Math.round((((p.config || {}).nurture || {}).daily || 8) * 1.5)));
  const ic = (p.config || {}).intercept || {};
  const warn = isIntercept
    ? `将在你已登录的小红书网页里浏览笔记并按概率点赞收藏，AI 自动生成评论回复（上限 ${ic.reply || 0} 条/天），私信只生成草稿存入插件、绝不自动发送（上限 ${ic.dm || 0} 条/天，需你手动确认）。出现验证码会自动停止。`
    : '将在你已登录的小红书网页里按计划自动浏览/停留，并按概率点赞收藏/关注/评论。出现验证码会自动停止。';
  if (!confirm(`▶ 执行「${p.name}」\n\n${warn}\n\n确定开始？`)) return;
  btn.disabled = true; btn.textContent = '启动中…';
  const st = await chrome.storage.local.get(['zsPersona']);
  const payload = { ptype: p.ptype, config: { ...(p.config || {}), persona: st.zsPersona || '' }, _minutes: mins, _planId: p.id };
  chrome.runtime.sendMessage({ type: 'nurturePlan', plan: payload }, (resp) => {
    btn.textContent = (resp && resp.ok) ? '✓ 已下发，看新标签进度' : '启动失败';
    setTimeout(() => window.close(), 1000);
  });
}
document.getElementById('planRefresh').addEventListener('click', fetchPlans);
fetchPlans();

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

// 顶部「有新版」横幅：读 background 存的 zsUpdate；点下载打开下载链接
(function () {
  function showUpd(u) {
    const bar = document.getElementById('updBar'); if (!bar || !u || !u.latest) return;
    bar.style.display = 'block';
    const v = document.getElementById('updVer'); if (v) v.textContent = (u.current ? 'v' + u.current + ' → ' : '') + 'v' + u.latest;
    const dl = document.getElementById('updDl');
    if (dl) dl.onclick = () => { chrome.tabs.create({ url: u.download || 'https://yonglin.chat/api/ext-download', active: true }); window.close(); };
  }
  try { chrome.storage.local.get(['zsUpdate'], (st) => { if (st && st.zsUpdate) showUpd(st.zsUpdate); }); } catch {}
  // 打开弹窗时也顺手催一次后台检查
  try { chrome.runtime.sendMessage({ type: 'zsCheckUpdate' }, () => void chrome.runtime.lastError); } catch {}
})();
