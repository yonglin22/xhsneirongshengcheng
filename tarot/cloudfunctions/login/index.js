// 静默登录：换 openid → 建/取用户 → 新人赠送积分
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const SIGNUP_GRANT = parseInt(process.env.SIGNUP_GRANT_CREDITS || '300', 10);

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const users = db.collection('users');

  let u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];

  if (!u) {
    const now = Date.now();
    try {
      const addRes = await users.add({
        data: {
          openid: OPENID,
          balance: SIGNUP_GRANT,
          streakCount: 0,
          lastSignDate: '',
          addedPrivate: false,
          createdAt: now
        }
      });
      await db.collection('ledger').add({
        data: {
          openid: OPENID, type: 'grant', amount: SIGNUP_GRANT, balanceAfter: SIGNUP_GRANT,
          refType: 'signup', refId: null, requestId: 'signup_' + OPENID,
          meta: { reason: '新人注册赠送' }, createdAt: now
        }
      });
      u = (await users.doc(addRes._id).get()).data;
    } catch (e) {
      // 并发下可能已被另一次请求创建，重新取一次
      u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];
      if (!u) throw e;
    }
  }

  return { ok: true, openid: OPENID, profile: { balance: u.balance, streakCount: u.streakCount || 0 } };
};
