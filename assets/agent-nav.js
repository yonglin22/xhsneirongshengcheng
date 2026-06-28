/* 获客 Agent 统一左侧导航（4 模块）。在各页 <body> 末尾引入即可，自动高亮当前页。 */
(function(){
  var NAV=[
    { id:'账号矩阵',  href:'/账号矩阵.html',  icon:'🗂', label:'账号矩阵', sub:'多号管理/登录态' },
    { id:'获客计划',  href:'/获客计划.html',  icon:'🎯', label:'获客计划', sub:'养号/截流任务' },
    { id:'话术库',    href:'/话术库.html',    icon:'💬', label:'话术库',   sub:'评论/回复/私信' },
    { id:'评论收集',  href:'/评论收集.html',  icon:'👥', label:'评论收集', sub:'潜客线索' }
  ];
  var path=decodeURIComponent(location.pathname);
  function cur(n){ return path===n.href || path.endsWith(n.href); }
  var css=''
    + '#agNav{position:fixed;top:0;left:0;bottom:0;width:202px;z-index:60;background:var(--paper-2,#faf7f1);'
    + 'border-right:1px solid var(--line,#e7e0d4);padding:20px 14px;display:flex;flex-direction:column;gap:4px;overflow:auto}'
    + '#agNav .an-brand{font-weight:800;font-size:15px;letter-spacing:.04em;margin:2px 6px 14px;display:flex;align-items:center;gap:8px}'
    + '#agNav .an-brand i{color:var(--cinnabar,#ff2442);font-style:normal}'
    + '#agNav a.an-item{display:flex;gap:10px;align-items:center;padding:9px 11px;border-radius:10px;text-decoration:none;color:var(--ink,#2a2520);transition:.15s}'
    + '#agNav a.an-item:hover{background:rgba(0,0,0,.04)}'
    + '#agNav a.an-item.on{background:var(--cinnabar,#ff2442);color:#fff;box-shadow:0 4px 14px rgba(255,36,66,.28)}'
    + '#agNav a.an-item.on .an-sub{color:rgba(255,255,255,.8)}'
    + '#agNav .an-ic{font-size:17px;line-height:1}'
    + '#agNav .an-tx{font-size:13.5px;font-weight:700;line-height:1.15}'
    + '#agNav .an-sub{font-size:10.5px;color:var(--ink-soft,#8a8178);font-weight:400;margin-top:2px}'
    + '#agNav .an-back{margin-top:auto;font-size:12px;color:var(--ink-soft,#8a8178);text-decoration:none;padding:9px 11px;border-radius:10px}'
    + '#agNav .an-back:hover{background:rgba(0,0,0,.04)}'
    + 'body.has-agnav>.ag-page,body.has-agnav>main.ag-page{margin-left:202px}'
    + '@media(max-width:980px){#agNav{position:static;width:auto;flex-direction:row;flex-wrap:wrap;bottom:auto;'
    + 'border-right:none;border-bottom:1px solid var(--line,#e7e0d4);padding:10px}'
    + '#agNav .an-brand{display:none}#agNav .an-sub{display:none}#agNav .an-back{margin:0}'
    + '#agNav a.an-item{padding:7px 11px}'
    + 'body.has-agnav>.ag-page,body.has-agnav>main.ag-page{margin-left:0}}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  var nav=document.createElement('nav'); nav.id='agNav';
  nav.innerHTML='<div class="an-brand"><i>朱砂</i>获客 Agent</div>'
    + NAV.map(function(n){ return '<a class="an-item'+(cur(n)?' on':'')+'" href="'+n.href+'">'
        + '<span class="an-ic">'+n.icon+'</span><span><span class="an-tx">'+n.label+'</span>'
        + '<span class="an-sub">'+n.sub+'</span></span></a>'; }).join('')
    + '<a class="an-back" href="/">← 返回工作台</a>';
  function mount(){ document.body.classList.add('has-agnav'); document.body.insertBefore(nav, document.body.firstChild); }
  if(document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
