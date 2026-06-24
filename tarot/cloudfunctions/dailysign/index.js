// 每日一签（免费）：一天一次（DB 锁定，封顶成本）→ 抽 1 张 → 短 AI 提示（带静态兜底）→ 连签
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { callModel } = require('./model.js');
const { draw } = require('./deck.js');
const fallback = require('./fallback.js');

// 东八区日期 YYYY-MM-DD
function cnDate(offsetDays) {
  const t = Date.now() + 8 * 3600 * 1000 - (offsetDays || 0) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const date = cnDate(0);
  const signs = db.collection('dailysigns');
  const users = db.collection('users');

  const u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];

  // 今天已签：直接回放，不再抽、不再调 AI
  const existing = (await signs.where({ openid: OPENID, date }).limit(1).get()).data[0];
  if (existing) {
    return { ok: true, sign: existing, streak: u ? (u.streakCount || 0) : 0, balance: u ? u.balance : 0, already: true };
  }

  // 抽 1 张
  const card = draw(1, ['今日'])[0];

  // 短 AI（带兜底）：一句话提示 + 宜/忌
  let tip = '', yi = '', ji = '';
  try {
    const raw = await callModel({
      system: '你是塔罗日签解读师。根据给定的一张牌，写一句温暖、具体、像朋友提点的话（28字内，不预言、不宿命、把主动权留给用户），再给「宜」「忌」各一个2-4字的日常小词。只输出JSON：{"tip":"","yi":"","ji":""}',
      user: `今日牌：${card.name}（${card.reversed ? '逆位' : '正位'}）`,
      json: true, maxTokens: 200, temperature: 0.85
    });
    const j = JSON.parse(String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    tip = (j.tip || '').trim();
    yi = (j.yi || '').trim();
    ji = (j.ji || '').trim();
  } catch (e) { /* 落到兜底 */ }
  if (!tip || !yi || !ji) {
    const f = fallback(card);
    tip = tip || f.tip; yi = yi || f.yi; ji = ji || f.ji;
  }

  const energy = 40 + Math.floor(Math.random() * 56); // 40-95，轻量趣味
  const now = Date.now();
  const sign = { openid: OPENID, date, card, tip, yi, ji, energy, fav: false, createdAt: now };
  await signs.add({ data: sign });

  // 连签：昨天签过则 +1，否则重置为 1
  let streak = 1;
  if (u) {
    streak = (u.lastSignDate === cnDate(1)) ? (u.streakCount || 0) + 1 : 1;
    await users.doc(u._id).update({ data: { streakCount: streak, lastSignDate: date } });
  }

  return { ok: true, sign, streak, balance: u ? u.balance : 0 };
};
