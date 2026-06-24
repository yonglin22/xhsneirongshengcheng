# FateTell 塔罗小程序 · 部署手册（P0）

一个微信小程序：**免费「每日一签」养习惯 → 付费「深度解读」变现 → 往私域沉淀**。
原生小程序 + 微信云开发（云函数 + 云数据库）。本手册让你从 0 到「在开发者工具里真跑、能走通付费」。

---

## 0. 你需要先有

| 必备 | 说明 |
|---|---|
| 微信小程序 AppID | [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册。**云开发支付需企业主体**（个人主体只能用「模拟支付」联调，不能上线收款） |
| 微信开发者工具 | [下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) |
| 一个模型 API Key | 默认 DeepSeek（便宜、中文强）；也支持智谱 GLM、Kimi、Anthropic |

---

## 1. 导入项目

1. 开发者工具 → 导入项目 → 目录选 **`tarot/`** 这一层（含 `project.config.json`）。
2. 填上你的 AppID（或先用「测试号」联调，但测试号不能用云开发，建议直接用正式 AppID）。
3. 打开 `project.config.json`，把 `"appid"` 改成你的 AppID。

## 2. 开通云开发，拿环境 ID

1. 开发者工具顶部点「云开发」→ 开通（新用户有免费额度）→ 新建一个环境。
2. 记下**环境 ID**（形如 `fatetell-3xxxx`）。
3. 打开 `miniprogram/config.js`，填：
   - `cloudEnv`：上面的环境 ID
   - `serviceWechat`：你的客服/私域微信号（解读页、我的页展示）
   - `mockPay`：联调先留 `true`（模拟支付）

## 3. 配置云函数环境变量

云开发控制台 → 云函数 → 分别给 **reading** 和 **dailysign** 配「环境变量」（两个都要配模型 key）：

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `AI_KEY` | ✅ | — | 模型 API Key |
| `AI_PROVIDER` | | `openai` | `openai`（DeepSeek/智谱/Kimi）或 `anthropic` |
| `AI_BASE_URL` | | `https://api.deepseek.com` | 模型网关地址 |
| `AI_MODEL` | | `deepseek-chat` | 模型名 |

给 **login** 配（可选）：`SIGNUP_GRANT_CREDITS`（新人赠送，默认 300）。
给 **reading** 配（可选）：`PRICE_READING`（深度解读单价，默认 290）。
给 **pay** 配（联调必配）：`ALLOW_MOCK_PAY=1`（开启模拟支付；**上线删掉**）。

> 智谱示例：`AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4`、`AI_MODEL=glm-4-flash`
> Anthropic 示例：`AI_PROVIDER=anthropic`、`AI_BASE_URL=https://api.anthropic.com`、`AI_MODEL=claude-sonnet-4-6`

## 4. 上传部署云函数

`cloudfunctions/` 下 **7 个**函数：`init / login / dailysign / reading / user / pay / payCallback`。
逐个右键 → **「上传并部署：云端安装依赖」**（会自动装 `wx-server-sdk`，无需本地 npm）。

## 5. 建表 + 设权限（跑一次）

1. 右键 **init** → 「云端测试」→ 运行。返回 `ok:true` 即 5 张表（users/ledger/readings/dailysigns/orders）建好。
2. 云开发控制台 → 数据库 → 5 张表逐个把「权限设置」改成 **「仅创建者可读写」或「所有用户不可读写」**。
   （前端只通过云函数访问数据库，云函数是管理员权限，会绕过这条；这样设防止用户直接读写库。）

## 6. 在开发者工具里跑通闭环（模拟支付）

此时 `config.mockPay=true` + 云函数 `pay` 有 `ALLOW_MOCK_PAY=1`：

- **每日一签**：首页自动出今日牌 + 一句话 + 宜/忌 + 连签。
- **问事**：选姻缘/事业/财运 + 写处境（≥4字）→ 抽牌动画 → AI 结构化解读（逐字揭示）。
- **充值**：我的 → 充值 → 点任意包 → 立即到账（模拟）。
- **扣点**：余额够时问事会扣 `PRICE_READING`；不够会拦你去充值。
- **历史/收藏**：我的页可看记录、点开回看、收藏。

走通这套，你的 **P0 付费闭环**就成立了。

## 7. 上线真支付（需企业主体）

1. 云开发控制台 → 开通**微信支付/云支付**，绑定你的微信支付商户号。
2. 给 **pay** 配环境变量 `WX_SUB_MCH_ID=你的商户号`；**删除** `ALLOW_MOCK_PAY`。
3. `config.js` 把 `mockPay` 改成 `false`。
4. `pay/index.js` 里 `cloud.cloudPay.unifiedOrder` 的字段按你开通的云支付类型核对（普通商户/服务商字段略有差异，以云支付官方文档为准）。
5. 真机预览测一笔小额，确认 `payCallback` 入账、`orders` 变 `paid`、`ledger` 有 `recharge`。

---

## 改东西去哪

| 想改 | 改哪 |
|---|---|
| 深度解读价格 | reading 环境变量 `PRICE_READING`（或代码默认值） |
| 新人赠送 | login 环境变量 `SIGNUP_GRANT_CREDITS` |
| 充值套餐/价格 | `cloudfunctions/pay/index.js` 的 `PACKS`（唯一真源，前端自动取） |
| 解读的「说中感」/分寸 | `cloudfunctions/reading/prompt.js`（**核心资产**，反复打磨这里） |
| 日签提示口吻/兜底 | `dailysign/index.js` 的短 prompt + `dailysign/fallback.js` |
| 换模型 | reading + dailysign 的 `AI_*` 环境变量 |
| 视觉风格 | `miniprogram/app.wxss`（水墨设计系统） |

## 合规（写进了产品，别拆）

- 财运只停在「财富心态/事业方向/决策参考」，不碰具体标的与买卖时点；事业不预测成败、不替人做去留；感情不替人做分合。这些是 `prompt.js` 的红线。
- 入口页 + 解读结尾都有免责：「仅供自我觉察与决策参考，不构成确定性预测或投资建议」。
- ⚠️ **类目审核**：占卜/命理在微信属高风险类目，提交审核时类目选择、文案框定（建议往"心理/情绪自我觉察"靠）会影响过审，**不保证一次过**。少惹投诉是这个赛道长期活下去的根本。

## 已知边界（现实约束）

- 本环境（Claude Code）无法预览小程序，需你在微信开发者工具里运行。
- 真支付需企业主体 + 商户号；个人主体只能用模拟支付联调。
- 日签免费但**一天一次**（DB 锁定），成本可控；深度解读每次一次模型调用，注意单价与模型成本的账（见你《P0 验证指标表》）。

---

## 数据结构（云数据库）

- **users**：openid, balance, streakCount, lastSignDate, addedPrivate, createdAt
- **ledger**：openid, type(recharge/consume/grant/refund), amount(±), balanceAfter, refType, refId, requestId, meta, createdAt
- **readings**：openid, domain, situation, cards[], result{}, fav, createdAt
- **dailysigns**：openid, date, card, tip, yi, ji, energy, fav, createdAt
- **orders**：openid, outTradeNo, packId, amountFen, credits, status(pending/paid), createdAt, paidAt
