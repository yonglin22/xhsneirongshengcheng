// 充值：列套餐 / 下单。支持两种模式：
//   模拟支付（event.mock=true 且环境变量 ALLOW_MOCK_PAY=1）：直接到账，联调用
//   真实云支付：cloud.cloudPay.unifiedOrder（需开通云支付 + 商户号，字段按你的开通情况核对）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 套餐（唯一真源；前端展示与计价都以此为准）。改价改这里即可。
const PACKS = [
  { id: 'p1', cny: 1, credits: 100, label: '体验' },
  { id: 'p6', cny: 6, credits: 600, label: '基础' },
  { id: 'p30', cny: 30, credits: 3300, label: '进阶', tag: '送300' },
  { id: 'p68', cny: 68, credits: 8000, label: '工作室', tag: '送1200' }
];

const ALLOW_MOCK = process.env.ALLOW_MOCK_PAY === '1';

function outTradeNo() {
  return 'T' + Date.now() + Math.floor(Math.random() * 1e6);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'create';

  if (action === 'packs') return { ok: true, packs: PACKS };

  const pack = PACKS.find((p) => p.id === event.packId);
  if (!pack) return { ok: false, error: '套餐不存在' };

  const users = db.collection('users');
  const u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];
  if (!u) return { ok: false, error: '未登录' };

  const no = outTradeNo();
  const now = Date.now();
  await db.collection('orders').add({
    data: {
      openid: OPENID, outTradeNo: no, packId: pack.id,
      amountFen: pack.cny * 100, credits: pack.credits,
      status: 'pending', createdAt: now
    }
  });

  // —— 模拟支付：免商户号跑通闭环 ——
  if (event.mock) {
    if (!ALLOW_MOCK) return { ok: false, error: '模拟支付未开启：请在云函数 pay 的环境变量里设 ALLOW_MOCK_PAY=1' };
    const r = await creditOrder(OPENID, no);
    return { ok: true, mock: true, balance: r.balance, credits: pack.credits };
  }

  // —— 真实微信云支付 ——（需先在云开发后台开通云支付并绑定商户号）
  try {
    const res = await cloud.cloudPay.unifiedOrder({
      body: 'FateTell 塔罗·积分充值-' + pack.label,
      outTradeNo: no,
      spbillCreateIp: '127.0.0.1',
      subMchId: process.env.WX_SUB_MCH_ID,   // 你的（子）商户号
      totalFee: pack.cny * 100,              // 单位：分
      envId: cloud.DYNAMIC_CURRENT_ENV,
      functionName: 'payCallback',           // 支付成功后微信回调的云函数
      nonceStr: Math.random().toString(36).slice(2),
      tradeType: 'JSAPI'
    });
    return { ok: true, payment: res.payment, outTradeNo: no };
  } catch (e) {
    return { ok: false, error: '下单失败：' + (e.errMsg || e.message) };
  }
};

// 入账（幂等）：订单从 pending → paid，加余额、写流水。pay(模拟) 与 payCallback(真实) 共用同一逻辑。
async function creditOrder(openid, outTradeNo) {
  const ord = (await db.collection('orders').where({ outTradeNo }).limit(1).get()).data[0];
  if (!ord) throw new Error('订单不存在');
  const u = (await db.collection('users').where({ openid }).limit(1).get()).data[0];
  if (!u) throw new Error('用户不存在');

  let balance = u.balance || 0;
  await db.runTransaction(async (t) => {
    const o = (await t.collection('orders').doc(ord._id).get()).data;
    if (o.status === 'paid') { return; } // 幂等：已入账则跳过
    const cu = (await t.collection('users').doc(u._id).get()).data;
    balance = (cu.balance || 0) + ord.credits;
    await t.collection('users').doc(u._id).update({ data: { balance } });
    await t.collection('orders').doc(ord._id).update({ data: { status: 'paid', paidAt: Date.now() } });
    await t.collection('ledger').add({
      data: {
        openid, type: 'recharge', amount: ord.credits, balanceAfter: balance,
        refType: 'order', refId: ord._id, requestId: 'order_' + outTradeNo,
        meta: { packId: ord.packId }, createdAt: Date.now()
      }
    });
  });
  return { balance };
}

exports.creditOrder = creditOrder;
