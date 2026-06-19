// 养号（保守拟真）：在 www.xiaohongshu.com 慢刷信息流 + 随机停留 + 偶尔进笔记看一会再返回
// 只有 popup 点「开始今日养号」后才运行；有每日上限；出验证/异常立即停。
(function () {
  if (!/^https?:\/\/www\.xiaohongshu\.com/.test(location.href)) return;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const log = (...a) => console.log('[朱砂养号]', ...a);
  let stopFlag = false;

  chrome.storage.local.get(['nurtureRun', 'nurtureCfg'], async (st) => {
    if (!st.nurtureRun) return;
    chrome.storage.local.set({ nurtureRun: false }); // 取走即清，避免每次进站都跑
    const cfg = Object.assign({ notes: 6, minutes: 8 }, st.nurtureCfg || {});
    await run(cfg);
  });

  function overlay() {
    const o = document.createElement('div');
    o.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:999999;background:#16181d;color:#fff;padding:12px 16px;border-radius:12px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:300px;line-height:1.6;font-family:-apple-system,sans-serif';
    o.innerHTML = '<b>🌱 朱砂养号中…</b><div id="nz-msg" style="margin-top:4px;color:#ddd"></div><button id="nz-stop" style="margin-top:8px;background:#ff2442;color:#fff;border:none;border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer">停止</button>';
    document.body.appendChild(o);
    o.querySelector('#nz-stop').onclick = () => { stopFlag = true; o.querySelector('#nz-msg').textContent = '正在停止…'; };
    return { say: t => { const m = o.querySelector('#nz-msg'); if (m) m.textContent = t; }, done: () => setTimeout(() => o.remove(), 6000) };
  }
  function riskHit() { const t = document.body.innerText || ''; return /环境异常|安全验证|滑动验证|拼图验证|登录后查看/.test(t) && t.length < 2000; }

  async function run(cfg) {
    const ui = overlay();
    const deadline = Date.now() + cfg.minutes * 60000;
    let opened = 0;
    try {
      if (!/\/explore/.test(location.href)) { location.href = 'https://www.xiaohongshu.com/explore'; return; }
      await sleep(rnd(2000, 3500));
      while (!stopFlag && Date.now() < deadline && opened < cfg.notes) {
        if (riskHit()) { ui.say('⚠ 触发验证，已停止养号'); break; }
        // 慢刷
        const steps = Math.round(rnd(2, 4));
        for (let s = 0; s < steps && !stopFlag; s++) { window.scrollBy({ top: rnd(300, 700), behavior: 'smooth' }); await sleep(rnd(1500, 3500)); }
        // 找一篇笔记进去看
        const links = [...document.querySelectorAll('a[href*="/explore/"],a[href*="/discovery/item/"]')].filter(a => a.offsetParent);
        const link = links[Math.floor(rnd(0, Math.min(links.length, 8)))];
        if (link) {
          opened++;
          ui.say(`已浏览 ${opened}/${cfg.notes} 篇 · 阅读中…`);
          link.click();
          await sleep(rnd(6000, 14000)); // 停留阅读
          for (let s = 0; s < 2 && !stopFlag; s++) { window.scrollBy({ top: rnd(200, 500), behavior: 'smooth' }); await sleep(rnd(1500, 3000)); }
          if (riskHit()) { ui.say('⚠ 触发验证，已停止'); break; }
          history.back(); // 返回信息流
          await sleep(rnd(2500, 4500));
        } else {
          ui.say('刷信息流中…');
          await sleep(rnd(2000, 4000));
        }
      }
      ui.say(stopFlag ? '已手动停止' : `✓ 今日养号完成：浏览 ${opened} 篇，活跃约 ${Math.round((Date.now() - (deadline - cfg.minutes * 60000)) / 60000)} 分钟`);
    } catch (e) { ui.say('养号出错：' + (e.message || e)); }
    ui.done();
  }
})();
