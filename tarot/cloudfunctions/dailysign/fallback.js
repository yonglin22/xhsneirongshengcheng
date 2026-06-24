// 日签静态兜底：AI 不可用时按花色/大牌给一句话 + 宜/忌，保证日签永不硬失败。
const SUIT = {
  '权杖': { tip: '心里那点火还在，今天让它带你迈出一小步。', yi: '行动', ji: '空想' },
  '圣杯': { tip: '照顾一下自己的感受，它在跟你说真话。', yi: '倾听', ji: '压抑' },
  '宝剑': { tip: '想清楚比想得多更重要，给念头一点秩序。', yi: '梳理', ji: '钻牛角' },
  '星币': { tip: '把注意力放回手边能落地的小事上。', yi: '务实', ji: '攀比' }
};
const MAJOR = { tip: '今天适合慢下来，听听自己真正想要什么。', yi: '觉察', ji: '勉强' };

module.exports = function fallback(card) {
  const keys = Object.keys(SUIT);
  for (let i = 0; i < keys.length; i++) {
    if (card.name.indexOf(keys[i]) === 0) return SUIT[keys[i]];
  }
  return MAJOR;
};
