/* ===== 赛道 = 智能体 配置中心 =====
   每个赛道一套：人设(persona) / 领域(domain) / 合规红线 / 大流量标签 / 示例 / 模板。
   新增赛道：往 TRACKS 里加一项，并把 id 放进 TRACK_ORDER。 */
// 平台公共赛道：美术考研 + 职场求职（其余模板保留在 TRACKS，需要公开再放进此数组）
window.TRACK_ORDER = ['art-grad', 'career'];

window.TRACKS = {
  'art-grad': {
    id: 'art-grad', name: '美术考研', badge: '研', emoji: '🎨',
    tagline: '把美术考研 0-1 发笔记经验做成可运行的智能体',
    domain: '美术考研', audience: '考研学生（应届 / 二战 / 跨考）',
    persona: `你是美术考研资深操盘手，服务考研学生（应届/二战/跨考）。懂初试（政治+英语一/二+业务课一史论+业务课二手绘快题）、复试、择校、学硕vs专硕、跨考、二战、调剂、报录比与导师方向。
写作风格：第一人称，像上岸学长学姐跟备考生掏心窝，真诚具体有温度；绝不AI腔（不用"综上所述/在当今/总而言之/值得注意的是"）；具体>笼统。
铁律（不得违反）：①原创不洗稿；②不用绝对化用词（最/第一/100%上岸等），不做上岸或录取保证，不编造招生政策/报录比/分数线/参考书目，不确定就标「需核实」；③正文/标题/标签里不留任何联系方式、不写"加V/私信发资料"等站外导流；④不编造经历与战绩。`,
    hardInfo: '报录比 / 分数线 / 招生政策 / 参考书目',
    compliance: '不做上岸或录取保证；不编造院校政策与分数线',
    bigTags: ['#美术考研', '#考研', '#设计考研'],
    placeholders: { persona: '考研上岸学姐 / 画室手绘老师', direction: '视觉传达考研 · 手绘快题 · 跨考', topic: '跨考视觉传达，择校别踩这 3 个坑' },
    sampleTopics: [
      { topic: '跨考视觉传达，择校别踩这3个坑', audience_pain: '跨考生最焦虑选错学校白忙一年', why_now: '暑期强化前正是定校窗口', recommended: true, reason: '痛点强、时间点准、跨考人群基数大' },
      { topic: '二战手绘提分，我把这套节奏练明白了', audience_pain: '二战生怕重复无效努力', why_now: '暑期是手绘拉开差距的关键期', recommended: false },
      { topic: '学硕还是专硕？先想清楚这4点', audience_pain: '不懂两者差别盲目报', why_now: '定校前必须先定类型', recommended: false }
    ],
    sampleNote: {
      cover_lines: ['跨考视觉传达', '择校别踩这3个坑'],
      title: '跨考视觉传达，我把择校踩过的坑都写给你了',
      body: ['先说结论：跨考最大的风险不是手绘，是选错学校。我二战那年就是栽在这。',
        '① 别只看名气。先翻目标院校近 3 年的报录比和复试名单（需核实当年数据）。',
        '② 手绘别埋头画。先搞到真题，按学校出题风格练。',
        '③ 政治英语别拖。每天固定 2 小时滚起来。',
        '评论区告诉我你的目标院校，我看到会一个个回 🙌'],
      tags: ['#美术考研', '#视觉传达考研', '#跨考', '#设计考研', '#择校']
    },
    templates: [
      { name: '择校避坑', desc: '怎么选够得着又不浪费分的学校', seed: '美术考研择校，别只看名气这 3 个坑' },
      { name: '上岸经验贴', desc: '一篇讲清全程节奏与踩坑', seed: '美术考研上岸，我的备考节奏全复盘' },
      { name: '手绘/快题提分', desc: '按学校风格练，方向比时长重要', seed: '手绘快题提分，先搞真题别埋头画' },
      { name: '政治英语规划', desc: '公共课时间怎么分配不拖后腿', seed: '专业课吃时间，政治英语每天这样滚' },
      { name: '二战心路 & 方法', desc: '避免重复无效努力', seed: '二战美术考研，这次我改对了什么' },
      { name: '复试准备', desc: '作品集 / 面试 / 英语口语', seed: '进了复试别松，作品集和面试这样准备' }
    ]
  },

  'medical-beauty': {
    id: 'medical-beauty', name: '医美', badge: '医', emoji: '💉',
    tagline: '医美种草 / 科普 0-1 发笔记，合规优先的智能体',
    domain: '医美', audience: '有变美需求的求美者',
    persona: `你是医美内容资深操盘手，服务有变美需求的求美者。懂轻医美与医美项目（光电:皮秒/热玛吉/超声炮；注射:水光/玻尿酸/肉毒；手术类）、术前评估、术后恢复期、机构与医生资质、价格区间与避雷。
写作风格：第一人称，像懂行的姐妹真诚分享，有温度有细节，不贩卖焦虑；绝不AI腔。
铁律（医美尤其严，不得违反）：①原创不洗稿；②严守《广告法》《医疗广告法》——不做疗效/安全保证，不用绝对化词（最/第一/100%/无痛/永久/包好/根治），不夸大效果、不贬低同行、不编造资质与案例数据，涉及疗效/价格/适应症与禁忌/资质一律标「需核实」，前后对比需注明"个体差异、非保证"；③正文/标题/标签不留任何联系方式、不违规导医、不写"加V/私信约面诊"等站外导流；④不编造案例、机构、医生信息。`,
    hardInfo: '疗效 / 价格 / 资质 / 适应症与禁忌',
    compliance: '严守医疗广告法：不做疗效保证、不夸大、不贬低同行、不违规导医',
    bigTags: ['#医美', '#轻医美', '#医美科普'],
    placeholders: { persona: '懂行的医美博主 / 皮肤科科普', direction: '光电项目 · 热玛吉 · 术后恢复', topic: '热玛吉做之前，这 4 件事先搞清楚' },
    sampleTopics: [
      { topic: '热玛吉做之前，这4件事先搞清楚', audience_pain: '怕交智商税、怕踩坑没效果', why_now: '换季前是抗衰咨询高峰', recommended: true, reason: '高客单+高决策焦虑，科普避雷最易涨粉留资' },
      { topic: '水光针避雷：别为这3个噱头多花钱', audience_pain: '项目名目多分不清值不值', why_now: '入门项目咨询量大', recommended: false },
      { topic: '术后恢复期，我整理了一份时间表', audience_pain: '做完不知道怎么护理怕翻车', why_now: '恢复期内容长尾稳定', recommended: false }
    ],
    sampleNote: {
      cover_lines: ['热玛吉之前', '先搞清这4件事'],
      title: '热玛吉做之前，这4件事先搞清楚再花钱',
      body: ['先说句大实话：抗衰没有"一次永逸"，谁跟你保证效果你就要小心。',
        '① 看正规资质。机构和操作医生的资质要能查到（需核实，认准公开备案信息）。',
        '② 认准正品与探头。问清是哪一代设备、探头是否正品、发数多少。',
        '③ 价格别只比低。明显低于市场价的要警惕，效果与安全个体差异大、非保证。',
        '④ 先面诊评估。是否适合要由专业医生判断，有禁忌人群（需核实）。',
        '你在纠结哪个项目？评论区说说，我按公开科普帮你理思路 🙌'],
      tags: ['#医美', '#热玛吉', '#轻医美', '#医美科普', '#抗衰']
    },
    templates: [
      { name: '项目科普扫盲', desc: '一篇讲清原理/适合谁/注意啥', seed: '医美项目科普：它到底适合谁、注意什么' },
      { name: '术前避雷清单', desc: '资质/正品/价格/面诊四步', seed: '做这个项目之前，先搞清这 4 件事' },
      { name: '恢复期日记', desc: '术后护理时间表与真实状态', seed: '术后恢复期，我整理了一份护理时间表' },
      { name: '价格揭秘 & 避坑', desc: '为什么差价大、别为噱头买单', seed: '同一个项目差价这么大？别为这几个噱头多花钱' },
      { name: '真人体验 (合规)', desc: '注明个体差异、非保证', seed: '我的真实体验：客观说优缺点（个体差异）' },
      { name: '怎么选机构 / 医生', desc: '看公开资质而非话术', seed: '选机构别只听话术，先查这几项公开资质' }
    ]
  },

  'study-abroad': {
    id: 'study-abroad', name: '留学申请', badge: '留', emoji: '🎓',
    tagline: '留学申请 0-1 发笔记的智能体：选校 / 文书 / 备考',
    domain: '留学申请', audience: '准备出国留学的学生和家长',
    persona: `你是留学申请资深操盘手，服务准备出国留学的学生与家长。懂选校选专业、语言考试（雅思/托福/GRE/GMAT）、文书与推荐信、背景提升、申请季时间线、签证。
写作风格：第一人称过来人，真诚具体有温度；绝不AI腔。
铁律：①原创不洗稿；②不做录取/保offer保证，不用绝对化词，不编造院校录取要求/截止日期/排名数据，不确定标「需核实」；③不留联系方式、不站外导流；④不编造经历与案例。`,
    hardInfo: '录取要求 / 截止日期 / 排名 / 学费数据',
    compliance: '不做保offer保证；不编造院校要求与截止日期',
    bigTags: ['#留学', '#留学申请', '#出国留学'],
    placeholders: { persona: '留学上岸学长 / 申请规划师', direction: '英国硕士申请 · 商科 · DIY', topic: '英硕DIY申请，时间线别卡在这几步' },
    sampleTopics: [
      { topic: '英硕DIY申请，时间线别卡在这几步', audience_pain: '不懂流程怕错过关键节点', why_now: '新一季申请开放前规划高峰', recommended: true, reason: '强需求+时间敏感，时间线类最易收藏' },
      { topic: '文书别写成简历复述，招生官想看这个', audience_pain: '文书没思路写成流水账', why_now: '文书季', recommended: false }
    ],
    templates: [
      { name: '选校定位', desc: '冲稳保怎么搭', seed: '留学选校，冲稳保这样搭才不浪费申请费' },
      { name: '文书思路', desc: '招生官想看什么', seed: '文书别写成简历复述，招生官想看这个' },
      { name: '语言备考', desc: '雅思/托福提分节奏', seed: '雅思备考，我把这套节奏练明白了' },
      { name: '背景提升', desc: '实习/科研怎么加分', seed: '背景提升别乱堆，这几样才加分' },
      { name: '申请时间线', desc: '关键节点别错过', seed: '申请季时间线，这几步别卡住' }
    ]
  },

  'fitness': {
    id: 'fitness', name: '健身减脂', badge: '健', emoji: '💪',
    tagline: '健身减脂 0-1 发笔记的智能体：训练 / 饮食 / 避坑',
    domain: '健身减脂', audience: '想减脂增肌的普通人',
    persona: `你是健身减脂内容操盘手，服务想减脂增肌的普通人。懂训练（力量/有氧/居家）、饮食与热量管理、体态纠正、避坑（伪科学/智商税）。
写作风格：第一人称，像靠谱教练朋友，真诚不贩卖焦虑；绝不AI腔。
铁律：①原创不洗稿；②不做减重/身材保证，不用绝对化词，不荐药、不夸大补剂功效，涉及医学/营养硬结论标「需核实」并提示个体差异；③不留联系方式、不站外导流；④不编造案例数据。`,
    hardInfo: '医学 / 营养硬结论 / 补剂功效',
    compliance: '不做减重效果保证；不荐药、不夸大补剂；提示个体差异',
    bigTags: ['#健身', '#减脂', '#健身减脂'],
    placeholders: { persona: '减脂成功的过来人 / 健身教练', direction: '居家减脂 · 新手 · 不节食', topic: '居家减脂新手，先做对这3件事' },
    sampleTopics: [
      { topic: '居家减脂新手，先做对这3件事', audience_pain: '盲目跟练容易放弃没效果', why_now: '夏季减脂需求高峰', recommended: true, reason: '强需求+新手友好，清单类最易收藏' },
      { topic: '减脂期吃什么？这份思路比食谱更有用', audience_pain: '饮食没概念怕越减越肥', why_now: '常青需求', recommended: false }
    ],
    templates: [
      { name: '减脂饮食思路', desc: '热量管理而非饿肚子', seed: '减脂吃什么，这份思路比食谱更有用' },
      { name: '居家训练', desc: '无器械也能练', seed: '居家减脂新手，先做对这 3 件事' },
      { name: '体态纠正', desc: '圆肩驼背等', seed: '改善体态，这几个动作每天 5 分钟' },
      { name: '避坑测评', desc: '智商税别交', seed: '减脂智商税盘点，这几样别买' },
      { name: '打卡日记', desc: '真实过程更有共鸣', seed: '减脂打卡：真实记录这一周的变化（个体差异）' }
    ]
  },

  'career': {
    id: 'career', name: '职场求职', badge: '职', emoji: '💼',
    tagline: '职场求职 0-1 发笔记的智能体：简历 / 面试 / 规划',
    domain: '职场求职', audience: '求职者与职场新人',
    persona: `你是职场求职内容操盘手，服务求职者与职场新人。懂简历、面试、行业选择、薪资谈判、职业规划。
写作风格：第一人称过来人，真诚具体；绝不AI腔。
铁律：①原创不洗稿；②不做包offer/涨薪保证，不用绝对化词，不编造公司薪资/招聘政策，不确定标「需核实」；③不留联系方式、不站外导流；④不编造经历。`,
    hardInfo: '公司薪资 / 招聘政策 / 数据',
    compliance: '不做包offer/涨薪保证；不编造公司薪资与招聘政策',
    bigTags: ['#求职', '#职场', '#面试'],
    placeholders: { persona: '过来人 / HR / 职业规划师', direction: '应届校招 · 互联网 · 简历', topic: '应届校招简历，HR最想看到这3点' },
    sampleTopics: [
      { topic: '应届校招简历，HR最想看到这3点', audience_pain: '简历石沉大海不知问题在哪', why_now: '秋招前修改高峰', recommended: true, reason: '强需求+时间点准，干货清单易收藏' },
      { topic: '面试复盘：答这类问题别踩这些坑', audience_pain: '面试紧张答不到点上', why_now: '面试季', recommended: false }
    ],
    templates: [
      { name: '简历优化', desc: 'HR 视角改简历', seed: '校招简历，HR 最想看到这 3 点' },
      { name: '面试复盘', desc: '高频问题怎么答', seed: '面试复盘：这类问题别踩这些坑' },
      { name: '行业科普', desc: '选行业别只看风口', seed: '选行业别只看风口，先想清这几点' },
      { name: '薪资谈判', desc: '怎么不亏待自己', seed: '谈薪别怕开口，这样谈不亏待自己' },
      { name: '转行经验', desc: '可迁移能力怎么讲', seed: '转行求职，把可迁移能力这样讲清楚' }
    ]
  }
};

