// 微信云支付成功回调：校验成功 → 给对应订单入账（幂等）。必须返回 {errcode:0,errmsg:'OK'}
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  try {
    // 云支付回调结构：成功时 returnCode/resultCode 为 SUCCESS，带 outTradeNo
    const success = event.resultCode === 'SUCCESS' || event.returnCode === 'SUCCESS';
    if (!success) return { errcode: 1, errmsg: 'pay not success' };

    const outTradeNo = event.outTradeNo;
    if (!outTradeNo) return { errcode: 1, errmsg: 'no outTradeNo' };

    const ord = (await db.collection('orders').where({ outTradeNo }).limit(1).get()).data[0];
    if (!ord) return { errcode: 1, errmsg: 'order not found' };
    const u = (await db.collection('users').where({ openid: ord.openid }).limit(1).get()).data[0];
    if (!u) return { errcode: 1, errmsg: 'user not found' };

    await db.runTransaction(async (t) => {
      const o = (await t.collection('orders').doc(ord._id).get()).data;
      if (o.status === 'paid') return; // 幂等
      const cu = (await t.collection('users').doc(u._id).get()).data;
      const balance = (cu.balance || 0) + ord.credits;
      await t.collection('users').doc(u._id).update({ data: { balance } });
      await t.collection('orders').doc(ord._id).update({ data: { status: 'paid', paidAt: Date.now() } });
      await t.collection('ledger').add({
        data: {
          openid: ord.openid, type: 'recharge', amount: ord.credits, balanceAfter: balance,
          refType: 'order', refId: ord._id, requestId: 'order_' + outTradeNo,
          meta: { packId: ord.packId }, createdAt: Date.now()
        }
      });
    });

    return { errcode: 0, errmsg: 'OK' };
  } catch (e) {
    return { errcode: 1, errmsg: String((e && e.message) || e) };
  }
};
