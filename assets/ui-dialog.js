/* 统一弹框/提示，替换原生 alert/confirm。window.zAlert / zConfirm（返回 Promise）/ zToast。 */
(function(){
  if(window.zAlert) return;
  var css=''
    + '.zdlg-mask{position:fixed;inset:0;z-index:100020;background:rgba(20,16,14,.45);display:flex;align-items:center;justify-content:center;padding:20px;animation:zdlgFade .12s ease}'
    + '@keyframes zdlgFade{from{opacity:0}to{opacity:1}}'
    + '.zdlg{background:var(--paper,#fff);border:1px solid var(--line,#e7e0d4);border-radius:16px;max-width:420px;width:100%;padding:22px 22px 18px;box-shadow:0 24px 60px -16px rgba(0,0,0,.4)}'
    + '.zdlg-t{font-size:15px;font-weight:800;margin-bottom:8px;color:var(--ink,#2a2520)}'
    + '.zdlg-b{font-size:13.5px;line-height:1.6;color:var(--ink,#2a2520);white-space:pre-wrap}'
    + '.zdlg-f{margin-top:18px;display:flex;gap:9px;justify-content:flex-end}'
    + '.zdlg-btn{border:1px solid var(--line,#e7e0d4);background:#fff;color:var(--ink,#2a2520);border-radius:9px;padding:7px 16px;font-size:13px;cursor:pointer;font-weight:600}'
    + '.zdlg-btn:hover{background:rgba(0,0,0,.04)}'
    + '.zdlg-btn.go{background:var(--cinnabar,#ff2442);border-color:var(--cinnabar,#ff2442);color:#fff}'
    + '.zdlg-btn.go:hover{filter:brightness(1.05)}'
    + '.ztoast-wrap{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:100030;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}'
    + '.ztoast{background:rgba(22,24,29,.94);color:#fff;font-size:13px;padding:10px 18px;border-radius:10px;box-shadow:0 10px 30px -8px rgba(0,0,0,.45);max-width:80vw;animation:zdlgFade .14s ease}'
    + '.ztoast.ok{background:#0a7d43}.ztoast.err{background:#c0341f}';
  var st=document.createElement('style'); st.textContent=css; (document.head||document.documentElement).appendChild(st);

  function build(opts){
    return new Promise(function(resolve){
      var mask=document.createElement('div'); mask.className='zdlg-mask';
      var foot = opts.confirm
        ? '<button class="zdlg-btn" data-r="0">'+(opts.cancelText||'取消')+'</button><button class="zdlg-btn go" data-r="1">'+(opts.okText||'确定')+'</button>'
        : '<button class="zdlg-btn go" data-r="1">'+(opts.okText||'确定')+'</button>';
      mask.innerHTML='<div class="zdlg" role="dialog">'
        + (opts.title?'<div class="zdlg-t">'+esc(opts.title)+'</div>':'')
        + '<div class="zdlg-b">'+esc(opts.message||'')+'</div>'
        + '<div class="zdlg-f">'+foot+'</div></div>';
      document.body.appendChild(mask);
      var done=function(v){ if(mask.parentNode) mask.parentNode.removeChild(mask); document.removeEventListener('keydown',onKey); resolve(v); };
      function onKey(e){ if(e.key==='Escape') done(opts.confirm?false:true); else if(e.key==='Enter') done(true); }
      mask.addEventListener('click',function(e){ if(e.target===mask) done(opts.confirm?false:true); var r=e.target.getAttribute&&e.target.getAttribute('data-r'); if(r!=null) done(r==='1'); });
      document.addEventListener('keydown',onKey);
      var go=mask.querySelector('.zdlg-btn.go'); if(go) go.focus();
    });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }

  window.zAlert=function(message,opt){ opt=opt||{}; return build({message:message,title:opt.title,okText:opt.okText,confirm:false}); };
  window.zConfirm=function(message,opt){ opt=opt||{}; return build({message:message,title:opt.title||'确认操作',okText:opt.okText||'确定',cancelText:opt.cancelText,confirm:true}); };
  window.zToast=function(message,type){
    var wrap=document.querySelector('.ztoast-wrap'); if(!wrap){ wrap=document.createElement('div'); wrap.className='ztoast-wrap'; document.body.appendChild(wrap); }
    var t=document.createElement('div'); t.className='ztoast'+(type?(' '+type):''); t.textContent=message; wrap.appendChild(t);
    setTimeout(function(){ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },300); }, type==='err'?3200:2200);
  };
})();
