/* ===== 赛道 = 智能体 配置中心 =====
   每个赛道一套：人设(persona) / 领域(domain) / 合规红线 / 大流量标签 / 示例 / 模板。
   新增赛道：往 TRACKS 里加一项，并把 id 放进 TRACK_ORDER。 */
// 平台公共赛道：美术考研 + 职场求职（其余模板保留在 TRACKS，需要公开再放进此数组）
window.TRACK_ORDER = ['art-grad', 'design-grad', 'career'];

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

  'design-grad': {
    id: 'design-grad', name: '设计考研', badge: '设', emoji: '🖋️',
    tagline: '设计考研（世界现代设计史）0-1 起号，日更3条稳小眼睛的智能体',
    domain: '设计考研 · 世界现代设计史', audience: '设计考研学生（应届 / 二战 / 跨考），尤其史论备考人',
    persona: `你是"设计考研学姐"——设计专业研究生/毕业、带过多届设计考研生，专攻「世界现代设计史」史论。说话干脆直接、不拖泥带水、爱用口诀，常用句式"讲人话""你记住""别慌"，像上岸学姐跟备考生掏心窝，真诚具体有温度；绝不AI腔（不用"综上所述/在当今/总而言之/值得注意的是/首先其次最后"）。
你的领域底盘（世界现代设计史必考板块，按高频）：工艺美术运动（莫里斯·拉斯金·红屋，与包豪斯对比）、新艺术运动（各国别称、吉马德·高迪·霍塔）、德意志制造联盟（穆特修斯·贝伦斯，标准化vs个性化之争）、包豪斯（三任校长格罗皮乌斯/迈耶/密斯、三阶段魏玛-德绍-柏林、教学体系、历史意义）、装饰艺术运动（来源·特点·与现代主义区别）、现代主义（功能主义·少即是多·密斯/柯布西耶/赖特）、波普设计（英国/美国波普与消费文化）、后现代主义（孟菲斯·文丘里·对现代主义的反叛）、各国设计（北欧人性化、日本双轨制、意大利、德国）。
内容打法（核心：不原创、只把爆款逻辑换成自己的）：保留同行爆款的结构 → 换自己的案例 → 换自己编的口诀 → 换开头第一句 → 换配图，改写度≥60%，绝不洗稿照搬。擅长把知识点做成"口诀/时间轴/万能答题句"，把一个热点（设计展/设计师诞辰逝世/品牌新品/设计奖项/老建筑翻新）映射成2-3个设计史可考方向。
铁律（不得违反）：①原创不洗稿，与对标不得实质相似；②不用绝对化用词（第一/最/全网/百分百/保证/必过/押中/原题），不做上岸或押题保证，不编造院校招生政策/报录比/分数线/参考书目/真题，不确定一律标「需核实」；③正文/标题/标签不留任何联系方式，不写"加V/私信/扫码发资料"，导流只用"主页群聊/评论区扣设计史"这类站内合规说法；④不编造经历与战绩。`,
    hardInfo: '报录比 / 分数线 / 招生政策 / 参考书目 / 真题 / 院校信息',
    compliance: '不做上岸或押题保证；不编造院校政策、分数线与真题；导流只用站内说法',
    bigTags: ['#设计考研', '#世界现代设计史', '#设计史'],
    defaultImgStyle: '红笔/荧光笔划重点的手写笔记实拍图，白底或浅色背景、上下留白、标题大字粗体（红或黑），真实笔记翻拍感，不要花哨、不要AI插画风',
    pipeline: {
      frame: `【设计考研·结构铁律——按选题类型套对应模板】
· 技巧突击类(口诀/方法,300-400字)：①痛点开头一句"讲人话！[知识点]不用死记硬背" ②中间3个口诀/方法,每个"口诀→举个例子" ③结尾"完整[框架/资料]放图里了直接存,点赞收藏后面翻出来用"。
· 热点蹭流类(400-500字)：①热点引入"最近[XX]火了,设计考研人记下这3个考点" ②3个考点,每个"知识点名称→怎么考(答题方向)" ③结尾"完整考点整理已发主页群聊,评论区扣设计史领"。
· 资料展示类(200-300字)：①钩子"这版[资料]整理了我3个月,直接抄作业" ②3个理由(✅) ③配红笔笔记图 ④"高清PDF已放主页群聊"。
· 通用：标题=数字+情绪词+结果承诺(但不绝对化不做上岸保证)；每段≤4行；自创口诀/时间轴/万能句优先；不洗稿、与对标改写度≥60%(保结构换案例换口诀换开头)。`,
      body: `【设计考研·正文铁律】严格按选题对应模板(技巧突击/热点蹭流/资料展示)的固定结构写；用"设计考研学姐"口吻,开口常用"讲人话/你记住/别慌";知识点尽量给自创口诀或时间轴(如包豪斯三阶段:魏玛-德绍-柏林);每段≤4行、段间用👉🔥✅🎨适度点缀;结尾固定"点赞收藏,设计史不迷路,学姐带你冲";院校政策/分数线/报录比/真题一律标「需核实」;导流只写"主页群聊/评论区扣设计史",绝不出现微信/加我/扫码及绝对化词(第一/最/保证/押中)。`,
      cover: `【设计考研·封面铁律】封面=红笔/荧光笔划重点的手写笔记实拍感:白底或浅色背景、上下留白、中间是笔记主体、标题大字粗体(红或黑);cover_lines第一行=知识点大字(如"包豪斯三校长"),第二行=方法承诺(如"一个口诀记住");visual 描述务必是"手写笔记翻拍/红笔标注"风,不要AI插画、不要花哨背景、画面内不出现印刷体段落。`
    },
    playbook: {
      checklist: [
        '标题 12-20 字，含数字 + 情绪词（如"别背了""3个口诀"）',
        '正文分段，每段不超过 4 行',
        '每段之间加 emoji（👉🔥✅🎨），但克制不刷屏',
        '标签 3-5 个，必带 #设计考研 #世界现代设计史',
        '封面是红笔/荧光笔划重点的手写笔记风（白底大字）',
        '无违禁词：第一 / 最 / 全网 / 百分百 / 保证 / 必过 / 押中 / 原题',
        '导流合规：只写"主页群聊/评论区扣设计史"，不留微信/加我/扫码',
        '院校政策·分数线·报录比·真题，不确定的都标了「需核实」'
      ],
      hotspotMap: [
        { when: 'XX 设计展 / 博览会开幕', point: '该展览关联的设计运动（如世博会→工艺美术运动）', ask: '“XX 博览会对现代设计的影响”' },
        { when: '某著名设计师逝世 / 诞辰', point: '该设计师代表作与设计理念', ask: '“论述 XX 的设计思想及其对后世的影响”' },
        { when: '某品牌发新品（设计感强）', point: '该品牌风格溯源（如苹果→包豪斯+德国设计）', ask: '“从苹果产品看包豪斯设计理念的当代延续”' },
        { when: '某设计奖项公布', point: '获奖作品趋势与设计史流派关联', ask: '“从 XX 奖看当代设计与现代主义的关系”' },
        { when: '某老建筑翻新 / 保护', point: '该建筑的设计流派、设计师、时代背景', ask: '“XX 建筑与 XX 设计运动的关系”' }
      ],
      dataRedlines: [
        { sig: '发布后 2 小时 · 小眼睛 < 100', act: '封面或标题不行，先换封面再换标题' },
        { sig: '小眼睛 < 200', act: '标题不够抓人，下一篇重写标题（加数字+情绪词）' },
        { sig: '点赞 < 20', act: '干货不够硬，加自创口诀 / 加具体案例' },
        { sig: '收藏 > 点赞', act: '内容有价值，保持这个选题方向和风格' },
        { sig: '评论多但无转化', act: '评论区置顶引导语要优化（站内合规说法）' },
        { sig: '点赞 > 100', act: '可复制到矩阵其他号，换封面+改标题30%再发' }
      ]
    },
    // 矩阵起盘预设：3 个老号(先养号) + 1 店铺卖资料。账号矩阵/获客计划一键铺设，矩阵起盘SOP页渲染。
    matrix: {
      groupName: '设计考研矩阵',
      shop: '考研资料店铺（设计史速记/名词解释/时间轴大图/论述模板·只写整理/方向，不写押题/必过/原题）',
      accounts: [
        { role: '主号 · IP大号', nick: '设计考研学姐', focus: '技巧突击（口诀/时间轴/论述万能句）', goal: '涨粉立人设 → 引到店铺', note: '主号·技巧突击·立人设引店铺 ‖ 老号先养号7天' },
        { role: '资料号', nick: '设计史资料整理', focus: '资料展示（速记笔记/思维导图/名词解释）', goal: '截流"找资料"人群 → 直接进店', note: '资料号·每篇挂店铺链接·截流找资料 ‖ 老号先养号7天' },
        { role: '热点号', nick: '设计考研日报', focus: '热点蹭流（用热点→考点映射表）', goal: '蹭流量测爆款 → 给主号导流', note: '热点号·蹭流量测爆款·给主号导流 ‖ 老号先养号7天' }
      ],
      interceptKeywords: ['设计考研', '世界现代设计史', '设计史笔记', '设计考研带背', '艺术设计考研'],
      nurture: { days: 7, daily: 15, love: 60, like: 80, fav: 25, follow: 20, comment: 15 },
      cadence: [
        { time: '08:00', type: '资料展示', note: '日常更新' },
        { time: '12:00', type: '技巧突击', note: '主推 · 最容易爆' },
        { time: '18:00', type: '热点蹭流', note: '蹭下班刷手机高峰' }
      ],
      phases: [
        { name: '第①阶段 · 养号期', span: '第 1–7 天', goal: '3 个老号先养权重、清旧标签、做精准浏览，别一上来就发广告', todo: [
          '每号每天用「搜索页·起号养号」计划，保守互动（好感率60%、每日≤15篇）',
          '搜「设计考研/世界现代设计史/设计史笔记」按最多点赞浏览停留+少量点赞收藏',
          '老号若有跑偏的旧笔记/旧标签，先隐藏或删，养正"设计考研"的账号标签',
          '完善昵称/简介/头像统一人设（学姐/资料/日报三种）；这7天不挂任何链接'
        ] },
        { name: '第②阶段 · 内容起号', span: '第 8–30 天', goal: '日更 3 条，7 天内小眼睛稳定 300–500', todo: [
          '按发布节奏 08:00 资料 / 12:00 技巧 / 18:00 热点，每号每天 1–3 条',
          '一键按对标生成全套 → 合规自检（发布前清单+数据红线）→ 发布',
          '主号爆款换口诀换封面后一稿多发到资料号/热点号（改写度≥60%）',
          '每天 3 次看数据，按「数据红线」调标题/封面/口诀'
        ] },
        { name: '第③阶段 · 截流 + 卖货', span: '第 30 天起', goal: '稳定起量后开截流、上店铺转化', todo: [
          '用「搜索页·截流获客」计划，关键词=上面5个，去同行评论区收集潜客（保守、出验证即停）',
          '主号/资料号笔记挂店铺商品链接，承接只用"主页群聊/评论区扣设计史"',
          '资料号每篇必挂店铺；热点号只导流到主号不硬卖',
          '点赞>100 的爆款，换封面+改标题30% 铺到矩阵其他号复用'
        ] }
      ]
    },
    placeholders: { persona: '设计考研学姐 / 设计史带背老师', direction: '世界现代设计史 · 口诀速记 · 论述题', topic: '3个口诀搞定包豪斯三任校长' },
    sampleTopics: [
      { topic: '世界现代设计史，死记硬背你就输了', audience_pain: '史论知识点又多又碎，硬背记不住还混', why_now: '暑期强化是史论拉分的关键窗口', recommended: true, reason: '痛点强、覆盖全科目、技巧突击类最易爆' },
      { topic: '3个口诀搞定包豪斯三任校长', audience_pain: '三任校长和阶段总记混', why_now: '包豪斯是必考核心、常年高频', recommended: false },
      { topic: '设计史时间轴，一张图串起所有运动', audience_pain: '各运动先后顺序与关系理不清', why_now: '强化期需要建框架', recommended: false },
      { topic: '新艺术运动各国别称，一个口诀记住全部', audience_pain: '各国别称多到记不住', why_now: '高频名词解释考点', recommended: false }
    ],
    sampleNote: {
      cover_lines: ['包豪斯三任校长', '一个口诀记住'],
      title: '讲人话！包豪斯三任校长不用死记，记这个口诀就行',
      body: ['别慌，包豪斯三任校长其实就一句口诀：「格罗皮乌斯开局、迈耶过渡、密斯收尾」。',
        '① 格罗皮乌斯：创办人，1919魏玛起家，定下"艺术与技术新统一"。',
        '② 汉斯·迈耶：左转过渡，强调功能与社会性，争议也最大。',
        '③ 密斯·凡德罗：末任校长，搬到柏林后停办，"少即是多"就是他。',
        '配套的三阶段时间轴（魏玛—德绍—柏林）我整理在图里了，直接存。',
        '点赞收藏，设计史不迷路，学姐带你冲 🙌'],
      tags: ['#设计考研', '#世界现代设计史', '#包豪斯', '#设计史', '#考研史论']
    },
    templates: [
      { name: '技巧突击（口诀/方法）', desc: '痛点开头+3个口诀/方法+引导存图，300-400字', seed: '讲人话！这个知识点不用死记，记这个口诀就行' },
      { name: '热点蹭流（热点→考点）', desc: '热点引入+3个可考方向+怎么答，400-500字', seed: '最近这个设计大事火了，设计考研人记下这3个考点' },
      { name: '资料展示（干货引流）', desc: '钩子+3个理由+红笔笔记图+站内领取，200-300字', seed: '这版设计史速记笔记整理了3个月，直接抄作业' },
      { name: '设计史时间轴', desc: '一张图串起所有运动的先后与关系', seed: '设计史时间轴，一张图串起所有设计运动' },
      { name: '名词解释速记', desc: '高频名词一个口诀记一组', seed: '设计史名词解释，这20个高频的一次背完' },
      { name: '论述题万能句', desc: '可套用的开头/框架/万能案例', seed: '论述题万能开头，设计考研直接套用' }
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

// 仅把赛道登记进本地 TRACKS/localStorage（供新建与「云端回灌」共用）
function __registerCustomTrack(t, opts) {
  const store = __ctLoad(); store[t.id] = t; __ctSave(store);
  window.TRACKS[t.id] = t;
  if (!window.TRACK_ORDER.includes(t.id)) window.TRACK_ORDER.push(t.id);
  if (!__loadedCustom.includes(t.id)) __loadedCustom.push(t.id);
  if (opts && opts.select) { try { localStorage.setItem('ag_track', t.id); } catch {} } // 新建即设为当前激活赛道
}
// 把赛道定义持久化到云端（跨设备 / 清缓存不丢）：塞进该赛道的 agent_config，保存点统一保留 _track
function __persistTrackCloud(t) {
  try {
    if (!(window.CloudAgent && window.Cloud)) return;
    Cloud.loggedIn().then(ok => {
      if (!ok) return;
      let cur = {}; try { cur = JSON.parse(localStorage.getItem('ag_cfg_' + t.id) || '{}'); } catch {}
      cur._track = t; try { localStorage.setItem('ag_cfg_' + t.id, JSON.stringify(cur)); } catch {}
      CloudAgent.save(t.id, cur);
    });
  } catch {}
}
window.addCustomTrack = function (t) {
  __registerCustomTrack(t, { select: true });
  __persistTrackCloud(t); // ★ 云端持久化，换设备/清缓存后登录可自动恢复
};
// 云端回灌：登录后把服务端存的自定义赛道合并回本地（不改当前选择、不回写云端，避免回环）
window.hydrateCloudTrack = function (t) {
  if (!t || !t.id) return false;
  if (__ctLoad()[t.id]) return false; // 本地已有则跳过
  __registerCustomTrack(t, { select: false });
  return true;
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
