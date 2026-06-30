// 执行端协议客户端（每台真机一个实例）。对接服务端协议（与「设备看板 / 网页执行端」同一套）：
//   POST /api/devices/heartbeat   设备上线/状态
//   POST /api/dispatch/pull       领一条任务（pending→running，含完整计划配置）
//   POST /api/dispatch/report     中途进度/数据回报
//   POST /api/dispatch/done       完成回报（ok=false + data.risk → 服务端自动熔断暂停同账号）
//   POST /api/note-stats          发布后笔记数据回流（小眼睛/赞/藏/评论）
//   POST /api/gen-comment         按人设生成拟人评论
// 鉴权：Authorization: Bearer <设备token>（在「设备看板」生成）。
//
// ⚠️ 真机拟人执行（在小红书 App 里浏览/点赞/评论）的具体动作，依赖 UI 坐标/控件，
//    各机型分辨率不同，需按你的真机适配——见下方 TODO 钩子（adbTap / adbSwipe / 已留贝塞尔滑动样例）。
const https = require('https');
const http = require('http');

function postJSON(base, pathname, token, body) {
  return new Promise((resolve) => {
    let u; try { u = new URL(base + pathname); } catch { return resolve({ ok: false, error: 'bad url' }); }
    const mod = u.protocol === 'http:' ? http : https;
    const payload = Buffer.from(JSON.stringify(body || {}));
    const req = mod.request(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': payload.length, ...(token ? { authorization: 'Bearer ' + token } : {}) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false, error: d.slice(0, 200) }); } }); });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.write(payload); req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

module.exports = class Agent {
  constructor({ serial, model, token, serverBase, adb }) {
    this.serial = serial; this.model = model; this.token = token;
    this.base = serverBase; this.adb = adb;
    this.running = false; this.busy = false; this._st = { status: 'idle', task: null, progress: 0, log: '' };
  }
  state() { return { agentStatus: this._st.status, agentTask: this._st.task, agentProgress: this._st.progress, agentLog: this._st.log }; }
  log(s) { this._st.log = s; }

  async start() { if (this.running) return; this.running = true; this._loop(); this._hb(); }
  stop() { this.running = false; }

  async _hb() { while (this.running) { await postJSON(this.base, '/api/devices/heartbeat', this.token, { key: this.serial, name: this.model, status: this.busy ? 'working' : 'idle' }); await sleep(25000); } }

  async _loop() {
    while (this.running) {
      if (this.busy) { await sleep(800); continue; }
      const r = await postJSON(this.base, '/api/dispatch/pull', this.token, { device: this.model });
      if (r && r.ok && r.task) { this.busy = true; try { await this._run(r.task); } catch (e) { this.log('异常:' + e.message); } this.busy = false; }
      else await sleep(5000);
    }
  }

  async _run(task) {
    const p = task.plan || {}, cfg = p.config || {}, nz = cfg.nurture || {}, ic = cfg.intercept || {};
    const isIc = /_intercept$/.test(p.ptype);
    const daily = Math.max(3, Math.min(isIc ? 8 : 12, parseInt(nz.daily) || 8));
    this._st = { status: 'working', task: p.name || p.ptype, progress: 0, log: '开始' };
    let viewed = 0, liked = 0, faved = 0, commented = 0, collected = 0;
    const id = task.dispatchId;

    // 打开小红书（搜索养号用关键词搜索页，首页养号用 explore）
    const kw = (cfg.keywords || [])[0] || '';
    await this._openXhs(kw);

    for (let i = 1; i <= daily; i++) {
      if (!this.running) break;
      await sleep(rnd(2500, 6000));                       // 拟人停留：可换 Beta 分布
      viewed++;
      await this._humanScroll();                          // 拟人滑动（贝塞尔曲线，见下）
      if (Math.random() < (+nz.love || 60) / 100) {       // 命中对标才互动
        if (Math.random() < (+nz.like || 3) / 100) { await this._tapLike(); liked++; }
        if (Math.random() < (+nz.fav || 2) / 100) { await this._tapFav(); faved++; }
        if (Math.random() < (+(isIc ? ic.reply : nz.comment) || 5) / 100) {
          const g = await postJSON(this.base, '/api/gen-comment', this.token, { persona: p.name, scene: isIc ? 'intercept' : 'reply', noteTitle: kw + '·对标笔记' });
          if (g && g.ok) { await this._postComment(g.comment); commented++; }
        }
      }
      this._st.progress = Math.round(i / daily * 100); this.log(`第${i}/${daily}篇 浏览${viewed}赞${liked}`);
      await postJSON(this.base, '/api/dispatch/report', this.token, { id, progress: this._st.progress, data: { viewed, liked, faved, commented } });

      // 风控检测：若截图里出现验证码/异常，立即熔断（TODO: 接图像/控件检测）
      if (await this._riskHit()) {
        await postJSON(this.base, '/api/dispatch/done', this.token, { id, ok: false, result: '检测到风控验证，已熔断', data: { viewed, liked, faved, commented, risk: 'captcha' } });
        this._st.status = 'idle'; return;
      }
    }
    await postJSON(this.base, '/api/dispatch/done', this.token, { id, ok: true, result: `养号完成 浏览${viewed}赞${liked}藏${faved}`, data: { viewed, liked, faved, commented, collected } });
    this._st = { status: 'idle', task: null, progress: 0, log: '完成' };
  }

  // ===== 真机操作原语（按你的机型适配坐标） =====
  async _shell(args) { try { await this.adb(['-s', this.serial, 'shell', ...args]); } catch {} }
  async _openXhs(kw) {
    // 用 monkey 拉起小红书；若要直接进搜索页可换成 am start -d 的 deeplink（需小红书支持）
    await this._shell(['monkey', '-p', 'com.xingin.xhs', '-c', 'android.intent.category.LAUNCHER', '1']);
    await sleep(3500);
    // TODO: 若 kw 非空，点搜索框→输入→回车（坐标随机型而定）
  }
  async _humanScroll() {
    // 贝塞尔/随机化滑动：起止点加抖动、时长随机，降低机器特征
    const x = 540 + rnd(-40, 40), y1 = 1500 + rnd(-80, 80), y2 = 600 + rnd(-80, 80), dur = rnd(280, 620);
    await this._shell(['input', 'swipe', String(x), String(y1), String(x + rnd(-30, 30)), String(y2), String(dur)]);
  }
  async _tapLike() { /* TODO: 双击屏幕中心点赞 或 点赞按钮坐标 */ await this._shell(['input', 'tap', '980', '1700']); }
  async _tapFav() { /* TODO: 收藏按钮坐标 */ await this._shell(['input', 'tap', '980', '1820']); }
  async _postComment(text) {
    // TODO: 点评论框→input text→发送。中文需 adb keyboard（ADBKeyBoard）或剪贴板粘贴
    await this._shell(['input', 'tap', '300', '1900']);
    await sleep(800);
    await this._shell(['input', 'text', JSON.stringify(String(text || '').replace(/\s/g, '_')).slice(1, -1)]);
  }
  async _riskHit() {
    // TODO: 抓一帧截图做验证码/异常弹窗识别（OCR 或模板匹配）。占位：恒 false。
    return false;
  }
};
