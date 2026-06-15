# 赛道智能体 · 小红书内容操盘台（前端 + 本地代理）

一个**赛道智能体解决方案平台**：选一个赛道（= 一个独立智能体），把「给方向 → 出可发笔记」做成一条可点的流水线。
**S1 选题 → S2–S7 创作流水线 → 成稿预览 → S8 合规自检**，每个赛道有自己的人设 / 合规红线 / 知识库 / 模板。
所有 API Key 只存服务端，不进浏览器；同源调用顺带消除 CORS。

## 目录
```
art-grad-frontend/
├── server.js          # Node 代理 + 静态服务（文本/图像/文件解析/图片代理）
├── package.json       # 依赖：officeparser（解析 Office/PDF）
├── .env.example       # 复制为 .env 填 key
├── index.html         # 首页：赛道选择 + 模板 + 「＋新增赛道」
├── 选题.html          # S1
├── 流水线.html        # S2–S7（手动逐步 / 一键自动跑完）
├── 成稿预览.html      # 真实小红书排版 + 多图轮播/深色 + 导出图文包 ZIP（html2canvas + JSZip，CDN）
├── 合规自检.html      # S8（可从流水线导入）
├── 智能体.html        # 智能体设置：人设 + 知识库(可上传文件) + 自定义 skills
└── assets/
    ├── atelier.css    # 共享设计系统（朱砂/宣纸/深色）
    ├── app.js         # 共享逻辑（赛道/人设注入/代理调用/跨页草稿）
    └── tracks.js      # 赛道（智能体）配置中心 + 自定义赛道
```

## 跑起来（首次 4 步）
```bash
cd art-grad-frontend
npm install                   # 安装 officeparser（知识库解析 Word/Excel/PPT/PDF 用）
cp .env.example .env          # 编辑 .env，填文本模型 key（必填）+ 智谱图像 key（选填）
node server.js                # 需要 Node 18+
```
浏览器打开 **http://localhost:8787**

> ⚠️ 必须从 `http://localhost` 打开，别直接双击 html（file:// 下 `/assets`、`/api` 全失效）。
> 以后再启动只需 `node server.js`；停止 `pkill -f "node server.js"`。

## 配什么模型（见 .env.example 详注）
- **文本**（写文案）：默认 DeepSeek（便宜、支付宝/微信付费、中文强）。也支持智谱 GLM、Kimi、Anthropic 官方/中转。
- **图像**（S6 封面）：智谱 CogView（`cogview-3-flash` 免费带水印；`cogview-4` 充值更好无水印）。也可换硅基流动 Kolors/FLUX。
- **视觉**（看对标图片）：智谱 **GLM-4V-Flash（免费）**，复用同一把智谱 key（`ZHIPU_VISION_MODEL`，默认 `glm-4v-flash`）。
- 顶栏小圆点 = 服务状态：绿=就绪，红=未连服务或没配 key。前端不暴露任何模型选择和 key。

## 计费 / 账号系统（手机号登录 + 积分钱包 + 后扣 + 充值）
默认**关**（`BILLING_ENABLED=false`，本地裸用不受影响）。要收费在 `.env` 开。需 **Node ≥ 22**（内置 `node:sqlite`，免编译）。
- **账号**：手机号验证码登录（dev 模式验证码直接回显）；注册送 200 积分；httpOnly Cookie 会话（现有 `/api/*` 调用自动带，无需改前端）。
- **后扣计费**：`/api/claude` 文本、`/api/image` 图像按 `price_rules` 扣（gate 余额→调 AI→成功才扣，失败/不足不收费；`request_id` 幂等防双扣）。视觉/工具类免费。
- **充值**：单次 ¥1 + 体验/基础/进阶/工作室四档；微信 Native v3（配齐 `WXPAY_*` 出二维码）；联调用 `/api/pay/dev-confirm`。积分**只从验签回调入账**，前端永不直接加分。
- **管理员**：`ADMIN_PHONES` 白名单里的手机号登录即「管理者」，账户页直接出**手动充/扣**面板（免令牌，会话鉴权）；也支持运维 `x-admin-token`。
- **角色切换**：管理员在账户页可随时 **👁 切为普通用户 / ↩ 切回管理者**（预览普通用户体验，服务端权限不变）。
- **跨设备**：登录后**创作历史/作品库**、**智能体配置（人设/KB/skills/配图风格）**自动云端同步（按账号存 SQLite），换设备登录即在；未登录回退本地 localStorage。
- 测试页：**`/账户.html`**（登录/充值/钱包流水/管理员）。计价与套餐详见 [`PRICING.md`](./PRICING.md)。

