const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: { loading: true, sign: null, streak: 0, balance: 0, error: '', orbOn: true },

  onShow() { this.load(); },

  async load() {
    this.setData({ error: '' });
    try {
      await app.ready();
      const r = await api.call('dailysign', {});
      this.setData({ loading: false, sign: r.sign, streak: r.streak, balance: r.balance });
      if (app.globalData.profile) app.globalData.profile.balance = r.balance;
    } catch (e) {
      this.setData({ loading: false, error: '网络晃了一下，下拉重试。' });
    }
  },

  goAsk() { wx.navigateTo({ url: '/pages/ask/index' }); },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); }
});
