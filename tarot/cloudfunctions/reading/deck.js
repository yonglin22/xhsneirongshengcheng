// 完整 78 张塔罗牌库 + Fisher–Yates 真随机抽牌。抽牌与领域无关，领域只走进 Prompt。
const MAJOR = [
  ['愚人', '0'], ['魔术师', 'I'], ['女祭司', 'II'], ['皇后', 'III'], ['皇帝', 'IV'], ['教皇', 'V'],
  ['恋人', 'VI'], ['战车', 'VII'], ['力量', 'VIII'], ['隐士', 'IX'], ['命运之轮', 'X'], ['正义', 'XI'],
  ['倒吊人', 'XII'], ['死神', 'XIII'], ['节制', 'XIV'], ['恶魔', 'XV'], ['高塔', 'XVI'], ['星星', 'XVII'],
  ['月亮', 'XVIII'], ['太阳', 'XIX'], ['审判', 'XX'], ['世界', 'XXI']
];
const SUITS = [['权杖', '杖'], ['圣杯', '杯'], ['宝剑', '剑'], ['星币', '币']];
const RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍从', '骑士', '皇后', '国王'];

const DECK = [];
MAJOR.forEach(([name, mark]) => DECK.push({ name, mark }));
SUITS.forEach(([suit, glyph]) => RANKS.forEach((r) => DECK.push({ name: suit + r, mark: glyph })));

function draw(n, positions) {
  const d = DECK.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = d[i]; d[i] = d[j]; d[j] = tmp;
  }
  return d.slice(0, n).map((c, i) => ({
    position: (positions && positions[i]) || ('位置' + (i + 1)),
    name: c.name,
    mark: c.mark,
    reversed: Math.random() < 0.5
  }));
}

module.exports = { DECK, draw };
