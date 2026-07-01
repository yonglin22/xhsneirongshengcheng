/* 页面首次进入引导：一次性弹出「这个页面做什么 + 关键步骤 + 注意事项」，可「不再提示」，
   并在左下角留一个「❔ 引导」小按钮随时重看。用法：pageIntro({key,emoji,title,intro,steps:[{t,d}],tips:[]}) */
(function () {
  if (window.pageIntro) return;
  var css = ''
    + '.pgi-mask{position:fixed;inset:0;z-index:100040;background:rgba(20,16,14,.5);display:flex;align-items:center;justify-content:center;padding:20px;animation:pgiFade .14s ease}'
    + '@keyframes pgiFade{from{opacity:0}to{opacity:1}}'
    + '.pgi{background:var(--paper,#fff);border:1px solid var(--line,#e7e0d4);border-radius:18px;max-width:460px;width:100%;box-shadow:0 30px 70px -20px rgba(0,0,0,.45);overflow:hidden;transform:translateY(8px);animation:pgiUp .2s cubic-bezier(.22,.7,.2,1) forwards}'
    + '@keyframes pgiUp{to{transform:translateY(0)}}'
    + '.pgi-hd{background:linear-gradient(135deg,var(--cinnabar,#a5813a),#d9bd7a);color:#fff;padding:16px 20px}'
    + '.pgi-hd .em{font-size:24px}.pgi-hd .t{font-size:17px;font-weight:800;margin-top:4px}'
    + '.pgi-hd .i{font-size:12.5px;opacity:.95;margin-top:5px;line-height:1.6}'
    + '.pgi-bd{padding:16px 20px;max-height:56vh;overflow-y:auto}'
    + '.pgi-step{display:flex;gap:11px;padding:8px 0}'
    + '.pgi-step .n{flex:none;width:24px;height:24px;border-radius:50%;background:var(--cinnabar,#a5813a);color:#fff;font-size:12.5px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px}'
    + '.pgi-step .st{font-size:13.5px;font-weight:700;color:var(--ink,#2a2520)}'
    + '.pgi-step .sd{font-size:12.5px;color:var(--ink-soft,#8b8378);margin-top:2px;line-height:1.55}'
    + '.pgi-tips{margin-top:12px;background:var(--paper-2,#faf7f1);border:1px solid var(--line,#eee);border-radius:12px;padding:11px 13px}'
    + '.pgi-tips .th{font-size:12px;font-weight:700;color:var(--cinnabar-deep,#d21f3c);margin-bottom:5px}'
    + '.pgi-tips li{font-size:12px;color:var(--ink-soft,#8b8378);line-height:1.7;list-style:none;padding-left:15px;position:relative}'
    + '.pgi-tips li:before{content:"·";position:absolute;left:4px;color:var(--cinnabar,#a5813a);font-weight:900}'
    + '.pgi-ft{display:flex;align-items:center;gap:10px;padding:13px 20px;border-top:1px solid var(--line,#eee)}'
    + '.pgi-btn{border:none;background:var(--cinnabar,#a5813a);color:#fff;border-radius:10px;padding:9px 20px;font-size:13.5px;font-weight:700;cursor:pointer}'
    + '.pgi-btn:hover{filter:brightness(1.05)}'
    + '.pgi-skip{background:none;border:none;color:var(--ink-soft,#8b8378);font-size:12.5px;cursor:pointer;margin-left:auto}'
    + '.pgi-reopen{position:fixed;left:calc(var(--side-w, 0px) + 16px);bottom:16px;z-index:120;background:var(--paper,#fff);border:1px solid var(--line,#e7e0d4);color:var(--ink-soft,#6b6357);border-radius:999px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px -8px rgba(0,0,0,.28)}'
    + '@media(max-width:880px){.pgi-reopen{left:12px}}'
    + '.pgi-reopen:hover{color:var(--cinnabar,#a5813a);border-color:var(--cinnabar,#a5813a)}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  window.pageIntro = function (cfg) {
    if (!cfg || !cfg.key) return;
    var KEY = 'zs_intro_' + cfg.key;
    function build() {
      var steps = (cfg.steps || []).map(function (s, i) {
        return '<div class="pgi-step"><div class="n">' + (i + 1) + '</div><div><div class="st">' + esc(s.t) + '</div>' + (s.d ? '<div class="sd">' + esc(s.d) + '</div>' : '') + '</div></div>';
      }).join('');
      var tips = (cfg.tips && cfg.tips.length) ? '<div class="pgi-tips"><div class="th">💡 小贴士</div><ul style="margin:0;padding:0">' + cfg.tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' : '';
      var mask = document.createElement('div'); mask.className = 'pgi-mask';
      mask.innerHTML = '<div class="pgi" role="dialog"><div class="pgi-hd"><div class="em">' + (cfg.emoji || '✨') + '</div><div class="t">' + esc(cfg.title || '页面说明') + '</div>' + (cfg.intro ? '<div class="i">' + esc(cfg.intro) + '</div>' : '') + '</div>'
        + '<div class="pgi-bd">' + steps + tips + '</div>'
        + '<div class="pgi-ft"><button class="pgi-btn">知道了，开始</button><button class="pgi-skip">不再提示</button></div></div>';
      document.body.appendChild(mask);
      function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
      mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
      mask.querySelector('.pgi-btn').addEventListener('click', function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} close(); });
      mask.querySelector('.pgi-skip').addEventListener('click', function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} close(); });
    }
    function reopenBtn() {
      if (document.querySelector('.pgi-reopen')) return;
      var b = document.createElement('button'); b.className = 'pgi-reopen'; b.textContent = '❔ 引导';
      b.title = '重看本页操作引导';
      b.addEventListener('click', build);
      document.body.appendChild(b);
    }
    function go() {
      reopenBtn();
      var seen = false; try { seen = localStorage.getItem(KEY) === '1'; } catch (e) {}
      if (!seen) setTimeout(build, 500); // 稍等页面渲染，避免与鉴权跳转/白屏冲突
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  };
})();
