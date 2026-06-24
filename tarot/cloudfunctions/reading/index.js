// 深度解读（付费核心）：幂等 → gate 余额 → 服务端抽牌 → 调模型 → 成功才原子扣点 + 存档
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { callModel, parseJSONLoose } = require('./model.js');
const { draw } = require('./deck.js');
const SYSTEM_PROMPT = require('./prompt.js');

const PRICE = parseInt(process.env.PRICE_READING || '290', 10);
const POSITIONS = ['现状', '阻碍', '指引'];

async function balanceOf(openid) {
  const u = (await db.collection('users').where({ openid }).limit(1).get()).data[0];
  return u ? u.balance : 0;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const domain = String(event.domain || '').trim();
  const situation = String(event.situation || '').trim();
  const requestId = String(event.requestId || '') || ('r_' + OPENID + '_' + Date.now());

  if (!['姻缘', '事业', '财运'].includes(domain)) return { ok: false, error: '领域不对，重选一下。' };
  if (situation.length < 4) return { ok: false, error: '再多说一点你的处境（至少 4 个字）。' };

  const users = db.collection('users');
  const ledger = db.collection('ledger');

  // —— 幂等：同一 requestId 已处理，直接回放那次解读，避免重试重复扣点 ——
  const dup = (await ledger.where({ requestId }).limit(1).get()).data[0];
  if (dup && dup.refId) {
    const rd = (await db.collection('readings').doc(dup.refId).get().catch(() => ({ data: null }))).data;
    if (rd) return { ok: true, cards: rd.cards, result: rd.result, balance: await balanceOf(OPENID), readingId: rd._id, dedup: true };
  }

  // —— gate 余额（先拦一道，省掉无谓的模型调用）——
  const u = (await users.where({ openid: OPENID }).limit(1).get()).data[0];
  if (!u) return { ok: false, error: '未登录' };
  if ((u.balance || 0) < PRICE) return { ok: false, code: 'INSUFFICIENT', error: '积分不足', need: PRICE, balance: u.balance || 0 };

  // —— 服务端抽牌（权威，不交给前端，防作弊）——
  const cards = draw(3, POSITIONS);
  const cardsText = cards.map((c) => `${c.position}·${c.name}(${c.reversed ? '逆位' : '正位'})`).join('、');
  const userMsg = `领域：${domain}\n我的处境：${situation}\n\n抽到的牌：${cardsText}\n\n请按系统设定的 JSON 结构给出解读。`;

  // —— 调模型：20s 超时 + 失败/解析失败重试 1 次 + JSON 兜底 ——
  let result = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      const raw = await callModel({ system: SYSTEM_PROMPT, user: userMsg, json: true, maxTokens: 1500, temperature: 0.8 });
      const parsed = parseJSONLoose(raw);
      if (parsed && parsed.situation) result = parsed; // 基本健全性校验
    } catch (e) { /* 重试 */ }
  }

  // —— 降级：模型没接上，绝不扣点，把已抽到的牌带回去 ——
  if (!result) {
    return { ok: false, code: 'AI_FAIL', error: '牌已摊开，但解读没接上，积分没扣，再试一次就好。', cards, balance: u.balance || 0 };
  }

  // —— 成功才扣点：事务内重校验余额 + 扣点 + 写流水 + 存档（原子，防并发双扣）——
  const now = Date.now();
  let readingId = '';
  let newBalance = u.balance;
  try {
    await db.runTransaction(async (t) => {
      const cur = (await t.collection('users').doc(u._id).get()).data;
      if ((cur.balance || 0) < PRICE) throw new Error('INSUFFICIENT');
      const addRes = await t.collection('readings').add({
        data: { openid: OPENID, domain, situation, cards, result, fav: false, createdAt: now }
      });
      readingId = addRes._id;
      newBalance = (cur.balance || 0) - PRICE;
      await t.collection('users').doc(u._id).update({ data: { balance: newBalance } });
      await t.collection('ledger').add({
        data: {
          openid: OPENID, type: 'consume', amount: -PRICE, balanceAfter: newBalance,
          refType: 'reading', refId: readingId, requestId, meta: { domain }, createdAt: now
        }
      });
    });
  } catch (e) {
    if (String(e.message).indexOf('INSUFFICIENT') >= 0) {
      return { ok: false, code: 'INSUFFICIENT', error: '积分不足', need: PRICE, balance: await balanceOf(OPENID) };
    }
    return { ok: false, code: 'AI_FAIL', error: '扣点异常，积分未变动，再试一次。', cards, balance: await balanceOf(OPENID) };
  }

  return { ok: true, cards, result, balance: newBalance, readingId };
};
