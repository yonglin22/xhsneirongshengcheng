const app = getApp();
const api = require('../../utils/api.js');
const config = require('../../config.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

Page({
  data: { packs: [], balance: 0, busy: false, mock: config.mockPay },

  async onLoad() {
    try {
      await app.ready();
      const r = await api.call('pay', { action: 'packs' });
      this.setData({ packs: r.packs });
    } catch (e) {}
    this.refreshBalance();
  },

  onShow() { this.refreshBalance(); },

  refreshBalance() {
    const p = app.globalData.profile;
    if (p) this.setData({ balance: p.balance });
  },

  async buy(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ busy: true });
    try {
      const r = await api.call('pay', { action: 'create', packId: id, mock: this.data.mock });
      if (r.mock) {
        this.afterPaid(r.balance);
        wx.showToast({ title: '充值成功（模拟）', icon: 'success' });
      } else {
        await wx.requestPayment(r.payment);
        wx.showLoading({ title: '到账中…' });
        await sleep(1500);
        const u = await api.call('user', { action: 'home' });
        wx.hideLoading();
        this.afterPaid(u.balance);
        wx.showToast({ title: '充值成功', icon: 'success' });
      }
    } catch (err) {
      const msg = (err && err.errMsg) || (err && err.message) || '';
      if (msg.indexOf('cancel') < 0) {
        wx.showToast({ title: (err && err.message) || '充值失败', icon: 'none' });
      }
    } finally {
      this.setData({ busy: false });
    }
  },

  afterPaid(balance) {
    if (balance != null) {
      this.setData({ balance });
      if (app.globalData.profile) app.globalData.profile.balance = balance;
    }
  }
});
