const app = getApp();
const api = require('../../utils/api.js');
const config = require('../../config.js');

Page({
  data: {
    domains: [
      { k: '姻缘', en: 'Love' },
      { k: '事业', en: 'Career' },
      { k: '财运', en: 'Fortune' }
    ],
    domain: '姻缘',
    situation: '',
    canGo: false,
    balance: 0,
    price: config.pricing.readingCredits
  },

  async onShow() {
    try { await app.ready(); } catch (e) {}
    const p = app.globalData.profile;
    if (p) this.setData({ balance: p.balance });
  },

  pickDomain(e) {
    this.setData({ domain: e.currentTarget.dataset.k });
  },

  onInput(e) {
    const v = e.detail.value;
    this.setData({ situation: v, canGo: v.trim().length >= 4 });
  },

  go() {
    if (!this.data.canGo) return;
    if (this.data.balance < this.data.price) {
      wx.showModal({
        title: '积分不足',
        content: `深度解读需 ${this.data.price} 积分，去充值一下？`,
        confirmText: '去充值',
        cancelText: '再想想',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/recharge/index' }); }
      });
      return;
    }
    app.globalData.pending = { domain: this.data.domain, situation: this.data.situation.trim() };
    wx.navigateTo({ url: '/pages/reading/index' });
  }
});