## 真实艺术热点（三源，绝不编造）+ RSSHub 部署
选题页「🔥 拉今日艺术热点」聚合三源，🎨 艺术相关排最前，挑一条 → 走「热点三步法」（映射考点 + A/B/C 形式）。
| 源 | 依赖 | 开关 |
|---|---|---|
| 🎨 **澎湃·艺术（直连搜索）** | **无需 Docker** | `.env` `ART_DIRECT=1`（默认开） |
| 🎨 **RSSHub 展讯**（豆瓣看展览/设计组） | 需 RSSHub（可选加分） | `.env` `RSSHUB_BASE` + `RSSHUB_ART_FEEDS` |
| 微博热搜（通用补充） | 无 | 始终 |

> **不依赖 Docker 也有艺术资讯**：澎湃直连是主力；RSSHub 只是锦上添花，关了也照常出艺术。

**RSSHub 部署（可选，要更多展讯才需要）**：
```bash
docker run -d --name rsshub --restart unless-stopped -p 1200:1200 -e CACHE_TYPE=memory diygod/rsshub
# 验证路由有内容（浏览器打开确认有 <item>），再填 .env：
#   RSSHUB_BASE=http://localhost:1200
#   RSSHUB_ART_FEEDS=/douban/group/art,/douban/group/artworld
```
- macOS 用 Docker Desktop 或 colima（`brew install colima && colima start`，无界面）跑守护进程；容器 `--restart unless-stopped` 会随守护进程自启。
- 想彻底不碰 Docker：不配 `RSSHUB_*` 即可，澎湃直连 + 微博热搜足够用。
- RSSHub 路由会变，去 `docs.rsshub.app` 找，**先在浏览器开 `BASE/路由` 确认有 `<item>` 再加**。

## .env 完整配置清单
```ini
# —— 文本模型（必填）——
API_FORMAT=openai            # openai(DeepSeek/智谱/Kimi) 或 anthropic
ANTHROPIC_BASE_URL=https://api.deepseek.com
ANTHROPIC_AUTH_STYLE=bearer
MODEL=deepseek-chat
ANTHROPIC_API_KEY=sk-xxx     # .env 始终覆盖外部环境变量（防 shell 残留的 Claude Code 变量串台）
# —— 图像 / 视觉（选填）——
ZHIPU_API_KEY=xxx            # 智谱（CogView 出图 + GLM-4V 看图同一把）
ZHIPU_IMAGE_MODEL=cogview-4
# 升级图像：IMAGE_PROVIDER=siliconflow / IMAGE_API_KEY=sk-xxx / IMAGE_MODEL=Kwai-Kolors/Kolors / IMAGE_SIZE=768x1024
# —— 计费（收费才开）——
BILLING_ENABLED=false        # true 启用登录+扣费
SIGNUP_GRANT_CREDITS=200
SESSION_SECRET=改成长随机串
ADMIN_TOKEN=改成你的令牌
ADMIN_PHONES=                 # 管理员手机号白名单，逗号分隔
# SMS_PROVIDER=               # 留空=dev 回显验证码；接入后只发不回显
# WXPAY_MCHID= / WXPAY_APIV3_KEY= / WXPAY_SERIAL= / WXPAY_PRIVATE_KEY_PATH= / WXPAY_APPID= / WXPAY_NOTIFY_URL=
# —— 艺术资讯三源 ——
ART_DIRECT=1                 # 澎湃直连艺术源（无需 Docker）
RSSHUB_BASE=                 # 自建 RSSHub 地址（选填）
RSSHUB_ART_FEEDS=            # 逗号分隔的艺术路由（选填）
```
> 改价改 `billing.js` 的 price_rules 那一行；改套餐改 `server.js` 的 `PACKS`（启动同步进库）。

## 核心能力
- **多赛道智能体**：首页切赛道，人设/合规/示例/模板整套切换；切换会清空上一篇数据不串味。
- **＋ 新增赛道**：首页一键创建自定义赛道，可「✨ AI 帮我写人设」，全站立即可用。
- **智能体设置页**：每个赛道独立配置 —
  - 基础人设（系统 prompt）
  - **知识库**：4 类（账号资料/行业知识/爆文样本/红线），每个可**多文件上传**，自动提取文字（Word/Excel/PPT/PDF/CSV/MD/TXT）→ 显示为**附件块**（点开可预览原文、✕ 可删），保存后**注入该赛道所有生成**。右上角实时显示「✓ 已生效：N 文件·约 X 字」；**超 8000 字黄字提醒**精简留精华。
  - **自定义 Skills**：加「名称 + 提示词（可用 `{{输入}}`）+ 可选 GitHub 链接（运行时拉取，`{{github}}` 引用）」，可当场运行。
