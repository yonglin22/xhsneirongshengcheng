/* 珠宝「招商 / 招代理」参考笔记知识库
   - 内置真实招商爆款笔记 URL（彩宝/水晶/翡翠）
   - 在用户本机（已登录小红书 + 装了插件）用 window.xhsExt.fetchNote 抓正文，缓存进 localStorage
   - 选题建议 / 正文生成 / 海报出图 优先用抓到的真实内容；抓不到则回退标题提炼的基础套路
   两个页面（选题.html / 流水线.html）都引用本文件，缓存 localStorage 跨页面共享。 */
(function () {
  const CACHE_KEY = 'jw_zhaoshang_kb_v1';
  const u = (id, tk) => `https://www.xiaohongshu.com/discovery/item/${id}?xsec_token=${tk}&xsec_source=pc_share`;
  // 用户提供的真实招商爆款笔记（去重后）
  const NOTES = [
    { cat: '彩宝', title: '专注老客·明码标价·真诚无套路不杀熟', url: u('68142d770000000023017c56', 'ABeyTD9slJphuHgWrQyXvwHGZCMUeIqV0-aAQCWIaNlxw=') },
    { cat: '彩宝', title: '不杀熟不宰客·专注老客·明码标价', url: u('66e0448a0000000027000e9b', 'ABwcSKL1YlNF6mLOX_wWxKQJQRaVeX-_g__tzwNRcwR0E=') },
    { cat: '彩宝', title: '明码标价·提供鉴赏期·拒绝强买强卖', url: u('67500b780000000006016808', 'AB7fGzFGA9XfCdrjip63HU7qPaQQ1dwPMYvAJ0bRAj0D4=') },
    { cat: '彩宝', title: '后悔发现太晚·老客疯狂复购的彩宝朋友圈', url: u('689aeb9c000000001c0102f6', 'ABk6e756SWIG5kUPFCd6SwaoNSUXbPSF18Oe51UEmRgWU=') },
    { cat: '彩宝', title: '诚招代理·源头严选珠宝供应链', url: u('67b65e610000000029036c77', 'ABlAV8SBjhTBKN2fusiU_t96SJP2zJsLV9k-5jbzAc1A0=') },
    { cat: '水晶', title: 'Mood水晶共创计划·想搞钱的姐妹看过来', url: u('6a182a8900000000360191e9', 'ABVGOaI-Vyjpf3xXBpZRaTINoSu2uouK_qdgklvkGgEU4=') },
    { cat: '水晶', title: '00后勇闯水晶行业·告诉你还能不能做', url: u('69fb53980000000020038c9a', 'ABUTyuDVqtRyq9LEynzkJQk5jC6l3-6hP4HqgtlB91KAY=') },
    { cat: '水晶', title: '水晶代理招募·一件代发轻松挣', url: u('69427a8a000000001e00ead8', 'ABfABPMYSV0bUE56lUaWQJzLK-ng-a8GfQjK49cIdS3Uw=') },
    { cat: '水晶', title: '做宠物品牌·不一定要自己囤货（供应链代发）', url: u('6a5a276a000000000a03bf1a', 'ABrN-c3LwPtIS462CjYCrcV_OnqKbizXJLD7N63wxF850=') },
    { cat: '翡翠', title: '第一次做平价玉镯代理真的嘎嘎香', url: u('69e7378e0000000022027c45', 'ABqorifrRsjcni-frGCcNWP00_qwqvPVV0dRMvQ-6WadM=') },
    { cat: '翡翠', title: '第一次做平价玉镯代理真的嘎嘎香(2)', url: u('69f603b7000000001b02067a', 'ABKEGTlQOM8fr7fbvdLtpvlBEk3RVHoDjFdwsqR9ORHeM=') },
    { cat: '翡翠', title: '翡翠人必进·从毛料到成品全链路交流', url: u('698330e8000000002200b789', 'ABRdKm33mgN666eXpH3VBIcx22tEFCcMsXpN2L0HMqOC0=') },
  ];

  // 抓不到真实正文时的兜底（标题提炼的招商套路）
  const BASE = '【招商/招代理题材·结合本账号源头供应链知识库 + 真实招商爆款套路】\n① 信任建场：明码标价·不杀熟不宰客·专注老客·提供鉴赏期·拒绝强买强卖·老客疯狂复购反馈。\n② 招募钩子：源头一手货源/严选供应链、一件代发0囤货、低门槛轻资产、共创计划/合伙人。\n③ 行业前景：赛道机会与亲身入行体验（00后勇闯水晶行业、第一次做平价玉镯代理嘎嘎香、翡翠毛料到成品全链路）。\n④ 人群场景：宝妈副业、上班族搞钱、学生党轻创业、做品牌不用囤货（供应链代发）。\n⑤ 彩宝重明码标价老客复购、水晶重共创计划一件代发、翡翠重平价玉镯代理·毛料成品全链路。\n〔招商合规铁律〕只讲供应链优势/合作模式/真实体验；绝不承诺具体收入或"稳赚/月入过万/躺赚"，不用拉人头·发展下线·交入门费·多级返利等传销话术，如实提示"收益因人而异"。';

  // 读缓存：返回真实抓取的 KB 文本；没有则 null
  function cached() {
    try { const o = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return (o && o.kb) ? o : null; } catch { return null; }
  }
  // 供 prompt 用：优先真实抓取内容，其次基础套路
  function kb() { const c = cached(); return c ? c.kb : BASE; }
  function meta() { const c = cached(); return c ? { at: c.at, count: c.count } : null; }

  // 找到有插件桥接的窗口：选题页是 iframe 内嵌，插件只注入外层主页面，故需回退到 parent/top（同源可直接用）
  function ext() {
    if (window.xhsExt && window.xhsExt.available) return window.xhsExt;
    try { if (window.parent && window.parent !== window && window.parent.xhsExt && window.parent.xhsExt.available) return window.parent.xhsExt; } catch {}
    try { if (window.top && window.top !== window && window.top.xhsExt && window.top.xhsExt.available) return window.top.xhsExt; } catch {}
    return null;
  }
  // 用本机插件登录态抓取全部招商笔记正文，拼成知识库并缓存。onProgress(i,total,note) 汇报进度
  async function fetchAll(onProgress) {
    const X = ext();
    if (!X) throw new Error('没检测到浏览器插件（请在装了插件、已登录小红书的浏览器里操作）');
    const got = [];
    for (let i = 0; i < NOTES.length; i++) {
      const n = NOTES[i];
      if (onProgress) onProgress(i, NOTES.length, n);
      let r = null; try { r = await X.fetchNote(n.url); } catch { r = null; }
      if (r && r.needLogin) throw new Error('请先在浏览器登录小红书后重试');
      if (r && r.ok) {
        const tags = (r.tags || []).map(t => t.startsWith('#') ? t : '#' + t).join(' ');
        const body = [r.title, r.content, tags].filter(Boolean).join('\n').replace(/\s+\n/g, '\n').trim();
        if (body) got.push(`〖${n.cat}｜${(r.title || n.title).slice(0, 30)}〗\n${body.slice(0, 700)}`);
      }
      await new Promise(rs => setTimeout(rs, 2500 + Math.random() * 800)); // 温和间隔，防「请求太频繁」
    }
    if (!got.length) throw new Error('一篇都没抓到（链接可能失效或被风控），稍后再试');
    const kbText = '【招商/招代理题材·必须结合本账号源头供应链知识库 + 以下真实招商爆款笔记内容来写选题/正文/海报】\n\n'
      + got.join('\n\n')
      + '\n\n〔招商合规铁律〕只讲供应链优势/合作模式/真实体验；绝不承诺具体收入或"稳赚/月入过万/躺赚"，不用拉人头·发展下线·交入门费·多级返利等传销话术，如实提示"收益因人而异"。';
    const rec = { kb: kbText, at: Date.now(), count: got.length };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(rec)); } catch {}
    return rec;
  }

  window.ZhaoshangKB = { NOTES, BASE, kb, meta, cached, fetchAll, CACHE_KEY };
})();
