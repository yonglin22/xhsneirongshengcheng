/**
 * 能量向量 · Energy Vector —— 命理选品系统「单一可信源」中间层 (v1.0)
 *
 * 约定：三类解读智能体只「写」向量，选品引擎只「读」向量。
 *   - 五行命理/八字 → 写 wuxing（五行盈缺，五行的唯一真值来源）
 *   - 塔罗 / 星盘(本命) / 合盘 / 情绪 → 写 themes（议题，受控词表）
 *   - 合盘 → 额外写 relation（关系轴）
 * 选品引擎 selectBeads(person) 把向量映射到打了同样标签的 SKU。
 *
 * 铁律：agent 之间不越界（塔罗不写五行、五行不写关系议题）；themes 只能取受控词表。
 */

/* ───────── 受控词表（enum，禁止自由造词） ───────── */

export type Element = 'jin' | 'mu' | 'shui' | 'huo' | 'tu'; // 金 木 水 火 土
export const ELEMENTS: Element[] = ['jin', 'mu', 'shui', 'huo', 'tu'];
export const ELEMENT_CN: Record<Element, string> = { jin: '金', mu: '木', shui: '水', huo: '火', tu: '土' };

/** 议题受控词表：所有 agent 的 themes 必须取自这里。新增议题=改版本+补映射表。 */
export type Theme =
  | '情感决断' | '情绪安定' | '沟通表达' | '信任松绑' | '自我价值'
  | '桃花招缘' | '关系承诺' | '边界建立' | '疗愈放下'
  | '专注定力' | '睡眠安神' | '焦虑纾解' | '事业推进' | '财务稳健';
export const THEMES: Theme[] = [
  '情感决断','情绪安定','沟通表达','信任松绑','自我价值',
  '桃花招缘','关系承诺','边界建立','疗愈放下',
  '专注定力','睡眠安神','焦虑纾解','事业推进','财务稳健',
];

export type AgentId = 'wuxing' | 'tarot' | 'natal' | 'synastry' | 'emotion';
export type Scene = 'ambiguous' | 'together' | 'reconcile' | 'single';

/* ───────── 向量结构 ───────── */

/** 五行盈缺（仅八字/五行命理 agent 写）。分数为相对能量 0..100。 */
export interface WuxingProfile {
  scores: Record<Element, number>; // 各元素相对能量 0..100
  lack: Element[];                  // 最缺（需补），按优先级排序
  excess: Element[];               // 过旺（需泄/耗）
  favorable: Element[];            // 喜用神（补之有利）——补石首选依据
  avoid: Element[];                // 忌神（不可加强）——补石绝对红线
  dayMaster?: Element;             // 日主
  source: 'bazi' | 'bazi_simplified'; // 精确盘 / P0 简化盘
}

/** 一条议题标签（可多 agent 贡献同一议题，合成时按 theme 聚合）。 */
export interface ThemeTag {
  theme: Theme;
  weight: number;   // 0..1 当前强度
  source: AgentId;  // 谁贡献的（便于溯源/调参）
}

/** 单个人的向量。her 必有；ta 仅合盘有。 */
export interface PersonVector {
  wuxing?: WuxingProfile;               // 缺省=未接八字，选品降级为纯议题选石
  themes: ThemeTag[];
  taboo?: { colors?: string[]; materials?: string[] };
  prefer?: { colors?: string[]; budget?: [number, number] };
}

/** 关系轴（仅合盘 agent 写）。summary 供文案，needs 供选品。 */
export interface RelationAxis {
  summary: string;                       // 关系轴一句话（不参与结构化匹配）
  needs: { her: Theme[]; ta: Theme[] };  // 关系里各自要补的议题
  palette_hint?: 'warm' | 'cool' | 'neutral';
  anchorTheme?: Theme;                   // 「关系锚」同款珠对应的议题（如 情绪安定→静心香珠）
}

