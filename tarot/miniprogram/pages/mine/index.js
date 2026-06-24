const app = getApp();
const api = require('../../utils/api.js');
const config = require('../../config.js');

Page({
  data: {
    loading: true,
    balance: 0,
    streak: 0,
    readings: [],
    ledger: [],
    tab: 'history',
    serviceWechat: config.serviceWechat
  },

  onShow() { this.load(); },

  async load() {
    try {
      await app.ready();
      const r = await api.call('user', { action: 'home' });
      this.setData({
        loading: false,
        balance: r.balance,
        streak: r.streak,
        readings: (r.readings || []).map(fmtReading),
        ledger: (r.ledger || []).map(fmtLedger)
      });
      if (app.globalData.profile) app.globalData.profile.balance = r.balance;
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.t }); },
  openReading(e) { wx.navigateTo({ url: '/pages/reading/index?id=' + e.currentTarget.dataset.id }); },
  goRecharge() { wx.navigateTo({ url: '/pages/recharge/index' }); },
  copyWechat() {
    wx.setClipboardData({ data: this.data.serviceWechat, success: () => wx.showToast({ title: '已复制', icon: 'none' }) });
  }
});

function fmtReading(r) {
  const head = (r.result && r.result.situation) ? r.result.situation : (r.situation || '');
  return { id: r._id, domain: r.domain, when: fmtDate(r.createdAt), fav: r.fav, head: head.slice(0, 32) };
}
function fmtLedger(l) {
  const map = { recharge: '充值', consume: '深度解读', grant: '新人赠送', refund: '返还', admin_grant: '调整', admin_deduct: '调整' };
  return { type: map[l.type] || l.type, amount: (l.amount >= 0 ? '+' : '') + l.amount, when: fmtDate(l.createdAt) };
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getMonth() + 1}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
