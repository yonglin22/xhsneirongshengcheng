const config = require('./config.js');

App({
  globalData: {
    openid: null,
    profile: null,    // { balance, streakCount }
    pending: null,    // 问事页 → 解读页传参 { domain, situation }
    config
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库过低，请使用 2.2.3 及以上版本');
      return;
    }
    wx.cloud.init({
      env: config.cloudEnv,
      traceUser: true
    });
    // 静默登录：拿 openid、建用户、发新人积分
    this.loginPromise = this.doLogin();
  },

  async doLogin() {
    try {
      const r = await wx.cloud.callFunction({ name: 'login' });
      const res = r.result || {};
      if (res.ok) {
        this.globalData.openid = res.openid;
        this.globalData.profile = res.profile;
      }
      return res;
    } catch (e) {
      console.error('登录失败', e);
      throw e;
    }
  },

  // 页面统一用：await getApp().ready() 确保已登录
  ready() {
    return this.loginPromise || this.doLogin();
  }
});
