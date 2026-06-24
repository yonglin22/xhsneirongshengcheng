const app = getApp();
const api = require('../../utils/api.js');
const config = require('../../config.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function rid() { return 'r_' + Date.now() + '_' + Math.floor(Math.random() * 1e6); }

Page({
  data: {
    orbOn: false,
    head: '正在为你抽牌',
    headPy: 'chōu pái zhōng',
    cards: [],
    showMean: false,
    body: null,
    typed: '',
    reveal: { r1: false, r2: false, r3: false, r4: false, r5: false },
    error: '',
    errBtn: '',
    errTo: '',
    faved: false,
    favId: '',
    serviceWechat: config.serviceWechat
  },

  onLoad(options) {
    if (options && options.id) {
      this.setData({ orbOn: true });
      return this.loadReview(options.id);
    }
    const pending = app.globalData.pending;
    if (!pending) {
      this.setData({ error: '没有拿到你的问题，回去重新问一次吧。', errBtn: '返回', errTo: 'back' });
      return;
    }
    app.globalData.pending = null;
    this.run(pending.domain, pending.situation);
  },

  // ============ 正常解读流程 ============
  async run(domain, situation) {
    try { await app.ready(); } catch (e) {} // 确保已登录建好用户
    const requestId = rid();
    const p = api.call('reading', { domain, situation, requestId }); // 与动画并行

    this.setData({ orbOn: true });
    await this.dealBacks();      // 摆三张牌背
    try {
      const res = await p;       // 等服务端抽牌 + AI 解读
      await this.revealCards(res.cards, res.result);
      await this.renderBody(res.result, false);
      if (res.balance != null && app.globalData.profile) app.globalData.profile.balance = res.balance;
      this.setData({ favId: res.readingId || '' });
    } catch (e) {
      this.handleError(e);
    }
  },

  async dealBacks() {
    const cards = [
      { position: '现状', mark: '', name: '', reversed: false, flip: false, in: false, meaning: '' },
      { position: '阻碍', mark: '', name: '', reversed: false, flip: false, in: false, meaning: '' },
      { position: '指引', mark: '', name: '', reversed: false, flip: false, in: false, meaning: '' }
    ];
    this.setData({ cards });
    for (let i = 0; i < 3; i++) {
      await sleep(150);
      this.setData({ [`cards[${i}].in`]: true });
    }
    await sleep(450);
  },

  async revealCards(serverCards, result) {
    this.setData({ head: '你抽到的牌', headPy: 'nǐ chōu dào de pái' });
    const cards = serverCards.map((c, i) => ({
      position: c.position, name: c.name, mark: c.mark, reversed: c.reversed,
      flip: false, in: true, meaning: (result.cards[i] || {}).meaning || ''
    }));
    this.setData({ cards });
    await sleep(140);
    for (let i = 0; i < 3; i++) {
      this.setData({ [`cards[${i}].flip`]: true });
      await sleep(440);
    }
    await sleep(260);
    this.setData({ showMean: true });
    await sleep(220);
  },

  async renderBody(d, instant) {
    this.setData({ body: { perspective: d.perspective || '', insights: d.insights || [], action: d.action || '' } });
    if (instant) {
      this.setData({
        typed: d.situation || '',
        'reveal.r1': true, 'reveal.r2': true, 'reveal.r3': true, 'reveal.r4': true, 'reveal.r5': true
      });
      return;
    }
    this.setData({ 'reveal.r1': true });
    await this.typewriter(d.situation || '');
    const order = ['r2', 'r3', 'r4', 'r5'];
    for (let i = 0; i < order.length; i++) {
      await sleep(280);
      this.setData({ ['reveal.' + order[i]]: true });
    }
  },

  async typewriter(text) {
    for (let i = 1; i <= text.length; i++) {
      this.setData({ typed: text.slice(0, i) });
      await sleep(42);
    }
  },

  // ============ 历史回看（不抽牌、不扣点） ============
  async loadReview(id) {
    try {
      await app.ready();
      const res = await api.call('user', { action: 'reading', id });
      const rd = res.reading;
      this.setData({ head: '你抽到的牌', headPy: 'nǐ chōu dào de pái', faved: !!rd.fav, favId: id });
      const cards = rd.cards.map((c, i) => ({
        position: c.position, name: c.name, mark: c.mark, reversed: c.reversed,
        flip: true, in: true, meaning: (rd.result.cards[i] || {}).meaning || ''
      }));
      this.setData({ cards, showMean: true });
      await this.renderBody(rd.result, true);
    } catch (e) {
      this.setData({ error: '没找到这条记录。', errBtn: '返回', errTo: 'back' });
    }
  },

  // ============ 错误 / 降级 ============
  handleError(e) {
    if (e.code === 'INSUFFICIENT') {
      this.setData({ error: '积分不足，去充值后再来问。', errBtn: '去充值', errTo: 'recharge' });
    } else {
      this.setData({ error: e.message || '牌已摊开，但解读没接上，积分没扣，再试一次就好。', errBtn: '重新抽牌', errTo: 'back' });
    }
    if (e.payload && e.payload.cards) {
      const cards = e.payload.cards.map((c) => ({
        position: c.position, name: c.name, mark: c.mark, reversed: c.reversed, flip: true, in: true, meaning: ''
      }));
      this.setData({ cards, showMean: false });
    }
  },

  onErr() {
    if (this.data.errTo === 'recharge') wx.redirectTo({ url: '/pages/recharge/index' });
    else wx.navigateBack();
  },

  // ============ 收藏 / 再问 / 私域 ============
  async toggleFav() {
    if (!this.data.favId) return;
    try {
      const r = await api.call('user', { action: 'fav', id: this.data.favId });
      this.setData({ faved: r.fav });
      wx.showToast({ title: r.fav ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (e) {}
  },

  again() { wx.redirectTo({ url: '/pages/ask/index' }); },

  copyWechat() {
    wx.setClipboardData({
      data: this.data.serviceWechat,
      success: () => wx.showToast({ title: '微信号已复制', icon: 'none' })
    });
  }
});
