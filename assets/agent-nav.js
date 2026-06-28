/* 获客 Agent 模块导航（4 模块横向标签条）。放在 main.ag-page 顶部，自动高亮当前页。
   注意：站点已有全局左侧栏(#agSide)，这里用横向标签条避免再造一条左栏导致重叠。 */
(function(){
  var NAV=[
    { id:'账号矩阵',  href:'/账号矩阵.html',  icon:'🗂', label:'账号矩阵' },
    { id:'获客计划',  href:'/获客计划.html',  icon:'🎯', label:'获客计划' },
    { id:'话术库',    href:'/话术库.html',    icon:'💬', label:'话术库'   },
    { id:'评论收集',  href:'/评论收集.html',  icon:'👥', label:'评论收集' }
  ];
  var path=decodeURIComponent(location.pathname);
  function cur(n){ return path===n.href || path.endsWith(n.href); }
  var css=''
    + '#agModNav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;padding:6px;border:1px solid var(--line,#e7e0d4);'
    + 'border-radius:14px;background:var(--paper-2,#faf7f1)}'
    + '#agModNav a{display:inline-flex;align-items:center;gap:7px;padding:8px 15px;border-radius:10px;text-decoration:none;'
    + 'color:var(--ink,#2a2520);font-size:13.5px;font-weight:700;transition:.15s;white-space:nowrap}'
    + '#agModNav a:hover{background:rgba(0,0,0,.045)}'
    + '#agModNav a.on{background:var(--cinnabar,#ff2442);color:#fff;box-shadow:0 4px 14px rgba(255,36,66,.28)}'
    + '#agModNav a .agmn-ic{font-size:15px;line-height:1}';
  function mount(){
    if(document.getElementById('agModNav')) return;
    var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
    var nav=document.createElement('nav'); nav.id='agModNav';
    nav.innerHTML=NAV.map(function(n){ return '<a class="'+(cur(n)?'on':'')+'" href="'+n.href+'">'
      + '<span class="agmn-ic">'+n.icon+'</span>'+n.label+'</a>'; }).join('');
    var host=document.querySelector('main.ag-page')||document.querySelector('main')||document.body;
    host.insertBefore(nav, host.firstChild);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