/** 顶层向量：一次解读的完整产出。 */
export interface EnergyVector {
  version: '1.0';
  scene?: Scene;
  her: PersonVector;
  ta?: PersonVector;         // 合盘才有
  relation?: RelationAxis;   // 合盘才有
  meta: { generatedAt: string; agents: AgentId[]; requestId: string };
}

/* ───────── SKU 标签（选品引擎「读」的另一端） ───────── */

export type SkuKind = 'main' | 'accent' | 'spacer' | 'incense' | 'pendant';
export interface SkuTags {
  id: string;
  name: string;
  kind: SkuKind;
  element?: Element;      // 主五行属性（补五行用）
  colorFamily: string;   // 色系
  themes: Theme[];        // 功用议题
  price: number;
  priceWholesale?: number;
  stock: 'ready' | 'custom';
  incenseFormula?: string; // 香珠：香方名（功用表述为气味体验，非疗效）
}

/* ───────── 契约：写入 / 合成 / 读取 ───────── */

/** 各 agent 只允许写的字段（越界即校验失败）。 */
export const WRITE_SCOPE: Record<AgentId, string[]> = {
  wuxing:   ['her.wuxing', 'ta.wuxing'],
  tarot:    ['her.themes', 'ta.themes'],
  natal:    ['her.themes', 'ta.themes'],
  synastry: ['relation', 'her.themes', 'ta.themes', 'scene'],
  emotion:  ['her.themes'],
};

/** 合成：把多 agent 的 themes 聚合到每个人（同议题取加权上限，去重）。 */
export function mergeThemes(tags: ThemeTag[]): ThemeTag[] {
  const by = new Map<Theme, ThemeTag>();
  for (const t of tags) {
    const cur = by.get(t.theme);
    // 同议题多来源：weight 取「1-∏(1-w)」软饱和，source 记首个
    if (!cur) by.set(t.theme, { ...t });
    else cur.weight = 1 - (1 - cur.weight) * (1 - t.weight);
  }
  return [...by.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * 选品引擎入口（P0 规则版签名；实现见 PRD §四映射规则）。
 * 铁律：补五行只在 favorable/lack 里选，绝不落在 avoid（忌神）上；
 *       wuxing 缺省时降级为纯 themes 选石，并在结果标 degraded。
 */
export interface BeadPlan { skuSeq: string[]; reason: string; degraded: boolean }
export type SelectBeads = (
  person: PersonVector,
  opts: { wristCm: number; budget?: [number, number]; anchorTheme?: Theme }
) => BeadPlan;

/* ───────── 校验 ───────── */

export function validateEnergyVector(v: EnergyVector): string[] {
  const errs: string[] = [];
  if (v.version !== '1.0') errs.push(`version 必须为 '1.0'，收到 ${v.version}`);
  const checkPerson = (p: PersonVector | undefined, who: string) => {
    if (!p) return;
    for (const t of p.themes) {
      if (!THEMES.includes(t.theme)) errs.push(`${who}.themes 出现非法议题「${t.theme}」`);
      if (t.weight < 0 || t.weight > 1) errs.push(`${who}.themes[${t.theme}].weight 越界(0..1)`);
    }
    if (p.wuxing) {
      for (const e of ELEMENTS) {
        const s = p.wuxing.scores[e];
        if (typeof s !== 'number' || s < 0 || s > 100) errs.push(`${who}.wuxing.scores.${e} 越界(0..100)`);
      }
      const bad = p.wuxing.favorable.filter((e) => p.wuxing!.avoid.includes(e));
      if (bad.length) errs.push(`${who}.wuxing 喜用神与忌神冲突：${bad.map((e) => ELEMENT_CN[e]).join('')}`);
    }
  };
  checkPerson(v.her, 'her');
  checkPerson(v.ta, 'ta');
  if (v.ta && !v.relation) errs.push('有 ta 但缺 relation（合盘必须产出关系轴）');
  return errs;
}
