// 我的页聚合 + 历史回看 + 收藏
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'home';
  const users = db.collection('users');
  const u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];
  if (!u) return { ok: false, error: '未登录' };

  if (action === 'home') {
    const readings = (await db.collection('readings')
      .where({ openid: OPENID }).orderBy('createdAt', 'desc').limit(20).get()).data;
    const ledger = (await db.collection('ledger')
      .where({ openid: OPENID }).orderBy('createdAt', 'desc').limit(30).get()).data;
    return { ok: true, balance: u.balance, streak: u.streakCount || 0, readings, ledger };
  }

  if (action === 'reading') {
    const rd = (await db.collection('readings').doc(event.id).get().catch(() => ({ data: null }))).data;
    if (!rd || rd.openid !== OPENID) return { ok: false, error: '未找到' };
    return { ok: true, reading: rd };
  }

  if (action === 'fav') {
    const rd = (await db.collection('readings').doc(event.id).get().catch(() => ({ data: null }))).data;
    if (!rd || rd.openid !== OPENID) return { ok: false, error: '未找到' };
    const next = !rd.fav;
    await db.collection('readings').doc(event.id).update({ data: { fav: next } });
    return { ok: true, fav: next };
  }

  if (action === 'addPrivate') {
    await users.doc(u._id).update({ data: { addedPrivate: true } });
    return { ok: true };
  }

  return { ok: false, error: '未知操作' };
};