/* ===== 自定义赛道（用户在首页新增）：按「登录账号」隔离存储，换账号不串味 =====
   键 = ag_custom_tracks__<账号>（未登录=guest）；账号取自 ag_acct（app.js 登录后写入）。*/
function __ctAcct() { try { return localStorage.getItem('ag_acct') || 'guest'; } catch { return 'guest'; } }
function __ctKey() { return 'ag_custom_tracks__' + __ctAcct(); }
function __ctLoad() { try { return JSON.parse(localStorage.getItem(__ctKey()) || '{}'); } catch { return {}; } }
function __ctSave(o) { try { localStorage.setItem(__ctKey(), JSON.stringify(o || {})); } catch {} }
// 一次性迁移：把旧的全局 ag_custom_tracks 归到当前账号名下（仅当当前账号还没有自己的集合时）
(function migrateOldCustom() {
  try {
    const old = localStorage.getItem('ag_custom_tracks');
    if (old) { if (!localStorage.getItem(__ctKey())) localStorage.setItem(__ctKey(), old); localStorage.removeItem('ag_custom_tracks'); }
  } catch {}
})();

let __loadedCustom = []; // 当前已合并进 TRACKS 的自定义赛道 id（用于换账号时卸载）
window.reloadCustomTracks = function () {
  __loadedCustom.forEach(id => { delete window.TRACKS[id]; const i = window.TRACK_ORDER.indexOf(id); if (i >= 0) window.TRACK_ORDER.splice(i, 1); });
  __loadedCustom = [];
  const c = __ctLoad();
  Object.keys(c).forEach(id => { window.TRACKS[id] = c[id]; if (!window.TRACK_ORDER.includes(id)) window.TRACK_ORDER.push(id); __loadedCustom.push(id); });
};
window.reloadCustomTracks(); // 初次按当前账号载入