- **创作流水线（S2–S7）**：
  - **S2 找对标**：选目标（涨粉/起号出单/变现…）→「找对标建议」给筛选维度 + 一份**可点的真实搜索清单**（关键词+建议排序）；每个词「看几篇」可拉真实笔记卡（封面/标题/作者/赞），点「用这篇拆解」自动抓进 ②。
  - **S2 抓取对标**：贴小红书链接，抓**封面/多图 + 标题 + 正文 + 话题标签**（缩略图 + 标签展示）。
  - **带图解析**：用 GLM-4V 把对标封面转成**视觉描述**，连同标题/正文/标签作为「对标参考」**贯穿 S3–S7**。
  - **每步可编辑**；**「▶ 一键按对标生成全套」**自动跑完正文+标题+封面文案+**封面配图**+标签。
  - **S6 多图封面**：按**对标图片张数**自动生成 N 张（封面+配图，每张对应正文一个要点、整组统一风格、构图贴对标），支持**📎 手动上传**、每张**🔄 单张重生成**、✕ 删除；生成图自动**裁底去「AI生成」水印**。
- **成稿预览**：真实小红书排版、**多图轮播**（导入即显示 S6 的 N 张图）、深色模式；**导出图文包 ZIP** = `01_封面.png`（含叠字）+ 全部 `配图.jpg`（去水印）+ `文案.txt`，解压即发。
- **合规自检（图文一起过审）**：按赛道红线逐项查文字 + 给改后版本（强制 JSON，稳定不崩）；**笔记图片**可从流水线导入/上传，**🔍 图片合规初查**用 GLM-4V 逐张查二维码/联系方式/绝对化文字/违规元素。

## 后端接口一览
| 路径 | 作用 |
|---|---|
| `POST /api/claude` | 文本生成（注入服务端 key；支持 `json:true` 强制合法 JSON） |
| `POST /api/image` | 封面图生成（智谱/硅基流动/OpenAI 兼容，统一成 `{data:[{url}]}`） |
| `POST /api/vision` | 视觉解析（GLM-4V 看对标封面/配图，返回中文描述；服务端取图转 base64 绕防盗链） |
| `GET  /api/img-proxy?u=` | 把第三方图床的图变同源（显示 + 导出用） |
| `POST /api/extract` | 上传文件 → 纯文本（officeparser 解析 Office/PDF，md/csv 直读；上限 60MB） |
| `POST /api/fetch-note` | 抓取小红书笔记：标题 + 正文 + 多图 + 话题标签（优先解析内嵌 JSON，og 兜底；受平台反爬限制） |
| `POST /api/search` | 抓小红书搜索页解析若干笔记（找对标「看几篇」用；**搜索页反爬严，常返空**，前端回退到搜索链接） |
| `POST /api/fetch-url` | 抓取网页/GitHub 文本（自动 blob→raw，供自定义 skill 引用） |
| `GET  /api/hot-art` | 真实艺术热点（澎湃直连 + RSSHub + 微博，🎨 艺术相关在前） |
| `GET  /api/health` | 服务/接口就绪状态（含 `billing` 开关） |
| **计费/账号** | `POST /api/auth/send-code` `·login` `·logout` `·profile` · `GET /api/auth/me` |
| | `GET /api/price`（计价+套餐）· `GET /api/wallet` · `POST /api/order/create` `·pay/dev-confirm` `·pay/notify` |
| | `POST /api/admin/adjust`（手动充扣）· `GET /api/admin/user`（需 `x-admin-token` 或管理员会话） |
| **云同步** | `GET/POST /api/history` `·/get` `·/delete`（作品库）· `GET /api/agent-config/all` · `POST /api/agent-config`（智能体配置） |

## 数据怎么在页面间流转
- 选题「用它去创作」→ 写入 `localStorage` 草稿 `ag_draft` → 流水线自动带入。
- 流水线每步（含封面图）存进同一份草稿；成稿预览/合规自检「从流水线导入」直接拿到。
- 智能体配置存 `ag_cfg_<赛道id>`；自定义赛道存 `ag_custom_tracks`。均在本机浏览器。

## 已知限制（现实约束，非 bug）
- **找对标「看几篇」常抓不到**：小红书**搜索页反爬比笔记页严得多**（多为登录墙），`/api/search` 实测常返空，前端会自动回退到「去搜 →」搜索链接让你手动挑。笔记**详情页**（你贴的单篇链接）则能抓。要稳定的真实笔记列表需接**第三方小红书数据 API**（新红/蝉小红/灰豚等，付费，可后续按需接入）。AI 绝不编造笔记链接（违反「不编造」铁律）。
- **对标抓取受反爬限制**：能在桌面浏览器**直接打开（不跳登录）**的链接成功率高；抓不到时手动粘贴正文。
- **AI 配图带"AI生成"水印**：智谱按法规烧进像素，删不掉；预览/导出已**裁掉底部一条**遮挡。
- **视觉解析**：DeepSeek 是纯文本，看不到图；图片理解由智谱 **GLM-4V** 完成（转成文字描述再喂给文本模型）。

## 上线提醒
- 本地自用原型。公网部署需：妥善保管 `.env`、给 `/api/*` 加鉴权/限流、固定允许来源、`.env` 与 `node_modules` 已在 `.gitignore`。
- 发布前所有稿件仍需 **S8 合规自检 + 运营终审**（产品内置的两个人审节点）。
