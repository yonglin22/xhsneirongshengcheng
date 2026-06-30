# 朱砂 · 设备投屏工作室（PC Electron + USB/ADB）

PRD 里 huohuoAI 工作室那一端的脚手架：把多台安卓真机 USB 接到一台电脑，**实时投屏成网格看板**，每台真机作为一个执行设备，跑「养号 / 截流计划」——直接对接你网页端已经做好的**执行端协议**（token 拉任务 / 进度回报 / 数据回流 / AI 评论 / 风控熔断）。

> 这是**独立桌面工程**，不在网页服务里运行。需要你在本机（装了 Node + adb）构建运行。

## 它能做什么（已实现骨架）
- 枚举 USB/ADB 在线真机，自动成网格。
- 投屏预览：默认 `adb screencap` 截图轮询（无需额外软件）；装了 `scrcpy` 可点「实时投屏」开真投屏窗口。
- 每台真机一个**执行端协议客户端**（`agent.js`）：心跳上线 → `/api/dispatch/pull` 领任务 → 拟人滑动/点赞/评论（贝塞尔滑动样例已给）→ `/api/dispatch/report` 回报进度 → `/api/dispatch/done` 完成（验证码即 `ok:false+risk` 熔断）→ `/api/gen-comment` 生成评论。
- 这些设备会**同时出现在网页端「设备看板」**（同一套协议、同一个朱砂账号）。

## 还需你适配（已留 TODO 钩子，在 `agent.js`）
真机在小红书 App 里的**具体点击坐标 / 控件**随机型分辨率不同，需按你的真机标定：
- `_openXhs`：拉起后进搜索页、输入关键词
- `_tapLike` / `_tapFav` / `_postComment`：点赞/收藏/评论的坐标（中文输入建议装 ADBKeyBoard 或走剪贴板）
- `_riskHit`：截一帧做验证码/异常弹窗识别（OCR 或模板匹配）——这是风控熔断的触发源

## 前置环境
1. Node ≥ 18、`adb`（Android platform-tools）在 PATH 中。
2. 投屏推荐装 [`scrcpy`](https://github.com/Genymobile/scrcpy)。
3. 手机：开发者选项 → USB 调试打开；首次连接在手机上「允许调试」。

## 运行
```bash
cd desktop-studio
npm install        # 装 electron
npm start          # 启动工作室
```
打包安装包：`npm run dist`（electron-builder）。

## 接入步骤
1. 网页端「设备看板 → 接入真机/脚本」给每台设备**生成执行端 token**（`zd_...`）。
2. 工作室里每张设备卡片粘贴对应 token → 点「接入」。
3. 在网页端「养号/截流计划」点 **📤 下发** 选这些账号 → 真机自动领取并开始执行，投屏看板实时显示进度。

## 配置
`~/.zhusha-studio.json` 自动保存：`serverBase`（默认 `https://yonglin.chat`）与每台设备的 token。

## 架构对应
| PRD huohuoAI 工作室 | 本脚手架 |
|---|---|
| USB/ADB 多机投屏（≤200 台） | `main.js` listDevices + screencap/scrcpy 网格 |
| 创建计划 / 任务下发 | 复用网页端「养号·截流计划」+ `/api/dispatch` |
| AOA 脚本引擎 / 拟人行为 | `agent.js`（贝塞尔滑动 + 概率互动 + 留坐标 TODO） |
| 大模型评论 / 风控熔断 | `/api/gen-comment` + `done(ok:false,risk)` |
| 数据上报 | `/api/dispatch/report` + `/api/note-stats` |