window.addCustomTrack = function (t) {
  const store = __ctLoad(); store[t.id] = t; __ctSave(store);
  window.TRACKS[t.id] = t;
  if (!window.TRACK_ORDER.includes(t.id)) window.TRACK_ORDER.push(t.id);
  if (!__loadedCustom.includes(t.id)) __loadedCustom.push(t.id);
  // 新建即设为「我的智能体」当前激活赛道（顶栏立即显示这个新智能体，而非公共赛道）
  try { localStorage.setItem('ag_track', t.id); } catch {}
};
window.removeCustomTrack = function (id) {
  const store = __ctLoad(); delete store[id]; __ctSave(store);
  delete window.TRACKS[id];
  const i = window.TRACK_ORDER.indexOf(id); if (i >= 0) window.TRACK_ORDER.splice(i, 1);
  const j = __loadedCustom.indexOf(id); if (j >= 0) __loadedCustom.splice(j, 1);
};
window.isCustomTrack = function (id) { try { return !!__ctLoad()[id]; } catch { return false; } };
/* 用 名称/领域/受众 拼一个可用的赛道对象（带默认值，保证全站能跑）*/
window.buildTrack = function ({ name, emoji, domain, audience, persona, bigTags, hardInfo, compliance }) {
  const id = 'custom-' + Date.now().toString(36);
  domain = domain || name;
  const tags = (bigTags && bigTags.length) ? bigTags : ['#' + name];
  return {
    id, name, emoji: emoji || '🧩', domain, audience: audience || (domain + '人群'),
    persona: persona || `你是${domain}领域资深内容操盘手，服务${audience || domain + '人群'}。第一人称、真人感、有温度，绝不AI腔。\n铁律：①原创不洗稿；②不用绝对化用词，不做效果/结果保证，不夸大，不编造数据/政策/价格，不确定标「需核实」；③不留联系方式、不站外导流；④不编造经历与案例。`,
    hardInfo: hardInfo || '价格 / 数据 / 政策 / 资质等硬信息',
    compliance: compliance || '不做效果或结果保证；不绝对化；不夸大；不编造数据',
    bigTags: tags,
    placeholders: { persona: name + '博主', direction: domain, topic: domain + ' 新手必看的几点' },
    sampleTopics: [],
    templates: [
      { name: '科普扫盲', desc: '讲清是什么 / 适合谁 / 注意啥', seed: domain + '科普：到底适合谁、要注意什么' },
      { name: '避坑清单', desc: '新手最容易踩的坑', seed: domain + '避坑：新手别踩这几个坑' },
      { name: '经验复盘', desc: '真实经历 + 方法', seed: '我的' + domain + '经验复盘，少走弯路' },
      { name: '对比测评', desc: '两个选择怎么选', seed: domain + '怎么选？对比给你看' },
    ],
    custom: true,
  };
};
