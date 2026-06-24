// 一次性建表：在开发者工具里右键 init → 云端测试 跑一次即可（幂等，可重复跑）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTIONS = ['users', 'ledger', 'readings', 'dailysigns', 'orders'];

exports.main = async () => {
  const done = [];
  for (const c of COLLECTIONS) {
    try {
      await db.createCollection(c);
      done.push(c + '：已创建');
    } catch (e) {
      // -501001 / 已存在 等：视为成功
      done.push(c + '：' + (e.errCode === -501001 || /already|存在/.test(String(e.errMsg || e.message)) ? '已存在' : (e.errMsg || e.message)));
    }
  }
  return { ok: true, done };
};
